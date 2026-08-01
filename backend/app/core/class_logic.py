from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from app.models.class_ import Class, ClassType
from app.models.package import Enrollment, EnrollmentStatus
from app.models.student import StudentProfile
from app.models.teacher import TeacherProfile
from app.core.timezone import utc_now, UTC
import logging

logger = logging.getLogger(__name__)

# ─── Constantes de negocio ──────────────────────────────────────────────────

# Mínimo de horas de antelación para agendar una clase
MIN_BOOKING_HOURS = 1

# Mínimo de horas de antelación para cancelar sin penalización
MIN_CANCEL_HOURS = 12

# Mínimo de horas de antelación para reagendar (para estudiantes)
MIN_RESCHEDULE_HOURS_STUDENT = 12

# Para staff (admin) no aplican restricciones de tiempo para reagendar
MIN_RESCHEDULE_HOURS_STAFF = 0 


# ─── Validaciones ───────────────────────────────────────────────────────────

def can_book_slot(
    start_time_utc: datetime,
    teacher_id: int,
    student_id: int,
    db: Session,
    exclude_class_id: int = None,  # Para reagendamiento
) -> tuple[bool, str]:
    """
    Verifica si un slot puede ser agendado.
    Retorna (puede_agendar, mensaje_de_error)
    """

    now = utc_now()

    # 1. No se puede agendar en el pasado
    if start_time_utc < now + timedelta(hours=MIN_BOOKING_HOURS):
        return False, f"Debes agendar con al menos {MIN_BOOKING_HOURS} hora de antelación"

    # 2. Verificar que el profesor no tiene clase en ese horario
    end_approx = start_time_utc + timedelta(hours=3)  # Margen amplio

    query = db.query(Class).filter(
        Class.teacher_id == teacher_id,
        Class.start_time_utc < end_approx,
        Class.end_time_utc > start_time_utc,
        Class.status.notin_(["cancelled", "pending", "pending_trial"])
    )
    if exclude_class_id:
        query = query.filter(Class.id != exclude_class_id)

    teacher_conflict = query.first()
    if teacher_conflict:
        return False, "El profesor ya tiene una clase en ese horario"

    # 3. Verificar que el estudiante no tiene clase en ese horario
    query_student = db.query(Class).filter(
        Class.student_id == student_id,
        Class.start_time_utc < end_approx,
        Class.end_time_utc > start_time_utc,
        Class.status.notin_(["cancelled", "pending", "pending_trial"])
    )
    if exclude_class_id:
        query_student = query_student.filter(Class.id != exclude_class_id)

    student_conflict = query_student.first()
    if student_conflict:
        return False, "Ya tienes una clase en ese horario"

    return True, ""


def can_cancel_class(
    class_: Class,
    requesting_user_id: int,
) -> tuple[bool, str]:
    """
    Verifica si una clase puede ser cancelada.
    Retorna (puede_cancelar, mensaje_de_error)
    """
    now = utc_now()

    # Solo pending o confirmed se pueden cancelar
    if class_.status not in ["pending", "pending_trial", "confirmed"]:
        return False, f"No se puede cancelar una clase con estado '{class_.status}'"

    # Verificar antelación mínima (solo para estudiantes)
    time_until_class = class_.start_time_utc - now
    if time_until_class < timedelta(hours=MIN_CANCEL_HOURS):
        hours_left = int(time_until_class.total_seconds() / 3600)
        return False, (
            f"Solo puedes cancelar con {MIN_CANCEL_HOURS}h de antelación. "
            f"Quedan {hours_left}h para la clase. Contacta al profesor."
        )

    return True, ""


def can_reschedule_class(
    class_: Class,
    role: str,  # "student", "teacher", "superadmin"
) -> tuple[bool, str]:
    """
    Verifica si una clase puede ser reagendada según el rol.
    - Estudiante: mínimo 12h de antelación
    - Profesor / Superadmin: sin restricción de tiempo
    """
    now = utc_now()

    if class_.status not in ["pending", "pending_trial", "confirmed"]:
        return False, f"No se puede reagendar una clase con estado '{class_.status}'"

    if role == "student":
        time_until_class = class_.start_time_utc - now
        if time_until_class < timedelta(hours=MIN_RESCHEDULE_HOURS_STUDENT):
            hours_left = int(time_until_class.total_seconds() / 3600)
            return False, (
                f"Solo puedes reagendar con {MIN_RESCHEDULE_HOURS_STUDENT}h "
                f"de antelación. Quedan {hours_left}h para la clase."
            )

    # Profesores y superadmin pueden reagendar sin restricción de tiempo
    return True, ""


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

        # Si se usaron todas las clases del paquete marcamos como completado
        if enrollment.classes_used >= enrollment.classes_total:
            enrollment.status = "completed"
        else:
            enrollment.status = "active"

        db.commit()

def get_student_booking_stage(student_id: int, db: Session) -> str:
    """
    Determina la etapa de reserva del estudiante:
    - "needs_trial": no tiene prueba activa ni completada
    - "trial_in_progress": prueba agendada/confirmada pero no realizada
    - "needs_package": completó la prueba pero nunca tuvo ningún paquete
    - "needs_renewal": agotó un paquete anterior y no tiene uno activo
    - "renewal_pending": ya solicitó renovación, esperando aprobación
    - "ready": tiene paquete activo
    """
    trial_pending = db.query(Class).filter(
        Class.student_id == student_id,
        Class.class_type == ClassType.trial,
        Class.status.in_(["pending", "pending_trial", "pending_payment", "confirmed"])
    ).first()
    if trial_pending:
        return "trial_in_progress"

    trial_completed = db.query(Class).filter(
        Class.student_id == student_id,
        Class.class_type == ClassType.trial,
        Class.status == "completed"
    ).first()
    if not trial_completed:
        return "needs_trial"

    active_enrollment = db.query(Enrollment).filter(
        Enrollment.student_id == student_id,
        Enrollment.status == EnrollmentStatus.active
    ).first()
    if active_enrollment:
        return "ready"

    pending_renewal = db.query(Enrollment).filter(
        Enrollment.student_id == student_id,
        Enrollment.status == EnrollmentStatus.pending_renewal
    ).first()
    if pending_renewal:
        return "renewal_pending"

    any_enrollment_ever = db.query(Enrollment).filter(
        Enrollment.student_id == student_id
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

    expired_pending = db.query(Class).filter(
        Class.status.in_(["pending", "pending_trial", "pending_payment"]),
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
) -> bool:
    """
    Determina si una clase en este estado debe contarse contra el
    paquete del estudiante (classes_used).

    - completed / no_show: siempre cuenta.
    - cancelled: solo cuenta si fue una cancelación tardía
      (menos de MIN_CANCEL_HOURS antes del inicio de la clase).
    - cualquier otro estado (pending, confirmed, etc.): no cuenta.
    """
    if class_status in TERMINAL_COUNTING_STATUSES:
        return True
    if class_status == "cancelled":
        ref = reference_time or utc_now()
        return (start_time_utc - ref) < timedelta(hours=MIN_CANCEL_HOURS)
    return False