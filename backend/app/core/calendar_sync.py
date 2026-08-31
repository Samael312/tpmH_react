from sqlalchemy.orm import Session
from typing import Optional
import logging

from app.models.google_calendar import GoogleCalendarToken
from app.models.class_ import Class
from app.core.google_calendar import (
    get_calendar_service_for_token,
    create_calendar_event,
    create_calendar_event_with_meet,
    add_meet_conference_to_event,
    update_calendar_event,
    delete_calendar_event,
)

logger = logging.getLogger(__name__)


def _get_teacher_calendar_service(teacher_id: int, db: Session):
    """
    Devuelve (service, calendar_id) para el profesor, o (None, None) si
    no tiene Calendar conectado/activo o el token necesita reconexión.
    Nunca lanza — el flujo de reserva de clases debe seguir funcionando
    aunque Calendar esté desconectado o roto.
    """
    token = db.query(GoogleCalendarToken).filter(
        GoogleCalendarToken.teacher_id == teacher_id,
        GoogleCalendarToken.is_active == True,
        GoogleCalendarToken.needs_reauth == False,
    ).first()

    if not token:
        return None, None

    service = get_calendar_service_for_token(token, db)
    if not service:
        return None, None

    return service, (token.calendar_id or "primary")


def _teacher_attendee_emails(class_: Class) -> list[str]:
    """
    El profesor queda como invitado explícito del evento (sin correo de
    invitación, ver sendUpdates="none" en core/google_calendar.py) para
    que Google Meet lo reconozca siempre como participante autorizado y
    pueda entrar a la videollamada sin pedir permiso — incluso si abre
    el link desde una cuenta/sesión de Google distinta a la que tiene
    conectada como Calendar. El alumno NO se agrega como invitado.
    """
    email = class_.teacher.user.email if class_.teacher and class_.teacher.user else None
    return [email] if email else []


def sync_class_created(class_: Class, db: Session) -> Optional[str]:
    service, calendar_id = _get_teacher_calendar_service(class_.teacher_id, db)
    if not service:
        return None
    try:
        student_name = (
            f"{class_.student.user.name} {class_.student.user.surname}"
            if class_.student and class_.student.user else "Estudiante"
        )
        title = f"Clase: {student_name} — {class_.subject or 'General'}"
        return create_calendar_event(
            service=service, calendar_id=calendar_id, title=title,
            start_utc=class_.start_time_utc, end_utc=class_.end_time_utc,
            description=f"Clase de {class_.subject or 'General'}\nDuración: {class_.duration} minutos",
            meet_link=class_.meet_link,
            attendee_emails=_teacher_attendee_emails(class_),
        )
    except Exception as e:
        logger.warning(f"Error en sync Calendar para clase {class_.id}: {e}")
        return None


def sync_class_updated(class_: Class, google_event_id: str, db: Session) -> bool:
    if not google_event_id:
        return True
    service, calendar_id = _get_teacher_calendar_service(class_.teacher_id, db)
    if not service:
        return True
    try:
        return update_calendar_event(
            service=service, calendar_id=calendar_id, event_id=google_event_id,
            start_utc=class_.start_time_utc, end_utc=class_.end_time_utc,
            meet_link=class_.meet_link,
            attendee_emails=_teacher_attendee_emails(class_),
        )
    except Exception as e:
        logger.warning(f"Error actualizando Calendar clase {class_.id}: {e}")
        return True


def generate_meet_link_for_class(class_: Class, db: Session) -> Optional[str]:
    """
    Genera automáticamente un link de Google Meet real para la clase,
    usando el Google Calendar del profesor. Se usa desde el job
    programado que corre ~30 minutos antes del inicio de cada clase
    (ver core/scheduler.py::generate_upcoming_meet_links).

    Devuelve el link generado, o None si el profesor no tiene Calendar
    conectado o si la generación falla por cualquier motivo — en ese
    caso la clase sigue funcionando igual y el profesor puede cargar un
    link manualmente en cualquier momento (PATCH /classes/{id}/meet-link).
    """
    service, calendar_id = _get_teacher_calendar_service(class_.teacher_id, db)
    if not service:
        return None

    try:
        attendee_emails = _teacher_attendee_emails(class_)
        if class_.google_event_id:
            link = add_meet_conference_to_event(
                service, calendar_id, class_.google_event_id, attendee_emails=attendee_emails
            )
            if link:
                return link
            # El evento ya no existe en Google (borrado externamente) —
            # caemos a crear uno nuevo con Meet incluido, igual que hace
            # sync_calendar_logic cuando update_calendar_event falla.
            class_.google_event_id = None

        student_name = (
            f"{class_.student.user.name} {class_.student.user.surname}"
            if class_.student and class_.student.user else "Estudiante"
        )
        title = f"Clase: {student_name} — {class_.subject or 'General'}"
        description = f"Clase de {class_.subject or 'General'}\nDuración: {class_.duration} minutos"

        event_id, link = create_calendar_event_with_meet(
            service=service, calendar_id=calendar_id, title=title,
            start_utc=class_.start_time_utc, end_utc=class_.end_time_utc,
            description=description,
            attendee_emails=attendee_emails,
        )
        if event_id:
            class_.google_event_id = event_id
        return link
    except Exception as e:
        logger.warning(f"Error generando Meet link automático para clase {class_.id}: {e}")
        return None


def sync_class_cancelled(teacher_id: int, google_event_id: str, db: Session) -> bool:
    if not google_event_id:
        return True
    service, calendar_id = _get_teacher_calendar_service(teacher_id, db)
    if not service:
        return True
    try:
        return delete_calendar_event(service=service, calendar_id=calendar_id, event_id=google_event_id)
    except Exception as e:
        logger.warning(f"Error eliminando evento Calendar: {e}")
        return True