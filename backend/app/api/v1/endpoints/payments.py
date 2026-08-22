# app/routers/payments.py / app/api/v1/endpoints/payments.py

import logging
from datetime import timedelta
from typing import List, Optional
from app.core.timezone import format_local_datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
import math
from app.auth.dependencies import (
    get_current_staff,
    get_current_staff_or_teacher,
    get_current_student,
    get_current_teacher_or_teacher_admin,
)
from app.core.class_logic import (
    can_book_slot, 
    get_student_booking_stage,
    validate_class_duration,
    )
from app.core.email import (
    send_class_booking_confirmation,
    send_class_confirmed_email,
    send_class_confirmed_teacher_email,
    send_new_booking_teacher_email,
    send_payment_failed_email,
    send_payment_receipt_email,
    send_admin_payment_pending_email,
    send_withdrawal_requested_teacher_email,
    send_admin_withdrawal_requested_email,
    send_withdrawal_processed_email
)
from app.core.teacher_students import link_student_to_teacher
from app.core.timezone import utc_now
from app.db.base import get_db
from app.models.class_ import Class, ClassType
from app.models.package import Enrollment, EnrollmentStatus, Package
from app.models.payment import Payment, TeacherWallet, Withdrawal
from app.models.payment_config import PaymentConfig
from app.models.teacher import TeacherProfile, TeacherStatus
from app.models.user import User, UserRole
from app.schemas.payments import (
    BookAndPayRequest,
    NotifyPaymentRequest,
    PaymentConfigResponse,
    PaymentResponse,
    ProcessWithdrawalRequest,
    SubmitPaymentReceiptRequest,
    UpdatePaymentConfigRequest,
    ValidatePaymentRequest,
    WalletResponse,
    WithdrawalRequest,
    WithdrawalRequestV2,
    WithdrawalResponse,
)

router = APIRouter()
logger = logging.getLogger(__name__)

DAYS_ES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]
PACKAGE_CHANGE_BLOCKING_STATUSES = ["completed", "no_show", "confirmed", "pending"]

# ─── HELPER FUNCTIONS ─────────────────────────────────────────────────────────

def _get_featured_teacher(db: Session):
    from app.core.config import settings
    from app.models.payment_config import PlatformConfig

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


def _installment_amount(package: Package, index: int) -> float:
    """Monto de la cuota `index` (1-based). Reparte el residuo en la última cuota."""
    n = package.installment_count or 1
    if index < 1 or index > n:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Número de cuota inválido: {index}. Este paquete consta de {n} cuota(s)."
        )

    base = package.installment_amount or round(package.price / n, 2)
    if index < n:
        return base
    return round(package.price - base * (n - 1), 2)


def _apply_instant_package_change(
    enrollment: Enrollment,
    new_package: Package,
    available_credits: int,
    db: Session,) -> None:
    """    Cambio de paquete sin cobro adicional: el nuevo paquete finito tiene    cupo suficiente para cubrir los créditos que el estudiante ya tenía    disponibles (deficit <= 0). classes_used NO se toca.    """
    enrollment.package_id = new_package.id
    enrollment.classes_total = new_package.classes_count
    enrollment.unlocked_credits = new_package.classes_count
    enrollment.prepaid_unlimited_credits = 0
    enrollment.change_requested_package_id = None
    enrollment.status = EnrollmentStatus.active
    db.commit()


def _apply_instant_switch_to_unlimited(
    enrollment: Enrollment,
    new_package: Package,
    available_credits: int,
    db: Session,) -> None:
    """    Cambio a un paquete ilimitado: los créditos finitos que le quedaban al    estudiante se transfieren tal cual a prepaid_unlimited_credits, sin    cobro. Desde ahí puede comprar más créditos con el flujo normal de    recarga (que suma sobre lo existente).    """
    enrollment.package_id = new_package.id
    enrollment.classes_total = None
    enrollment.unlocked_credits = 0
    enrollment.prepaid_unlimited_credits = (enrollment.prepaid_unlimited_credits or 0) + available_credits
    enrollment.change_requested_package_id = None
    enrollment.status = EnrollmentStatus.active
    db.commit()


def _get_enrollment_available_credits(enrollment: Enrollment, db: Session) -> int:
    """Créditos disponibles del enrollment ANTES del cambio de paquete."""
    if enrollment.package.classes_count is not None:
        occupied_slots = db.query(Class).filter(
            Class.enrollment_id == enrollment.id,
            Class.status != "cancelled",
        ).count()
        return max((enrollment.unlocked_credits or 0) - occupied_slots, 0)
    return enrollment.prepaid_unlimited_credits or 0


