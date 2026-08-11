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
    get_current_staff_or_teacher,
)
from app.core.teacher_students import link_student_to_teacher
from app.models.user import User
from app.models.class_ import Class, ClassType
from app.models.payment import Payment, TeacherWallet, Withdrawal
from app.models.package import Enrollment, EnrollmentStatus
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
    NotifyPaymentRequest,
    WithdrawalRequestV2,
    ProcessWithdrawalRequest
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

def _apply_commission(amount_total: float, teacher: TeacherProfile) -> tuple[float, float]:
    """Devuelve (amount_teacher, amount_platform)."""
    commission = teacher.commission_rate if teacher else 0.15
    amount_platform = round(amount_total * commission, 2)
    amount_teacher = round(amount_total - amount_platform, 2)
    return amount_teacher, amount_platform

def _credit_wallet(teacher_id: int, amount_teacher: float, db: Session):
    wallet = db.query(TeacherWallet).filter(TeacherWallet.teacher_id == teacher_id).first()
    if not wallet:
        wallet = TeacherWallet(teacher_id=teacher_id, available_balance=0.0, total_earned=0.0, total_withdrawn=0.0)
        db.add(wallet)
        db.flush()
    wallet.available_balance += amount_teacher
    wallet.total_earned += amount_teacher

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


def _resolve_booking_teacher(current_user: User, teacher_username: Optional[str], db: Session):
    """
    Determina con qué profesor se agenda (trial o clase sin enrollment
    todavía). Single-tenant: siempre el featured teacher, se ignora
    teacher_username. Multi-tenant: teacher_username es obligatorio.
    """
    from app.models.payment_config import PlatformConfig
    config = db.query(PlatformConfig).first()

    if not config or config.is_single_tenant:
        return _get_featured_teacher(db)

    if not teacher_username:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Debes especificar con qué profesor deseas agendar (teacher_username)"
        )

    return db.query(TeacherProfile).filter(
        TeacherProfile.user_username == teacher_username,
        TeacherProfile.status == TeacherStatus.approved
    ).first()


