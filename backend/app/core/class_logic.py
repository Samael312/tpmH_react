# backend/app/core/class_logic.py

from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from app.models.class_ import Class, ClassType
from app.models.package import Enrollment, EnrollmentStatus
from app.models.payment import Payment
from app.models.payment_config import PlatformConfig
from app.models.student import StudentProfile
from app.models.teacher import TeacherProfile
from app.core.timezone import utc_now, UTC
import logging
from app.schemas.classes import ALLOWED_DURATIONS

logger = logging.getLogger(__name__)

# ─── Fallbacks (usados solo si platform_config aún no tiene fila) ───────────
MIN_BOOKING_HOURS = 1
MIN_CANCEL_HOURS = 12
MIN_RESCHEDULE_HOURS_STUDENT = 12
MIN_RESCHEDULE_HOURS_STAFF = 0

def get_business_rules(db: Session) -> dict:
    """
    Lee las reglas de negocio configuradas por el superadmin desde
    PlatformConfig. Si no hay fila aún, cae a los defaults de arriba.
    """
    config = db.query(PlatformConfig).first()
    if not config:
        return {
            "min_booking_hours": MIN_BOOKING_HOURS,
            "min_cancel_hours": MIN_CANCEL_HOURS,
            "min_reschedule_hours_student": MIN_RESCHEDULE_HOURS_STUDENT,
            "allowed_class_durations": ALLOWED_DURATIONS,
            "allowed_package_durations": [30, 60],
            "low_credit_threshold": 1,
            "low_credit_renotify_days": 6,
        }
    return {
        "min_booking_hours": config.min_booking_hours or MIN_BOOKING_HOURS,
        "min_cancel_hours": config.min_cancel_hours or MIN_CANCEL_HOURS,
        "min_reschedule_hours_student": config.min_reschedule_hours_student or MIN_RESCHEDULE_HOURS_STUDENT,
        "allowed_class_durations": config.allowed_class_durations or ALLOWED_DURATIONS,
        "allowed_package_durations": config.allowed_package_durations or [30, 60],
        "low_credit_threshold": config.low_credit_threshold or 1,
        "low_credit_renotify_days": config.low_credit_renotify_days or 6,
    }

def validate_class_duration(duration_minutes: int, db: Session) -> tuple[bool, str]:
    rules = get_business_rules(db)
    allowed = rules["allowed_class_durations"]
    if duration_minutes not in allowed:
        return False, f"Duración inválida. Opciones permitidas: {allowed}"
    return True, ""


# ─── Validaciones ───────────────────────────────────────────────────────────

def can_book_slot(
    start_time_utc: datetime,
    teacher_id: int,
    student_id: int,
    db: Session,
    exclude_class_id: int = None,
) -> tuple[bool, str]:
    now = utc_now()
    rules = get_business_rules(db)

    if start_time_utc < now + timedelta(hours=rules["min_booking_hours"]):
        return False, f"Debes agendar con al menos {rules['min_booking_hours']} hora(s) de antelación"

    end_approx = start_time_utc + timedelta(hours=3)

    # BUG-04 fix: "expired" se trata igual que "cancelled" (no bloquea el
    # slot). "pending" ya no es necesario en esta lista: las clases
    # regulares ahora siempre se crean directamente como "confirmed"
    # (ver book_class), por lo que ese estado ya no puede ocurrir para
    # clases nuevas; se deja fuera de la exclusión a propósito por si
    # existieran filas históricas previas a este cambio.
    query = db.query(Class).filter(
        Class.teacher_id == teacher_id,
        Class.start_time_utc < end_approx,
        Class.end_time_utc > start_time_utc,
        Class.status.notin_(["cancelled", "expired", "pending_trial"])
    )
    if exclude_class_id:
        query = query.filter(Class.id != exclude_class_id)
    if query.first():
        return False, "El profesor ya tiene una clase en ese horario"

    query_student = db.query(Class).filter(
        Class.student_id == student_id,
        Class.start_time_utc < end_approx,
        Class.end_time_utc > start_time_utc,
        Class.status.notin_(["cancelled", "expired", "pending_trial"])
    )
    if exclude_class_id:
        query_student = query_student.filter(Class.id != exclude_class_id)
    if query_student.first():
        return False, "Ya tienes una clase en ese horario"

    return True, ""


