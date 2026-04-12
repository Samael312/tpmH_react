from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
import logging

from app.db.base import get_db
from app.auth.dependencies import (
    get_current_user,
    get_current_student,
    get_current_teacher_or_teacher_admin,
    get_current_staff,
    get_currtent_user,
)
from app.models.user import User
from app.models.class_ import Class
from app.models.payment import Payment, TeacherWallet, Withdrawal
from app.models.package import Enrollment
from app.models.package import Package
from app.models.teacher import TeacherProfile
from app.models.payment_config import PaymentConfig
from app.core.timezone import utc_now
from app.schemas.payments import (
    PaymentConfigResponse,
    UpdatePaymentConfigRequest,
    BookAndPayRequest,
    SubmitPaymentReceiptRequest,
    PaymentResponse,
    ValidatePaymentRequest,
    WalletResponse,
    WithdrawalRequest,
    WithdrawalResponse,
)
from app.core.class_logic import can_book_slot

router = APIRouter()
logger = logging.getLogger(__name__)


# ─── CONFIGURACIÓN DE PAGOS ──────────────────────────────────────────────────

@router.get("/config", response_model=PaymentConfigResponse)
def get_payment_config(db: Session = Depends(get_db)):
    """
    Devuelve la configuración de métodos de pago.
    Endpoint público — el estudiante lo consulta antes de reservar
    para saber cómo pagar.
    """
    config = db.query(PaymentConfig).first()

    if not config:
        # Si no hay config creamos una por defecto
        config = PaymentConfig()
        db.add(config)
        db.commit()
        db.refresh(config)

    has_any = config.paypal_enabled or config.binance_enabled

    return PaymentConfigResponse(
        paypal_enabled=config.paypal_enabled,
        binance_enabled=config.binance_enabled,
        paypal_email=config.paypal_email if config.paypal_enabled else None,
        binance_address=config.binance_address if config.binance_enabled else None,
        binance_network=config.binance_network if config.binance_enabled else None,
        whatsapp_number=config.whatsapp_number,
        has_any_method=has_any,
    )


@router.patch("/config")
def update_payment_config(
    data: UpdatePaymentConfigRequest,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db)
):
    """Solo staff puede modificar la configuración de pagos"""
    config = db.query(PaymentConfig).first()
    if not config:
        config = PaymentConfig()
        db.add(config)

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(config, field, value)

    config.updated_by = current_user.id
    db.commit()

    return {"message": "Configuración actualizada"}


# ─── FLUJO DE RESERVA Y PAGO ─────────────────────────────────────────────────

@router.post("/book", status_code=status.HTTP_201_CREATED)
def book_class(
    data: BookAndPayRequest,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    """
    Paso 1 — El estudiante reserva un slot.
    La clase queda en estado 'pending'.
    El slot NO está bloqueado todavía — se bloquea al subir el comprobante.
    """
    # Verificar enrollment activo
    enrollment = db.query(Enrollment).filter(
        Enrollment.id == data.enrollment_id,
        Enrollment.student_id == current_user.student_profile.id,
        Enrollment.status == "active"
    ).first()

    if not enrollment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Enrollment no encontrado o no activo"
        )

    if enrollment.classes_used >= enrollment.classes_total:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Has agotado todas las clases de este paquete"
        )

    # Verificar disponibilidad del slot
    can_book, error_msg = can_book_slot(
        start_time_utc=data.start_time_utc,
        teacher_id=enrollment.teacher_id,
        student_id=current_user.student_profile.id,
        db=db
    )

    if not can_book:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=error_msg
        )

    # Crear la clase en estado pending
    new_class = Class(
        enrollment_id=enrollment.id,
        teacher_id=enrollment.teacher_id,
        student_id=current_user.student_profile.id,
        start_time_utc=data.start_time_utc,
        end_time_utc=data.end_time_utc,
        duration=data.duration_minutes,
        teacher_timezone=enrollment.teacher.timezone
            if hasattr(enrollment.teacher, 'timezone') else None,
        student_timezone=current_user.student_profile.timezone,
        status="pending"
    )

    db.add(new_class)
    db.commit()
    db.refresh(new_class)

    # Devolver la config de pagos junto con la clase
    # para que el frontend sepa cómo debe pagar
    config = db.query(PaymentConfig).first()

    return {
        "class_id": new_class.id,
        "status": new_class.status,
        "message": "Slot reservado. Sube el comprobante para confirmar.",
        "payment_instructions": {
            "paypal_enabled": config.paypal_enabled if config else False,
            "binance_enabled": config.binance_enabled if config else False,
            "paypal_email": config.paypal_email if config else None,
            "binance_address": config.binance_address if config else None,
            "binance_network": config.binance_network if config else None,
            "whatsapp_number": config.whatsapp_number if config else None,
        }
    }


