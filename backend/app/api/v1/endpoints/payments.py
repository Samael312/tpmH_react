#payments.py
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
import logging
from datetime import timedelta
from app.db.base import get_db
from app.auth.dependencies import (
    get_current_student,
    get_current_teacher_or_teacher_admin,
    get_current_staff,
    get_current_user,
)
from app.core.teacher_students import link_student_to_teacher
from app.models.user import User
from app.models.class_ import Class, ClassType
from app.models.payment import Payment, TeacherWallet, Withdrawal
from app.models.package import Enrollment
from app.models.package import Package
from app.models.teacher import TeacherProfile, TeacherStatus
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
from app.core.class_logic import can_book_slot, get_student_booking_stage

router = APIRouter()
logger = logging.getLogger(__name__)

DAYS_ES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]

def _get_featured_teacher(db: Session):
    from app.models.payment_config import PlatformConfig
    from app.core.config import settings
    config = db.query(PlatformConfig).first()
    username = None
    if config and config.featured_teacher_id:
        t = db.query(TeacherProfile).filter(TeacherProfile.id == config.featured_teacher_id).first()
        if t:
            username = t.user_username
    username = username or settings.FEATURED_TEACHER_USERNAME
    if not username:
        return None
    return db.query(TeacherProfile).filter(TeacherProfile.user_username == username).first()

def _sync_student_teacher_username(current_user: User, teacher: TeacherProfile, db: Session):
    """
    En modo single-tenant, al agendar una clase el estudiante queda
    vinculado automáticamente al profesor featured (sin necesidad de
    pasar por choose-teacher).
    """
    from app.models.payment_config import PlatformConfig
    config = db.query(PlatformConfig).first()
    if not config or not config.is_single_tenant:
        return

    student_profile = current_user.student_profile
    if student_profile and student_profile.teacher_username != teacher.user_username:
        student_profile.teacher_username = teacher.user_username
        db.commit()

def _get_trial_teacher(current_user: User, db: Session):
    """
    Determina con qué profesor se agenda la clase de prueba.
    - Modo single-tenant activo: siempre el profesor featured.
    - Modo multi-tenant: el profesor que el estudiante haya elegido.
    """
    from app.models.payment_config import PlatformConfig
    config = db.query(PlatformConfig).first()

    if not config or config.is_single_tenant:
        return _get_featured_teacher(db)

    student_profile = current_user.student_profile
    username = student_profile.teacher_username if student_profile else None
    if not username:
        return None

    return db.query(TeacherProfile).filter(
        TeacherProfile.user_username == username,
        TeacherProfile.status == TeacherStatus.approved
    ).first()


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
        default_commission_rate=config.default_commission_rate or 0.15,
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

@router.post("/book", status_code=status.HTTP_201_CREATED)
def book_class(
    data: BookAndPayRequest,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    student_id = current_user.student_profile.id
    stage = get_student_booking_stage(student_id, db)

    if stage == "trial_in_progress":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ya tienes una clase de prueba pendiente. Complétala antes de agendar otra."
        )

    if stage == "needs_package":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Debes elegir un paquete de clases para poder seguir agendando."
        )

    # ─── Primera clase del estudiante: SIEMPRE es de prueba, sin paquete ───
    if stage == "needs_trial":
        teacher = _get_trial_teacher(current_user, db)
        if not teacher:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Debes elegir un profesor antes de reservar tu clase de prueba"
            )

        _sync_student_teacher_username(current_user, teacher, db)

        trial_start = data.start_time_utc
        trial_end = trial_start + timedelta(minutes=30)

        day_of_week = DAYS_ES[trial_start.weekday()]

        can_book, error_msg = can_book_slot(
            start_time_utc=trial_start,
            teacher_id=teacher.id,
            student_id=student_id,
            db=db
        )
        if not can_book:
            raise HTTPException(status.HTTP_409_CONFLICT, error_msg)

        trial_subject = (
            (teacher.subjects[0] if teacher.subjects else None)
            or (teacher.languages[0] if teacher.languages else None)
            or "Clase de prueba"
        )

        trial_class = Class(
            enrollment_id=None,
            teacher_id=teacher.id,
            student_id=student_id,
            class_type=ClassType.trial,
            subject=trial_subject,
            start_time_utc=trial_start,
            end_time_utc=trial_end,
            duration=30,
            teacher_timezone=teacher.timezone,
            student_timezone=current_user.student_profile.timezone,
            status="pending_trial", 
            day_of_week=day_of_week,
        )
        db.add(trial_class)
        db.commit()
        db.refresh(trial_class)

        return {
            "class_id": trial_class.id,
            "status": trial_class.status,
            "is_trial": True,
            "message": "Tu clase de prueba fue reservada. El staff la confirmará en breve.",
        }

    # ─── stage == "ready": flujo normal contra el paquete activo ───
    if not data.enrollment_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Falta el paquete (enrollment_id)")

    enrollment = db.query(Enrollment).filter(
        Enrollment.id == data.enrollment_id,
        Enrollment.student_id == student_id,
        Enrollment.status == "active"
    ).first()

    if not enrollment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Enrollment no encontrado o no activo")

    _sync_student_teacher_username(current_user, enrollment.teacher, db)

    if enrollment.classes_total is not None and enrollment.classes_used >= enrollment.classes_total:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Has agotado todas las clases de este paquete")

    can_book, error_msg = can_book_slot(
        start_time_utc=data.start_time_utc,
        teacher_id=enrollment.teacher_id,
        student_id=student_id,
        db=db
    )
    if not can_book:
        raise HTTPException(status.HTTP_409_CONFLICT, error_msg)

    day_of_week = DAYS_ES[data.start_time_utc.weekday()]

    new_class = Class(
        enrollment_id=enrollment.id,
        teacher_id=enrollment.teacher_id,
        student_id=student_id,
        class_type=ClassType.regular,
        subject=enrollment.package.subject,
        start_time_utc=data.start_time_utc,
        end_time_utc=data.end_time_utc,
        duration=data.duration_minutes,
        teacher_timezone=getattr(enrollment.teacher, "timezone", None),
        student_timezone=current_user.student_profile.timezone,
        status="pending",
        day_of_week=day_of_week,
    )
    db.add(new_class)
    db.commit()
    db.refresh(new_class)

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

@router.get("/booking-status")
def get_booking_status(
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    """El frontend usa esto para saber qué flujo de reserva mostrar."""
    stage = get_student_booking_stage(current_user.student_profile.id, db)
    return {"stage": stage}

def _sync_student_teacher_username(current_user: User, teacher: TeacherProfile, db: Session):
    """
    En modo single-tenant, al agendar una clase el estudiante queda
    vinculado automáticamente al profesor featured.
    """
    from app.models.payment_config import PlatformConfig
    config = db.query(PlatformConfig).first()
    if not config or not config.is_single_tenant:
        return

    student_profile = current_user.student_profile
    if student_profile and student_profile.teacher_username != teacher.user_username:
        old_teacher_username = student_profile.teacher_username
        student_profile.teacher_username = teacher.user_username
        db.commit()
        link_student_to_teacher(db, student_profile, teacher, old_teacher_username=old_teacher_username)