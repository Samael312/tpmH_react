from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from google.auth.exceptions import RefreshError
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
import requests
from google_auth_oauthlib.flow import Flow
from datetime import datetime, timedelta
from typing import Optional, List, Tuple
from sqlalchemy.orm import Session
import logging
import time

from app.core.config import settings
from app.core.timezone import utc_now, UTC
from app.models.google_calendar import GoogleCalendarToken
from app.models.teacher import TeacherProfile
from app.models.class_ import Class

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/calendar"]

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
    `state` es opcional — el endpoint pasa el id del profesor para
    identificarlo al volver del callback (protección CSRF básica).
    Funciona igual para cuentas Gmail personales que para Workspace:
    no requiere delegación de dominio ni admin del lado de Google,
    cada profesor autoriza su propia cuenta.
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
    return auth_url


def exchange_code_for_tokens(code: str) -> dict:
    """Intercambia el código de autorización por tokens."""
    flow = get_oauth_flow()
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
    """
    Construye el cliente de Google Calendar a partir de un
    GoogleCalendarToken, refrescando el access_token si hace falta.

    Si el refresh falla porque el usuario revocó el acceso (o el
    refresh_token expiró — pasa tras ~6 meses de inactividad, o
    inmediatamente si el proyecto de OAuth sigue en modo "Testing"),
    marca needs_reauth=True e is_active=False y devuelve None SIN
    lanzar excepción, para que el llamador pueda seguir con el
    resto de profesores.
    """
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
            credentials.expiry = token.token_expiry

        if credentials.expired and credentials.refresh_token:
            credentials.refresh(Request())
            # Persistir el access_token/expiry refrescado
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
    """
    Reintenta una llamada a la API de Google ante errores transitorios
    (5xx, o 429/rateLimitExceeded puntual). No reintenta errores 4xx
    de permisos/validación — esos se propagan de inmediato.
    """
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
# Lectura — bloques ocupados externos (Preply, calendario personal, etc.)
# ─────────────────────────────────────────────────────────────────────────

def get_busy_ranges(
    service,
    calendar_id: str,
    time_min: datetime,
    time_max: datetime,
) -> List[Tuple[datetime, datetime]]:
    """
    Devuelve los rangos ocupados del calendario del profesor en Google
    (freebusy) entre time_min y time_max, en UTC.

    Esto incluye TODO lo que haya en su calendario — eventos de Preply,
    citas personales, eventos que nuestra propia app creó, etc. — sin
    distinguir origen, porque para efectos de "no dejar reservar encima"
    no importa de dónde vino el bloqueo. No se crea ninguna fila en
    `Class` a partir de esto: es solo información de disponibilidad.
    """
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
    """
    Punto de entrada usado en tiempo real por availability.py al calcular
    slots: si el profesor tiene Google Calendar conectado y activo,
    devuelve sus bloques ocupados externos para ese rango. Si no tiene
    Calendar conectado, o la sync está desactivada, o el token necesita
    reconexión, devuelve lista vacía (no bloquea nada — el sistema
    funciona igual sin Calendar conectado).
    """
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
# Escritura — crear/actualizar/borrar SOLO eventos que el sistema creó
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
        # Marca de origen — nunca usada para decidir si borrar cosas
        # ajenas, solo informativa dentro del propio evento.
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


def update_calendar_event(
    service,
    calendar_id: str,
    event_id: str,
    start_utc: Optional[datetime] = None,
    end_utc: Optional[datetime] = None,
    meet_link: Optional[str] = None,
) -> bool:
    """
    Actualiza un evento existente. Si el evento ya no existe en Google
    (fue borrado manualmente por el profesor), devuelve False sin
    lanzar excepción — el llamador debe interpretar esto como
    "hay que limpiar el google_event_id local y recrearlo".
    """
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

    if start_utc:
        event["start"]["dateTime"] = start_utc.isoformat()
        event["start"]["timeZone"] = "UTC"
    if end_utc:
        event["end"]["dateTime"] = end_utc.isoformat()
        event["end"]["timeZone"] = "UTC"
    if meet_link:
        event["location"] = meet_link

    try:
        _with_retries(
            service.events().update(calendarId=calendar_id, eventId=event_id, body=event).execute
        )
        return True
    except HttpError as e:
        logger.warning(f"Error actualizando evento {event_id}: {e}")
        return False


def delete_calendar_event(service, calendar_id: str, event_id: str) -> bool:
    """
    Borra un evento por su ID. Solo se llama con IDs que vinieron de
    `Class.google_event_id` — es decir, eventos que el propio sistema
    creó. Nunca se recorre el calendario buscando "sobrantes" para
    borrarlos; eso es exactamente lo que evitamos aquí a propósito.
    """
    try:
        _with_retries(
            service.events().delete(calendarId=calendar_id, eventId=event_id).execute
        )
        return True
    except HttpError as e:
        status = getattr(e.resp, "status", None)
        if status == 410 or status == 404:
            # Ya estaba borrado — no es un error real
            return True
        logger.warning(f"Error eliminando evento {event_id}: {e}")
        return False


# ─────────────────────────────────────────────────────────────────────────
# Reconciliación por profesor (Fase B) — llamada por el job periódico
# y por el endpoint de "sincronizar ahora"
# ─────────────────────────────────────────────────────────────────────────

def sync_calendar_logic(teacher_id: int, db: Session) -> dict:
    """
    Sincroniza el calendario de UN profesor.

    Fase A (lectura / salud de conexión):
      Consulta freebusy en la ventana [ahora, ahora+SYNC_WINDOW_DAYS]
      solo para verificar que la conexión funciona y registrar cuántos
      bloques externos hay — esto NO escribe nada en `Class`. El uso
      real de estos bloques para bloquear horarios ocurre en vivo, vía
      `get_teacher_busy_ranges()`, cuando el estudiante pide slots
      disponibles (ver integración en availability.py).

    Fase B (escritura hacia Google):
      Recorre las clases futuras y no canceladas del profesor:
        - Sin google_event_id            -> crea el evento
        - Con google_event_id y vigente  -> actualiza si cambió horario
        - Con google_event_id pero el
          evento ya no existe en Google  -> limpia el id y lo recrea
        - Cancelada pero con
          google_event_id                -> borra el evento y limpia el id

      Nunca toca eventos que no tengan su origen en `Class.google_event_id`.
    """
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
        # get_calendar_service_for_token ya marcó needs_reauth/last_error si aplicaba
        return {"ok": False, "message": token.last_error or "No se pudo conectar con Google Calendar"}

    calendar_id = token.calendar_id or "primary"
    now = utc_now()
    window_end = now + timedelta(days=SYNC_WINDOW_DAYS)

    # ─── Fase A: healthcheck + conteo de bloques externos ───
    external_busy_count = 0
    try:
        busy = get_busy_ranges(service, calendar_id, now, window_end)
        external_busy_count = len(busy)
    except Exception as e:
        logger.warning(f"Fase A (lectura) falló para teacher_id={teacher_id}: {e}")

    # ─── Fase B: reconciliar Class -> Google ───
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
                # completed/finalized/no_show — no tocamos el evento pasado
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
                # El evento ya no existe del lado de Google — lo recreamos
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
                logger.warning(f"Cuota/permiso excedido sincronizando teacher_id={teacher_id}, deteniendo esta corrida: {e}")
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
    """
    Punto de entrada del job periódico. Recorre todos los profesores con
    Calendar conectado y activo, sincronizando uno por uno. Un error en
    un profesor no detiene a los demás.
    """
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