def can_cancel_class(
    class_: Class,
    requesting_user_id: int,
    db: Session,
) -> tuple[bool, str]:
    now = utc_now()
    rules = get_business_rules(db)

    if class_.status not in ["pending", "pending_trial", "confirmed"]:
        return False, f"No se puede cancelar una clase con estado '{class_.status}'"

    time_until_class = class_.start_time_utc - now
    if time_until_class < timedelta(hours=rules["min_cancel_hours"]):
        hours_left = int(time_until_class.total_seconds() / 3600)
        return False, (
            f"Solo puedes cancelar con {rules['min_cancel_hours']}h de antelación. "
            f"Quedan {hours_left}h para la clase. Contacta al profesor."
        )

    return True, ""


def can_reschedule_class(
    class_: Class,
    role: str,
    db: Session,
) -> tuple[bool, str]:
    now = utc_now()
    rules = get_business_rules(db)

    # BUG-02 fix (ampliado): una clase que quedó 'finalized' (limbo transitorio
    # post-clase, aún no resuelta a completed/no_show) puede reagendarse tanto
    # por el profesor como por el estudiante, sin restricción de antelación
    # (la clase ya pasó, así que exigir horas de anticipación no aplica).
    reschedulable_statuses = ["pending", "pending_trial", "confirmed", "finalized"]

    if class_.status not in reschedulable_statuses:
        return False, f"No se puede reagendar una clase con estado '{class_.status}'"

    if role == "student" and class_.status != "finalized":
        time_until_class = class_.start_time_utc - now
        if time_until_class < timedelta(hours=rules["min_reschedule_hours_student"]):
            hours_left = int(time_until_class.total_seconds() / 3600)
            return False, (
                f"Solo puedes reagendar con {rules['min_reschedule_hours_student']}h "
                f"de antelación. Quedan {hours_left}h para la clase."
            )

    return True, ""


def resolve_status_after_reschedule(class_: Class) -> str:
    """
    Determina el status que debe quedar una clase tras reagendarla.

    Regla general (ya vigente, BUG-04/12/18/19): reagendar NO resetea el
    status a 'pending'/'pending_trial' — una clase 'confirmed' sigue
    'confirmed', una 'pending_trial' sigue 'pending_trial' (es el único
    estado "pendiente" que existe hoy para clases).

    Única excepción: una clase 'finalized' (limbo transitorio post-clase que
    el sistema aún no resolvió a completed/no_show) al reagendarse a una
    fecha futura vuelve a ser una clase con clase por dar, así que debe
    pasar a 'confirmed' para volver a aparecer en "Próximas" en vez de
    quedar atascada en "Historial" con una fecha futura.
    """
    if class_.status == "finalized":
        return "confirmed"
    return class_.status


def update_enrollment_counter(
    enrollment_id: int,
    delta: int,
    db: Session
):
    """
    Actualiza el contador de clases usadas en un enrollment.
    delta=1 cuando se completa una clase
    delta=-1 cuando se cancela una clase completada
    """
    enrollment = db.query(Enrollment).filter(
        Enrollment.id == enrollment_id
    ).first()

    if enrollment:
        enrollment.classes_used = max(0, enrollment.classes_used + delta)

        # Si se usaron todas las clases del paquete marcamos como completado # None = ilimitadas, nunca se marca como completado por conteo
        if enrollment.classes_total is not None and enrollment.classes_used >= enrollment.classes_total:
            enrollment.status = "completed"
        else:
            enrollment.status = "active"

        db.commit()