def _ensure_teacher_linked(current_user: User, teacher: TeacherProfile, db: Session):
    """
    Garantiza el vínculo estudiante-profesor. Single-tenant: no hace
    nada (ya cubierto por _sync_student_teacher_username). Multi-tenant:
    crea el StudentTeacherLink y agrega al estudiante a
    teacher_profiles.students si no existía, de forma idempotente.
    """
    from app.models.payment_config import PlatformConfig
    from app.models.student_teacher_link import StudentTeacherLink

    config = db.query(PlatformConfig).first()
    if not config or config.is_single_tenant:
        return

    profile = current_user.student_profile
    existing = db.query(StudentTeacherLink).filter(
        StudentTeacherLink.student_id == profile.id,
        StudentTeacherLink.teacher_id == teacher.id,
    ).first()
    if not existing:
        db.add(StudentTeacherLink(student_id=profile.id, teacher_id=teacher.id))
        db.commit()
        link_student_to_teacher(db, profile, teacher, old_teacher_username=None)


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

    # Resolver profesor: si viene enrollment_id, el profesor es implícito
    # en el enrollment; si no (caso trial), se resuelve por
    # teacher_username (obligatorio en multi-tenant) o featured (single).
    if data.enrollment_id:
        enrollment_for_teacher = db.query(Enrollment).filter(
            Enrollment.id == data.enrollment_id,
            Enrollment.student_id == student_id,
        ).first()
        if not enrollment_for_teacher:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Enrollment no encontrado")
        teacher = db.query(TeacherProfile).filter(
            TeacherProfile.id == enrollment_for_teacher.teacher_id
        ).first()
    else:
        teacher = _resolve_booking_teacher(current_user, data.teacher_username, db)

    if not teacher:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se pudo determinar con qué profesor deseas agendar"
        )

    stage = get_student_booking_stage(student_id, teacher.id, db)

    if stage == "trial_in_progress":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ya tienes una clase de prueba pendiente con este profesor. Complétala antes de agendar otra."
        )

    if stage == "needs_package":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Debes elegir un paquete de clases con este profesor para poder seguir agendando."
        )

    # ─── Primera clase con este profesor: SIEMPRE es de prueba, sin paquete ───
    if stage == "needs_trial":
        _ensure_teacher_linked(current_user, teacher, db)
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
        Enrollment.status.in_(["active", "pending_package_change"]),
    ).first()

    if not enrollment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Enrollment no encontrado o no activo")

    _sync_student_teacher_username(current_user, enrollment.teacher, db)

    # Verificación de créditos desbloqueados contra clases usadas
    if enrollment.classes_total is not None and enrollment.classes_used >= enrollment.unlocked_credits:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "No tienes créditos disponibles todavía. Completa el pago pendiente o renueva tu paquete."
        )

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
        status="confirmed" if enrollment.classes_total is not None else "pending",
        day_of_week=day_of_week,
    )
    db.add(new_class)
    db.commit()
    db.refresh(new_class)

    # Paquete finito (con créditos ya desbloqueados): confirmada sin payment_instructions
    if enrollment.classes_total is not None:
        return {
            "class_id": new_class.id,
            "status": new_class.status,
            "message": "Clase agendada y confirmada."
        }

    # Paquete ilimitado: queda "pending" y requiere notify-payment por cada clase
    config = db.query(PaymentConfig).first()
    return {
        "class_id": new_class.id,
        "status": new_class.status,
        "message": "Slot reservado. Notifica tu pago para confirmarla.",
        "payment_instructions": {
            "paypal_enabled": config.paypal_enabled if config else False,
            "binance_enabled": config.binance_enabled if config else False,
            "paypal_email": config.paypal_email if config else None,
            "binance_address": config.binance_address if config else None,
            "binance_network": config.binance_network if config else None,
            "whatsapp_number": config.whatsapp_number if config else None,
        }
    }

@router.get("/my-withdrawals", response_model=List[WithdrawalResponse])
def get_my_withdrawals(
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db),
):
    return db.query(Withdrawal).filter(
        Withdrawal.teacher_id == current_user.teacher_profile.id
    ).order_by(Withdrawal.created_at.desc()).all()