def _installment_credit_amount(classes_count: int, installment_count: int, installment_index: int) -> int:
    """
    Créditos que se liberan al pagar la cuota `installment_index` (1-based).
    Cada cuota libera ceil(classes_count / installment_count), EXCEPTO la
    última, que libera el resto exacto (puede ser menor que las anteriores).
    """
    per_installment = math.ceil(classes_count / installment_count)
    if installment_index >= installment_count:
        already_unlocked = per_installment * (installment_count - 1)
        return max(classes_count - already_unlocked, 0)
    return per_installment


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
    Determina con qué profesor se agenda (trial o clase sin enrollment todavía).
    Single-tenant: siempre el featured teacher. Multi-tenant: teacher_username es obligatorio.
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
    Garantiza el vínculo estudiante-profesor de forma idempotente en multi-tenant.
    """
    from app.models.payment_config import PlatformConfig
    from app.models.student_teacher_link import StudentTeacherLink

    config = db.query(PlatformConfig).first()
    if not config or not config.is_single_tenant:
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
    config = db.query(PaymentConfig).first()
    if not config:
        config = PaymentConfig()
        db.add(config)
        db.commit()
        db.refresh(config)

    has_any = (
        config.paypal_enabled
        or config.binance_enabled
        or config.bank_transfer_enabled
        or config.mobile_payment_enabled
    )

    return PaymentConfigResponse(
        paypal_enabled=config.paypal_enabled,
        binance_enabled=config.binance_enabled,
        bank_transfer_enabled=config.bank_transfer_enabled,
        mobile_payment_enabled=config.mobile_payment_enabled,
        paypal_email=config.paypal_email if config.paypal_enabled else None,
        binance_address=config.binance_address if config.binance_enabled else None,
        binance_network=config.binance_network if config.binance_enabled else None,
        bank_transfer_details=config.bank_transfer_details if config.bank_transfer_enabled else None,
        mobile_payment_details=config.mobile_payment_details if config.mobile_payment_enabled else None,
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

    config = db.query(PaymentConfig).first()
    if config:
        method_enabled_map = {
            "paypal": config.paypal_enabled,
            "binance": config.binance_enabled,
            "bank_transfer": config.bank_transfer_enabled,
            "mobile_payment": config.mobile_payment_enabled,
        }
        if data.payment_method in method_enabled_map and not method_enabled_map[data.payment_method]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Este método de pago no está habilitado actualmente"
            )

    teacher = db.query(TeacherProfile).filter(TeacherProfile.id == class_.teacher_id).first()
    commission = teacher.commission_rate if teacher else 0.15
    amount_platform = round(data.amount * commission, 2)
    amount_teacher = round(data.amount - amount_platform, 2)

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

    class_.status = "pending_payment"
    db.commit()
    db.refresh(payment)

    return {
        "payment_id": payment.id,
        "class_status": "pending_payment",
        "message": "Comprobante recibido. El staff verificará el pago pronto."
    }


@router.post("/book", status_code=status.HTTP_201_CREATED)
def book_class(
    data: BookAndPayRequest,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    student_id = current_user.student_profile.id

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

    # ─── Primera clase con este profesor: SIEMPRE es de prueba ───
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

        allowed_subjects = set((teacher.subjects or []) + (teacher.languages or []))
        trial_subject = data.subject if data.subject in allowed_subjects else None
        trial_subject = trial_subject or (
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

        if teacher.user:
            send_new_booking_teacher_email(
                to_email=teacher.user.email,
                teacher_name=teacher.user.name,
                student_first_name=current_user.name,
                student_last_name=current_user.surname,
                student_nationality=current_user.nationality,
                student_phone=current_user.phone_number,
                subject=trial_subject,
                class_start_local=format_local_datetime(trial_start, teacher.timezone),
                duration_minutes=30,
                is_trial=True,
            )
        send_class_booking_confirmation(
            to_email=current_user.email,
            student_name=current_user.name,
            teacher_name=f"{teacher.user.name} {teacher.user.surname}" if teacher.user else "",
            subject=trial_subject,
            class_start_local=format_local_datetime(trial_start, current_user.student_profile.timezone),
            duration_minutes=30,
            is_trial=True,
        )

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

    can_duration, duration_msg = validate_class_duration(data.duration_minutes, db)
    if not can_duration:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, duration_msg)
    
    _sync_student_teacher_username(current_user, enrollment.teacher, db)

    day_of_week = DAYS_ES[data.start_time_utc.weekday()]

    # ─── Paquete finito ───
    if enrollment.package.classes_count is not None:
        if enrollment.payment_status == "unpaid":
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Tu paquete está pendiente de confirmación de pago")

        occupied_slots = db.query(Class).filter(
            Class.enrollment_id == enrollment.id,
            Class.status != "cancelled",
        ).count()

        if occupied_slots >= enrollment.unlocked_credits:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "No tienes créditos disponibles todavía")

        can_book, error_msg = can_book_slot(
            start_time_utc=data.start_time_utc,
            teacher_id=enrollment.teacher_id,
            student_id=student_id,
            db=db
        )
        if not can_book:
            raise HTTPException(status.HTTP_409_CONFLICT, error_msg)

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
            status="confirmed",
            day_of_week=day_of_week,
            used_prepaid_credit=False,
        )
        db.add(new_class)
        db.commit()
        db.refresh(new_class)

        teacher_user = enrollment.teacher.user if enrollment.teacher and enrollment.teacher.user else None
        send_class_confirmed_email(
            to_email=current_user.email,
            student_name=current_user.name,
            teacher_name=f"{teacher_user.name} {teacher_user.surname}" if teacher_user else "",
            subject=new_class.subject or "Clase",
            class_start_local=format_local_datetime(new_class.start_time_utc, current_user.student_profile.timezone),
            duration_minutes=new_class.duration,
        )
        if teacher_user:
            send_class_confirmed_teacher_email(
                to_email=teacher_user.email,
                teacher_name=teacher_user.name,
                student_name=f"{current_user.name} {current_user.surname}",
                subject=new_class.subject or "Clase",
                class_start_local=format_local_datetime(new_class.start_time_utc, enrollment.teacher.timezone),
                duration_minutes=new_class.duration,
            )

        return {
            "class_id": new_class.id,
            "status": new_class.status,
            "message": "Clase agendada y confirmada."
        }

    # ─── Paquete ilimitado ───
    else:
        can_book, error_msg = can_book_slot(
            start_time_utc=data.start_time_utc,
            teacher_id=enrollment.teacher_id,
            student_id=student_id,
            db=db
        )
        if not can_book:
            raise HTTPException(status.HTTP_409_CONFLICT, error_msg)

        has_prepaid = enrollment.prepaid_unlimited_credits > 0

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
            status="confirmed" if has_prepaid else "pending",
            day_of_week=day_of_week,
            used_prepaid_credit=has_prepaid,
        )
        db.add(new_class)

        if has_prepaid:
            enrollment.prepaid_unlimited_credits -= 1

        db.commit()
        db.refresh(new_class)

        teacher_user = enrollment.teacher.user if enrollment.teacher and enrollment.teacher.user else None

        if has_prepaid:
            send_class_confirmed_email(
                to_email=current_user.email,
                student_name=current_user.name,
                teacher_name=f"{teacher_user.name} {teacher_user.surname}" if teacher_user else "",
                subject=new_class.subject or "Clase",
                class_start_local=format_local_datetime(new_class.start_time_utc, current_user.student_profile.timezone),
                duration_minutes=new_class.duration,
            )
            if teacher_user:
                send_class_confirmed_teacher_email(
                    to_email=teacher_user.email,
                    teacher_name=teacher_user.name,
                    student_name=f"{current_user.name} {current_user.surname}",
                    subject=new_class.subject or "Clase",
                    class_start_local=format_local_datetime(new_class.start_time_utc, enrollment.teacher.timezone),
                    duration_minutes=new_class.duration,
                )

            return {
                "class_id": new_class.id,
                "status": new_class.status,
                "message": "Clase agendada usando tu saldo prepagado."
            }

        send_class_booking_confirmation(
            to_email=current_user.email,
            student_name=current_user.name,
            teacher_name=f"{teacher_user.name} {teacher_user.surname}" if teacher_user else "",
            subject=new_class.subject or "Clase",
            class_start_local=format_local_datetime(new_class.start_time_utc, current_user.student_profile.timezone),
            duration_minutes=new_class.duration,
        )
        if teacher_user:
            send_new_booking_teacher_email(
                to_email=teacher_user.email,
                teacher_name=teacher_user.name,
                student_name=f"{current_user.name} {current_user.surname}",
                subject=new_class.subject or "Clase",
                class_start_local=format_local_datetime(new_class.start_time_utc, enrollment.teacher.timezone),
                duration_minutes=new_class.duration,
                is_trial=False,
            )

        config = db.query(PaymentConfig).first()
        return {
            "class_id": new_class.id,
            "status": new_class.status,
            "message": "Slot reservado. Notifica tu pago para confirmarla.",
            "payment_instructions": {
                "paypal_enabled": config.paypal_enabled if config else False,
                "binance_enabled": config.binance_enabled if config else False,
                "bank_transfer_enabled": config.bank_transfer_enabled if config else False,
                "mobile_payment_enabled": config.mobile_payment_enabled if config else False,
                "paypal_email": config.paypal_email if config else None,
                "binance_address": config.binance_address if config else None,
                "binance_network": config.binance_network if config else None,
                "bank_transfer_details": config.bank_transfer_details if config else None,
                "mobile_payment_details": config.mobile_payment_details if config else None,
                "whatsapp_number": config.whatsapp_number if config else None,
            }
        }


# ─── VALIDACIÓN POR STAFF O PROFESOR ─────────────────────────────────────────

@router.get("/pending-review")
def get_payments_pending_review(
    current_user: User = Depends(get_current_staff_or_teacher),
    db: Session = Depends(get_db),
):
    query = db.query(Payment).filter(Payment.status == "pending_review")
    if current_user.role == "teacher":
        query = query.filter(Payment.teacher_id == current_user.teacher_profile.id)

    payments = query.order_by(Payment.created_at.asc()).all()

    result = []
    for p in payments:
        student_user = p.student.user if p.student else None
        entry = {
            "payment_id": p.id,
            "payment_type": p.payment_type,
            "installment_index": p.installment_index,
            "amount": p.amount_total,
            "transaction_reference": p.transaction_id,
            "submitted_at": p.created_at,
            "student_name": f"{student_user.name} {student_user.surname}" if student_user else "Desconocido",
            "student_username": student_user.username if student_user else None,
        }
        if p.payment_type == "single_class" and p.class_id:
            class_ = db.query(Class).filter(Class.id == p.class_id).first()
            entry["class_start_utc"] = class_.start_time_utc if class_ else None
            entry["payment_expires_at"] = class_.payment_expires_at if class_ else None
        elif p.enrollment_id:
            enrollment = db.query(Enrollment).filter(Enrollment.id == p.enrollment_id).first()
            pkg_id = (enrollment.renewal_requested_package_id or enrollment.change_requested_package_id or enrollment.package_id) if enrollment else None
            pkg = db.query(Package).filter(Package.id == pkg_id).first() if pkg_id else None
            entry["package_name"] = pkg.name if pkg else None
            entry["installment_total"] = pkg.installment_count if pkg else None
        result.append(entry)

    return result

@router.get("/history")
def get_payments_history(
    current_user: User = Depends(get_current_staff_or_teacher),
    db: Session = Depends(get_db),
):
    """
    Historial de pagos ya resueltos (aprobados o rechazados).
    Teacher solo ve los suyos; staff ve todos.
    """
    query = db.query(Payment).filter(Payment.status.in_(["approved", "rejected"]))
    if current_user.role == "teacher":
        query = query.filter(Payment.teacher_id == current_user.teacher_profile.id)

    payments = query.order_by(
        Payment.validated_at.desc().nullslast(), Payment.created_at.desc()
    ).all()

    result = []
    for p in payments:
        student_user = p.student.user if p.student else None
        entry = {
            "payment_id": p.id,
            "payment_type": p.payment_type,
            "installment_index": p.installment_index,
            "amount": p.amount_total,
            "transaction_reference": p.transaction_id,
            "submitted_at": p.created_at,
            "validated_at": p.validated_at,
            "status": p.status,               # "approved" | "rejected"
            "rejection_reason": p.rejection_reason,
            "student_name": f"{student_user.name} {student_user.surname}" if student_user else "Desconocido",
            "student_username": student_user.username if student_user else None,
        }
        if p.payment_type == "single_class" and p.class_id:
            class_ = db.query(Class).filter(Class.id == p.class_id).first()
            entry["class_start_utc"] = class_.start_time_utc if class_ else None
        elif p.enrollment_id:
            enrollment = db.query(Enrollment).filter(Enrollment.id == p.enrollment_id).first()
            pkg_id = (
                enrollment.renewal_requested_package_id
                or enrollment.change_requested_package_id
                or enrollment.package_id
            ) if enrollment else None
            pkg = db.query(Package).filter(Package.id == pkg_id).first() if pkg_id else None
            entry["package_name"] = pkg.name if pkg else None
            entry["installment_total"] = pkg.installment_count if pkg else None
        result.append(entry)

    return result

@router.patch("/{payment_id}/validate")
def validate_payment(
    payment_id: int,
    data: ValidatePaymentRequest,
    current_user: User = Depends(get_current_staff_or_teacher),
    db: Session = Depends(get_db),
):
    payment = db.query(Payment).filter(Payment.id == payment_id, Payment.status == "pending_review").first()
    if not payment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pago no encontrado o ya procesado")

    if current_user.role == "teacher_admin":   # antes: current_user.role == "teacher"
        if not current_user.teacher_profile or payment.teacher_id != current_user.teacher_profile.id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo puedes validar pagos de tus estudiantes")

    now = utc_now()

    # ── RECHAZAR PAGO ──
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

        student_user = payment.student.user if payment.student else None
        if student_user:
            concept_map = {"single_class": "Clase suelta", "package": "Paquete", "renewal": "Renovación", "package_change": "Cambio de paquete", "unlimited_recharge": "Recarga de créditos"}
            send_payment_failed_email(
                to_email=student_user.email,
                student_name=student_user.name,
                concept=concept_map.get(payment.payment_type, "Pago"),
                amount=payment.amount_total,
                rejection_reason=data.rejection_reason,
            )

        db.commit()
        return {"message": "Pago rechazado"}

    # ── APROBAR PAGO ──
    teacher = db.query(TeacherProfile).filter(TeacherProfile.id == payment.teacher_id).first()

    if not payment.is_manual_grant:
        amount_teacher, amount_platform = _apply_commission(payment.amount_total, teacher)
        payment.amount_teacher = amount_teacher
        payment.amount_platform = amount_platform
        _credit_wallet(payment.teacher_id, amount_teacher, db)
    else:
        payment.amount_teacher = 0
        payment.amount_platform = 0
        amount_teacher = 0

    payment.status = "approved"
    payment.validated_by = current_user.id
    payment.validated_at = now

    if payment.payment_type == "single_class":
        if not data.meet_link:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Debes proporcionar el link de Meet al aprobar")
        class_ = db.query(Class).filter(Class.id == payment.class_id).first()
        if class_:
            class_.status = "confirmed"
            class_.meet_link = data.meet_link
            class_.payment_expires_at = None

            student_user = payment.student.user if payment.student else None
            teacher_profile = db.query(TeacherProfile).filter(TeacherProfile.id == payment.teacher_id).first()
            
            if student_user:
                send_class_confirmed_email(
                    to_email=student_user.email,
                    student_name=student_user.name,
                    teacher_name=f"{teacher_profile.user.name} {teacher_profile.user.surname}" if teacher_profile and teacher_profile.user else "",
                    subject=class_.subject or "Clase",
                    class_start_local=format_local_datetime(class_.start_time_utc, student_user.student_profile.timezone),
                    duration_minutes=class_.duration,
                )
            if teacher_profile and teacher_profile.user:
                send_class_confirmed_teacher_email(
                    to_email=teacher_profile.user.email,
                    teacher_name=teacher_profile.user.name,
                    student_name=f"{student_user.name} {student_user.surname}" if student_user else "",
                    subject=class_.subject or "Clase",
                    class_start_local=format_local_datetime(class_.start_time_utc, teacher_profile.timezone),
                    duration_minutes=class_.duration,
                )

    elif payment.payment_type == "unlimited_recharge":
        enrollment = db.query(Enrollment).filter(Enrollment.id == payment.enrollment_id).first()
        if enrollment:
            credits = payment.installment_index or 0
            enrollment.prepaid_unlimited_credits += credits
            if enrollment.activated_at is None:
                enrollment.activated_at = now
                enrollment.payment_status = "paid"

    elif payment.payment_type in ("package", "renewal", "package_change"):
        enrollment = db.query(Enrollment).filter(Enrollment.id == payment.enrollment_id).first()
        if enrollment:
            target_package_id = (
                enrollment.renewal_requested_package_id
                or enrollment.change_requested_package_id
                or enrollment.package_id
            )
            target_package = db.query(Package).filter(Package.id == target_package_id).first()
            enrollment.paid_via_installments = payment.installment_index is not None
            is_renewal = enrollment.status == EnrollmentStatus.pending_renewal or payment.payment_type == "renewal"
            is_change = enrollment.status == EnrollmentStatus.pending_package_change or payment.payment_type == "package_change"

            if is_renewal or is_change:
                enrollment.package_id = target_package.id
                enrollment.classes_total = target_package.classes_count
                enrollment.unlocked_credits = 0  # arranca limpio con el paquete nuevo
                if target_package.classes_count is not None:
                    enrollment.prepaid_unlimited_credits = 0   # <-- NUEVO
                if is_renewal:
                    enrollment.classes_used = 0
                enrollment.status = EnrollmentStatus.active
                enrollment.renewal_requested_package_id = None
                enrollment.change_requested_package_id = None

            if payment.installment_index is not None:
                enrollment.installments_paid = payment.installment_index
                n = target_package.installment_count or 1
                if target_package.classes_count is not None:
                    credit_this_installment = _installment_credit_amount(
                        target_package.classes_count, n, payment.installment_index
                    )
                    enrollment.unlocked_credits = (enrollment.unlocked_credits or 0) + credit_this_installment
                enrollment.payment_status = "paid" if payment.installment_index >= n else "partially_paid"
            else:
                enrollment.installments_paid = 1
                enrollment.unlocked_credits = target_package.classes_count if target_package.classes_count is not None else 0
                enrollment.payment_status = "paid"

            if enrollment.activated_at is None and enrollment.payment_status in ("paid", "partially_paid"):
                enrollment.activated_at = now

    student_user = payment.student.user if payment.student else None
    if student_user and not payment.is_manual_grant:
        concept_map = {"single_class": "Clase suelta", "package": "Paquete", "renewal": "Renovación", "package_change": "Cambio de paquete", "unlimited_recharge": "Recarga de créditos"}
        send_payment_receipt_email(
            to_email=student_user.email,
            student_name=student_user.name,
            concept=concept_map.get(payment.payment_type, "Pago"),
            amount=payment.amount_total,
            payment_method=payment.payment_method,
            transaction_reference=payment.transaction_id,
        )

    db.commit()
    return {"message": "Pago aprobado correctamente", "amount_credited": amount_teacher}


@router.post("/manual-grant")
def manual_grant_payment(
    data: NotifyPaymentRequest,
    current_user: User = Depends(get_current_staff_or_teacher),
    db: Session = Depends(get_db),
):
    if data.type != "package" or not data.enrollment_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "manual-grant solo aplica a paquetes por ahora")

    enrollment = db.query(Enrollment).filter(Enrollment.id == data.enrollment_id).first()
    if not enrollment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Enrollment no encontrado")
    if current_user.role == "teacher" and enrollment.teacher_id != current_user.teacher_profile.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No autorizado")

    target_package_id = enrollment.renewal_requested_package_id or enrollment.change_requested_package_id or enrollment.package_id
    package = db.query(Package).filter(Package.id == target_package_id).first()

    payment = Payment(
        enrollment_id=enrollment.id, student_id=enrollment.student_id, teacher_id=enrollment.teacher_id,
        amount_total=0, amount_teacher=0, amount_platform=0,
        payment_method="manual_grant", status="pending_review",
        payment_type="package", is_manual_grant=True,
    )
    db.add(payment)
    db.flush()

    payment.status = "approved"
    payment.validated_by = current_user.id
    payment.validated_at = utc_now()

    is_renewal = enrollment.status == EnrollmentStatus.pending_renewal
    is_change = enrollment.status == EnrollmentStatus.pending_package_change
    if is_renewal or is_change:
        enrollment.package_id = package.id
        enrollment.classes_total = package.classes_count
        if is_renewal:
            enrollment.classes_used = 0
        enrollment.status = EnrollmentStatus.active
        enrollment.renewal_requested_package_id = None
        enrollment.change_requested_package_id = None

    enrollment.installments_paid = package.installment_count or 1
    enrollment.unlocked_credits = package.classes_count if package.classes_count is not None else 0
    enrollment.payment_status = "paid"
    enrollment.activated_at = utc_now()

    db.commit()
    return {"message": "Acceso otorgado manualmente"}


# ─── CONSULTAS ESTUDIANTE Y PROFESOR ─────────────────────────────────────────

@router.get("/my-payments", response_model=List[PaymentResponse])
def get_my_payments_student(
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    return db.query(Payment).filter(
        Payment.student_id == current_user.student_profile.id
    ).order_by(Payment.created_at.desc()).all()


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
            "payment_type": p.payment_type, "installment_number": p.installment_index,
            "status": p.status, "created_at": p.created_at, "validated_at": p.validated_at,
        }
        for p in payments
    ]


@router.get("/my-wallet", response_model=WalletResponse)
def get_my_wallet(
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db)
):
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
        return WalletResponse(
            available_balance=0.0,
            total_earned=0.0,
            total_withdrawn=0.0,
        )

    return wallet


@router.get("/my-withdrawals", response_model=List[WithdrawalResponse])
def get_my_withdrawals(
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db),
):
    return db.query(Withdrawal).filter(
        Withdrawal.teacher_id == current_user.teacher_profile.id
    ).order_by(Withdrawal.created_at.desc()).all()


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

    send_withdrawal_requested_teacher_email(
        to_email=current_user.email, teacher_name=current_user.name,
        amount=data.amount, destination_method="Transferencia",
    )
    admin_emails = [a.email for a in db.query(User).filter(User.role == UserRole.superadmin, User.is_active == True).all()]
    for admin_email in admin_emails:
        send_admin_withdrawal_requested_email(
            to_email=admin_email, teacher_name=f"{current_user.name} {current_user.surname}",
            amount=data.amount, destination_details=data.payment_info,
        )

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
    else:
        if not data.rejection_reason:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Debes indicar el motivo del rechazo")
        withdrawal.status = "rejected"
        withdrawal.rejection_reason = data.rejection_reason
        withdrawal.processed_by = current_user.id
        withdrawal.processed_at = now
        if wallet:
            wallet.available_balance += withdrawal.amount

    db.commit()

    teacher_user = teacher.user if (teacher := db.query(TeacherProfile).filter(TeacherProfile.id == withdrawal.teacher_id).first()) else None
    if teacher_user:
        send_withdrawal_processed_email(
            to_email=teacher_user.email, teacher_name=teacher_user.name,
            status="completed" if data.action == "complete" else "rejected",
            amount=withdrawal.amount, reference=data.reference, rejection_reason=data.rejection_reason,
        )

    return {"message": f"Retiro {'completado' if data.action == 'complete' else 'rechazado'}"}


@router.get("/booking-status")
def get_booking_status(
    teacher_username: Optional[str] = None,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    from app.models.payment_config import PlatformConfig
    from app.models.student_teacher_link import StudentTeacherLink

    config = db.query(PlatformConfig).first()
    student_id = current_user.student_profile.id

    teacher = None
    if not config or config.is_single_tenant:
        teacher = _get_featured_teacher(db)
        if not teacher:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "No hay profesora featured configurada")
    elif teacher_username:
        teacher = db.query(TeacherProfile).filter(
            TeacherProfile.user_username == teacher_username,
            TeacherProfile.status == TeacherStatus.approved
        ).first()
        if not teacher:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Profesor no encontrado")
    else:
        linked_teacher_ids = [
            l.teacher_id for l in db.query(StudentTeacherLink).filter(
                StudentTeacherLink.student_id == student_id
            ).all()
        ]
        if len(linked_teacher_ids) == 0:
            return {"stage": "needs_teacher", "teacher_username": None, "enrollment_id": None}
        if len(linked_teacher_ids) == 1:
            teacher = db.query(TeacherProfile).filter(TeacherProfile.id == linked_teacher_ids[0]).first()

    if not teacher:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tienes más de un profesor vinculado. Especifica teacher_username."
        )

    stage = get_student_booking_stage(student_id, teacher.id, db)

    enrollment = db.query(Enrollment).filter(
        Enrollment.student_id == student_id,
        Enrollment.teacher_id == teacher.id
    ).order_by(Enrollment.created_at.desc()).first()

    return {
        "stage": stage,
        "teacher_username": teacher.user_username,
        "enrollment_id": enrollment.id if enrollment else None
    }


@router.post("/notify-payment")
def notify_payment(
    data: NotifyPaymentRequest,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    student_id = current_user.student_profile.id

    # ── Clase suelta ──
    if data.type == "single_class":
        if not data.class_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "class_id es requerido")

        class_ = db.query(Class).filter(
            Class.id == data.class_id, Class.student_id == student_id, Class.status == "pending",
        ).first()
        if not class_:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Clase no encontrada o ya notificada")

        if db.query(Payment).filter(Payment.class_id == class_.id, Payment.status == "pending_review").first():
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

        class_.status = "pending_payment"
        class_.payment_expires_at = expires_at

        payment = Payment(
            class_id=class_.id, enrollment_id=class_.enrollment_id,
            student_id=student_id, teacher_id=class_.teacher_id,
            amount_total=amount, amount_teacher=0, amount_platform=0,
            payment_method="manual", transaction_id=data.transaction_reference,
            status="pending_review", payment_type="single_class",
        )
        db.add(payment)
        db.commit()
        db.refresh(payment)
        
        admin_emails = [a.email for a in db.query(User).filter(User.role == UserRole.superadmin, User.is_active == True).all()]
        for admin_email in admin_emails:
            send_admin_payment_pending_email(
                to_email=admin_email,
                student_name=current_user.name,
                amount=amount,
                concept="single_class",
                payment_method="manual",
                transaction_reference=data.transaction_reference,
            )
            
        return {"payment_id": payment.id, "class_status": class_.status, "expires_at": expires_at}

    # ── Recarga prepagada ilimitada ──
    if data.type == "unlimited_recharge":
        if not data.enrollment_id or not data.credits_requested:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "enrollment_id y credits_requested son requeridos")

        enrollment = db.query(Enrollment).filter(
            Enrollment.id == data.enrollment_id, Enrollment.student_id == student_id,
        ).first()
        if not enrollment or enrollment.package.classes_count is not None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Este enrollment no es de tipo ilimitado")

        amount = round(enrollment.package.price * data.credits_requested, 2)
        payment = Payment(
            enrollment_id=enrollment.id, student_id=student_id, teacher_id=enrollment.teacher_id,
            amount_total=amount, amount_teacher=0, amount_platform=0,
            payment_method="manual", transaction_id=data.transaction_reference,
            status="pending_review", payment_type="unlimited_recharge",
        )
        payment.installment_index = data.credits_requested
        db.add(payment)
        db.commit()
        db.refresh(payment)
        
        admin_emails = [a.email for a in db.query(User).filter(User.role == UserRole.superadmin, User.is_active == True).all()]
        for admin_email in admin_emails:
            send_admin_payment_pending_email(
                to_email=admin_email,
                student_name=current_user.name,
                amount=amount,
                concept="unlimited_recharge",
                payment_method="manual",
                transaction_reference=data.transaction_reference,
            )
            
        return {"payment_id": payment.id, "message": "Recarga notificada, en espera de aprobación"}

    # ── Paquete (inicial, renovación o cambio) ──

    if data.type == "package":
        if data.enrollment_id:
            enrollment = db.query(Enrollment).filter(
                Enrollment.id == data.enrollment_id, Enrollment.student_id == student_id,
            ).first()
            if not enrollment:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Enrollment no encontrado")
            package = db.query(Package).filter(Package.id == enrollment.package_id).first()
            if not package:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Paquete no encontrado")
        else:
            if not data.package_id:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "package_id es requerido")
            package = db.query(Package).filter(
                Package.id == data.package_id, Package.is_active == True
            ).first()
            if not package:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Paquete no encontrado")

            stage = get_student_booking_stage(student_id, package.teacher_id, db)
            if stage != "needs_package":
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    "Ya no puedes seleccionar un paquete inicial con este profesor en este momento"
                )

            enrollment = Enrollment(
                student_id=student_id,
                package_id=package.id,
                teacher_id=package.teacher_id,
                classes_used=0,
                classes_total=package.classes_count,
                unlocked_credits=0,
                payment_status="unpaid",
                status=EnrollmentStatus.active,
            )
            db.add(enrollment)
            db.flush()
        payment_type = "package"

    elif data.type == "renewal":
        if not data.enrollment_id or not data.package_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "enrollment_id y package_id son requeridos")

        current_enrollment = db.query(Enrollment).filter(
            Enrollment.id == data.enrollment_id, Enrollment.student_id == student_id,
        ).first()
        if not current_enrollment:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Enrollment no encontrado")
        if current_enrollment.status not in [EnrollmentStatus.active, EnrollmentStatus.completed]:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Solo puedes renovar un paquete activo o completado")

        new_package = db.query(Package).filter(
            Package.id == data.package_id,
            Package.teacher_id == current_enrollment.teacher_id,
            Package.is_active == True,
        ).first()
        if not new_package:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Paquete no encontrado o no disponible")

        existing_renewal = db.query(Enrollment).filter(
            Enrollment.student_id == student_id,
            Enrollment.teacher_id == current_enrollment.teacher_id,
            Enrollment.status == EnrollmentStatus.pending_renewal,
        ).first()
        if existing_renewal:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ya tienes una solicitud de renovación pendiente")

        current_enrollment.status = EnrollmentStatus.pending_renewal
        current_enrollment.renewal_requested_package_id = new_package.id
        enrollment = current_enrollment
        package = new_package
        payment_type = "renewal"

    elif data.type == "package_change":
        if not data.enrollment_id or not data.package_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "enrollment_id y package_id son requeridos")

        current_enrollment = db.query(Enrollment).filter(
            Enrollment.id == data.enrollment_id, Enrollment.student_id == student_id,
        ).first()
        if not current_enrollment:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Enrollment no encontrado")
        if current_enrollment.status != EnrollmentStatus.active:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Solo puedes solicitar un cambio de paquete si tu paquete actual está activo"
            )

        new_package = db.query(Package).filter(
            Package.id == data.package_id,
            Package.teacher_id == current_enrollment.teacher_id,
            Package.is_active == True,
        ).first()
        if not new_package:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Paquete no encontrado, no disponible, o no pertenece a tu profesor actual")
        if new_package.id == current_enrollment.package_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ya tienes este paquete activo")

        available_credits = _get_enrollment_available_credits(current_enrollment, db)

        # ── Paquete nuevo ilimitado: cambio instantáneo, sin cobro ──
        if new_package.classes_count is None:
            _apply_instant_switch_to_unlimited(current_enrollment, new_package, available_credits, db)
            return {
                "message": "Cambiaste a un paquete ilimitado. Tus créditos disponibles se transfirieron "
                           "sin costo adicional. Puedes comprar más créditos cuando quieras."
            }

        # ── Paquete nuevo finito ──
        deficit = new_package.classes_count - available_credits
        if deficit < 0:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"No puedes cambiar a este paquete: ya tienes {available_credits} créditos disponibles "
                f"y el nuevo paquete solo permite {new_package.classes_count}. Elige un paquete con más cupo."
            )

        if deficit == 0:
            _apply_instant_package_change(current_enrollment, new_package, available_credits, db)
            return {"message": "Cambio de paquete aplicado sin costo adicional (tus créditos ya cubren el nuevo paquete)."}

        if db.query(Payment).filter(
            Payment.enrollment_id == current_enrollment.id,
            Payment.status == "pending_review",
            Payment.payment_type.in_(["package", "renewal", "package_change"]),
        ).first():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ya hay un pago pendiente de revisión")

        price_per_class = new_package.price / new_package.classes_count
        amount = round(price_per_class * deficit, 2)

        current_enrollment.status = EnrollmentStatus.pending_package_change
        current_enrollment.change_requested_package_id = new_package.id
        db.commit()

        payment = Payment(
            enrollment_id=current_enrollment.id, student_id=student_id, teacher_id=current_enrollment.teacher_id,
            amount_total=amount, amount_teacher=0, amount_platform=0,
            payment_method="manual", transaction_id=data.transaction_reference,
            status="pending_review", payment_type="package_change",
            installment_index=None,
        )
        db.add(payment)
        db.commit()
        db.refresh(payment)

        admin_emails = [a.email for a in db.query(User).filter(User.role == UserRole.superadmin, User.is_active == True).all()]
        for admin_email in admin_emails:
            send_admin_payment_pending_email(
                to_email=admin_email,
                student_name=current_user.name,
                amount=amount,
                concept="package_change",
                payment_method="manual",
                transaction_reference=data.transaction_reference,
            )

        return {
            "payment_id": payment.id,
            "message": f"Pago notificado por {deficit} créditos faltantes (${amount:.2f}). En espera de aprobación.",
        }

    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"type inválido: {data.type}")

    use_installments = data.installment_index is not None

    if use_installments and not package.allow_installments:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Este paquete no admite pago en cuotas")

    if use_installments:
        expected_next = enrollment.installments_paid + 1
        if data.installment_index != expected_next:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Debes pagar la cuota {expected_next} primero")
        if db.query(Payment).filter(
            Payment.enrollment_id == enrollment.id,
            Payment.status == "pending_review",
            Payment.payment_type.in_(["package", "renewal", "package_change"]),
        ).first():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ya hay un pago o cuota pendiente de revisión")
        amount = _installment_amount(package, data.installment_index)
    else:
        if enrollment.payment_status != "unpaid" and payment_type not in ("renewal", "package_change"):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Este paquete ya fue pagado o tiene una cuota en curso")
        if db.query(Payment).filter(
            Payment.enrollment_id == enrollment.id,
            Payment.status == "pending_review",
            Payment.payment_type.in_(["package", "renewal", "package_change"]),
        ).first():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ya hay un pago pendiente de revisión")
        amount = package.price

    payment = Payment(
        enrollment_id=enrollment.id, student_id=student_id, teacher_id=enrollment.teacher_id,
        amount_total=amount, amount_teacher=0, amount_platform=0,
        payment_method="manual", transaction_id=data.transaction_reference,
        status="pending_review", payment_type=payment_type,
        installment_index=data.installment_index,
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)
    
    admin_emails = [a.email for a in db.query(User).filter(User.role == UserRole.superadmin, User.is_active == True).all()]
    for admin_email in admin_emails:
        send_admin_payment_pending_email(
            to_email=admin_email,
            student_name=current_user.name,
            amount=amount,
            concept=payment_type,
            payment_method="manual",
            transaction_reference=data.transaction_reference,
        )
        
    return {"payment_id": payment.id, "message": "Pago notificado, en espera de aprobación"}

@router.get("/admin/withdrawals/pending")
def get_pending_withdrawals(
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    withdrawals = db.query(Withdrawal).filter(Withdrawal.status == "pending").order_by(Withdrawal.created_at.asc()).all()
    result = []
    for w in withdrawals:
        teacher = db.query(TeacherProfile).filter(TeacherProfile.id == w.teacher_id).first()
        result.append({
            "id": w.id, "teacher_id": w.teacher_id,
            "teacher_username": teacher.user.username if teacher and teacher.user else "unknown",
            "teacher_name": f"{teacher.user.name} {teacher.user.surname}" if teacher and teacher.user else "unknown",
            "amount": w.amount, "destination_details": w.destination_details,
            "created_at": w.created_at, "status": w.status,
        })
    return result