def get_student_booking_stage(student_id: int, teacher_id: int, db: Session) -> str:
    """
    Determina la etapa de reserva del estudiante CON UN PROFESOR ESPECÍFICO.
    Cada relación estudiante-profesor es independiente: completar la
    prueba con un profesor no exime de la prueba con otro.

    - "needs_trial": no tiene prueba activa ni completada con este profesor
    - "trial_in_progress": prueba agendada/confirmada pero no realizada
    - "needs_package": completó la prueba pero nunca tuvo paquete con él
    - "needs_renewal": agotó un paquete anterior y no tiene uno activo
    - "renewal_pending": ya solicitó renovación, esperando aprobación
    - "ready": tiene paquete activo (incluye "pending_package_change":
      sigue siendo utilizable mientras se aprueba el cambio)
    """
    trial_pending = db.query(Class).filter(
        Class.student_id == student_id,
        Class.teacher_id == teacher_id,
        Class.class_type == ClassType.trial,
        Class.status.in_(["pending", "pending_trial", "pending_payment", "confirmed"])
    ).first()
    if trial_pending:
        return "trial_in_progress"

    trial_completed = db.query(Class).filter(
        Class.student_id == student_id,
        Class.teacher_id == teacher_id,
        Class.class_type == ClassType.trial,
        Class.status == "completed"
    ).first()
    if not trial_completed:
        return "needs_trial"

    active_enrollment = db.query(Enrollment).filter(
        Enrollment.student_id == student_id,
        Enrollment.teacher_id == teacher_id,
        Enrollment.status == EnrollmentStatus.active
    ).first()

    if active_enrollment:
        # BUG-19 fix: este chequeo antes era exclusivo de paquetes finitos
        # (classes_count is not None). Los paquetes ilimitados también deben
        # bloquearse mientras su pago inicial/renovación siga sin aprobar,
        # igual que los finitos — si no, el estudiante podía llegar al
        # selector de horarios sin que su compra hubiera sido aprobada.
        if active_enrollment.payment_status == "unpaid":
            has_pending_payment = db.query(Payment).filter(
                Payment.enrollment_id == active_enrollment.id,
                Payment.status == "pending_review",
            ).first() is not None

            if has_pending_payment:
                return "package_pending_payment"

            # Nunca se notificó el pago, o fue rechazado y no se reintentó.
            # No hay nada que confirmar: liberamos este enrollment obsoleto
            # para que el estudiante pueda elegir paquete de nuevo.
            active_enrollment.status = EnrollmentStatus.cancelled
            db.commit()
            return "needs_package"
        return "ready"

    package_change_pending = db.query(Enrollment).filter(
        Enrollment.student_id == student_id,
        Enrollment.teacher_id == teacher_id,
        Enrollment.status == EnrollmentStatus.pending_package_change
    ).first()
    if package_change_pending:
        # El paquete actual sigue siendo utilizable mientras se aprueba
        # el cambio — el estudiante puede seguir agendando normalmente.
        return "ready"

    pending_renewal = db.query(Enrollment).filter(
        Enrollment.student_id == student_id,
        Enrollment.teacher_id == teacher_id,
        Enrollment.status == EnrollmentStatus.pending_renewal
    ).first()
    if pending_renewal:
        return "renewal_pending"

    any_enrollment_ever = db.query(Enrollment).filter(
        Enrollment.student_id == student_id,
        Enrollment.teacher_id == teacher_id,
    ).first()
    if any_enrollment_ever:
        return "needs_renewal"

    return "needs_package"

# ─── Finalización automática ────────────────────────────────────────────────

def finalize_past_classes(db: Session) -> int:
    """
    Marca como 'finalized' las clases confirmadas cuyo horario ya terminó,
    y como 'no_show' las que nunca se confirmaron/pagaron y ya pasó su hora.
    Actualiza también el contador de clases usadas del paquete, ya que estos
    estados cuentan contra el cupo del estudiante.
    """
    now = utc_now()
    count = 0

    expired_confirmed = db.query(Class).filter(
        Class.status == "confirmed",
        Class.end_time_utc < now,
    ).all()
    for c in expired_confirmed:
        c.status = "finalized"
        count += 1

    # BUG-04/12 fix: "pending" y "pending_payment" para clases regulares ya
    # no pueden producirse (el flujo de "reservar y pagar después" fue
    # eliminado); solo queda "pending_trial" para clases de prueba nunca
    # confirmadas por el profesor/staff.
    expired_pending = db.query(Class).filter(
        Class.status == "pending_trial",
        Class.end_time_utc < now,
    ).all()
    for c in expired_pending:
        c.status = "no_show"
        count += 1
        if c.class_type == ClassType.regular and c.enrollment_id:
            update_enrollment_counter(c.enrollment_id, delta=1, db=db)

    if count:
        db.commit()
    return count