@router.get("/my-income")
def get_my_income(
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db),
):
    payments = db.query(Payment).filter(
        Payment.teacher_id == current_user.teacher_profile.id,
        Payment.status.in_(["approved", "pending_review", "rejected"]),
    ).order_by(Payment.created_at.desc()).all()
    return [
        {
            "id": p.id, "amount_teacher": p.amount_teacher,
            "payment_type": p.payment_type, "installment_number": p.installment_number,
            "status": p.status, "created_at": p.created_at, "validated_at": p.validated_at,
        }
        for p in payments
    ]

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
    current_user: User = Depends(get_current_staff_or_teacher),  # ← ahora simétrico: staff o el profesor dueño
    db: Session = Depends(get_db),
):
    payment = db.query(Payment).filter(
        Payment.id == payment_id, Payment.status == "pending_review"
    ).first()
    if not payment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pago no encontrado o ya procesado")

    # Un profesor solo puede validar pagos de sus propios estudiantes
    if current_user.role == "teacher":
        if not current_user.teacher_profile or payment.teacher_id != current_user.teacher_profile.id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo puedes validar pagos de tus estudiantes")

    now = utc_now()

    if data.action == "reject":
        if not data.rejection_reason:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Debes indicar el motivo del rechazo")
        payment.status = "rejected"
        payment.validated_by = current_user.id
        payment.validated_at = now
        payment.rejection_reason = data.rejection_reason

        if payment.payment_type == "single_class" and payment.class_id:
            class_ = db.query(Class).filter(Class.id == payment.class_id).first()
            if class_:
                class_.status = "pending"
                class_.payment_expires_at = None
                class_.meet_link = None

        db.commit()
        return {"message": "Pago rechazado", "rejection_reason": data.rejection_reason}

    # ── approve ──
    teacher = db.query(TeacherProfile).filter(TeacherProfile.id == payment.teacher_id).first()
    amount_teacher, amount_platform = _apply_commission(payment.amount_total, teacher)
    payment.amount_teacher = amount_teacher
    payment.amount_platform = amount_platform
    payment.status = "approved"
    payment.validated_by = current_user.id
    payment.validated_at = now

    _credit_wallet(payment.teacher_id, amount_teacher, db)

    if payment.payment_type == "single_class":
        if not data.meet_link:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Debes proporcionar el link de Meet al aprobar")
        class_ = db.query(Class).filter(Class.id == payment.class_id).first()
        if class_:
            class_.status = "confirmed"
            class_.meet_link = data.meet_link
            class_.payment_expires_at = None

    elif payment.payment_type == "package":
        enrollment = db.query(Enrollment).filter(Enrollment.id == payment.enrollment_id).first()
        if not enrollment:
            db.commit()
            return {"message": "Pago aprobado (enrollment no encontrado)"}

        target_package_id = (
            enrollment.renewal_requested_package_id
            or enrollment.change_requested_package_id
            or enrollment.package_id
        )
        target_package = db.query(Package).filter(Package.id == target_package_id).first()
        is_renewal = enrollment.status == EnrollmentStatus.pending_renewal
        is_change = enrollment.status == EnrollmentStatus.pending_package_change

        if payment.installment_number == 1:
            enrollment.payment_installment_status = "installment_1_paid"
            if target_package.classes_count is not None:
                enrollment.unlocked_credits = target_package.classes_count // 2
            # Renovación/cambio se activa ya con la primera cuota — el
            # estudiante puede empezar a agendar de inmediato.
            if is_renewal:
                enrollment.package_id = target_package.id
                enrollment.classes_total = target_package.classes_count
                enrollment.classes_used = 0
                enrollment.status = EnrollmentStatus.active
            elif is_change:
                enrollment.package_id = target_package.id
                enrollment.classes_total = target_package.classes_count
                enrollment.status = EnrollmentStatus.active

        else:  # installment_number == 2 o pago completo (None)
            enrollment.payment_installment_status = "fully_paid"
            enrollment.unlocked_credits = target_package.classes_count if target_package.classes_count is not None else 0
            if is_renewal or payment.installment_number is None:
                enrollment.package_id = target_package.id
                enrollment.classes_total = target_package.classes_count
                if is_renewal:
                    enrollment.classes_used = 0
                enrollment.status = EnrollmentStatus.active
            elif is_change:
                enrollment.package_id = target_package.id
                enrollment.classes_total = target_package.classes_count
                enrollment.status = EnrollmentStatus.active

            enrollment.renewal_requested_package_id = None
            enrollment.change_requested_package_id = None

    db.commit()
    return {"message": "Pago aprobado correctamente", "amount_credited": amount_teacher}


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


@router.post("/request-withdrawal", response_model=WithdrawalResponse, status_code=status.HTTP_201_CREATED)
def request_withdrawal_v2(
    data: WithdrawalRequestV2,
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db),
):
    teacher = current_user.teacher_profile
    wallet = db.query(TeacherWallet).filter(TeacherWallet.teacher_id == teacher.id).first()

    if not wallet or data.amount > wallet.available_balance:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Saldo insuficiente. Disponible: ${wallet.available_balance if wallet else 0:.2f}")

    pending = db.query(Withdrawal).filter(
        Withdrawal.teacher_id == teacher.id, Withdrawal.status == "pending"
    ).first()
    if pending:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ya tienes un retiro pendiente de procesar")

    # Bloqueo inmediato del saldo — evita doble solicitud del mismo dinero
    wallet.available_balance -= data.amount

    withdrawal = Withdrawal(
        teacher_id=teacher.id,
        amount=data.amount,
        destination_details=data.payment_info,
        status="pending",
    )
    db.add(withdrawal)
    db.commit()
    db.refresh(withdrawal)
    return withdrawal


