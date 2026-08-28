# app/core/group_cohort_logic.py

from sqlalchemy.orm import Session

from app.core.timezone import utc_now
from app.models.class_ import Class, ClassType
from app.models.class_participant import ClassParticipant
from app.models.group_cohort import GroupCohort, CohortStatus
from app.models.package import Enrollment, EnrollmentStatus


def get_cohort_active_count(cohort_id: int, db: Session) -> int:
    """Enrollments activos (no cancelados) inscritos en esta cohorte."""
    return db.query(Enrollment).filter(
        Enrollment.cohort_id == cohort_id,
        Enrollment.status.notin_(["cancelled"]),
    ).count()


def get_cohort_student_ids(cohort_id: int, teacher_id: int, db: Session) -> list[int]:
    """
    StudentProfile.id de todos los integrantes activos (no cancelados) de
    una cohorte, validando que le pertenezca al profesor que la consulta.
    Usado para asignar materiales/tareas a un grupo entero de una sola vez
    (ver endpoints /materials/{id}/assign y POST /homework/).
    Devuelve [] si la cohorte no existe o no es del profesor.
    """
    cohort = db.query(GroupCohort).filter(
        GroupCohort.id == cohort_id,
        GroupCohort.teacher_id == teacher_id,
    ).first()
    if not cohort:
        return []

    rows = db.query(Enrollment.student_id).filter(
        Enrollment.cohort_id == cohort_id,
        Enrollment.status.notin_(["cancelled"]),
    ).all()
    return [r[0] for r in rows]


def get_enrollment_group_occupied_slots(enrollment: Enrollment, db: Session) -> int:
    """
    Equivalente a _get_enrollment_occupied_slots (payments.py) pero para
    enrollments grupales: las clases grupales no llevan Class.enrollment_id
    (una misma Class es compartida por varios alumnos), así que se cuenta
    vía ClassParticipant.
    """
    return (
        db.query(ClassParticipant)
        .join(Class, ClassParticipant.class_id == Class.id)
        .filter(
            ClassParticipant.enrollment_id == enrollment.id,
            ClassParticipant.attendance_status != "cancelled",
            Class.status.notin_(["cancelled", "expired"]),
        )
        .count()
    )


def release_cohort_seat(enrollment: Enrollment, db: Session) -> None:
    """
    Libera el cupo de un alumno que migra de grupal a individual (o cuyo
    enrollment grupal se cancela). No hace commit — el caller decide cuándo.

    - Cancela su participación en las sesiones FUTURAS de la cohorte
      (libera cupo real para otro alumno).
    - Conserva su participación en sesiones ya pasadas (historial de
      asistencia intacto).
    - Limpia enrollment.cohort_id para que el enrollment quede como
      puramente individual de ahí en adelante.
    """
    if not enrollment.cohort_id:
        return

    now = utc_now()
    future_participations = (
        db.query(ClassParticipant)
        .join(Class, ClassParticipant.class_id == Class.id)
        .filter(
            ClassParticipant.enrollment_id == enrollment.id,
            Class.start_time_utc > now,
        )
        .all()
    )
    for p in future_participations:
        p.attendance_status = "cancelled"

    enrollment.cohort_id = None


def close_cohort(cohort: GroupCohort, start_date, db: Session) -> None:
    """El profesor cierra la cohorte manualmente con los integrantes
    actuales, sin importar si llegó al mínimo definido."""
    cohort.status = CohortStatus.confirmed
    cohort.start_date = start_date
    cohort.closed_at = utc_now()


def release_and_cancel_all_cohort_enrollments(cohort_id: int, db: Session) -> list[Enrollment]:
    """
    Libera el cupo y CANCELA cada enrollment activo de una cohorte —
    lógica compartida entre cancel_cohort (el profesor la aborta porque
    no se llenó) y complete_cohort (el paquete/las sesiones ya cumplieron
    su ciclo pero el grupo quedó por debajo del mínimo). En ambos casos
    el alumno debe quedar libre de elegir un nuevo paquete la próxima vez
    que intente agendar (ver get_student_booking_stage).
    No hace commit. Retorna los enrollments afectados para notificar.
    """
    affected = db.query(Enrollment).filter(
        Enrollment.cohort_id == cohort_id,
        Enrollment.status.notin_(["cancelled"]),
    ).all()
    for enrollment in affected:
        release_cohort_seat(enrollment, db)
        enrollment.status = EnrollmentStatus.cancelled
    return affected


def cancel_cohort(cohort: GroupCohort, db: Session) -> list[Enrollment]:
    """
    Cancela una cohorte que no se llenó (o que el profesor decide abortar
    antes de que arrancara). Libera el cupo de TODOS sus enrollments
    activos y además CANCELA cada enrollment por completo (antes solo se
    liberaba el cupo y el enrollment quedaba "activo" pero sin cohorte —
    un estado inconsistente: el alumno parecía tener un paquete grupal
    utilizable sin ninguna cohorte real detrás). Al cancelar el
    enrollment, get_student_booking_stage lo manda a
    needs_renewal/needs_package la próxima vez que entre a agendar, y
    puede elegir un paquete individual u otra cohorte con cupo.
    No hace commit. Retorna los enrollments afectados para que el caller
    pueda notificar a cada alumno.
    """
    cohort.status = CohortStatus.cancelled
    cohort.closed_at = utc_now()
    return release_and_cancel_all_cohort_enrollments(cohort.id, db)
