from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from app.models.class_ import Class
from app.models.package import Enrollment
from app.models.student import StudentProfile
from app.models.teacher import TeacherProfile
from app.core.timezone import utc_now, UTC
import logging

logger = logging.getLogger(__name__)

# ─── Constantes de negocio ──────────────────────────────────────────────────

# Mínimo de horas de antelación para agendar una clase
MIN_BOOKING_HOURS = 1

# Mínimo de horas de antelación para cancelar sin penalización
MIN_CANCEL_HOURS = 24

# Mínimo de horas de antelación para reagendar
MIN_RESCHEDULE_HOURS = 24


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
        Class.status.notin_(["cancelled"])
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
        Class.status.notin_(["cancelled"])
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
    if class_.status not in ["pending", "confirmed"]:
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
) -> tuple[bool, str]:
    """
    Verifica si una clase puede ser reagendada.
    """
    now = utc_now()

    if class_.status not in ["pending", "confirmed"]:
        return False, f"No se puede reagendar una clase con estado '{class_.status}'"

    time_until_class = class_.start_time_utc - now
    if time_until_class < timedelta(hours=MIN_RESCHEDULE_HOURS):
        return False, (
            f"Solo puedes reagendar con {MIN_RESCHEDULE_HOURS}h de antelación"
        )

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