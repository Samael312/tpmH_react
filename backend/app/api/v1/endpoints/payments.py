# app/routers/payments.py / app/api/v1/endpoints/payments.py

import logging
from datetime import timedelta, timezone
from typing import List, Optional
from app.core.timezone import format_local_datetime
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from app.core.pagination import Pagination, paginate
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload
import math
from app.auth.dependencies import (
    get_current_user,
    require_verified_email,
    get_current_staff,
    require_superadmin,
    get_current_staff_or_teacher,
    get_current_student,
    get_current_teacher_or_teacher_admin,
)
from app.core.class_logic import (
    can_book_slot, 
    get_student_booking_stage,
    validate_class_duration,
    get_business_rules,
    get_buffer_minutes_for_type,
    get_price_per_class,
    validate_payment_method,
    PAYMENT_METHOD_LABELS,
    PAYMENT_CONCEPT_LABELS,
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
from app.core.class_logic import lock_booking_rows
from app.core.wallet import wallet_apply
from app.db.base import get_db
from app.models.class_ import Class, ClassType
from app.models.package import Enrollment, EnrollmentStatus, Package
from app.models.payment import Payment, TeacherWallet, Withdrawal
from app.models.manual_grant_request import ManualGrantRequest
from app.models.student import StudentProfile
from app.core.god_mode_audit import log_god_mode_action
from app.core.notifications import create_notification
from app.core.grant_emails import send_admin_manual_grant_requested_email, send_manual_grant_resolved_email
from app.models.payment_config import PaymentConfig
from app.models.teacher import TeacherProfile, TeacherStatus
from app.models.user import User, UserRole
from app.core.platform_config import get_platform_config  # Fase 14, E9: una lectura por petición
from app.core.platform_config import ensure_featured_teacher_in_single_tenant, resolve_featured_teacher
from app.schemas.payments import (
    BookAndPayRequest,
    NotifyPaymentRequest,
    PaymentConfigResponse,
    PaymentResponse,
    ProcessWithdrawalRequest,
    RequestRefundTeacherSuspendedRequest,
    RequestRefundCohortCancelledRequest,
    UpdatePaymentConfigRequest,
    ValidatePaymentRequest,
    WalletResponse,
    WithdrawalRequest,
    WithdrawalRequestV2,
    WithdrawalResponse,
    CreateManualGrantRequest,
    ResolveManualGrantRequest,
    ManualGrantRequestResponse,
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
    # La destacada guardada o, si no hay, FEATURED_TEACHER_USERNAME (misma resolución en todo el backend).
    return resolve_featured_teacher(db)


def _apply_commission(amount_total: float, teacher: TeacherProfile) -> tuple[float, float]:
    # AUD-11: commission_rate NULL cae al 15 % por defecto (antes TypeError).
    commission = teacher.commission_rate if teacher and teacher.commission_rate is not None else 0.15
    amount_platform = round(amount_total * commission, 2)
    amount_teacher = round(amount_total - amount_platform, 2)
    return amount_teacher, amount_platform


def _credit_wallet(teacher_id: int, amount_teacher: float, db: Session):
    # Fase 20 (D4): UPDATE atomico (col = col + x), no leer-modificar-escribir sobre el objeto ORM.
    wallet_apply(db, teacher_id, balance=amount_teacher, earned=amount_teacher, allow_negative=True)


def _enrollment_paid_and_refunded(enrollment_id: Optional[int], db: Session, exclude_payment_id: Optional[int] = None) -> tuple[float, float]:
    """(pagado, ya reembolsado) del enrollment: pagos reales aprobados (sin otorgamientos manuales) y reembolsos
    aprobados o en revision. Es lo que realmente se cobro, no el precio actual del paquete (Fase 20, D2)."""
    if enrollment_id is None:
        return 0.0, 0.0
    paid = db.query(func.coalesce(func.sum(Payment.amount_total), 0)).filter(
        Payment.enrollment_id == enrollment_id,
        Payment.status == "approved",
        Payment.payment_type.in_(_REFUNDABLE_PAYMENT_TYPES),
        Payment.is_manual_grant.isnot(True),
    ).scalar()
    refunded_q = db.query(func.coalesce(func.sum(Payment.amount_total), 0)).filter(
        Payment.enrollment_id == enrollment_id,
        Payment.payment_type == "refund",
        Payment.status.in_(["approved", "pending_review"]),
    )
    if exclude_payment_id is not None:
        refunded_q = refunded_q.filter(Payment.id != exclude_payment_id)
    return round(float(paid or 0), 2), round(float(refunded_q.scalar() or 0), 2)


def _enrollment_refundable(enrollment_id: Optional[int], db: Session, exclude_payment_id: Optional[int] = None) -> float:
    paid, refunded = _enrollment_paid_and_refunded(enrollment_id, db, exclude_payment_id)
    return round(max(paid - refunded, 0.0), 2)


def _cap_refund_amount(amount: float, enrollment_id: Optional[int], db: Session) -> float:
    """Ningun reembolso supera lo pagado menos lo ya reembolsado. Sin nada reembolsable -> 400."""
    refundable = _enrollment_refundable(enrollment_id, db)
    if refundable <= 0:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "No hay ningún pago aprobado pendiente de reembolsar en este paquete.",
        )
    return round(min(amount, refundable), 2)


REFUND_WINDOW_DAYS = 7
_REFUNDABLE_PAYMENT_TYPES = ("package", "renewal", "package_change", "unlimited_recharge", "group_enrollment")


def _ensure_refund_within_window(enrollment_id: int, db: Session) -> None:
    """
    Reembolso voluntario (bajada de paquete con devolución): solo dentro de los
    REFUND_WINDOW_DAYS días posteriores a la aprobación del último pago real del
    enrollment. Los reembolsos por culpa de la plataforma (profesor suspendido,
    grupo cancelado) no pasan por aquí.
    """
    last_validated = db.query(func.max(Payment.validated_at)).filter(
        Payment.enrollment_id == enrollment_id,
        Payment.status == "approved",
        Payment.payment_type.in_(_REFUNDABLE_PAYMENT_TYPES),
        Payment.is_manual_grant.isnot(True),
    ).scalar()
    if last_validated is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No hay ningún pago aprobado que reembolsar.")
    if last_validated.tzinfo is None:
        last_validated = last_validated.replace(tzinfo=timezone.utc)
    if utc_now() - last_validated > timedelta(days=REFUND_WINDOW_DAYS):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"El plazo para pedir un reembolso es de {REFUND_WINDOW_DAYS} días desde la aprobación de tu pago "
            "y ya venció. Si crees que corresponde, contacta con soporte.",
        )


def _teacher_refund_share(enrollment_id: Optional[int], teacher_id: int, amount: float, db: Session) -> float:
    """
    Parte del reembolso que asume el profesor: `amount` × (neto del profesor / total) del último
    pago aprobado del enrollment (comisión congelada en ese pago). La plataforma asume su comisión.
    Sin pago de referencia, cae a (1 - commission_rate) del profesor.
    """
    ref = None
    if enrollment_id is not None:
        ref = db.query(Payment).filter(
            Payment.enrollment_id == enrollment_id,
            Payment.status == "approved",
            Payment.payment_type.in_(_REFUNDABLE_PAYMENT_TYPES),
            Payment.is_manual_grant.isnot(True),
            Payment.amount_total > 0,
        ).order_by(Payment.validated_at.desc()).first()
    if ref is not None:
        ratio = (ref.amount_teacher or 0.0) / ref.amount_total
    else:
        teacher = db.query(TeacherProfile).filter(TeacherProfile.id == teacher_id).first()
        rate = teacher.commission_rate if teacher and teacher.commission_rate is not None else 0.15
        ratio = 1 - rate
    return round(amount * max(min(ratio, 1.0), 0.0), 2)


def _ensure_teacher_can_cover_refund(
    enrollment_id: Optional[int], teacher_id: int, amount: float, db: Session, lock: bool = False,
) -> tuple[TeacherWallet | None, float]:
    """
    Devuelve (billetera, parte del profesor). Si el profesor ya retiró y su saldo no cubre su
    parte, se bloquea y se avisa de que contacte con soporte.
    """
    share = _teacher_refund_share(enrollment_id, teacher_id, amount, db)
    query = db.query(TeacherWallet).filter(TeacherWallet.teacher_id == teacher_id)
    if lock:
        query = query.with_for_update()
    wallet = query.first()
    balance = round(wallet.available_balance or 0.0, 2) if wallet else 0.0
    if share > balance + 0.001:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "El saldo del profesor no cubre este reembolso en este momento. Contacta con soporte para procesarlo.",
        )
    return wallet, share


DUPLICATE_PAYMENT_NOTIFICATION_WINDOW_SECONDS = 15


