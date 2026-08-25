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
from app.core.calendar_sync import sync_class_created
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
    UpdatePaymentConfigRequest,
    ValidatePaymentRequest,
    WalletResponse,
    WithdrawalRequest,
    WithdrawalRequestV2,
    WithdrawalResponse,
)

router = APIRouter()
logger = logging.getLogger(__name__)


def _sync_google_calendar_created(new_class: Class, db: Session) -> None:
    """Crea el evento en Google Calendar del profesor al instante, si tiene
    Calendar conectado. Nunca lanza — la reserva debe seguir funcionando
    aunque falle la sincronización (el job en background igual la cubre)."""
    try:
        event_id = sync_class_created(new_class, db)
        if event_id:
            new_class.google_event_id = event_id
            db.commit()
    except Exception as e:
        logger.error(f"Error al sincronizar Google Calendar (creación) clase {new_class.id}: {e}")

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
    occupied_slots: int,
    db: Session,) -> None:
    """    Cambio de paquete sin cobro adicional (diferencia == 0).

    Regla de negocio 3.1 (downgrade): si los créditos ya usados/agendados
    (occupied_slots) igualan o superan el cupo del paquete nuevo, el
    enrollment se marca 'completed' en vez de dejarlo 'active' con
    unlocked_credits por debajo de lo ya usado — eso dejaba al estudiante
    bloqueado para siempre al intentar agendar (occupied_slots >= unlocked_credits
    nunca deja de ser cierto). classes_used NO se toca.
    """
    enrollment.package_id = new_package.id
    enrollment.classes_total = new_package.classes_count
    enrollment.prepaid_unlimited_credits = 0
    enrollment.change_requested_package_id = None
    if occupied_slots >= new_package.classes_count:
        enrollment.unlocked_credits = occupied_slots
        enrollment.status = EnrollmentStatus.completed
    else:
        enrollment.unlocked_credits = new_package.classes_count
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


def _get_enrollment_occupied_slots(enrollment: Enrollment, db: Session) -> int:
    """Créditos ya usados/agendados (no cancelados/expirados) del enrollment."""
    return db.query(Class).filter(
        Class.enrollment_id == enrollment.id,
        Class.status.notin_(["cancelled", "expired"]),
    ).count()


