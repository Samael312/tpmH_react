import os
import logging
import time
import uuid
from datetime import datetime, timedelta
from typing import List, Optional, Tuple
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

# Flexibilizar la validación de scopes en oauthlib
os.environ["OAUTHLIB_RELAX_TOKEN_SCOPE"] = "1"

import requests
from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.timezone import UTC, utc_now
from app.models.class_ import Class
from app.models.google_calendar import GoogleCalendarToken
from app.models.teacher import TeacherProfile

logger = logging.getLogger(__name__)

SCOPES = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "openid",
]

# Ventana hacia adelante que consideramos al sincronizar / consultar busy
SYNC_WINDOW_DAYS = 30

# Reintentos ante errores transitorios (5xx, rate limit puntual)
MAX_RETRIES = 3
RETRY_BACKOFF_SECONDS = 1.5


# ─────────────────────────────────────────────────────────────────────────
# OAuth2 — conexión inicial
# ─────────────────────────────────────────────────────────────────────────

def get_oauth_flow() -> Flow:
    """Crea el flujo OAuth2 para conectar Google Calendar"""
    return Flow.from_client_config(
        client_config={
            "web": {
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "redirect_uris": [settings.GOOGLE_REDIRECT_URI],
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        },
        scopes=SCOPES,
        redirect_uri=settings.GOOGLE_REDIRECT_URI,
    )


def get_auth_url(state: Optional[str] = None) -> str:
    """
    Genera la URL de autorización de Google.
    Limpia los parámetros de PKCE para evitar desajustes de 'code_verifier'.
    """
    flow = get_oauth_flow()
    kwargs = {
        "access_type": "offline",       # necesario para obtener refresh_token
        "include_granted_scopes": "true",
        "prompt": "consent",            # fuerza refresh_token también en reconexiones
    }
    if state:
        kwargs["state"] = state

    auth_url, _ = flow.authorization_url(**kwargs)

    # Remueve code_challenge y code_challenge_method de la URL
    parsed = urlparse(auth_url)
    query_params = parse_qs(parsed.query)
    query_params.pop("code_challenge", None)
    query_params.pop("code_challenge_method", None)

    new_query = urlencode(query_params, doseq=True)
    return urlunparse(parsed._replace(query=new_query))


def exchange_code_for_tokens(code: str, code_verifier: Optional[str] = None) -> dict:
    """Intercambia el código de autorización por tokens."""
    flow = get_oauth_flow()
    if code_verifier:
        flow.code_verifier = code_verifier

    flow.fetch_token(code=code)
    credentials = flow.credentials
    return {
        "access_token": credentials.token,
        "refresh_token": credentials.refresh_token,
        "token_expiry": credentials.expiry,
    }


def revoke_token(token: str):
    """Revoca el token de acceso en los servidores de Google"""
    try:
        requests.post(
            'https://oauth2.googleapis.com/revoke',
            params={'token': token},
            headers={'content-type': 'application/x-www-form-urlencoded'}
        )
    except Exception as e:
        logger.error(f"Error revocando token en Google: {e}")


# ─────────────────────────────────────────────────────────────────────────
# Servicio autenticado — con manejo de refresh y de tokens revocados
# ─────────────────────────────────────────────────────────────────────────

def get_calendar_service_for_token(token: GoogleCalendarToken, db: Session):
    try:
        credentials = Credentials(
            token=token.access_token,
            refresh_token=token.refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=settings.GOOGLE_CLIENT_ID,
            client_secret=settings.GOOGLE_CLIENT_SECRET,
            scopes=SCOPES,
        )
        if token.token_expiry:
            expiry = token.token_expiry
            if expiry.tzinfo is not None:
                expiry = expiry.astimezone(UTC).replace(tzinfo=None)
            credentials.expiry = expiry

        if credentials.expired and credentials.refresh_token:
            credentials.refresh(Request())
            token.access_token = credentials.token
            token.token_expiry = credentials.expiry
            token.needs_reauth = False
            token.last_error = None
            db.commit()

        return build("calendar", "v3", credentials=credentials, cache_discovery=False)

    except RefreshError as e:
        logger.warning(f"Refresh token inválido/revocado para teacher_id={token.teacher_id}: {e}")
        token.needs_reauth = True
        token.is_active = False
        token.last_error = "Token revocado o expirado. Reconexión requerida."
        db.commit()
        return None

    except Exception as e:
        logger.error(f"Error inesperado creando servicio de Calendar (teacher_id={token.teacher_id}): {e}")
        token.last_error = str(e)[:500]
        db.commit()
        return None


def _with_retries(fn, *args, **kwargs):
    last_exc = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return fn(*args, **kwargs)
        except HttpError as e:
            status = getattr(e.resp, "status", None)
            retriable = status in (429, 500, 502, 503)
            last_exc = e
            if not retriable or attempt == MAX_RETRIES:
                raise
            wait = RETRY_BACKOFF_SECONDS * attempt
            logger.warning(f"Google API status={status}, reintentando en {wait}s (intento {attempt}/{MAX_RETRIES})")
            time.sleep(wait)
    raise last_exc


# ─────────────────────────────────────────────────────────────────────────
# Lectura — bloques ocupados externos
# ─────────────────────────────────────────────────────────────────────────

def get_busy_ranges(
    service,
    calendar_id: str,
    time_min: datetime,
    time_max: datetime,
) -> List[Tuple[datetime, datetime]]:
    if time_min.tzinfo is None:
        time_min = time_min.replace(tzinfo=UTC)
    if time_max.tzinfo is None:
        time_max = time_max.replace(tzinfo=UTC)

    body = {
        "timeMin": time_min.isoformat(),
        "timeMax": time_max.isoformat(),
        "items": [{"id": calendar_id}],
    }

    try:
        result = _with_retries(service.freebusy().query(body=body).execute)
    except HttpError as e:
        logger.warning(f"Error consultando freebusy en {calendar_id}: {e}")
        return []

    calendars = result.get("calendars", {})
    cal_data = calendars.get(calendar_id, {})
    busy_raw = cal_data.get("busy", [])

    ranges = []
    for b in busy_raw:
        try:
            start = datetime.fromisoformat(b["start"].replace("Z", "+00:00"))
            end = datetime.fromisoformat(b["end"].replace("Z", "+00:00"))
            ranges.append((start, end))
        except (KeyError, ValueError):
            continue
    return ranges


def get_teacher_busy_ranges(
    teacher_id: int,
    time_min: datetime,
    time_max: datetime,
    db: Session,
) -> List[Tuple[datetime, datetime]]:
    token = db.query(GoogleCalendarToken).filter(
        GoogleCalendarToken.teacher_id == teacher_id,
        GoogleCalendarToken.is_active == True,
        GoogleCalendarToken.needs_reauth == False,
    ).first()

    if not token:
        return []

    service = get_calendar_service_for_token(token, db)
    if not service:
        return []

    return get_busy_ranges(service, token.calendar_id or "primary", time_min, time_max)


# ─────────────────────────────────────────────────────────────────────────
# Escritura — crear/actualizar/borrar eventos
# ─────────────────────────────────────────────────────────────────────────

def create_calendar_event(
    service,
    calendar_id: str,
    title: str,
    start_utc: datetime,
    end_utc: datetime,
    description: str = "",
    meet_link: Optional[str] = None,
) -> Optional[str]:
    event_body = {
        "summary": title,
        "description": description,
        "start": {"dateTime": start_utc.isoformat(), "timeZone": "UTC"},
        "end": {"dateTime": end_utc.isoformat(), "timeZone": "UTC"},
        "extendedProperties": {"private": {"tpmh_managed": "true"}},
    }
    if meet_link:
        event_body["location"] = meet_link
        event_body["description"] += f"\n\nGoogle Meet: {meet_link}"

    try:
        event = _with_retries(
            service.events().insert(calendarId=calendar_id, body=event_body).execute
        )
        return event.get("id")
    except HttpError as e:
        logger.error(f"Error creando evento en Google Calendar: {e}")
        return None


def _extract_meet_link(event: dict) -> Optional[str]:
    """Saca el link de Google Meet de un evento con conferenceData."""
    hangout = event.get("hangoutLink")
    if hangout:
        return hangout
    for entry_point in event.get("conferenceData", {}).get("entryPoints", []):
        if entry_point.get("entryPointType") == "video":
            return entry_point.get("uri")
    return None


def create_calendar_event_with_meet(
    service,
    calendar_id: str,
    title: str,
    start_utc: datetime,
    end_utc: datetime,
    description: str = "",
) -> Tuple[Optional[str], Optional[str]]:
    """
    Crea un evento en Google Calendar generando de una vez un link de
    Google Meet real (conferenceData). Devuelve (event_id, meet_link);
    cualquiera de los dos puede venir None si falló ese paso puntual.
    """
    event_body = {
        "summary": title,
        "description": description,
        "start": {"dateTime": start_utc.isoformat(), "timeZone": "UTC"},
        "end": {"dateTime": end_utc.isoformat(), "timeZone": "UTC"},
        "extendedProperties": {"private": {"tpmh_managed": "true"}},
        "conferenceData": {
            "createRequest": {
                "requestId": uuid.uuid4().hex,
                "conferenceSolutionKey": {"type": "hangoutsMeet"},
            }
        },
    }

    try:
        event = _with_retries(
            service.events()
            .insert(calendarId=calendar_id, body=event_body, conferenceDataVersion=1)
            .execute
        )
        return event.get("id"), _extract_meet_link(event)
    except HttpError as e:
        logger.error(f"Error creando evento con Meet en Google Calendar: {e}")
        return None, None


def add_meet_conference_to_event(
    service,
    calendar_id: str,
    event_id: str,
) -> Optional[str]:
    """
    Agrega un link de Google Meet real a un evento ya existente
    (conferenceData). Devuelve el link generado, o None si el evento ya
    no existe (fue borrado externamente) o si la generación falla —
    en ambos casos el llamador debe manejarlo sin romper el flujo.
    """
    try:
        event = _with_retries(
            service.events().get(calendarId=calendar_id, eventId=event_id).execute
        )
    except HttpError as e:
        if getattr(e.resp, "status", None) == 404:
            logger.info(f"Evento {event_id} ya no existe en Google (borrado externamente)")
        else:
            logger.warning(f"Error obteniendo evento {event_id} para agregar Meet: {e}")
        return None

    if event.get("status") == "cancelled":
        logger.info(f"Evento {event_id} está en la papelera de Google, no se le agrega Meet")
        return None

    # Si el evento ya tiene un Meet armado (p. ej. lo generó otra corrida
    # del job), lo reutilizamos en vez de pedir uno nuevo.
    existing_link = _extract_meet_link(event)
    if existing_link:
        return existing_link

    event["conferenceData"] = {
        "createRequest": {
            "requestId": uuid.uuid4().hex,
            "conferenceSolutionKey": {"type": "hangoutsMeet"},
        }
    }

    try:
        updated = _with_retries(
            service.events()
            .update(calendarId=calendar_id, eventId=event_id, body=event, conferenceDataVersion=1)
            .execute
        )
        return _extract_meet_link(updated)
    except HttpError as e:
        logger.warning(f"Error agregando Meet al evento {event_id}: {e}")
        return None


def update_calendar_event(
    service,
    calendar_id: str,
    event_id: str,
    start_utc: Optional[datetime] = None,
    end_utc: Optional[datetime] = None,
    meet_link: Optional[str] = None,
) -> bool:
    try:
        event = _with_retries(
            service.events().get(calendarId=calendar_id, eventId=event_id).execute
        )
    except HttpError as e:
        if getattr(e.resp, "status", None) == 404:
            logger.info(f"Evento {event_id} ya no existe en Google (borrado externamente)")
        else:
            logger.warning(f"Error obteniendo evento {event_id}: {e}")
        return False

    # FIX: Si el evento está en la papelera de Google (status == "cancelled"), 
    # lo tratamos como inexistente para forzar su recreación en sync_calendar_logic.
    if event.get("status") == "cancelled":
        logger.info(f"Evento {event_id} figura como cancelado/papelera en Google (borrado externamente)")
        return False

    if start_utc:
        event["start"]["dateTime"] = start_utc.isoformat()
        event["start"]["timeZone"] = "UTC"
    if end_utc:
        event["end"]["dateTime"] = end_utc.isoformat()
        event["end"]["timeZone"] = "UTC"
    if meet_link:
        event["location"] = meet_link

    # FIX: sin conferenceDataVersion=1 la API ignora (y puede no persistir)
    # el conferenceData que ya trae el evento en `event` (traído por el GET
    # de arriba) — Google lo documenta explícitamente para "todo request
    # de modificación de evento", no solo cuando uno cambia el Meet a
    # propósito. Sin esto, un evento con Meet autogenerado (ver
    # add_meet_conference_to_event / create_calendar_event_with_meet)
    # podía perder su conferenceData en la próxima sync horaria o el
    # próximo PATCH de horario/link.
    try:
        _with_retries(
            service.events()
            .update(calendarId=calendar_id, eventId=event_id, body=event, conferenceDataVersion=1)
            .execute
        )
        return True
    except HttpError as e:
        logger.warning(f"Error actualizando evento {event_id}: {e}")
        return False


def delete_calendar_event(service, calendar_id: str, event_id: str) -> bool:
    try:
        _with_retries(
            service.events().delete(calendarId=calendar_id, eventId=event_id).execute
        )
        return True
    except HttpError as e:
        status = getattr(e.resp, "status", None)
        if status in (410, 404):
            return True
        logger.warning(f"Error eliminando evento {event_id}: {e}")
        return False


# ─────────────────────────────────────────────────────────────────────────
# Reconciliación por profesor
# ─────────────────────────────────────────────────────────────────────────

def sync_calendar_logic(teacher_id: int, db: Session) -> dict:
    token = db.query(GoogleCalendarToken).filter(
        GoogleCalendarToken.teacher_id == teacher_id,
        GoogleCalendarToken.is_active == True,
    ).first()

    if not token:
        return {"ok": False, "message": "Profesor sin Google Calendar conectado"}

    if token.needs_reauth:
        return {"ok": False, "message": "Token inválido — el profesor debe reconectar Google Calendar"}

    service = get_calendar_service_for_token(token, db)
    if not service:
        return {"ok": False, "message": token.last_error or "No se pudo conectar con Google Calendar"}

    calendar_id = token.calendar_id or "primary"
    now = utc_now()
    window_end = now + timedelta(days=SYNC_WINDOW_DAYS)

    external_busy_count = 0
    try:
        busy = get_busy_ranges(service, calendar_id, now, window_end)
        external_busy_count = len(busy)
    except Exception as e:
        logger.warning(f"Fase A (lectura) falló para teacher_id={teacher_id}: {e}")

    new_count = 0
    updated_count = 0
    deleted_count = 0
    error_count = 0

    classes_in_window = db.query(Class).filter(
        Class.teacher_id == teacher_id,
        Class.start_time_utc >= now,
        Class.start_time_utc <= window_end,
    ).all()

    for class_ in classes_in_window:
        try:
            is_cancelled = class_.status == "cancelled"

            if is_cancelled:
                if class_.google_event_id:
                    if delete_calendar_event(service, calendar_id, class_.google_event_id):
                        class_.google_event_id = None
                        deleted_count += 1
                continue

            if class_.status not in ("pending", "pending_trial", "confirmed"):
                continue

            student_name = (
                f"{class_.student.user.name} {class_.student.user.surname}"
                if class_.student and class_.student.user else "Estudiante"
            )
            title = f"Clase: {student_name} — {class_.subject or 'General'}"
            description = f"Clase de {class_.subject or 'General'}\nDuración: {class_.duration} minutos"

            if not class_.google_event_id:
                event_id = create_calendar_event(
                    service, calendar_id, title,
                    class_.start_time_utc, class_.end_time_utc,
                    description=description, meet_link=class_.meet_link,
                )
                if event_id:
                    class_.google_event_id = event_id
                    new_count += 1
                else:
                    error_count += 1
                continue

            updated = update_calendar_event(
                service, calendar_id, class_.google_event_id,
                start_utc=class_.start_time_utc, end_utc=class_.end_time_utc,
                meet_link=class_.meet_link,
            )
            if updated:
                updated_count += 1
            else:
                class_.google_event_id = None
                event_id = create_calendar_event(
                    service, calendar_id, title,
                    class_.start_time_utc, class_.end_time_utc,
                    description=description, meet_link=class_.meet_link,
                )
                if event_id:
                    class_.google_event_id = event_id
                    new_count += 1
                else:
                    error_count += 1

        except HttpError as e:
            status = getattr(e.resp, "status", None)
            if status in (403, 429):
                logger.warning(f"Cuota/permiso excedido sincronizando teacher_id={teacher_id}: {e}")
                token.last_error = f"Límite de la API de Google alcanzado (status {status})"
                db.commit()
                break
            logger.error(f"Error sincronizando clase {class_.id}: {e}")
            error_count += 1
        except Exception as e:
            logger.error(f"Error inesperado sincronizando clase {class_.id}: {e}")
            error_count += 1

    token.last_synced_at = utc_now()
    if error_count == 0:
        token.last_error = None
    db.commit()

    msg = (
        f"Sync OK — {new_count} nuevas, {updated_count} actualizadas, "
        f"{deleted_count} eliminadas, {error_count} errores, "
        f"{external_busy_count} bloques externos detectados"
    )
    logger.info(f"[calendar_sync] teacher_id={teacher_id}: {msg}")
    return {
        "ok": error_count == 0,
        "message": msg,
        "new_count": new_count,
        "updated_count": updated_count,
        "deleted_count": deleted_count,
        "error_count": error_count,
        "external_busy_count": external_busy_count,
    }


def run_calendar_sync_for_all_teachers(db: Session) -> dict:
    tokens = db.query(GoogleCalendarToken).filter(
        GoogleCalendarToken.is_active == True,
        GoogleCalendarToken.needs_reauth == False,
    ).all()

    results = []
    for token in tokens:
        try:
            result = sync_calendar_logic(token.teacher_id, db)
            results.append({"teacher_id": token.teacher_id, **result})
        except Exception as e:
            logger.error(f"Fallo sincronizando teacher_id={token.teacher_id}: {e}")
            results.append({"teacher_id": token.teacher_id, "ok": False, "message": str(e)})

    logger.info(f"[calendar_sync] Corrida completa: {len(results)} profesores procesados")
    return {"teachers_synced": len(results), "results": results}