@router.post("/submit-receipt")
def submit_payment_receipt(
    data: SubmitPaymentReceiptRequest,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    """
    Paso 2 — El estudiante sube el comprobante de pago.
    La clase pasa a 'pending_payment' y el slot queda BLOQUEADO.
    Nadie más puede reservar ese horario.
    """
    # Verificar que la clase existe y pertenece al estudiante
    class_ = db.query(Class).filter(
        Class.id == data.class_id,
        Class.student_id == current_user.student_profile.id,
        Class.status == "pending"
    ).first()

    if not class_:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Clase no encontrada o ya tiene un comprobante"
        )

    # Verificar que el método de pago está habilitado
    config = db.query(PaymentConfig).first()
    if config:
        if data.payment_method == "paypal" and not config.paypal_enabled:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="PayPal no está habilitado actualmente"
            )
        if data.payment_method == "binance" and not config.binance_enabled:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Binance no está habilitado actualmente"
            )

    # Calcular distribución según comisión del profesor
    teacher = db.query(TeacherProfile).filter(
        TeacherProfile.id == class_.teacher_id
    ).first()

    commission = teacher.commission_rate if teacher else 0.15
    amount_platform = round(data.amount * commission, 2)
    amount_teacher = round(data.amount - amount_platform, 2)

    # Crear registro de pago
    payment = Payment(
        class_id=class_.id,
        enrollment_id=class_.enrollment_id,
        student_id=current_user.student_profile.id,
        teacher_id=class_.teacher_id,
        amount_total=data.amount,
        amount_teacher=amount_teacher,
        amount_platform=amount_platform,
        payment_method=data.payment_method,
        receipt_url=data.receipt_url,
        receipt_public_id=data.receipt_public_id,
        transaction_id=data.transaction_id,
        status="pending_review"
    )
    db.add(payment)

    # Cambiar estado de la clase — slot bloqueado
    class_.status = "pending_payment"

    db.commit()
    db.refresh(payment)

    return {
        "payment_id": payment.id,
        "class_status": "pending_payment",
        "message": "Comprobante recibido. El staff verificará el pago pronto."
    }


# ─── VALIDACIÓN POR STAFF ────────────────────────────────────────────────────

@router.get("/pending-review")
def get_payments_pending_review(
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db)
):
    """
    Lista todos los pagos pendientes de validación.
    El staff ve los comprobantes aquí para aprobar o rechazar.
    """
    payments = db.query(Payment).filter(
        Payment.status == "pending_review"
    ).order_by(Payment.created_at.asc()).all()

    result = []
    for p in payments:
        class_ = db.query(Class).filter(Class.id == p.class_id).first()
        student_user = p.student.user if hasattr(p, 'student') else None

        result.append({
            "payment_id": p.id,
            "class_id": p.class_id,
            "student_name": f"{student_user.name} {student_user.surname}"
                if student_user else "Unknown",
            "student_username": student_user.username if student_user else "Unknown",
            "amount": p.amount_total,
            "payment_method": p.payment_method,
            "transaction_id": p.transaction_id,
            "receipt_url": p.receipt_url,
            "class_start_utc": class_.start_time_utc if class_ else None,
            "submitted_at": p.created_at,
        })

    return result


@router.patch("/{payment_id}/validate")
def validate_payment(
    payment_id: int,
    data: ValidatePaymentRequest,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db)
):
    """
    El staff aprueba o rechaza un comprobante.

    Si aprueba:
    - La clase pasa a 'confirmed'
    - Se acredita el balance al profesor
    - El link de Meet queda disponible para el estudiante

    Si rechaza:
    - La clase vuelve a 'pending' (el slot se libera)
    - El estudiante puede subir otro comprobante
    """
    payment = db.query(Payment).filter(
        Payment.id == payment_id,
        Payment.status == "pending_review"
    ).first()

    if not payment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pago no encontrado o ya procesado"
        )

    now = utc_now()

    if data.action == "approve":
        if not data.meet_link:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Debes proporcionar el link de Google Meet al aprobar"
            )

        # Actualizar pago
        payment.status = "approved"
        payment.validated_by = current_user.id
        payment.validated_at = now

        # Confirmar la clase y añadir el Meet link
        class_ = db.query(Class).filter(Class.id == payment.class_id).first()
        if class_:
            class_.status = "confirmed"
            class_.meet_link = data.meet_link

        # Acreditar balance al profesor
        wallet = db.query(TeacherWallet).filter(
            TeacherWallet.teacher_id == payment.teacher_id
        ).first()

        if not wallet:
            # Crear wallet si no existe
            wallet = TeacherWallet(
                teacher_id=payment.teacher_id,
                available_balance=0.0,
                total_earned=0.0,
                total_withdrawn=0.0,
            )
            db.add(wallet)
            db.flush()

        wallet.available_balance += payment.amount_teacher
        wallet.total_earned += payment.amount_teacher

        db.commit()

        return {
            "message": "Pago aprobado. Clase confirmada y balance acreditado.",
            "class_status": "confirmed",
            "amount_credited": payment.amount_teacher,
        }

    else:  # reject
        if not data.rejection_reason:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Debes proporcionar el motivo del rechazo"
            )

        # Rechazar pago
        payment.status = "rejected"
        payment.validated_by = current_user.id
        payment.validated_at = now
        payment.rejection_reason = data.rejection_reason

        # Liberar el slot — vuelve a pending
        class_ = db.query(Class).filter(Class.id == payment.class_id).first()
        if class_:
            class_.status = "pending"
            class_.meet_link = None

        db.commit()

        return {
            "message": "Pago rechazado. El estudiante puede subir nuevo comprobante.",
            "class_status": "pending",
            "rejection_reason": data.rejection_reason,
        }