# ─── Conteo contra el paquete ────────────────────────────────────────────────

TERMINAL_COUNTING_STATUSES = {"completed", "no_show"}


def class_counts_towards_package(
    class_status: str,
    start_time_utc: datetime,
    reference_time: datetime | None = None,
    apply_late_cancel_penalty: bool = True,
    min_cancel_hours: int | None = None,
) -> bool:
    """
    Determina si una clase en este estado debe contarse contra el
    paquete del estudiante (classes_used).

    - completed / no_show: siempre cuenta.
    - cancelled: cuenta solo si apply_late_cancel_penalty=True Y fue una
      cancelación tardía (menos de min_cancel_hours antes del inicio).
      Cuando el profesor o el staff cancelan, apply_late_cancel_penalty
      debe ser False — la penalización por antelación solo es
      responsabilidad del estudiante, nunca de la plataforma.
    - cualquier otro estado (pending, confirmed, expired, etc.): no cuenta.

    min_cancel_hours: umbral configurable (PlatformConfig.min_cancel_hours,
    vía get_business_rules). Si no se pasa, cae al default MIN_CANCEL_HOURS.
    """
    if class_status in TERMINAL_COUNTING_STATUSES:
        return True
    if class_status == "cancelled":
        if not apply_late_cancel_penalty:
            return False
        ref = reference_time or utc_now()
        hours = min_cancel_hours if min_cancel_hours is not None else MIN_CANCEL_HOURS
        return (start_time_utc - ref) < timedelta(hours=hours)
    return False

def cancel_class_and_refund(
    class_: "Class",
    db: Session,
    apply_late_cancel_penalty: bool,
) -> bool:
    """
    Marca la clase como cancelada y devuelve el crédito al estudiante
    si corresponde. Centraliza la lógica que antes estaba duplicada en
    los 3 endpoints de cancelación (estudiante, profesor, admin).

    apply_late_cancel_penalty:
        - True  → se usa para cancelaciones del ESTUDIANTE: si cancela
          con menos de min_cancel_hours de antelación, no recupera el
          crédito. (En la práctica esto casi nunca se dispara porque
          can_cancel_class ya bloquea la cancelación tardía del
          estudiante antes de llegar aquí.)
        - False → se usa para profesor/admin: el crédito SIEMPRE se
          devuelve, sin importar cuán cerca esté la clase. Ellos no
          deben aplicar una penalización pensada para el estudiante.

    No hace commit — el caller decide cuándo confirmar la transacción.
    Retorna True si el crédito fue devuelto.
    """
    min_cancel_hours = get_business_rules(db)["min_cancel_hours"]

    old_status = class_.status
    old_counts = class_counts_towards_package(
        old_status, class_.start_time_utc,
        apply_late_cancel_penalty=apply_late_cancel_penalty,
        min_cancel_hours=min_cancel_hours,
    )

    class_.status = "cancelled"

    counts_as_used = class_counts_towards_package(
        "cancelled", class_.start_time_utc,
        apply_late_cancel_penalty=apply_late_cancel_penalty,
        min_cancel_hours=min_cancel_hours,
    )
    credit_returned = not counts_as_used

    if credit_returned:
        if class_.used_prepaid_credit and class_.enrollment_id:
            enrollment = db.query(Enrollment).filter(
                Enrollment.id == class_.enrollment_id
            ).first()
            if enrollment:
                enrollment.prepaid_unlimited_credits += 1
            class_.used_prepaid_credit = False
        elif class_.class_type == ClassType.regular and class_.enrollment_id and old_counts:
            update_enrollment_counter(class_.enrollment_id, delta=-1, db=db)

    return credit_returned