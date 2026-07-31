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
    - "needs_trial": no tiene prueba activa ni completada -> debe reservar su prueba (30min)
    - "trial_in_progress": ya tiene una prueba agendada/confirmada pero aún no se realiza
    - "needs_package": realizó/completó la prueba pero no tiene paquete activo
    - "ready": puede reservar contra su paquete activo
    """
    # 1. Verificar si tiene una clase de prueba en progreso o confirmada
    trial_pending = db.query(Class).filter(
        Class.student_id == student_id,
        Class.class_type == ClassType.trial,
        Class.status.in_(["pending", "pending_trial", "pending_payment", "confirmed"])
    ).first()

    if trial_pending:
        return "trial_in_progress"

    # 2. Verificar si ya completó una clase de prueba en el pasado
    trial_completed = db.query(Class).filter(
        Class.student_id == student_id,
        Class.class_type == ClassType.trial,
        Class.status == "completed"
    ).first()

    # Si no ha completado una prueba ni la tiene en curso, le corresponde la clase de prueba
    if not trial_completed:
        return "needs_trial"

    # 3. Si ya completó la prueba, verificamos si tiene un paquete activo
    active_enrollment = db.query(Enrollment).filter(
        Enrollment.student_id == student_id,
        Enrollment.status == EnrollmentStatus.active
    ).first()

    return "ready" if active_enrollment else "needs_package"

# ─── Finalización automática ────────────────────────────────────────────────

def finalize_past_classes(db: Session) -> int:
    """
    Marca como 'finalized' las clases confirmadas cuyo horario ya terminó
    (end_time_utc < ahora) pero que nadie marcó manualmente como
    completed / no_show / cancelled.

    Se ejecuta periódicamente desde el scheduler como red de seguridad,
    ya que normalmente es el profesor quien marca 'completed' a mano.

    Retorna cuántas clases se actualizaron.
    """
    now = utc_now()

    expired = db.query(Class).filter(
        Class.status == "confirmed",
        Class.end_time_utc < now,
    ).all()

    count = 0
    for class_ in expired:
        class_.status = "finalized"
        count += 1

    if count:
        db.commit()

    return count