from sqlalchemy.orm import Session
from typing import Optional
import logging

from app.models.google_calendar import GoogleCalendarToken
from app.models.class_ import Class
from app.models.teacher import TeacherProfile
from app.core.google_calendar import (
    get_calendar_service,
    create_calendar_event,
    update_calendar_event,
    delete_calendar_event,
)

logger = logging.getLogger(__name__)


def _get_teacher_calendar_service(teacher_id: int, db: Session):
    """
    Obtiene el servicio de Google Calendar del profesor.
    Retorna None si no tiene token o si la sync está desactivada.
    NUNCA lanza excepciones — retorna None en caso de error.
    """
    try:
        token = db.query(GoogleCalendarToken).filter(
            GoogleCalendarToken.teacher_id == teacher_id,
            GoogleCalendarToken.is_active == True
        ).first()

        if not token:
            return None, None

        service = get_calendar_service(
            access_token=token.access_token,
            refresh_token=token.refresh_token,
            token_expiry=token.token_expiry,
        )
        return service, token.calendar_id

    except Exception as e:
        logger.warning(
            f"No se pudo obtener servicio de Calendar "
            f"para profesor {teacher_id}: {e}"
        )
        return None, None


def sync_class_created(class_: Class, db: Session) -> Optional[str]:
    """
    Sincroniza una clase nueva con Google Calendar del profesor.
    Si el profesor no tiene Calendar conectado, no hace nada.

    Returns:
        google_event_id si se creó, None si no se sincronizó
    """
    service, calendar_id = _get_teacher_calendar_service(
        class_.teacher_id, db
    )

    if not service:
        return None  # Sin sync — flujo normal continúa

    try:
        # Nombre del evento en el calendario
        student_name = (
            f"{class_.student.user.name} {class_.student.user.surname}"
            if class_.student and class_.student.user
            else "Estudiante"
        )
        title = f"Clase: {student_name} — {class_.subject or 'General'}"

        event_id = create_calendar_event(
            service=service,
            calendar_id=calendar_id,
            title=title,
            start_utc=class_.start_time_utc,
            end_utc=class_.end_time_utc,
            description=f"Clase de {class_.subject or 'General'}\n"
                        f"Duración: {class_.duration} minutos",
            meet_link=class_.meet_link,
        )

        logger.info(
            f"Clase {class_.id} sincronizada con Google Calendar: {event_id}"
        )
        return event_id

    except Exception as e:
        # Log pero NO falla — la reserva ya se hizo correctamente
        logger.warning(f"Error en sync Calendar para clase {class_.id}: {e}")
        return None


def sync_class_updated(
    class_: Class,
    google_event_id: str,
    db: Session
) -> bool:
    """
    Actualiza el evento en Google Calendar al reagendar.
    Silencioso si no hay sync activa.
    """
    if not google_event_id:
        return True  # Sin event_id = sin sync, ok

    service, calendar_id = _get_teacher_calendar_service(
        class_.teacher_id, db
    )

    if not service:
        return True

    try:
        return update_calendar_event(
            service=service,
            calendar_id=calendar_id,
            event_id=google_event_id,
            start_utc=class_.start_time_utc,
            end_utc=class_.end_time_utc,
            meet_link=class_.meet_link,
        )
    except Exception as e:
        logger.warning(f"Error actualizando Calendar clase {class_.id}: {e}")
        return True  # No bloquear aunque falle


def sync_class_cancelled(
    teacher_id: int,
    google_event_id: str,
    db: Session
) -> bool:
    """
    Elimina el evento de Google Calendar al cancelar.
    Silencioso si no hay sync activa.
    """
    if not google_event_id:
        return True

    service, calendar_id = _get_teacher_calendar_service(teacher_id, db)

    if not service:
        return True

    try:
        return delete_calendar_event(
            service=service,
            calendar_id=calendar_id,
            event_id=google_event_id,
        )
    except Exception as e:
        logger.warning(f"Error eliminando evento Calendar: {e}")
        return True