def _get_enrollment_available_credits(enrollment: Enrollment, db: Session) -> int:
    """Créditos disponibles del enrollment ANTES del cambio de paquete."""
    if enrollment.package.classes_count is not None:
        occupied_slots = _get_enrollment_occupied_slots(enrollment, db)
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
#
# BUG-04/12/18/19: se eliminó por completo el endpoint /submit-receipt y el
# flujo de "clase suelta pendiente de pago" (payment_type="single_class").
# Ya era código muerto (ningún cliente lo llamaba) y, además, duplicaba una
# lógica que el negocio decidió eliminar: ahora, para agendar, el crédito
# (finito o prepagado ilimitado) debe existir de antemano; no se reserva un
# horario a la espera de que el estudiante notifique el pago después.

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

        _sync_google_calendar_created(trial_class, db)

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

        # BUG-04 fix: 'expired' se trata igual que 'cancelled' (no ocupa crédito).
        occupied_slots = db.query(Class).filter(
            Class.enrollment_id == enrollment.id,
            Class.status.notin_(["cancelled", "expired"]),
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

        _sync_google_calendar_created(new_class, db)

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
        # BUG-04/12/18/19 fix: se elimina el flujo de "reservar primero,
        # notificar el pago después, con expiración". Para poder agendar,
        # el crédito prepagado debe existir de antemano (comprado y
        # aprobado vía /payments/notify-payment type=unlimited_recharge,
        # o ya incluido en la compra inicial del paquete). Si no hay
        # saldo, se rechaza de forma limpia, sin crear ningún registro.
        if enrollment.payment_status == "unpaid":
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Tu paquete está pendiente de confirmación de pago"
            )

        if enrollment.prepaid_unlimited_credits <= 0:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "No tienes créditos disponibles. Compra créditos para poder agendar."
            )

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
            used_prepaid_credit=True,
        )
        db.add(new_class)
        enrollment.prepaid_unlimited_credits -= 1

        db.commit()
        db.refresh(new_class)

        _sync_google_calendar_created(new_class, db)

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
            "message": "Clase agendada usando tu saldo prepagado."
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
        # BUG-04/12: "single_class" ya no se genera para pagos nuevos, pero se
        # preserva el branch por compatibilidad con filas históricas previas
        # a este cambio.
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

    if current_user.role == "teacher":
        if not current_user.teacher_profile or payment.teacher_id != current_user.teacher_profile.id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo puedes validar pagos de tus estudiantes")

    now = utc_now()

    CONCEPT_MAP = {
        "package": "Paquete", "renewal": "Renovación", "package_change": "Cambio de paquete",
        "unlimited_recharge": "Recarga de créditos", "refund": "Reembolso",
    }

    # ── RECHAZAR PAGO ──
    if data.action == "reject":
        if not data.rejection_reason:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Debes indicar el motivo del rechazo")
        payment.status = "rejected"
        payment.validated_by = current_user.id
        payment.validated_at = now
        payment.rejection_reason = data.rejection_reason

        # Fix: un pago de renovación/cambio/reembolso rechazado ya no deja
        # al estudiante atascado en pending_renewal/pending_package_change
        # para siempre — se revierte al estado que tenía antes, para que
        # pueda volver a intentarlo.
        if payment.payment_type in ("renewal", "package_change", "refund"):
            enrollment = db.query(Enrollment).filter(Enrollment.id == payment.enrollment_id).first()
            if enrollment and enrollment.status in (
                EnrollmentStatus.pending_renewal, EnrollmentStatus.pending_package_change
            ):
                enrollment.status = EnrollmentStatus.active
                enrollment.renewal_requested_package_id = None
                enrollment.change_requested_package_id = None

        student_user = payment.student.user if payment.student else None
        if student_user:
            send_payment_failed_email(
                to_email=student_user.email,
                student_name=student_user.name,
                concept=CONCEPT_MAP.get(payment.payment_type, "Pago"),
                amount=payment.amount_total,
                rejection_reason=data.rejection_reason,
            )

        db.commit()
        return {"message": "Pago rechazado"}

    # ── APROBAR PAGO ──
    teacher = db.query(TeacherProfile).filter(TeacherProfile.id == payment.teacher_id).first()

    if payment.payment_type == "refund":
        # Es dinero que sale de la plataforma hacia el estudiante, no un
        # cobro — no corresponde acreditar nada a la billetera del profesor.
        payment.amount_teacher = 0
        payment.amount_platform = 0
        amount_teacher = 0
    elif not payment.is_manual_grant:
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

    # BUG-04/12 fix: se eliminó por completo el tipo de pago "single_class"
    # (clase suelta reservada como 'pending' a la espera de notificar el
    # pago). El link de Meet de las clases de paquete ya se genera
    # automáticamente vía sincronización con Google Calendar al momento
    # de la reserva, así que no hace falta pedirlo aquí.

    if payment.payment_type == "unlimited_recharge":
        enrollment = db.query(Enrollment).filter(Enrollment.id == payment.enrollment_id).first()
        if enrollment:
            credits = payment.installment_index or 0
            enrollment.prepaid_unlimited_credits += credits
            if enrollment.activated_at is None:
                enrollment.activated_at = now
                enrollment.payment_status = "paid"

    elif payment.payment_type in ("package", "renewal", "package_change", "refund"):
        enrollment = db.query(Enrollment).filter(Enrollment.id == payment.enrollment_id).first()
        if enrollment:
            # Regla de negocio 3.1, Caso A + "Reembolso completo": no se
            # otorga ningún paquete nuevo, solo se cancela el actual. Se
            # reconoce por ser un 'refund' sin ningún paquete solicitado.
            is_full_refund_cancel = (
                payment.payment_type == "refund"
                and enrollment.change_requested_package_id is None
                and enrollment.renewal_requested_package_id is None
            )

            if is_full_refund_cancel:
                enrollment.status = EnrollmentStatus.cancelled
            else:
                target_package_id = (
                    enrollment.renewal_requested_package_id
                    or enrollment.change_requested_package_id
                    or enrollment.package_id
                )
                target_package = db.query(Package).filter(Package.id == target_package_id).first()
                is_renewal = enrollment.status == EnrollmentStatus.pending_renewal or payment.payment_type == "renewal"
                is_change = enrollment.status == EnrollmentStatus.pending_package_change or payment.payment_type in ("package_change", "refund")

                if is_renewal or is_change:
                    enrollment.package_id = target_package.id
                    enrollment.classes_total = target_package.classes_count
                    enrollment.unlocked_credits = 0  # arranca limpio con el paquete nuevo
                    if target_package.classes_count is not None:
                        enrollment.prepaid_unlimited_credits = 0
                    if is_renewal:
                        enrollment.classes_used = 0
                    enrollment.status = EnrollmentStatus.active
                    enrollment.renewal_requested_package_id = None
                    enrollment.change_requested_package_id = None

                if target_package.classes_count is None:
                    # BUG-18 fix: paquete ILIMITADO. 'installment_index' aquí
                    # contiene la cantidad de créditos comprados (ver
                    # notify_payment), no un número de cuota — los paquetes
                    # ilimitados no usan pago en cuotas.
                    enrollment.paid_via_installments = False
                    credits = payment.installment_index or 0
                    enrollment.prepaid_unlimited_credits = (enrollment.prepaid_unlimited_credits or 0) + credits
                    enrollment.installments_paid = 1
                    enrollment.payment_status = "paid"
                elif payment.installment_index is not None:
                    enrollment.paid_via_installments = True
                    enrollment.installments_paid = payment.installment_index
                    n = target_package.installment_count or 1
                    credit_this_installment = _installment_credit_amount(
                        target_package.classes_count, n, payment.installment_index
                    )
                    enrollment.unlocked_credits = (enrollment.unlocked_credits or 0) + credit_this_installment
                    enrollment.payment_status = "paid" if payment.installment_index >= n else "partially_paid"
                else:
                    # Regla de negocio 3.1 (downgrade): nunca dejar
                    # unlocked_credits por debajo de lo ya usado/agendado —
                    # eso bloqueaba al estudiante para siempre. Si ya usó
                    # más créditos de los que el paquete nuevo ofrece, el
                    # enrollment queda 'completed' (ya agotó su valor) en
                    # vez de 'active' con un tope imposible de alcanzar.
                    enrollment.paid_via_installments = False
                    occupied_slots = _get_enrollment_occupied_slots(enrollment, db)
                    if occupied_slots >= target_package.classes_count:
                        enrollment.unlocked_credits = occupied_slots
                        enrollment.status = EnrollmentStatus.completed
                    else:
                        enrollment.unlocked_credits = target_package.classes_count
                    enrollment.installments_paid = target_package.installment_count or 1
                    enrollment.payment_status = "paid"

            if enrollment.activated_at is None and enrollment.payment_status in ("paid", "partially_paid"):
                enrollment.activated_at = now

    student_user = payment.student.user if payment.student else None
    if student_user and not payment.is_manual_grant:
        send_payment_receipt_email(
            to_email=student_user.email,
            student_name=student_user.name,
            concept=CONCEPT_MAP.get(payment.payment_type, "Pago"),
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
    # BUG-13 fix: bloquear la fila con SELECT ... FOR UPDATE para evitar que
    # dos solicitudes de retiro concurrentes lean el mismo saldo antes de
    # que cualquiera de las dos haga commit (condición de carrera / TOCTOU).
    wallet = db.query(TeacherWallet).filter(
        TeacherWallet.teacher_id == teacher.id
    ).with_for_update().first()

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

    # BUG-04/12: se eliminó el tipo "single_class" (reservar una clase suelta
    # como 'pending' y notificar su pago después). Ahora, para paquetes
    # ilimitados, la única vía de conseguir créditos es "unlimited_recharge"
    # (o la compra/renovación inicial del paquete, ver más abajo).

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
        current_enrollment.installments_paid = 0  # arranca limpio: cuotas del ciclo anterior no aplican al nuevo
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

        # Regla de negocio 3.2: bloquear el cambio de paquete de forma
        # estricta mientras el paquete actual tenga cuotas (o cualquier
        # saldo) pendiente de pago.
        if current_enrollment.payment_status != "paid":
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Debes completar el pago de tu paquete actual antes de poder cambiarlo."
            )

        if db.query(Payment).filter(
            Payment.enrollment_id == current_enrollment.id,
            Payment.status == "pending_review",
            Payment.payment_type.in_(["package", "renewal", "package_change", "refund"]),
        ).first():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ya hay un pago pendiente de revisión")

        new_package = db.query(Package).filter(
            Package.id == data.package_id,
            Package.teacher_id == current_enrollment.teacher_id,
            Package.is_active == True,
        ).first()
        if not new_package:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Paquete no encontrado, no disponible, o no pertenece a tu profesor actual")
        if new_package.id == current_enrollment.package_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ya tienes este paquete activo")

        # ── Paquete nuevo ilimitado: cambio instantáneo, sin cobro ──
        if new_package.classes_count is None:
            available_credits = _get_enrollment_available_credits(current_enrollment, db)
            _apply_instant_switch_to_unlimited(current_enrollment, new_package, available_credits, db)
            return {
                "message": "Cambiaste a un paquete ilimitado. Tus créditos disponibles se transfirieron "
                           "sin costo adicional. Puedes comprar más créditos cuando quieras."
            }

        old_total = current_enrollment.classes_total or 1
        old_price = current_enrollment.package.price
        price_per_class_old = old_price / old_total
        occupied_slots = _get_enrollment_occupied_slots(current_enrollment, db)
        is_downgrade = new_package.classes_count < old_total

        if not is_downgrade:
            # ── Upgrade (o lateral): comportamiento existente, se cobra
            # solo por los créditos adicionales sobre lo aún disponible ──
            available_credits = _get_enrollment_available_credits(current_enrollment, db)
            deficit = new_package.classes_count - available_credits
            if deficit < 0:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    f"No puedes cambiar a este paquete: ya tienes {available_credits} créditos disponibles "
                    f"y el nuevo paquete solo permite {new_package.classes_count}. Elige un paquete con más cupo."
                )
            if deficit == 0:
                _apply_instant_package_change(current_enrollment, new_package, occupied_slots, db)
                return {"message": "Cambio de paquete aplicado sin costo adicional (tus créditos ya cubren el nuevo paquete)."}
            amount = round((new_package.price / new_package.classes_count) * deficit, 2)
            payment_type = "package_change"
            apply_new_package = True
            notify_msg = f"Pago notificado por {deficit} créditos faltantes (${amount:.2f}). En espera de aprobación."

        else:
            # ── Regla de negocio 3.1 — Downgrade: se usa el VALOR restante
            # del paquete actual (no el conteo de créditos) para calcular
            # el ajuste, según si el estudiante ya consumió créditos o no. ──
            if occupied_slots == 0:
                # Caso A: ningún crédito usado — el estudiante elige.
                option = data.change_option or "adjust_difference"
                if option == "full_refund":
                    amount = round(old_price, 2)
                    payment_type = "refund"
                    apply_new_package = False
                    notify_msg = (
                        f"Se generó una solicitud de reembolso completo de ${amount:.2f}. "
                        "Tu paquete actual quedará cancelado una vez que el staff procese la devolución; "
                        "podrás elegir un paquete nuevo cuando quieras."
                    )
                else:
                    diff = round(new_package.price - old_price, 2)
                    apply_new_package = True
                    if diff == 0:
                        _apply_instant_package_change(current_enrollment, new_package, occupied_slots, db)
                        return {"message": "Cambio de paquete aplicado sin costo adicional (mismo valor)."}
                    amount = abs(diff)
                    payment_type = "package_change" if diff > 0 else "refund"
                    notify_msg = (
                        f"Pago notificado por ${amount:.2f} (diferencia con tu paquete anterior). En espera de aprobación."
                        if diff > 0 else
                        f"Se generó una nota de reembolso de ${amount:.2f} (diferencia a tu favor). En espera de aprobación."
                    )
            else:
                # Caso B: ya se consumieron créditos — nunca reembolso
                # completo, solo ajuste diferencial sobre el valor restante.
                remaining_value = round(price_per_class_old * (old_total - occupied_slots), 2)
                diff = round(new_package.price - remaining_value, 2)
                apply_new_package = True
                if diff == 0:
                    _apply_instant_package_change(current_enrollment, new_package, occupied_slots, db)
                    return {"message": "Cambio de paquete aplicado sin costo adicional (mismo valor restante)."}
                amount = abs(diff)
                payment_type = "package_change" if diff > 0 else "refund"
                notify_msg = (
                    f"Pago notificado por ${amount:.2f} (diferencia sobre el valor restante de tu paquete actual). En espera de aprobación."
                    if diff > 0 else
                    f"Se generó una nota de reembolso de ${amount:.2f} (valor restante a tu favor). En espera de aprobación."
                )

        current_enrollment.status = EnrollmentStatus.pending_package_change
        current_enrollment.change_requested_package_id = new_package.id if apply_new_package else None
        db.commit()

        payment = Payment(
            enrollment_id=current_enrollment.id, student_id=student_id, teacher_id=current_enrollment.teacher_id,
            amount_total=amount, amount_teacher=0, amount_platform=0,
            payment_method="manual", transaction_id=data.transaction_reference,
            status="pending_review", payment_type=payment_type,
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
                concept=payment_type,
                payment_method="manual",
                transaction_reference=data.transaction_reference,
            )

        return {"payment_id": payment.id, "message": notify_msg}

    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"type inválido: {data.type}")

    # BUG-18 fix: si el paquete (inicial o de renovación) es ILIMITADO, el
    # estudiante debe indicar cuántos créditos quiere comprar — antes este
    # dato nunca se pedía ni se cobraba, y al aprobarse el pago
    # prepaid_unlimited_credits nunca se incrementaba (quedaba en 0 pase lo
    # que pase). Se sigue la misma convención que "unlimited_recharge":
    # la cantidad de créditos se guarda reutilizando el campo
    # installment_index del Payment.
    if package.classes_count is None:
        if not data.credits_requested or data.credits_requested < 1:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "credits_requested es requerido para paquetes ilimitados"
            )
        if db.query(Payment).filter(
            Payment.enrollment_id == enrollment.id,
            Payment.status == "pending_review",
            Payment.payment_type.in_(["package", "renewal", "package_change", "refund"]),
        ).first():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ya hay un pago pendiente de revisión")

        amount = round(package.price * data.credits_requested, 2)
        payment = Payment(
            enrollment_id=enrollment.id, student_id=student_id, teacher_id=enrollment.teacher_id,
            amount_total=amount, amount_teacher=0, amount_platform=0,
            payment_method="manual", transaction_id=data.transaction_reference,
            status="pending_review", payment_type=payment_type,
            installment_index=data.credits_requested,
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
            Payment.payment_type.in_(["package", "renewal", "package_change", "refund"]),
        ).first():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ya hay un pago o cuota pendiente de revisión")
        amount = _installment_amount(package, data.installment_index)
    else:
        if enrollment.payment_status != "unpaid" and payment_type not in ("renewal", "package_change"):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Este paquete ya fue pagado o tiene una cuota en curso")
        if db.query(Payment).filter(
            Payment.enrollment_id == enrollment.id,
            Payment.status == "pending_review",
            Payment.payment_type.in_(["package", "renewal", "package_change", "refund"]),
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