def _find_recent_duplicate_payment(
    db: Session,
    student_id: int,
    payment_type: str,
    amount: float,
    enrollment_id: Optional[int] = None,
    window_seconds: int = DUPLICATE_PAYMENT_NOTIFICATION_WINDOW_SECONDS,
    installment_index: Optional[int] = None,
) -> Optional[Payment]:
    """
    Busca un Payment prácticamente idéntico (mismo estudiante, enrollment,
    tipo y monto) creado hace muy poco tiempo (por defecto, últimos 15
    segundos), usando el timestamp `Payment.created_at` que ya persiste
    cada pago.

    Se usa como guarda de idempotencia justo antes de insertar un nuevo
    Payment y de notificar por email al admin: evita que un doble clic o
    un reintento del frontend generen dos registros de pago -y por lo
    tanto dos correos consecutivos al admin pidiendo aprobar "la misma"
    solicitud-. Complementa (no reemplaza) los chequeos de "ya hay un
    pago pendiente de revisión" que ya existen en varias ramas de
    notify_payment, porque esos chequeos por status pueden no ver un pago
    que otro request insertó pero todavía no confirmó (commit) — la
    ventana de carrera entre dos requests casi simultáneos.
    """
    cutoff = utc_now() - timedelta(seconds=window_seconds)
    query = db.query(Payment).filter(
        Payment.student_id == student_id,
        Payment.payment_type == payment_type,
        Payment.amount_total == amount,
        Payment.created_at >= cutoff,
    )
    if enrollment_id is not None:
        query = query.filter(Payment.enrollment_id == enrollment_id)
    else:
        query = query.filter(Payment.enrollment_id.is_(None))
    # AUD-22: dos cuotas de igual monto (1 y 2) no son el mismo pago: se distinguen por numero.
    if installment_index is not None:
        query = query.filter(Payment.installment_index == installment_index)
    return query.order_by(Payment.created_at.desc()).first()


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
    # Migración grupal -> individual: si el enrollment venía de una
    # cohorte y el paquete nuevo ya no es grupal, libera su cupo.
    if enrollment.cohort_id and not new_package.is_group:
        from app.core.group_cohort_logic import release_cohort_seat
        release_cohort_seat(enrollment, db)
    # Decisión de negocio: tras el cambio el alumno queda con los créditos
    # COMPLETOS del paquete nuevo disponibles (lo ya usado no cuenta contra
    # él). Como "disponibles = unlocked - ocupadas", se suma lo ocupado.
    occupied_now = _get_enrollment_occupied_slots(enrollment, db)
    enrollment.unlocked_credits = occupied_now + new_package.classes_count
    enrollment.classes_used = 0
    enrollment.activated_at = utc_now()  # Fase 22 (E1): inicio del ciclo nuevo
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
    # BUG fix: esta era la única rama de cambio instantáneo de paquete que
    # NO liberaba el cupo de la cohorte al migrar de grupal -> individual
    # (a diferencia de _apply_instant_package_change, que sí lo hacía).
    # El enrollment quedaba con cohort_id todavía seteado aunque ya fuera
    # un paquete individual ilimitado: el alumno seguía contando como
    # integrante del grupo (get_cohort_active_count) y el banner del
    # estudiante seguía mostrando el panel de espera grupal en vez del de
    # paquete individual. Un alumno no puede tener un paquete individual
    # y seguir figurando dentro de una cohorte al mismo tiempo.
    if enrollment.cohort_id and not new_package.is_group:
        from app.core.group_cohort_logic import release_cohort_seat
        release_cohort_seat(enrollment, db)
    db.commit()


def _get_enrollment_occupied_slots(enrollment: Enrollment, db: Session) -> int:
    """Créditos ya usados/agendados (no cancelados/expirados) del enrollment."""
    if enrollment.cohort_id:
        # Enrollment grupal: las clases no llevan Class.enrollment_id (una
        # misma sesión es compartida por varios alumnos), se cuenta vía
        # ClassParticipant. Ver app/core/group_cohort_logic.py.
        from app.core.group_cohort_logic import get_enrollment_group_occupied_slots
        return get_enrollment_group_occupied_slots(enrollment, db)
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
    Cada cuota libera ceil(classes_count / installment_count), pero el
    acumulado nunca supera classes_count (con 1 clase y 3 cuotas: 1, 0, 0;
    antes liberaba 1, 1, 1). La última cuota libera el resto exacto.
    """
    per_installment = math.ceil(classes_count / installment_count)

    def cumulative(index: int) -> int:
        if index >= installment_count:
            return classes_count
        return min(classes_count, per_installment * max(index, 0))

    return cumulative(installment_index) - cumulative(installment_index - 1)


def _sync_student_teacher_username(current_user: User, teacher: TeacherProfile, db: Session):
    """
    En modo single-tenant, al agendar una clase el estudiante queda
    vinculado automáticamente al profesor featured.
    """
    from app.models.payment_config import PlatformConfig

    config = get_platform_config(db)
    if not config or not config.is_single_tenant:
        return

    student_profile = current_user.student_profile
    if student_profile and student_profile.teacher_username != teacher.user_username:
        old_teacher_username = student_profile.teacher_username
        student_profile.teacher_username = teacher.user_username
        db.commit()
        # No se pasa old_teacher_username: el alumno sigue en `.students` del profesor anterior (puede tener
        # paquete vivo o clases futuras con él tras un multi->single; T3/S1).
        link_student_to_teacher(db, student_profile, teacher, old_teacher_username=None)


def _resolve_booking_teacher(current_user: User, teacher_username: Optional[str], db: Session):
    """
    Determina con qué profesor se agenda (trial o clase sin enrollment todavía).
    Single-tenant: siempre el featured teacher. Multi-tenant: teacher_username es obligatorio.
    """
    from app.models.payment_config import PlatformConfig

    config = get_platform_config(db)

    if not config or config.is_single_tenant:
        featured = _get_featured_teacher(db)
        if featured and featured.status != TeacherStatus.approved:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La profesora no está disponible en este momento; no se pueden agendar clases.",
            )
        return featured

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
    Garantiza el vínculo estudiante-profesor de forma idempotente, en los dos modos.

    En single-tenant el vínculo no se muestra (los alumnos solo ven a la destacada), pero se guarda para que, si
    la plataforma pasa a multi, cada alumno siga con su profesora aunque la destacada haya cambiado entre medias
    o viniera de FEATURED_TEACHER_USERNAME.
    """
    from app.core.teacher_students import ensure_student_teacher_link

    profile = current_user.student_profile
    # Tolera la carrera con otra petición (restricción única): nunca 500.
    if ensure_student_teacher_link(db, profile.id, teacher.id):
        db.commit()
        link_student_to_teacher(db, profile, teacher, old_teacher_username=None)


# ─── CONFIGURACIÓN DE PAGOS ──────────────────────────────────────────────────