@router.post("/admin/withdrawals/{withdrawal_id}/process")
def process_withdrawal_v2(
    withdrawal_id: int,
    data: ProcessWithdrawalRequest,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    withdrawal = db.query(Withdrawal).filter(
        Withdrawal.id == withdrawal_id, Withdrawal.status == "pending"
    ).first()
    if not withdrawal:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Retiro no encontrado o ya procesado")

    wallet = db.query(TeacherWallet).filter(TeacherWallet.teacher_id == withdrawal.teacher_id).first()
    now = utc_now()

    if data.action == "complete":
        withdrawal.status = "completed"
        withdrawal.reference = data.reference
        withdrawal.processed_by = current_user.id
        withdrawal.processed_at = now
        if wallet:
            wallet.total_withdrawn += withdrawal.amount
        # available_balance NO se toca — ya se descontó al solicitar

    else:  # reject
        if not data.rejection_reason:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Debes indicar el motivo del rechazo")
        withdrawal.status = "rejected"
        withdrawal.rejection_reason = data.rejection_reason
        withdrawal.processed_by = current_user.id
        withdrawal.processed_at = now
        if wallet:
            wallet.available_balance += withdrawal.amount  # reinyección

    db.commit()
    return {"message": f"Retiro {'completado' if data.action == 'complete' else 'rechazado'}"}

@router.get("/booking-status")
def get_booking_status(
    teacher_username: Optional[str] = None,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    """
    El frontend usa esto para saber qué flujo de reserva mostrar.
    Single-tenant: siempre resuelve al featured teacher (se ignora el
    parámetro). Multi-tenant: si el estudiante tiene un solo profesor
    vinculado se resuelve automático; si tiene 0, devuelve "needs_teacher";
    si tiene 2+, se requiere teacher_username explícito.
    """
    from app.models.payment_config import PlatformConfig
    from app.models.student_teacher_link import StudentTeacherLink

    config = db.query(PlatformConfig).first()
    student_id = current_user.student_profile.id

    if not config or config.is_single_tenant:
        teacher = _get_featured_teacher(db)
        if not teacher:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "No hay profesora featured configurada")
        stage = get_student_booking_stage(student_id, teacher.id, db)
        return {"stage": stage, "teacher_username": teacher.user_username}

    if teacher_username:
        teacher = db.query(TeacherProfile).filter(
            TeacherProfile.user_username == teacher_username,
            TeacherProfile.status == TeacherStatus.approved
        ).first()
        if not teacher:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Profesor no encontrado")
        stage = get_student_booking_stage(student_id, teacher.id, db)
        return {"stage": stage, "teacher_username": teacher.user_username}

    linked_teacher_ids = [
        l.teacher_id for l in db.query(StudentTeacherLink).filter(
            StudentTeacherLink.student_id == student_id
        ).all()
    ]

    if len(linked_teacher_ids) == 0:
        return {"stage": "needs_teacher", "teacher_username": None}

    if len(linked_teacher_ids) == 1:
        teacher = db.query(TeacherProfile).filter(TeacherProfile.id == linked_teacher_ids[0]).first()
        stage = get_student_booking_stage(student_id, teacher.id, db)
        return {"stage": stage, "teacher_username": teacher.user_username}

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Tienes más de un profesor vinculado. Especifica teacher_username."
    )

# ─── NOTIFICACIÓN DE PAGO (reemplaza submit-receipt) ─────────────────────────

