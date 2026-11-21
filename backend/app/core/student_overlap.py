"""Solapes del lado del ALUMNO (clases con cualquier profesor y sesiones grupales).

Helper independiente de `can_book_slot` para poder usarlo al inscribir alumnos
en sesiones de cohorte (creación de sesión y auto-unión tras aprobar un pago).
El alumno no necesita el margen de preparación del profesor: se compara contra
el fin real de cada clase (`end_time_utc`), sin `buffer_minutes`.
"""
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.models.class_ import Class
from app.models.class_participant import ClassParticipant

# Estados que NO ocupan agenda. `pending_trial` y `pending` SI ocupan (mismo criterio que can_book_slot).
INACTIVE_CLASS_STATUSES = ("cancelled", "expired")
# Cubre de sobra cualquier duración posible (máx. 110 min + margen).
LOOKBACK = timedelta(hours=3)


def student_has_overlap(
    db: Session,
    student_id: int,
    start: datetime,
    end: datetime,
    exclude_class_id: int | None = None,
) -> bool:
    """True si el alumno ya tiene otra clase (individual con cualquier profesor, o sesión grupal
    en la que participa) que se solapa con [start, end). Sin margen de preparación del profesor."""
    lookback = start - LOOKBACK
    upper = end + LOOKBACK

    def _overlaps(c: Class) -> bool:
        return start < c.end_time_utc and c.start_time_utc < end

    q_own = db.query(Class).filter(
        Class.student_id == student_id,
        Class.start_time_utc > lookback,
        Class.start_time_utc < upper,
        Class.status.notin_(INACTIVE_CLASS_STATUSES),
    )
    q_group = (
        db.query(Class)
        .join(ClassParticipant, ClassParticipant.class_id == Class.id)
        .filter(
            ClassParticipant.student_id == student_id,
            ClassParticipant.attendance_status != "cancelled",
            Class.start_time_utc > lookback,
            Class.start_time_utc < upper,
            Class.status.notin_(INACTIVE_CLASS_STATUSES),
        )
    )
    if exclude_class_id:
        q_own = q_own.filter(Class.id != exclude_class_id)
        q_group = q_group.filter(Class.id != exclude_class_id)
    return any(_overlaps(c) for c in q_own.all()) or any(_overlaps(c) for c in q_group.all())