@router.get("/config", response_model=PaymentConfigResponse)
def get_payment_config(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Fase 20 (S5): ya no es publico. Requiere sesion; la comision por defecto solo la ve el staff;
    el GET no crea la fila (sin configuracion devuelve los valores por defecto sin escribir)."""
    config = db.query(PaymentConfig).first()
    if not config:
        config = PaymentConfig(
            paypal_enabled=True, binance_enabled=True, bank_transfer_enabled=False,
            mobile_payment_enabled=False, binance_network="USDT TRC20", default_commission_rate=0.15,
        )
    is_staff = current_user.role in (UserRole.superadmin, UserRole.teacher_admin)

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
        default_commission_rate=(config.default_commission_rate or 0.15) if is_staff else None,
        has_any_method=bool(has_any),
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
        # Single-tenant: un paquete de otro profesor (de una etapa multi) no sirve para agendar.
        ensure_featured_teacher_in_single_tenant(db, enrollment_for_teacher.teacher_id)
    else:
        teacher = _resolve_booking_teacher(current_user, data.teacher_username, db)

    if not teacher:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se pudo determinar con qué profesor deseas agendar"
        )

    # AUD-02b/23: serializa reservas concurrentes del mismo alumno/profesor (lock de fila).
    lock_booking_rows(db, teacher.id, student_id)

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

        rules = get_business_rules(db)
        trial_duration = rules["trial_duration_minutes"]
        trial_buffer = get_buffer_minutes_for_type(ClassType.trial, db)

        trial_start = data.start_time_utc
        # Se recalcula server-side a partir de la duración de prueba
        # configurada — NUNCA se confía en un end_time_utc que mande el
        # cliente (podría venir con el margen ya incluido, o manipulado).
        trial_end = trial_start + timedelta(minutes=trial_duration)
        day_of_week = DAYS_ES[trial_start.weekday()]

        can_book, error_msg = can_book_slot(
            start_time_utc=trial_start,
            teacher_id=teacher.id,
            student_id=student_id,
            # D5 fix: fin ocupado real del candidato (duración de prueba +
            # su propio margen), no solo su start.
            end_time_utc=trial_end + timedelta(minutes=trial_buffer),
            db=db,
            enforce_availability=True,
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
            duration=trial_duration,
            buffer_minutes=trial_buffer,
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
                duration_minutes=trial_duration,
                buffer_minutes=trial_buffer,
                is_trial=True,
            )
        send_class_booking_confirmation(
            to_email=current_user.email,
            student_name=current_user.name,
            teacher_name=f"{teacher.user.name} {teacher.user.surname}" if teacher.user else "",
            subject=trial_subject,
            class_start_local=format_local_datetime(trial_start, current_user.student_profile.timezone),
            duration_minutes=trial_duration,
            buffer_minutes=trial_buffer,
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
    ).populate_existing().first()  # tras el lock: leer creditos frescos, no la copia cacheada

    if not enrollment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Enrollment no encontrado")

    # Fase 22 (E3): 'pending_renewal' / 'pending_package_change' siguen siendo utilizables (los creditos ya
    # pagados que sobran se pueden agendar mientras se aprueba la renovacion/cambio). Mensajes especificos.
    _enr_status = getattr(enrollment.status, "value", enrollment.status)
    if _enr_status not in ("active", "pending_package_change", "pending_renewal"):
        _msgs = {
            "completed": "Tu paquete ya está completado: renuévalo o elige uno nuevo para seguir agendando.",
            "cancelled": "Este paquete fue cancelado: elige un paquete nuevo para seguir agendando.",
        }
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            _msgs.get(_enr_status, "Este paquete no está activo en este momento."),
        )

    # Profesor suspendido/rechazado: el enrollment puede seguir "active" o
    # "pending_package_change" (ninguno de los dos estados bloquea por sí
    # solo, ver el filtro de arriba), pero no debe poder agendarse ninguna
    # clase nueva mientras el profesor no esté disponible. El estudiante
    # ve sus créditos "congelados" en /users/me/teachers y puede pedir
    # reembolso vía /payments/request-refund-teacher-suspended.
    if enrollment.teacher.status != TeacherStatus.approved:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Tu profesor no está disponible en este momento. Tus créditos quedaron congelados: "
            "puedes solicitar un reembolso desde 'Tus Profesores'."
        )

    can_duration, duration_msg = validate_class_duration(data.duration_minutes, db)
    if not can_duration:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, duration_msg)
    
    # AUD-07: la duracion reservada debe ser la del paquete (antes bastaba con que estuviera en el catalogo global).
    if data.duration_minutes != enrollment.package.duration_minutes:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"La duración de la clase debe ser de {enrollment.package.duration_minutes} minutos (la de tu paquete)."
        )

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

        # D5 fix: se necesita ANTES del chequeo de choques, para poder
        # pasarle a can_book_slot el fin ocupado real del candidato
        # (duración + su propio margen), no solo su start.
        regular_buffer = get_buffer_minutes_for_type(ClassType.regular, db)

        can_book, error_msg = can_book_slot(
            start_time_utc=data.start_time_utc,
            teacher_id=enrollment.teacher_id,
            student_id=student_id,
            end_time_utc=data.start_time_utc + timedelta(minutes=data.duration_minutes + regular_buffer),
            db=db,
            enforce_availability=True,
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
            # Se recalcula server-side a partir de duration_minutes en vez
            # de confiar en el end_time_utc que manda el cliente (que viene
            # del slot elegido y podría no coincidir con la duración real
            # si alguien lo manipula).
            end_time_utc=data.start_time_utc + timedelta(minutes=data.duration_minutes),
            duration=data.duration_minutes,
            buffer_minutes=regular_buffer,
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
            buffer_minutes=new_class.buffer_minutes,
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

        # D5 fix: ídem branch de paquete finito -- se necesita antes del
        # chequeo de choques.
        regular_buffer = get_buffer_minutes_for_type(ClassType.regular, db)

        can_book, error_msg = can_book_slot(
            start_time_utc=data.start_time_utc,
            teacher_id=enrollment.teacher_id,
            student_id=student_id,
            end_time_utc=data.start_time_utc + timedelta(minutes=data.duration_minutes + regular_buffer),
            db=db,
            enforce_availability=True,
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
            end_time_utc=data.start_time_utc + timedelta(minutes=data.duration_minutes),
            duration=data.duration_minutes,
            buffer_minutes=regular_buffer,
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
            buffer_minutes=new_class.buffer_minutes,
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

def _load_payments_with_refs(query, db: Session):
    """
    Ejecuta la consulta de pagos con alumno/profesor/usuarios en un JOIN y precarga en lote
    las clases, matriculas y paquetes que el serializador consulta por fila (evita N+1).
    Devuelve (pagos, clases_por_id, matriculas_por_id, paquetes_por_id).
    """
    from app.models.student import StudentProfile
    payments = query.options(
        joinedload(Payment.student).joinedload(StudentProfile.user),
        joinedload(Payment.teacher).joinedload(TeacherProfile.user),
    ).all()

    class_ids = {p.class_id for p in payments if p.payment_type == "single_class" and p.class_id}
    enr_ids = {
        p.enrollment_id for p in payments
        if p.enrollment_id and not (p.payment_type == "single_class" and p.class_id)
    }
    classes = {c.id: c for c in db.query(Class).filter(Class.id.in_(class_ids)).all()} if class_ids else {}
    enrollments = {e.id: e for e in db.query(Enrollment).filter(Enrollment.id.in_(enr_ids)).all()} if enr_ids else {}
    pkg_ids = {
        pid for e in enrollments.values()
        for pid in [e.renewal_requested_package_id or e.change_requested_package_id or e.package_id] if pid
    }
    packages = {pk.id: pk for pk in db.query(Package).filter(Package.id.in_(pkg_ids)).all()} if pkg_ids else {}
    return payments, classes, enrollments, packages


@router.get("/pending-review")
def get_payments_pending_review(
    current_user: User = Depends(get_current_staff_or_teacher),
    db: Session = Depends(get_db),
):
    query = db.query(Payment).filter(Payment.status == "pending_review")
    if current_user.role == "teacher":
        query = query.filter(Payment.teacher_id == current_user.teacher_profile.id)

    payments, classes_map, enrollments_map, packages_map = _load_payments_with_refs(
        query.order_by(Payment.created_at.asc()), db
    )

    result = []
    for p in payments:
        student_user = p.student.user if p.student else None
        teacher_user = p.teacher.user if p.teacher else None
        entry = {
            "payment_id": p.id,
            "payment_type": p.payment_type,
            "installment_index": p.installment_index,
            "amount": p.amount_total,
            "payment_method": p.payment_method,
            "payment_method_label": PAYMENT_METHOD_LABELS.get(p.payment_method, p.payment_method),
            "transaction_reference": p.transaction_id,
            "submitted_at": p.created_at,
            "student_name": f"{student_user.name} {student_user.surname}" if student_user else "Desconocido",
            "student_username": student_user.username if student_user else None,
            "teacher_name": f"{teacher_user.name} {teacher_user.surname}" if teacher_user else None,
            # teacher_admin no valida pagos de sus propias clases (los resuelve el superadmin)
            "is_own_payment": bool(
                current_user.role == UserRole.teacher_admin and current_user.teacher_profile
                and p.teacher_id == current_user.teacher_profile.id
            ),
        }
        # BUG-04/12: "single_class" ya no se genera para pagos nuevos, pero se
        # preserva el branch por compatibilidad con filas históricas previas
        # a este cambio.
        if p.payment_type == "single_class" and p.class_id:
            class_ = classes_map.get(p.class_id)
            entry["class_start_utc"] = class_.start_time_utc if class_ else None
            entry["payment_expires_at"] = class_.payment_expires_at if class_ else None
        elif p.enrollment_id:
            enrollment = enrollments_map.get(p.enrollment_id)
            pkg_id = (enrollment.renewal_requested_package_id or enrollment.change_requested_package_id or enrollment.package_id) if enrollment else None
            pkg = packages_map.get(pkg_id) if pkg_id else None
            entry["package_name"] = pkg.name if pkg else None
            entry["installment_total"] = pkg.installment_count if pkg else None
        if p.payment_type == "refund":
            # A dónde tiene que depositar el admin al procesar este reembolso
            # (ver RefundPaymentInfo — todos los sub-campos son opcionales).
            entry["refund_payment_info"] = p.refund_payment_info
        result.append(entry)

    return result

@router.get("/history")
def get_payments_history(
    response: Response,
    page: Pagination = Depends(),
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

    ordered = query.order_by(Payment.validated_at.desc().nullslast(), Payment.created_at.desc())
    payments, classes_map, enrollments_map, packages_map = _load_payments_with_refs(
        paginate(ordered, page, response), db
    )

    result = []
    for p in payments:
        student_user = p.student.user if p.student else None
        teacher_user = p.teacher.user if p.teacher else None
        entry = {
            "payment_id": p.id,
            "payment_type": p.payment_type,
            "installment_index": p.installment_index,
            "amount": p.amount_total,
            "payment_method": p.payment_method,
            "payment_method_label": PAYMENT_METHOD_LABELS.get(p.payment_method, p.payment_method),
            "transaction_reference": p.transaction_id,
            "submitted_at": p.created_at,
            "validated_at": p.validated_at,
            "status": p.status,               # "approved" | "rejected"
            "rejection_reason": p.rejection_reason,
            "student_name": f"{student_user.name} {student_user.surname}" if student_user else "Desconocido",
            "student_username": student_user.username if student_user else None,
            "teacher_name": f"{teacher_user.name} {teacher_user.surname}" if teacher_user else None,
            # teacher_admin no valida pagos de sus propias clases (los resuelve el superadmin)
            "is_own_payment": bool(
                current_user.role == UserRole.teacher_admin and current_user.teacher_profile
                and p.teacher_id == current_user.teacher_profile.id
            ),
        }
        if p.payment_type == "single_class" and p.class_id:
            class_ = classes_map.get(p.class_id)
            entry["class_start_utc"] = class_.start_time_utc if class_ else None
        elif p.enrollment_id:
            enrollment = enrollments_map.get(p.enrollment_id)
            pkg_id = (
                enrollment.renewal_requested_package_id
                or enrollment.change_requested_package_id
                or enrollment.package_id
            ) if enrollment else None
            pkg = packages_map.get(pkg_id) if pkg_id else None
            entry["package_name"] = pkg.name if pkg else None
            entry["installment_total"] = pkg.installment_count if pkg else None
        if p.payment_type == "refund":
            entry["refund_payment_info"] = p.refund_payment_info
        result.append(entry)

    return result

@router.patch("/{payment_id}/validate")
def validate_payment(
    payment_id: int,
    data: ValidatePaymentRequest,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """
    NEG-01: solo `superadmin` y `teacher_admin` aprueban/rechazan pagos (los profesores
    normales ven el pago como «pendiente de revisión»). Un `teacher_admin` no valida los
    pagos de sus propias clases: los resuelve el `superadmin`.
    """
    # Lock de fila: dos aprobaciones simultaneas del mismo pago se serializan y la segunda ve
    # que ya no esta pendiente (404), asi la billetera se acredita una sola vez.
    payment = db.query(Payment).filter(
        Payment.id == payment_id, Payment.status == "pending_review"
    ).with_for_update().first()
    if not payment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pago no encontrado o ya procesado")

    from app.models.student_teacher_link import StudentTeacherLink

    if current_user.role == UserRole.teacher_admin:
        own = current_user.teacher_profile
        if own and payment.teacher_id == own.id:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "No puedes validar los pagos de tus propias clases: los resuelve el superadmin",
            )

    now = utc_now()

    CONCEPT_MAP = PAYMENT_CONCEPT_LABELS

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
                # D1 fix: no forzar siempre "active". Si el paquete que
                # tenía ANTES de pedir la renovación ya estaba agotado
                # (classes_used >= classes_total), hay que devolverlo a
                # "completed" -- así get_student_booking_stage lo vuelve a
                # mandar por "needs_renewal" (banner "Renovar paquete") en
                # vez de tratarlo como un paquete activo utilizable con 0
                # créditos restantes (lo que lo dejaba mostrando solo
                # "Cambiar paquete", sin forma de reintentar la renovación).
                if enrollment.classes_total is not None and enrollment.classes_used >= enrollment.classes_total:
                    enrollment.status = EnrollmentStatus.completed
                else:
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
        # Dinero que sale hacia el estudiante: se descuenta de la billetera del
        # profesor SU parte (la plataforma asume su comisión; decisión de
        # negocio). Si el saldo no alcanza se bloquea y el pago sigue pendiente.
        # amount_teacher/amount_platform quedan en negativo para que el
        # historial refleje el descuento.
        wallet, teacher_share = _ensure_teacher_can_cover_refund(
            payment.enrollment_id, payment.teacher_id, payment.amount_total, db, lock=True,
        )
        # El reembolso nunca puede superar lo cobrado (Fase 20, D2) y se descuenta de forma atomica.
        if payment.amount_total > _enrollment_refundable(payment.enrollment_id, db, exclude_payment_id=payment.id) + 0.001:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "El reembolso supera lo realmente pagado en este paquete (menos lo ya reembolsado). Recházalo o ajústalo en Modo Dios.",
            )
        if teacher_share and not wallet_apply(db, payment.teacher_id, balance=-teacher_share, earned=-teacher_share):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "El saldo del profesor no cubre este reembolso en este momento. Contacta con soporte para procesarlo.",
            )
        payment.amount_teacher = -teacher_share
        payment.amount_platform = -round(payment.amount_total - teacher_share, 2)
        amount_teacher = -teacher_share
    elif not payment.is_manual_grant:
        amount_teacher, amount_platform = _apply_commission(payment.amount_total, teacher)
        payment.amount_teacher = amount_teacher
        payment.amount_platform = amount_platform
        _credit_wallet(payment.teacher_id, amount_teacher, db)
    else:
        payment.amount_teacher = 0
        payment.amount_platform = 0
        amount_teacher = 0

    # Fase 22 (E4): un pago de cambio de paquete solo se aprueba si el enrollment sigue con el cambio solicitado
    # (si el alumno lo cancelo, `change_requested_package_id` es NULL y aprobarlo cobraria sin aplicar nada).
    if payment.payment_type == "package_change":
        _chg_enrollment = db.query(Enrollment).filter(Enrollment.id == payment.enrollment_id).first()
        if _chg_enrollment is None or _chg_enrollment.change_requested_package_id is None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Este cambio de paquete ya no está solicitado (el alumno lo canceló). Rechaza el pago.",
            )

    payment.status = "approved"
    payment.validated_by = current_user.id
    payment.validated_at = now

    # BUG-04/12 fix: se eliminó por completo el tipo de pago "single_class"
    # (clase suelta reservada como 'pending' a la espera de notificar el
    # pago). El link de Meet es un campo opcional que el profesor carga
    # manualmente por clase (PATCH /classes/{class_id}/meet-link, solo
    # mientras la clase está 'confirmed') — no se genera automáticamente
    # y no hace falta pedirlo aquí.

    if payment.payment_type == "unlimited_recharge":
        enrollment = db.query(Enrollment).filter(Enrollment.id == payment.enrollment_id).first()
        if enrollment:
            credits = payment.installment_index or 0
            enrollment.prepaid_unlimited_credits += credits
            if enrollment.activated_at is None:
                enrollment.activated_at = now
                enrollment.payment_status = "paid"

    elif payment.payment_type in ("package", "renewal", "package_change", "refund", "group_enrollment"):
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

                # Si el reembolso fue por profesor suspendido/rechazado (no
                # un downgrade voluntario con un profesor que sigue activo),
                # la relación profesor-estudiante se termina automáticamente
                # acá mismo — antes quedaba "colgada" (enrollment cancelado
                # pero el vínculo seguía existiendo) y el estudiante tenía
                # que ir a buscar manualmente cómo desvincularse antes de
                # poder elegir un profesor nuevo desde el marketplace.
                if enrollment.teacher.status != TeacherStatus.approved:
                    link = db.query(StudentTeacherLink).filter(
                        StudentTeacherLink.student_id == enrollment.student_id,
                        StudentTeacherLink.teacher_id == enrollment.teacher_id,
                    ).first()
                    if link:
                        db.delete(link)
                    teacher_profile = enrollment.teacher
                    if teacher_profile.students and enrollment.student_id in teacher_profile.students:
                        teacher_profile.students = [
                            sid for sid in teacher_profile.students if sid != enrollment.student_id
                        ]

                    # Cualquier clase que hubiera quedado agendada a futuro
                    # con este profesor (agendada antes de la suspensión) se
                    # archiva como cancelada — no se borra de la base de
                    # datos, queda en el historial, pero no cuenta para el
                    # nuevo ciclo si este estudiante vuelve a elegir a este
                    # mismo profesor más adelante una vez reactivado.
                    future_classes = db.query(Class).filter(
                        Class.student_id == enrollment.student_id,
                        Class.teacher_id == enrollment.teacher_id,
                        Class.start_time_utc > now,
                        Class.status.notin_(["cancelled", "completed", "no_show", "finalized"]),
                    ).all()
                    for cls in future_classes:
                        cls.status = "cancelled"
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
                    # Créditos que le sobraban ANTES del cambio (con el paquete
                    # y el recuento de ocupadas viejos). Decisión de negocio:
                    # en una RENOVACIÓN se suman a los del paquete nuevo; en un
                    # CAMBIO ya están pagados en la diferencia, no se suman.
                    old_was_finite = bool(enrollment.package and enrollment.package.classes_count is not None)
                    if old_was_finite:
                        prev_available = max(
                            (enrollment.unlocked_credits or 0) - _get_enrollment_occupied_slots(enrollment, db), 0
                        )
                    else:
                        prev_available = enrollment.prepaid_unlimited_credits or 0
                    carried_credits = prev_available if is_renewal else 0

                    enrollment.package_id = target_package.id
                    enrollment.classes_total = target_package.classes_count
                    if target_package.classes_count is not None:
                        enrollment.prepaid_unlimited_credits = 0
                    enrollment.classes_used = 0  # ciclo nuevo (renovación o cambio)
                    enrollment.activated_at = now  # Fase 22 (E1): inicio del ciclo; las clases anteriores no suman al contador nuevo
                    enrollment.status = EnrollmentStatus.active
                    enrollment.renewal_requested_package_id = None
                    enrollment.change_requested_package_id = None
                    # Migración grupal -> individual aprobada con diferencia
                    # de pago: libera el cupo de la cohorte ahora que el
                    # cambio de paquete quedó confirmado.
                    if enrollment.cohort_id and not target_package.is_group:
                        from app.core.group_cohort_logic import release_cohort_seat
                        release_cohort_seat(enrollment, db)
                    # Base de créditos: lo ya ocupado (clases del ciclo viejo
                    # siguen ligadas al enrollment y restan a "disponibles")
                    # más los sobrantes arrastrados. Arriba/abajo se suman los
                    # créditos del paquete nuevo (o de cada cuota).
                    enrollment.unlocked_credits = (
                        _get_enrollment_occupied_slots(enrollment, db) + carried_credits
                        if target_package.classes_count is not None else 0
                    )
                    if target_package.classes_count is None and old_was_finite:
                        # finito -> ilimitado: los sobrantes pasan a créditos
                        # prepagados (ilimitado -> ilimitado ya conserva los suyos)
                        enrollment.prepaid_unlimited_credits = (
                            (enrollment.prepaid_unlimited_credits or 0) + carried_credits
                        )

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
                    # D12 fix: un alumno que se sumó tarde a una cohorte (ya
                    # con sesiones dictadas) tiene su classes_total ya
                    # reducido desde la inscripción (ver enroll_in_cohort +
                    # _late_join_pricing) -- los créditos que recibe al
                    # aprobarse el pago deben respetar ESE total, no el
                    # classes_count completo del paquete (que es lo que
                    # pagaría un alumno que se une desde el arranque).
                    target_credits = (
                        enrollment.classes_total
                        if payment.payment_type == "group_enrollment"
                        else target_package.classes_count
                    )
                    if is_renewal or is_change:
                        # unlocked_credits ya trae la base (ocupadas + sobrantes)
                        enrollment.unlocked_credits = (enrollment.unlocked_credits or 0) + target_credits
                    elif occupied_slots >= target_credits:
                        enrollment.unlocked_credits = occupied_slots
                        enrollment.status = EnrollmentStatus.completed
                    else:
                        enrollment.unlocked_credits = target_credits
                    enrollment.installments_paid = target_package.installment_count or 1
                    enrollment.payment_status = "paid"

            if enrollment.activated_at is None and enrollment.payment_status in ("paid", "partially_paid"):
                enrollment.activated_at = now

    # Un alumno cuyo pago de inscripción a cohorte recién se aprueba no
    # aparecía en las sesiones grupales que el profesor ya había agendado
    # ANTES de la aprobación (solo se agregaba a las que se crearan
    # después) — se le sumaba como participante a futuro pero quedaba
    # "afuera" de sesiones ya visibles para el resto del grupo. Se
    # agrega retroactivamente como ClassParticipant a las sesiones
    # futuras de su cohorte que todavía tienen cupo.
    if payment.payment_type == "group_enrollment":
        enrollment_after = db.query(Enrollment).filter(Enrollment.id == payment.enrollment_id).first()
        if enrollment_after and enrollment_after.cohort_id and enrollment_after.payment_status == "paid":
            # NOTA: no reimportar Class/ClassType acá -- ya están importados
            # a nivel de módulo (línea ~39). Un import local dentro de esta
            # función hace que Python trate "Class" como variable LOCAL en
            # toda la función (incluyendo los usos de más arriba, ej. línea
            # ~968), lo que producía "UnboundLocalError: cannot access
            # local variable 'Class'" en cualquier camino que llegara a este
            # bloque después de haber referenciado Class antes.
            from app.models.class_participant import ClassParticipant
            from app.core.timezone import utc_now as _utc_now

            future_sessions = db.query(Class).filter(
                Class.cohort_id == enrollment_after.cohort_id,
                Class.class_type == ClassType.group,
                Class.start_time_utc > _utc_now(),
                Class.status.notin_(["cancelled"]),
            ).all()
            cohort = enrollment_after.cohort
            max_students = cohort.max_students if cohort else None
            for session in future_sessions:
                already_in = db.query(ClassParticipant).filter(
                    ClassParticipant.class_id == session.id,
                    ClassParticipant.student_id == enrollment_after.student_id,
                ).first()
                if already_in:
                    continue
                active_count = len([p for p in session.participants if p.attendance_status != "cancelled"])
                if max_students is not None and active_count >= max_students:
                    continue  # sesión ya llena — no forzar sobrecupo
                from app.core.student_overlap import student_has_overlap
                if student_has_overlap(db, enrollment_after.student_id, session.start_time_utc, session.end_time_utc,
                                       exclude_class_id=session.id):
                    continue  # ya tiene otra clase a esa hora: no se le duplica
                db.add(ClassParticipant(
                    class_id=session.id,
                    student_id=enrollment_after.student_id,
                    enrollment_id=enrollment_after.id,
                    attendance_status="confirmed",
                ))

    student_user = payment.student.user if payment.student else None
    if student_user and not payment.is_manual_grant:
        send_payment_receipt_email(
            to_email=student_user.email,
            student_name=student_user.name,
            concept=CONCEPT_MAP.get(payment.payment_type, "Pago"),
            amount=payment.amount_total,
            payment_method=PAYMENT_METHOD_LABELS.get(payment.payment_method, payment.payment_method),
            transaction_reference=payment.transaction_id,
        )

    db.commit()
    return {"message": "Pago aprobado correctamente", "amount_credited": amount_teacher}


def _apply_manual_grant(enrollment: Enrollment, actor_id: int, db: Session) -> Payment:
    """
    Otorga el paquete gratis (Payment manual de $0, sin comision ni billetera). No hace commit.
    Fase 20 (D5): bloquea la fila, no reactiva enrollments cancelados, tolera paquete inexistente y suma los
    creditos con la misma logica que la aprobacion de un pago (sobrantes en renovacion, creditos completos en
    cambio, nunca pisa unlocked_credits a ciegas).
    """
    db.query(Enrollment).filter(Enrollment.id == enrollment.id).with_for_update().first()
    db.refresh(enrollment)
    if enrollment.status == EnrollmentStatus.cancelled:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El paquete está cancelado: no se reactiva con un otorgamiento manual.")

    target_package_id = enrollment.renewal_requested_package_id or enrollment.change_requested_package_id or enrollment.package_id
    package = db.query(Package).filter(Package.id == target_package_id).first() if target_package_id else None
    if package is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El paquete de este enrollment ya no existe.")

    is_renewal = enrollment.status == EnrollmentStatus.pending_renewal
    is_change = enrollment.status == EnrollmentStatus.pending_package_change
    if not (is_renewal or is_change) and enrollment.payment_status == "paid":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Este paquete ya está pagado: no hay nada que otorgar.")

    now = utc_now()
    payment = Payment(
        enrollment_id=enrollment.id, student_id=enrollment.student_id, teacher_id=enrollment.teacher_id,
        amount_total=0, amount_teacher=0, amount_platform=0,
        payment_method="manual_grant", status="approved", payment_type="package", is_manual_grant=True,
        validated_by=actor_id, validated_at=now,
    )
    db.add(payment)

    if is_renewal or is_change:
        old_was_finite = bool(enrollment.package and enrollment.package.classes_count is not None)
        occupied = _get_enrollment_occupied_slots(enrollment, db)
        if old_was_finite:
            prev_available = max((enrollment.unlocked_credits or 0) - occupied, 0)
        else:
            prev_available = enrollment.prepaid_unlimited_credits or 0
        carried = prev_available if is_renewal else 0

        enrollment.package_id = package.id
        enrollment.classes_total = package.classes_count
        enrollment.classes_used = 0
        enrollment.activated_at = now  # Fase 22 (E1): inicio del ciclo nuevo
        enrollment.status = EnrollmentStatus.active
        enrollment.renewal_requested_package_id = None
        enrollment.change_requested_package_id = None
        if enrollment.cohort_id and not package.is_group:
            from app.core.group_cohort_logic import release_cohort_seat
            release_cohort_seat(enrollment, db)
        if package.classes_count is not None:
            enrollment.prepaid_unlimited_credits = 0
            enrollment.unlocked_credits = occupied + carried + package.classes_count
        else:
            enrollment.unlocked_credits = 0
            if old_was_finite:
                enrollment.prepaid_unlimited_credits = (enrollment.prepaid_unlimited_credits or 0) + carried
    elif package.classes_count is not None:
        target_credits = enrollment.classes_total if (enrollment.cohort_id and enrollment.classes_total) else package.classes_count
        enrollment.unlocked_credits = max(enrollment.unlocked_credits or 0, target_credits)

    enrollment.paid_via_installments = False
    enrollment.installments_paid = package.installment_count or 1
    enrollment.payment_status = "paid"
    if enrollment.activated_at is None:
        enrollment.activated_at = now
    db.flush()
    return payment


@router.post("/manual-grant")
def manual_grant_payment(
    data: NotifyPaymentRequest,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """Otorgamiento directo: SOLO staff. Los profesores lo piden con POST /manual-grant-requests (Fase 20, D5)."""
    if data.type != "package" or not data.enrollment_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "manual-grant solo aplica a paquetes por ahora")

    enrollment = db.query(Enrollment).filter(Enrollment.id == data.enrollment_id).first()
    if not enrollment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Enrollment no encontrado")
    if current_user.role == UserRole.teacher_admin:
        own = current_user.teacher_profile
        if own and enrollment.teacher_id == own.id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "No puedes otorgarte paquetes gratis a ti mismo: lo resuelve el superadmin")

    payment = _apply_manual_grant(enrollment, current_user.id, db)
    log_god_mode_action(
        db, actor=current_user, action="manual_grant.direct", entity_type="enrollment", entity_id=enrollment.id,
        reason="Otorgamiento manual directo del staff", before=None, after={"payment_id": payment.id},
    )
    db.commit()
    return {"message": "Acceso otorgado manualmente"}


# ─── SOLICITUDES DE OTORGAMIENTO MANUAL (profesor pide, staff resuelve) ─────

def _grant_request_response(r: ManualGrantRequest, db: Session) -> ManualGrantRequestResponse:
    teacher = db.query(TeacherProfile).filter(TeacherProfile.id == r.teacher_id).first()
    student = db.query(StudentProfile).filter(StudentProfile.id == r.student_id).first()
    package = db.query(Package).filter(Package.id == r.package_id).first() if r.package_id else None
    out = ManualGrantRequestResponse.model_validate(r)
    if teacher and teacher.user:
        out.teacher_name = f"{teacher.user.name} {teacher.user.surname}"
    if student and student.user:
        out.student_name = f"{student.user.name} {student.user.surname}"
    out.package_name = package.name if package else None
    return out


@router.post("/manual-grant-requests", response_model=ManualGrantRequestResponse, status_code=status.HTTP_201_CREATED)
def create_manual_grant_request(
    data: CreateManualGrantRequest,
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db),
):
    teacher = current_user.teacher_profile
    if not teacher:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Perfil de profesor no encontrado")
    enrollment = db.query(Enrollment).filter(
        Enrollment.id == data.enrollment_id, Enrollment.teacher_id == teacher.id,
    ).with_for_update().first()
    if not enrollment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Enrollment no encontrado")
    if enrollment.status == EnrollmentStatus.cancelled:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El paquete está cancelado.")
    target_package_id = enrollment.renewal_requested_package_id or enrollment.change_requested_package_id or enrollment.package_id
    package = db.query(Package).filter(Package.id == target_package_id).first() if target_package_id else None
    if package is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El paquete de este enrollment ya no existe.")
    awaiting = enrollment.status in (EnrollmentStatus.pending_renewal, EnrollmentStatus.pending_package_change)
    if not awaiting and enrollment.payment_status == "paid":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Este paquete ya está pagado: no hay nada que otorgar.")
    if db.query(ManualGrantRequest.id).filter(
        ManualGrantRequest.enrollment_id == enrollment.id, ManualGrantRequest.status == "pending",
    ).first():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ya hay una solicitud pendiente para este alumno.")

    req = ManualGrantRequest(
        teacher_id=teacher.id, student_id=enrollment.student_id, enrollment_id=enrollment.id,
        package_id=package.id, reason=data.reason, status="pending",
    )
    db.add(req)
    student_user = enrollment.student.user if enrollment.student else None
    student_name = f"{student_user.name} {student_user.surname}" if student_user else "alumno"
    create_notification(
        db, type="manual_grant_request", title="Solicitud de paquete gratis",
        message=f"{current_user.name} {current_user.surname} pide dar «{package.name}» gratis a {student_name}.",
        related_teacher_id=teacher.id,
    )
    db.commit()
    db.refresh(req)

    for a in db.query(User).filter(User.role == UserRole.superadmin, User.is_active == True).all():  # noqa: E712
        send_admin_manual_grant_requested_email(
            to_email=a.email, teacher_name=f"{current_user.name} {current_user.surname}",
            student_name=student_name, package_name=package.name, reason=data.reason,
        )
    return _grant_request_response(req, db)


@router.get("/my-manual-grant-requests", response_model=List[ManualGrantRequestResponse])
def get_my_manual_grant_requests(
    response: Response,
    page: Pagination = Depends(),
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db),
):
    q = db.query(ManualGrantRequest).filter(
        ManualGrantRequest.teacher_id == current_user.teacher_profile.id
    ).order_by(ManualGrantRequest.created_at.desc(), ManualGrantRequest.id.desc())
    return [_grant_request_response(r, db) for r in paginate(q, page, response).all()]


@router.get("/manual-grant-requests", response_model=List[ManualGrantRequestResponse])
def list_manual_grant_requests(
    response: Response,
    page: Pagination = Depends(),
    status_filter: Optional[str] = Query(None, alias="status", description="pending | approved | rejected"),
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    q = db.query(ManualGrantRequest)
    if status_filter:
        q = q.filter(ManualGrantRequest.status == status_filter)
    order = ManualGrantRequest.created_at.asc() if status_filter == "pending" else ManualGrantRequest.created_at.desc()
    q = q.order_by(order, ManualGrantRequest.id.desc())
    return [_grant_request_response(r, db) for r in paginate(q, page, response).all()]


@router.patch("/manual-grant-requests/{request_id}/resolve")
def resolve_manual_grant_request(
    request_id: int,
    data: ResolveManualGrantRequest,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    req = db.query(ManualGrantRequest).filter(
        ManualGrantRequest.id == request_id, ManualGrantRequest.status == "pending",
    ).with_for_update().first()
    if not req:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Solicitud no encontrada o ya resuelta")

    # Mismo criterio que validate_payment: un teacher_admin no resuelve lo de su propio perfil.
    if current_user.role == UserRole.teacher_admin:
        own = current_user.teacher_profile
        if own and req.teacher_id == own.id:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "No puedes resolver tus propias solicitudes: las resuelve el superadmin",
            )

    now = utc_now()
    teacher = db.query(TeacherProfile).filter(TeacherProfile.id == req.teacher_id).first()
    student = db.query(StudentProfile).filter(StudentProfile.id == req.student_id).first()
    student_name = f"{student.user.name} {student.user.surname}" if student and student.user else "el alumno"

    if data.action == "reject":
        if not (data.rejection_reason or "").strip():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Debes indicar el motivo del rechazo")
        req.status = "rejected"
        req.rejection_reason = data.rejection_reason.strip()
    else:
        enrollment = db.query(Enrollment).filter(Enrollment.id == req.enrollment_id).first()
        if not enrollment:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Enrollment no encontrado")
        before = {"payment_status": enrollment.payment_status, "unlocked_credits": enrollment.unlocked_credits,
                  "status": enrollment.status.value if hasattr(enrollment.status, "value") else enrollment.status}
        payment = _apply_manual_grant(enrollment, current_user.id, db)
        req.status = "approved"
        req.payment_id = payment.id
        log_god_mode_action(
            db, actor=current_user, action="manual_grant.approve", entity_type="enrollment", entity_id=enrollment.id,
            reason=req.reason, before=before,
            after={"payment_status": enrollment.payment_status, "unlocked_credits": enrollment.unlocked_credits,
                   "request_id": req.id, "payment_id": payment.id},
        )
    req.resolved_at = now
    req.resolved_by = current_user.id

    approved = data.action == "approve"
    if teacher and teacher.user:
        create_notification(
            db, type="manual_grant_resolved",
            title="Solicitud de paquete gratis " + ("aprobada" if approved else "rechazada"),
            message=(f"Tu solicitud para {student_name} fue aprobada." if approved
                     else f"Tu solicitud para {student_name} fue rechazada: {req.rejection_reason}"),
            related_teacher_id=teacher.id, recipient_role="teacher", recipient_user_id=teacher.user.id,
        )
    db.commit()

    if teacher and teacher.user:
        send_manual_grant_resolved_email(
            to_email=teacher.user.email, teacher_name=teacher.user.name, student_name=student_name,
            approved=approved, rejection_reason=req.rejection_reason,
        )
    return {"message": "Solicitud aprobada: paquete otorgado" if approved else "Solicitud rechazada"}


# ─── CONSULTAS ESTUDIANTE Y PROFESOR ─────────────────────────────────────────

@router.get("/my-payments", response_model=List[PaymentResponse])
def get_my_payments_student(
    response: Response,
    page: Pagination = Depends(),
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    query = db.query(Payment).filter(
        Payment.student_id == current_user.student_profile.id
    ).order_by(Payment.created_at.desc(), Payment.id.desc())
    return paginate(query, page, response).all()


@router.get("/my-income")
def get_my_income(
    response: Response,
    page: Pagination = Depends(),
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db),
):
    payments = paginate(db.query(Payment).filter(
        Payment.teacher_id == current_user.teacher_profile.id,
        Payment.status.in_(["approved", "pending_review", "rejected"]),
    ).order_by(Payment.created_at.desc(), Payment.id.desc()), page, response).all()
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
    response: Response,
    page: Pagination = Depends(),
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db),
):
    query = db.query(Withdrawal).filter(
        Withdrawal.teacher_id == current_user.teacher_profile.id
    ).order_by(Withdrawal.created_at.desc(), Withdrawal.id.desc())
    return paginate(query, page, response).all()


@router.post("/request-withdrawal", response_model=WithdrawalResponse, status_code=status.HTTP_201_CREATED)
def request_withdrawal_v2(
    data: WithdrawalRequestV2,
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db),
):
    require_verified_email(current_user)
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

    # Descuento atomico con guarda de saldo en el propio UPDATE (Fase 20, D4).
    if not wallet_apply(db, teacher.id, balance=-data.amount):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Saldo insuficiente.")

    withdrawal = Withdrawal(
        teacher_id=teacher.id,
        amount=data.amount,
        destination_details=data.payment_info,
        destination_method=(data.destination_method or None),
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
    ).with_for_update().first()  # idempotencia: dos procesos simultaneos no devuelven/descuentan dos veces
    if not withdrawal:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Retiro no encontrado o ya procesado")

    # Un teacher_admin no procesa su propio retiro: lo resuelve el superadmin.
    if current_user.role == UserRole.teacher_admin:
        own = current_user.teacher_profile
        if own and withdrawal.teacher_id == own.id:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "No puedes procesar tus propios retiros: los resuelve el superadmin",
            )

    now = utc_now()

    if data.action == "complete":
        withdrawal.status = "completed"
        withdrawal.reference = data.reference
        withdrawal.processed_by = current_user.id
        withdrawal.processed_at = now
        wallet_apply(db, withdrawal.teacher_id, withdrawn=withdrawal.amount)
    else:
        if not data.rejection_reason:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Debes indicar el motivo del rechazo")
        withdrawal.status = "rejected"
        withdrawal.rejection_reason = data.rejection_reason
        withdrawal.processed_by = current_user.id
        withdrawal.processed_at = now
        wallet_apply(db, withdrawal.teacher_id, balance=withdrawal.amount)

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

    config = get_platform_config(db)
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

    # GET: no debe escribir (heal=False); el barrido diario limpia los enrollments sin pagar.
    stage = get_student_booking_stage(student_id, teacher.id, db, heal=False)

    enrollment = db.query(Enrollment).filter(
        Enrollment.student_id == student_id,
        Enrollment.teacher_id == teacher.id
    ).order_by(Enrollment.created_at.desc()).first()

    # ── Último pago rechazado (para mostrarle al estudiante por qué volvió
    #    a "elegir paquete" / "renovar") ─────────────────────────────────
    # get_student_booking_stage() puede haber cancelado el enrollment que
    # tenía el pago rechazado (ver core/class_logic.py), así que no
    # filtramos por enrollment_id — buscamos el pago más reciente de este
    # estudiante con este profesor. Si el más reciente fue rechazado y no
    # hay un intento posterior que lo reemplace, se lo mostramos.
    last_payment = db.query(Payment).filter(
        Payment.student_id == student_id,
        Payment.teacher_id == teacher.id,
    ).order_by(Payment.created_at.desc()).first()

    last_rejected_payment = None
    if last_payment is not None and last_payment.status == "rejected":
        last_rejected_payment = {
            "payment_id": last_payment.id,
            "amount": last_payment.amount_total,
            "payment_type": last_payment.payment_type,
            "rejection_reason": last_payment.rejection_reason,
            "rejected_at": last_payment.validated_at,
        }

    # Recarga de créditos (paquete ilimitado) en revisión: a diferencia de
    # renovación/cambio de paquete, esto no cambia el `stage` (el estudiante
    # sigue pudiendo agendar con los créditos que ya tenía), así que sin este
    # campo no había ninguna forma de que el estudiante supiera que ya
    # mandó la recarga y está pendiente de que el staff la verifique.
    pending_recharge_payment = None
    pending_recharge = db.query(Payment).filter(
        Payment.student_id == student_id,
        Payment.teacher_id == teacher.id,
        Payment.payment_type == "unlimited_recharge",
        Payment.status == "pending_review",
    ).order_by(Payment.created_at.desc()).first()
    if pending_recharge is not None:
        pending_recharge_payment = {
            "payment_id": pending_recharge.id,
            "amount": pending_recharge.amount_total,
            "created_at": pending_recharge.created_at,
        }

    return {
        "stage": stage,
        "teacher_username": teacher.user_username,
        "enrollment_id": enrollment.id if enrollment else None,
        "last_rejected_payment": last_rejected_payment,
        "pending_recharge_payment": pending_recharge_payment,
    }


@router.post("/notify-payment")
def notify_payment(
    data: NotifyPaymentRequest,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    require_verified_email(current_user)
    student_id = current_user.student_profile.id

    # BUG-04/12: se eliminó el tipo "single_class" (reservar una clase suelta
    # como 'pending' y notificar su pago después). Ahora, para paquetes
    # ilimitados, la única vía de conseguir créditos es "unlimited_recharge"
    # (o la compra/renovación inicial del paquete, ver más abajo).

    # ── Recarga prepagada ilimitada ──
    if data.type == "unlimited_recharge":
        if not data.enrollment_id or not data.credits_requested:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "enrollment_id y credits_requested son requeridos")
        if data.credits_requested < 1:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "credits_requested debe ser al menos 1")
        if not data.payment_method:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "payment_method es requerido")
        method = validate_payment_method(data.payment_method, db)

        enrollment = db.query(Enrollment).filter(
            Enrollment.id == data.enrollment_id, Enrollment.student_id == student_id,
        ).first()
        if not enrollment or enrollment.package.classes_count is not None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Este enrollment no es de tipo ilimitado")
        ensure_featured_teacher_in_single_tenant(db, enrollment.teacher_id)

        amount = round(enrollment.package.price * data.credits_requested, 2)

        duplicate = _find_recent_duplicate_payment(
            db, student_id, "unlimited_recharge", amount, enrollment_id=enrollment.id,
        )
        if duplicate:
            return {"payment_id": duplicate.id, "message": "Recarga notificada, en espera de aprobación"}

        payment = Payment(
            enrollment_id=enrollment.id, student_id=student_id, teacher_id=enrollment.teacher_id,
            amount_total=amount, amount_teacher=0, amount_platform=0,
            payment_method=method, transaction_id=data.transaction_reference,
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
                concept=PAYMENT_CONCEPT_LABELS["unlimited_recharge"],
                payment_method=PAYMENT_METHOD_LABELS.get(method, method),
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
            # Single-tenant: renovar o cambiar un paquete de otro profesor tampoco.
            ensure_featured_teacher_in_single_tenant(db, package.teacher_id)
        else:
            if not data.package_id:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "package_id es requerido")
            package = db.query(Package).filter(
                Package.id == data.package_id, Package.is_active == True
            ).first()
            if not package:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Paquete no encontrado")
            if package.is_group:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    "No puedes unirte a un paquete grupal por esta vía. Inscríbete a un grupo disponible."
                )
            # Single-tenant: solo paquetes de la profesora destacada.
            ensure_featured_teacher_in_single_tenant(db, package.teacher_id)

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
        # Fase 22 (m1): igual que el cambio de paquete, no se renueva con cuotas del paquete actual sin pagar
        # (renovar reinicia installments_paid y dejaba las cuotas pendientes sin cobrar).
        if current_enrollment.payment_status != "paid":
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Debes completar el pago de las cuotas de tu paquete actual antes de poder renovarlo."
            )

        new_package = db.query(Package).filter(
            Package.id == data.package_id,
            Package.teacher_id == current_enrollment.teacher_id,
            Package.is_active == True,
        ).first()
        if not new_package:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Paquete no encontrado o no disponible")
        if new_package.is_group:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "No puedes renovar hacia un paquete grupal por esta vía. Inscríbete a un grupo disponible."
            )

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
        if new_package.is_group:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "No puedes unirte a un paquete grupal por esta vía. Inscríbete a un grupo disponible."
            )

        # D7: mínimo de clases YA COMPLETADAS configurable por el admin
        # antes de poder pedir CUALQUIER cambio de paquete (decisión de
        # negocio confirmada: aplica tanto a upgrades como a downgrades,
        # sin distinción). 0 = sin restricción (default).
        from app.core.platform_config import get_or_create_platform_config
        platform_config = get_or_create_platform_config(db)
        min_classes_required = platform_config.min_classes_before_package_change or 0
        if min_classes_required > 0 and current_enrollment.classes_used < min_classes_required:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Necesitas haber completado al menos {min_classes_required} clase(s) de tu paquete actual "
                f"antes de poder cambiarlo (llevas {current_enrollment.classes_used})."
            )

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
        # Correcciones Extra: usa el precio de clase unitaria guardado en
        # el paquete en vez de re-derivarlo siempre de price/classes_count
        # (más preciso -- evita arrastrar redondeo -- y más rápido).
        price_per_class_old = get_price_per_class(current_enrollment.package) or (old_price / old_total)
        occupied_slots = _get_enrollment_occupied_slots(current_enrollment, db)
        # Mismo nº de clases sin consumir ninguna: se trata como el caso A
        # (diferencia de precio), si no deficit == 0 regalaba el cambio a un
        # paquete más caro (mismo nº de clases, otra duración/precio).
        is_downgrade = new_package.classes_count < old_total or (
            new_package.classes_count == old_total and occupied_slots == 0
        )

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
            amount = round(
                (get_price_per_class(new_package) or (new_package.price / new_package.classes_count)) * deficit, 2
            )
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

        if payment_type == "refund":
            # Fase 20 (D2): ningun reembolso supera lo realmente pagado (menos lo ya reembolsado),
            # aunque el precio actual del paquete sea otro.
            _ensure_refund_within_window(current_enrollment.id, db)
            capped = _cap_refund_amount(amount, current_enrollment.id, db)
            if capped != amount:
                notify_msg = notify_msg.replace(f"${amount:.2f}", f"${capped:.2f}")
                amount = capped

        duplicate = _find_recent_duplicate_payment(
            db, student_id, payment_type, amount, enrollment_id=current_enrollment.id,
        )
        if duplicate:
            return {"payment_id": duplicate.id, "message": notify_msg}

        # Correcciones Extra: solo se exige/valida payment_method cuando el
        # estudiante es quien paga (payment_type == "package_change"). Si
        # terminó siendo un reembolso a su favor, lo que importa es
        # payment_info (a dónde depositarle), no cómo pagó.
        method = "manual"
        if payment_type == "package_change":
            if not data.payment_method:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "payment_method es requerido")
            method = validate_payment_method(data.payment_method, db)
        elif payment_type == "refund" and not data.payment_info:
            # Correcciones Extra: mismo requisito que en las solicitudes de
            # reembolso independientes -- no se puede generar un reembolso
            # sin al menos un dato de contacto para procesarlo.
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Completa al menos un dato de contacto o de cuenta para poder procesar tu reembolso"
            )
        if payment_type == "refund":
            _ensure_refund_within_window(current_enrollment.id, db)
            _ensure_teacher_can_cover_refund(current_enrollment.id, current_enrollment.teacher_id, amount, db)

        current_enrollment.status = EnrollmentStatus.pending_package_change
        current_enrollment.change_requested_package_id = new_package.id if apply_new_package else None
        db.commit()

        payment = Payment(
            enrollment_id=current_enrollment.id, student_id=student_id, teacher_id=current_enrollment.teacher_id,
            amount_total=amount, amount_teacher=0, amount_platform=0,
            payment_method=method, transaction_id=data.transaction_reference,
            status="pending_review", payment_type=payment_type,
            installment_index=None,
            refund_payment_info=(
                data.payment_info.model_dump(exclude_none=True)
                if payment_type == "refund" and data.payment_info else None
            ),
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
                concept=PAYMENT_CONCEPT_LABELS.get(payment_type, payment_type),
                payment_method=PAYMENT_METHOD_LABELS.get(method, method),
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
        if not data.payment_method:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "payment_method es requerido")
        method = validate_payment_method(data.payment_method, db)
        if db.query(Payment).filter(
            Payment.enrollment_id == enrollment.id,
            Payment.status == "pending_review",
            Payment.payment_type.in_(["package", "renewal", "package_change", "refund"]),
        ).first():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ya hay un pago pendiente de revisión")

        amount = round(package.price * data.credits_requested, 2)

        duplicate = _find_recent_duplicate_payment(
            db, student_id, payment_type, amount, enrollment_id=enrollment.id,
        )
        if duplicate:
            return {"payment_id": duplicate.id, "message": "Pago notificado, en espera de aprobación"}

        payment = Payment(
            enrollment_id=enrollment.id, student_id=student_id, teacher_id=enrollment.teacher_id,
            amount_total=amount, amount_teacher=0, amount_platform=0,
            payment_method=method, transaction_id=data.transaction_reference,
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
                concept=PAYMENT_CONCEPT_LABELS.get(payment_type, payment_type),
                payment_method=PAYMENT_METHOD_LABELS.get(method, method),
                transaction_reference=data.transaction_reference,
            )

        return {"payment_id": payment.id, "message": "Pago notificado, en espera de aprobación"}

    use_installments = data.installment_index is not None

    if not data.payment_method:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "payment_method es requerido")
    method = validate_payment_method(data.payment_method, db)

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

    duplicate = _find_recent_duplicate_payment(
        db, student_id, payment_type, amount, enrollment_id=enrollment.id,
        installment_index=data.installment_index if use_installments else None,
    )
    if duplicate:
        return {"payment_id": duplicate.id, "message": "Pago notificado, en espera de aprobación"}

    payment = Payment(
        enrollment_id=enrollment.id, student_id=student_id, teacher_id=enrollment.teacher_id,
        amount_total=amount, amount_teacher=0, amount_platform=0,
        payment_method=method, transaction_id=data.transaction_reference,
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
            concept=PAYMENT_CONCEPT_LABELS.get(payment_type, payment_type),
            payment_method=PAYMENT_METHOD_LABELS.get(method, method),
            transaction_reference=data.transaction_reference,
        )
        
    return {"payment_id": payment.id, "message": "Pago notificado, en espera de aprobación"}


@router.post("/request-refund-teacher-suspended")
def request_refund_teacher_suspended(
    data: RequestRefundTeacherSuspendedRequest,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """
    Reembolso disparado por la suspensión/rechazo del profesor del
    estudiante (no por un downgrade de paquete). Reutiliza el mismo
    mecanismo que el "reembolso completo" de cambio de paquete (Payment
    payment_type="refund" sin ningún paquete nuevo solicitado): al
    aprobarse, /payments/validate/{id} cancela el enrollment
    automáticamente (ver is_full_refund_cancel). Una vez cancelado, el
    estudiante puede terminar la relación con este profesor
    (DELETE /users/me/teachers/{username}, ya no está bloqueado por tener
    un enrollment activo) y elegir uno nuevo desde el marketplace.
    """
    enrollment_id = data.enrollment_id
    student_id = current_user.student_profile.id

    enrollment = db.query(Enrollment).filter(
        Enrollment.id == enrollment_id,
        Enrollment.student_id == student_id,
    ).first()
    if not enrollment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Enrollment no encontrado")

    if enrollment.teacher.status == TeacherStatus.approved:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Tu profesor está disponible — este reembolso solo aplica cuando el profesor "
            "está suspendido o inhabilitado."
        )

    if enrollment.status not in (EnrollmentStatus.active, EnrollmentStatus.pending_package_change):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Este paquete ya no está activo")

    if db.query(Payment).filter(
        Payment.enrollment_id == enrollment.id,
        Payment.status == "pending_review",
    ).first():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ya hay una solicitud de reembolso en revisión")

    if enrollment.package.classes_count is None:
        # Paquete ilimitado: el "valor restante" no es 1:1 con un precio
        # fijo por clase como en los finitos (depende de cuánto se pagó
        # por cada recarga histórica). Para no inventar un cálculo que
        # puede quedar mal, se deriva a soporte/admin (God Mode) en vez
        # de crear un Payment con un monto potencialmente incorrecto.
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Tu paquete es de créditos ilimitados — contacta a soporte para procesar el reembolso "
            "de tu saldo prepagado manualmente."
        )

    old_total = enrollment.classes_total or 1
    old_price = enrollment.package.price
    occupied_slots = _get_enrollment_occupied_slots(enrollment, db)
    # Fase 20 (D2/D3): se reembolsa lo REALMENTE pagado (pagos aprobados menos reembolsos previos), no el precio
    # actual del paquete; sin pago aprobado no hay nada que devolver.
    paid_total, _already_refunded = _enrollment_paid_and_refunded(enrollment.id, db)
    refundable = _enrollment_refundable(enrollment.id, db)
    if paid_total <= 0 or refundable <= 0:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "No hay ningún pago aprobado pendiente de reembolsar en este paquete. Si crees que corresponde, contacta con soporte.",
        )

    # Monto del reembolso según cuánto del paquete ya se usó:
    # - Si no usó ningún crédito todavía, se reembolsa el 100% de lo que
    #   pagó al elegir el paquete (occupied_slots == 0).
    # - Si ya usó créditos, se reembolsa el valor de los créditos que le
    #   quedaban disponibles (prorrateado sobre el precio del paquete), no
    #   el total pagado — ya consumió parte del servicio.
    if occupied_slots == 0:
        amount = refundable
        notify_msg = (
            f"Se generó una solicitud de reembolso completo de ${amount:.2f} porque tu profesor "
            "no está disponible. Tu paquete quedará cancelado una vez que el staff procese la "
            "devolución; podrás elegir un profesor nuevo cuando quieras."
        )
    else:
        # El valor por clase sale de lo pagado; si el precio actual es menor se toma el menor (nunca se supera
        # lo pagado, y el tope final es lo reembolsable).
        price_per_class = min(
            paid_total / old_total, get_price_per_class(enrollment.package) or (old_price / old_total)
        )
        amount = round(min(price_per_class * (old_total - occupied_slots), refundable), 2)
        if amount <= 0:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Ya usaste todas las clases de este paquete, no queda saldo por reembolsar."
            )
        notify_msg = (
            f"Se generó una solicitud de reembolso de ${amount:.2f} (valor de tus créditos "
            "disponibles) porque tu profesor no está disponible. En espera de aprobación."
        )

    duplicate = _find_recent_duplicate_payment(
        db, student_id, "refund", amount, enrollment_id=enrollment.id,
    )
    if duplicate:
        return {"payment_id": duplicate.id, "message": notify_msg}

    _ensure_teacher_can_cover_refund(enrollment.id, enrollment.teacher_id, amount, db)

    enrollment.status = EnrollmentStatus.pending_package_change
    enrollment.change_requested_package_id = None
    enrollment.renewal_requested_package_id = None
    db.commit()

    payment = Payment(
        enrollment_id=enrollment.id, student_id=student_id, teacher_id=enrollment.teacher_id,
        amount_total=amount, amount_teacher=0, amount_platform=0,
        payment_method="manual", transaction_id=None,
        status="pending_review", payment_type="refund",
        installment_index=None,
        refund_payment_info=data.payment_info.model_dump(exclude_none=True) if data.payment_info else None,
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
            concept=PAYMENT_CONCEPT_LABELS["refund"],
            payment_method="manual",
            transaction_reference=None,
        )

    return {"payment_id": payment.id, "message": notify_msg}


@router.post("/request-refund-cohort-cancelled")
def request_refund_cohort_cancelled(
    data: RequestRefundCohortCancelledRequest,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """
    Reembolso por una cohorte grupal que el profesor canceló (F3 del
    roadmap de verificación). A diferencia del reembolso por profesor
    suspendido, acá siempre es el 100% de lo pagado: el grupo nunca llegó
    a arrancar (o se abortó), no hay "clases ya tomadas" que descontar.
    Mientras este reembolso esté pendiente, get_student_booking_stage()
    devuelve "needs_group_refund" en vez de "needs_package" — así el
    estudiante ve primero el aviso de grupo cancelado, y recién después
    de que el staff apruebe/rechace el reembolso puede elegir un paquete
    o grupo nuevo.
    """
    from app.models.group_cohort import GroupCohort, CohortStatus

    student_id = current_user.student_profile.id
    enrollment = db.query(Enrollment).filter(
        Enrollment.id == data.enrollment_id,
        Enrollment.student_id == student_id,
    ).first()
    if not enrollment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Enrollment no encontrado")

    if not enrollment.cohort_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Este paquete no es grupal")

    cohort = db.query(GroupCohort).filter(GroupCohort.id == enrollment.cohort_id).first()
    if not cohort or cohort.status != CohortStatus.cancelled:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Este reembolso solo aplica cuando el grupo fue cancelado por el profesor."
        )

    if enrollment.payment_status != "paid":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No hay ningún pago confirmado que reembolsar")

    if db.query(Payment).filter(
        Payment.enrollment_id == enrollment.id,
        Payment.payment_type == "refund",
        Payment.status.in_(["pending_review", "approved"]),
    ).first():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ya hay una solicitud de reembolso en curso para este grupo")

    # Fase 20 (D2): el 100 % de lo realmente pagado (no el precio actual del paquete).
    amount = _cap_refund_amount(float("inf"), enrollment.id, db)  # = todo lo reembolsable (400 si no hay nada)
    notify_msg = (
        f"Se generó una solicitud de reembolso de ${amount:.2f} porque el grupo fue cancelado. "
        "En cuanto el staff la procese, vas a poder elegir un paquete o grupo nuevo."
    )
    _ensure_teacher_can_cover_refund(enrollment.id, enrollment.teacher_id, amount, db)

    payment = Payment(
        enrollment_id=enrollment.id, student_id=student_id, teacher_id=enrollment.teacher_id,
        amount_total=amount, amount_teacher=0, amount_platform=0,
        payment_method="manual", transaction_id=None,
        status="pending_review", payment_type="refund",
        installment_index=None,
        refund_payment_info=data.payment_info.model_dump(exclude_none=True) if data.payment_info else None,
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
            concept=PAYMENT_CONCEPT_LABELS["refund"],
            payment_method="manual",
            transaction_reference=None,
        )

    return {"payment_id": payment.id, "message": notify_msg}


@router.get("/admin/withdrawals/pending")
def get_pending_withdrawals(
    response: Response,
    page: Pagination = Depends(),
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    withdrawals = paginate(
        db.query(Withdrawal).filter(Withdrawal.status == "pending").order_by(Withdrawal.created_at.asc(), Withdrawal.id.asc()),
        page, response,
    ).all()
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