# ─── ESTUDIANTE — Ver pagos ──────────────────────────────────────────────────

@router.get("/my-payments", response_model=List[PaymentResponse])
def get_my_payments_student(
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    """Historial de pagos del estudiante"""
    return db.query(Payment).filter(
        Payment.student_id == current_user.student_profile.id
    ).order_by(Payment.created_at.desc()).all()


# ─── PROFESOR — Wallet y retiros ─────────────────────────────────────────────

@router.get("/my-wallet", response_model=WalletResponse)
def get_my_wallet(
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db)
):
    """Balance de la billetera virtual del profesor"""
    teacher = current_user.teacher_profile
    if not teacher:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Perfil de profesor no encontrado"
        )

    wallet = db.query(TeacherWallet).filter(
        TeacherWallet.teacher_id == teacher.id
    ).first()

    if not wallet:
        # Devolver wallet vacía si no existe
        return WalletResponse(
            available_balance=0.0,
            total_earned=0.0,
            total_withdrawn=0.0,
        )

    return wallet


@router.post(
    "/request-withdrawal",
    response_model=WithdrawalResponse,
    status_code=status.HTTP_201_CREATED
)
def request_withdrawal(
    data: WithdrawalRequest,
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db)
):
    """El profesor solicita retirar sus ganancias"""
    teacher = current_user.teacher_profile

    wallet = db.query(TeacherWallet).filter(
        TeacherWallet.teacher_id == teacher.id
    ).first()

    if not wallet or wallet.available_balance < data.amount:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Balance insuficiente. "
                   f"Disponible: ${wallet.available_balance:.2f if wallet else 0}"
        )

    # Verificar que no hay retiro pendiente
    pending = db.query(Withdrawal).filter(
        Withdrawal.teacher_id == teacher.id,
        Withdrawal.status == "pending"
    ).first()

    if pending:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ya tienes un retiro pendiente de procesar"
        )

    withdrawal = Withdrawal(
        teacher_id=teacher.id,
        amount=data.amount,
        destination_method=data.destination_method,
        destination_details=data.destination_details,
        status="pending"
    )
    db.add(withdrawal)
    db.commit()
    db.refresh(withdrawal)

    return withdrawal


# ─── STAFF — Procesar retiros ────────────────────────────────────────────────

@router.patch("/withdrawals/{withdrawal_id}/process")
def process_withdrawal(
    withdrawal_id: int,
    action: str,    # "complete" o "reject"
    rejection_reason: Optional[str] = None,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db)
):
    """El staff procesa un retiro manualmente"""
    withdrawal = db.query(Withdrawal).filter(
        Withdrawal.id == withdrawal_id,
        Withdrawal.status == "pending"
    ).first()

    if not withdrawal:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Retiro no encontrado o ya procesado"
        )

    now = utc_now()

    if action == "complete":
        withdrawal.status = "completed"
        withdrawal.processed_by = current_user.id
        withdrawal.processed_at = now

        # Descontar del wallet
        wallet = db.query(TeacherWallet).filter(
            TeacherWallet.teacher_id == withdrawal.teacher_id
        ).first()

        if wallet:
            wallet.available_balance -= withdrawal.amount
            wallet.total_withdrawn += withdrawal.amount

        db.commit()
        return {"message": "Retiro procesado correctamente"}

    elif action == "reject":
        if not rejection_reason:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Debes proporcionar el motivo del rechazo"
            )
        withdrawal.status = "rejected"
        withdrawal.processed_by = current_user.id
        withdrawal.processed_at = now
        withdrawal.rejection_reason = rejection_reason

        db.commit()
        return {"message": "Retiro rechazado"}

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="action debe ser 'complete' o 'reject'"
    )