@router.post("/notify-payment")
def notify_payment(
    data: NotifyPaymentRequest,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    student_id = current_user.student_profile.id

    # ── Clase suelta (paquetes ilimitados) ──
    if data.type == "single_class":
        if not data.class_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "class_id es requerido")

        class_ = db.query(Class).filter(
            Class.id == data.class_id,
            Class.student_id == student_id,
            Class.status == "pending",
        ).first()
        if not class_:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Clase no encontrada o ya notificada")

        existing = db.query(Payment).filter(
            Payment.class_id == class_.id, Payment.status == "pending_review"
        ).first()
        if existing:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ya notificaste el pago de esta clase")

        enrollment = db.query(Enrollment).filter(Enrollment.id == class_.enrollment_id).first() if class_.enrollment_id else None
        package = enrollment.package if enrollment else None
        if not package:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "No se pudo determinar el precio de esta clase")

        amount = package.price
        now = utc_now()
        hours_to_class = (class_.start_time_utc - now).total_seconds() / 3600

        if hours_to_class > 24:
            expires_at = class_.start_time_utc - timedelta(hours=12)
        elif hours_to_class >= 12:
            expires_at = now + timedelta(hours=4)
        else:
            expires_at = now + timedelta(hours=2)

        class_.status = "pending_payment"  # = PENDING_APPROVAL
        class_.payment_expires_at = expires_at

        payment = Payment(
            class_id=class_.id,
            enrollment_id=class_.enrollment_id,
            student_id=student_id,
            teacher_id=class_.teacher_id,
            amount_total=amount,
            amount_teacher=0,
            amount_platform=0,
            payment_method="manual",
            transaction_id=data.transaction_reference,
            status="pending_review",
            payment_type="single_class",
        )
        db.add(payment)
        db.commit()
        db.refresh(payment)

        return {
            "payment_id": payment.id,
            "class_status": class_.status,
            "expires_at": expires_at,
            "message": "Pago notificado. Se validará antes de que expire la reserva.",
        }

    # ── Paquete (compra inicial, renovación o cambio) ──
    if not data.enrollment_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "enrollment_id es requerido")

    enrollment = db.query(Enrollment).filter(
        Enrollment.id == data.enrollment_id,
        Enrollment.student_id == student_id,
    ).first()
    if not enrollment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Enrollment no encontrado")

    # El paquete "objetivo" depende del contexto: renovación, cambio, o el propio
    target_package_id = (
        enrollment.renewal_requested_package_id
        or enrollment.change_requested_package_id
        or enrollment.package_id
    )
    package = db.query(Package).filter(Package.id == target_package_id).first()
    if not package:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Paquete no encontrado")

    installment = data.installment_number
    if installment and not package.allows_installments:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Este paquete no admite pago en cuotas")

    if installment == 1:
        if enrollment.payment_installment_status != "unpaid":
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "La primera cuota ya fue notificada")
        amount = round(package.price / 2, 2)
    elif installment == 2:
        if enrollment.payment_installment_status != "installment_1_paid":
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Completa la primera cuota antes de la segunda")
        amount = round(package.price - round(package.price / 2, 2), 2)  # resto exacto, sin perder centavos
    else:
        if enrollment.payment_installment_status != "unpaid":
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Este paquete ya fue pagado o tiene una cuota en curso")
        amount = package.price

    existing = db.query(Payment).filter(
        Payment.enrollment_id == enrollment.id,
        Payment.status == "pending_review",
        Payment.payment_type == "package",
    ).first()
    if existing:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ya hay un pago de este paquete pendiente de revisión")

    payment = Payment(
        enrollment_id=enrollment.id,
        student_id=student_id,
        teacher_id=enrollment.teacher_id,
        amount_total=amount,
        amount_teacher=0,
        amount_platform=0,
        payment_method="manual",
        transaction_id=data.transaction_reference,
        status="pending_review",
        payment_type="package",
        installment_number=installment,
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)

    return {"payment_id": payment.id, "message": "Pago notificado, en espera de aprobación"}