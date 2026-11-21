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
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.timezone import UTC, utc_now
from app.models.class_ import Class, ClassType
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

# Palabra(s) que identifican, en el título de un evento del Google
# Calendar del profesor, una clase dictada en OTRA plataforma que
# queremos reflejar (solo lectura) dentro de tpmH — hoy solo Preply.
# El match es case-insensitive y busca la palabra en el summary del
# evento. Se guarda en Class.external_source cuál keyword la originó.
EXTERNAL_IMPORT_SOURCES = {
    "preply": "preply",
}

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

    flow.fetch_token(code=code, timeout=15)
    credentials = flow.credentials
    sub, email = _identity_from_id_token(getattr(credentials, "id_token", None))
    return {
        "access_token": credentials.token,
        "refresh_token": credentials.refresh_token,
        "token_expiry": credentials.expiry,
        # Identidad de la cuenta de Google conectada (None si Google no devolvio id_token)
        "google_sub": sub,
        "google_email": email,
    }


def _identity_from_id_token(id_token: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    """(sub, email) del id_token que Google devuelve en el canje del codigo (scope openid/email).
    Llega directo del endpoint de tokens de Google por TLS, por eso no se re-verifica la firma."""
    if not id_token:
        return None, None
    try:
        import jwt
        claims = jwt.decode(id_token, options={"verify_signature": False, "verify_aud": False,
                                               "verify_exp": False, "verify_iat": False, "verify_nbf": False})
        sub = claims.get("sub")
        email = claims.get("email")
        return (str(sub) if sub else None), (str(email).lower() if email else None)
    except Exception as e:
        logger.warning(f"No se pudo leer el id_token de Google: {e}")
        return None, None


def calendar_id_for(token: GoogleCalendarToken) -> str:
    """Calendario a usar: siempre el principal de la cuenta conectada. Las filas antiguas guardaban
    el email de la plataforma en calendar_id (puede no ser la cuenta de Google conectada): se tratan como "primary"."""
    cid = token.calendar_id
    if not cid or "@" in cid:
        return "primary"
    return cid


def revoke_token(token: str):
    """Revoca el token de acceso en los servidores de Google"""
    try:
        requests.post(
            'https://oauth2.googleapis.com/revoke',
            params={'token': token},
            headers={'content-type': 'application/x-www-form-urlencoded'},
            timeout=10,
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
        first_time = not token.needs_reauth
        token.needs_reauth = True
        token.is_active = False
        token.last_error = "Token revocado o expirado. Reconexión requerida."
        # Regla del dueno: perder el acceso NO cancela nada (ni clases ni eventos); solo se detiene la sync.
        db.commit()
        if first_time:
            notify_calendar_reauth(token, db)
        return None

    except Exception as e:
        logger.error(f"Error inesperado creando servicio de Calendar (teacher_id={token.teacher_id}): {e}")
        token.last_error = str(e)[:500]
        db.commit()
        return None


# ─────────────────────────────────────────────────────────────────────────
# Ciclo de vida de la conexion (desconexion / reautenticacion)
# ─────────────────────────────────────────────────────────────────────────

def reset_platform_sync_state(teacher_id: int, db: Session, clear_event_ids: bool) -> int:
    """Prepara las clases PROPIAS (no external) de un profesor para re-publicarse en un calendario de Google
    distinto/desconocido. NUNCA cancela clases ni borra nada en Google.
    - Siempre limpia google_sync_hash: la proxima sync consulta el evento (update); si no existe en ese
      calendario (404) lo crea de nuevo, y si existe (misma cuenta) lo reutiliza sin duplicar.
    - clear_event_ids=True (cambio de cuenta confirmado) tambien suelta google_event_id: se crearan eventos
      nuevos en el calendario nuevo; los del viejo se quedan donde estan.
    Las clases `external` (Preply) no se tocan: se deduplican por google_event_id al importar."""
    rows = db.query(Class).filter(
        Class.teacher_id == teacher_id,
        Class.class_type != ClassType.external,
        Class.google_event_id.isnot(None),
    ).all()
    for c in rows:
        c.google_sync_hash = None
        if clear_event_ids:
            c.google_event_id = None
    return len(rows)


def notify_calendar_reauth(token: GoogleCalendarToken, db: Session) -> None:
    """Avisa al profesor (campana + correo) de que debe reconectar Google Calendar. Nunca lanza."""
    try:
        from app.core.notifications import create_notification
        from app.models.user import User
        user = db.get(User, token.user_id)
        create_notification(
            db, type="calendar_reauth_required",
            title="Reconecta tu Google Calendar",
            message=("Google rechazó el acceso a tu calendario (token revocado o expirado). Mientras tanto la sincronización "
                     "está detenida (tus clases no se tocan). Reconéctalo desde tu perfil."),
            recipient_role="teacher", recipient_user_id=token.user_id,
        )
        db.commit()
        if user and user.email:
            from app.core.email import send_calendar_reauth_teacher_email
            send_calendar_reauth_teacher_email(user.email, f"{user.name or ''}".strip() or "profesor")
    except Exception as e:
        logger.warning(f"No se pudo avisar al profesor {token.teacher_id} de la reconexión de Calendar: {e}")
        try:
            db.rollback()
        except Exception:
            pass


def run_calendar_sync_background(teacher_id: int) -> None:
    """Sync de un profesor con su PROPIA sesion de BD (para BackgroundTasks: la de la peticion ya se cerro)."""
    from app.db.base import SessionLocal
    db = SessionLocal()
    try:
        sync_calendar_logic(teacher_id, db)
    except Exception as e:
        logger.error(f"Sync en segundo plano falló (teacher_id={teacher_id}): {e}")
    finally:
        db.close()


_QUOTA_REASONS = {"rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "dailyLimitExceeded", "limitExceeded"}


def http_error_kind(e: HttpError) -> str:
    """Clasifica un HttpError de Google: "quota" (429 o 403 por limite/cuota: reintentable mas tarde),
    "permission" (403/401 real: el profesor no tiene permiso sobre ese evento/calendario),
    "gone" (404/410) u "other"."""
    status = getattr(e.resp, "status", None)
    try:
        status = int(status)
    except (TypeError, ValueError):
        pass
    if status == 429:
        return "quota"
    if status in (403, 401):
        reasons = set()
        try:
            import json
            data = json.loads((e.content or b"{}").decode("utf-8", "ignore") or "{}")
            for err in (data.get("error", {}) or {}).get("errors", []) or []:
                if err.get("reason"):
                    reasons.add(err["reason"])
            if (data.get("error", {}) or {}).get("status") == "RESOURCE_EXHAUSTED":
                reasons.add("quotaExceeded")
        except Exception:
            pass
        return "quota" if reasons & _QUOTA_REASONS else "permission"
    if status in (404, 410):
        return "gone"
    return "other"


def _with_retries(fn, *args, **kwargs):
    last_exc = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return fn(*args, **kwargs)
        except HttpError as e:
            status = getattr(e.resp, "status", None)
            retriable = status in (429, 500, 502, 503) or (status == 403 and http_error_kind(e) == "quota")
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

class FreebusyError(Exception):
    """freebusy fallo (HttpError, error dentro del calendario o token invalido). Solo se lanza con strict=True."""


def get_busy_ranges(
    service,
    calendar_id: str,
    time_min: datetime,
    time_max: datetime,
    strict: bool = False,
) -> List[Tuple[datetime, datetime]]:
    """Rangos ocupados del calendario. Por defecto falla ABIERTO (devuelve [] si Google falla, para no
    romper reservas); con strict=True lanza FreebusyError para que el llamador sepa que el resultado NO es
    fiable (p. ej. para no cachearlo)."""
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
        kind = http_error_kind(e)
        logger.warning(f"Error consultando freebusy en {calendar_id} ({kind}): {e}")
        if strict:
            raise FreebusyError(kind) from e
        return []

    calendars = result.get("calendars", {})
    cal_data = calendars.get(calendar_id)
    if cal_data is None and len(calendars) == 1:
        cal_data = next(iter(calendars.values()))   # Google puede devolver el email real en vez de "primary"
    cal_data = cal_data or {}
    if cal_data.get("errors"):
        logger.warning(f"freebusy de {calendar_id} devolvió errores: {cal_data['errors']}")
        if strict:
            raise FreebusyError("calendar_errors")
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
    strict: bool = False,
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
        if strict:
            raise FreebusyError("no_service")
        return []

    return get_busy_ranges(service, calendar_id_for(token), time_min, time_max, strict=strict)


# ─────────────────────────────────────────────────────────────────────────
# Lectura — eventos reales (no solo busy) para importar clases externas
# ─────────────────────────────────────────────────────────────────────────

def list_calendar_events(
    service,
    calendar_id: str,
    time_min: datetime,
    time_max: datetime,
) -> List[dict]:
    """
    Trae los eventos "reales" (con título, no solo el rango busy/free)
    del calendario del profesor en la ventana dada. `singleEvents=True`
    expande eventos recurrentes en instancias individuales, cada una con
    su propio id — necesario para poder dedupear/actualizar por
    Class.google_event_id igual que hacemos con los eventos que nosotros
    mismos creamos.
    """
    if time_min.tzinfo is None:
        time_min = time_min.replace(tzinfo=UTC)
    if time_max.tzinfo is None:
        time_max = time_max.replace(tzinfo=UTC)

    events: List[dict] = []
    page_token = None
    try:
        while True:
            result = _with_retries(
                service.events().list(
                    calendarId=calendar_id,
                    timeMin=time_min.isoformat(),
                    timeMax=time_max.isoformat(),
                    singleEvents=True,
                    orderBy="startTime",
                    pageToken=page_token,
                    maxResults=250,
                ).execute
            )
            events.extend(result.get("items", []))
            page_token = result.get("nextPageToken")
            if not page_token:
                break
    except HttpError as e:
        logger.warning(f"Error listando eventos en {calendar_id}: {e}")

    return events


def _is_own_event(event: dict) -> bool:
    """True si el evento lo creó esta plataforma (ver create_calendar_event /
    create_calendar_event_with_meet, que siempre marcan extendedProperties).
    Estos nunca deben re-importarse como clase externa."""
    return (
        event.get("extendedProperties", {})
        .get("private", {})
        .get("tpmh_managed") == "true"
    )


def _match_external_source(event: dict) -> Optional[str]:
    """
    Si el título del evento contiene alguna de las keywords configuradas
    en EXTERNAL_IMPORT_SOURCES, devuelve el nombre de la fuente (ej.
    "preply"). None si no matchea ninguna o si el evento no tiene un
    horario puntual (dateTime) — los eventos de todo el día (solo
    "date") no se importan porque Class exige start/end exactos.
    """
    if _is_own_event(event):
        return None
    if event.get("status") == "cancelled":
        return None
    if not event.get("start", {}).get("dateTime") or not event.get("end", {}).get("dateTime"):
        return None

    title = (event.get("summary") or "").lower()
    for keyword, source in EXTERNAL_IMPORT_SOURCES.items():
        if keyword in title:
            return source
    return None


def import_external_classes_for_teacher(
    teacher_id: int,
    service,
    calendar_id: str,
    db: Session,
    time_min: datetime,
    time_max: datetime,
) -> dict:
    """
    Lee los eventos reales del Google Calendar del profesor (no solo
    freebusy) y refleja como Class(class_type="external") los que
    correspondan a una plataforma externa reconocida (ver
    EXTERNAL_IMPORT_SOURCES, hoy solo Preply, detectado por palabra en
    el título). Son de solo lectura desde la perspectiva de tpmH: no
    tienen student_id/enrollment_id, no consumen paquete/crédito, y el
    profesor no puede editarlas — solo existen para que se vean en su
    calendario/agenda y para que bloqueen el horario ante nuevos
    alumnos (can_book_slot ya las excluye del double-booking igual que
    a cualquier clase que no sea "group").

    Reconciliación por evento (dedup vía Class.google_event_id):
      - Evento nuevo que matchea       -> crea Class externa "confirmed".
      - Evento ya importado, sigue ahí -> actualiza horario/título si cambiaron.
      - Evento ya importado, cancelado
        o borrado en Google            -> marca la Class como "cancelled".
    """
    events = list_calendar_events(service, calendar_id, time_min, time_max)

    # G2: las existentes se buscan por google_event_id (ids que devolvio Google)
    # SIN filtrar por start_time_utc: Google devuelve los eventos cuyo FIN es
    # > time_min, asi que un evento en curso empezo antes de time_min. Ademas
    # se incluyen las externas aun abiertas de la ventana para poder cancelar
    # las que desaparecieron de Google.
    returned_ids = [e["id"] for e in events if e.get("id")]
    existing_by_event_id: dict[str, Class] = {}
    for i in range(0, len(returned_ids), 500):
        for c in db.query(Class).filter(
            Class.teacher_id == teacher_id,
            Class.class_type == ClassType.external,
            Class.google_event_id.in_(returned_ids[i:i + 500]),
        ).all():
            existing_by_event_id[c.google_event_id] = c
    for c in db.query(Class).filter(
        Class.teacher_id == teacher_id,
        Class.class_type == ClassType.external,
        Class.google_event_id.isnot(None),
        Class.end_time_utc > time_min,
        Class.start_time_utc <= time_max,
    ).all():
        existing_by_event_id.setdefault(c.google_event_id, c)

    seen_event_ids: set[str] = set()
    new_count = 0
    updated_count = 0
    cancelled_count = 0

    for event in events:
        event_id = event.get("id")
        if not event_id:
            continue

        source = _match_external_source(event)
        if not source:
            continue

        seen_event_ids.add(event_id)
        title = event.get("summary") or "Clase externa"
        # G7: se normaliza a UTC (en SQLite el offset del evento se perdia)
        start_dt = datetime.fromisoformat(event["start"]["dateTime"].replace("Z", "+00:00")).astimezone(UTC)
        end_dt = datetime.fromisoformat(event["end"]["dateTime"].replace("Z", "+00:00")).astimezone(UTC)
        duration_minutes = max(int((end_dt - start_dt).total_seconds() // 60), 1)
        # Si el evento de Preply ya trae su propio link de videollamada
        # (Meet, o cualquier URL en "location"), lo reflejamos para que
        # el profesor pueda unirse directo desde la card de la clase.
        meet_link = _extract_meet_link(event)
        if not meet_link:
            location = event.get("location") or ""
            if location.startswith("http://") or location.startswith("https://"):
                meet_link = location

        class_ = existing_by_event_id.get(event_id)
        if class_:
            changed = (
                class_.start_time_utc != start_dt
                or class_.end_time_utc != end_dt
                or class_.subject != title
                or class_.meet_link != meet_link
                or class_.status == "cancelled"
            )
            if changed:
                class_.start_time_utc = start_dt
                class_.end_time_utc = end_dt
                class_.duration = duration_minutes
                class_.subject = title
                class_.meet_link = meet_link
                if class_.status == "cancelled":
                    class_.status = "confirmed"
                updated_count += 1
        else:
            new_class = Class(
                teacher_id=teacher_id,
                student_id=None,
                class_type=ClassType.external,
                external_source=source,
                subject=title,
                start_time_utc=start_dt,
                end_time_utc=end_dt,
                duration=duration_minutes,
                buffer_minutes=0,
                status="confirmed",
                meet_link=meet_link,
                google_event_id=event_id,
                notes=f"Importada automáticamente desde Google Calendar ({source}).",
            )
            # G2: el indice unico (teacher_id, google_event_id) evita duplicados
            # aunque dos syncs corran a la vez; el perdedor se ignora sin romper el resto.
            try:
                with db.begin_nested():
                    db.add(new_class)
                    db.flush()
                existing_by_event_id[event_id] = new_class
                new_count += 1
            except IntegrityError:
                logger.info(f"Evento externo {event_id} ya importado por otra sync (teacher_id={teacher_id})")

    # Eventos que ya habíamos importado pero que ya no aparecen (se
    # borraron o dejaron de matchear en Google) -> se cancelan, nunca se
    # borran (mismo criterio que el resto de la plataforma al cancelar).
    for event_id, class_ in existing_by_event_id.items():
        if event_id not in seen_event_ids and class_.status != "cancelled":
            class_.status = "cancelled"
            cancelled_count += 1

    return {
        "new_count": new_count,
        "updated_count": updated_count,
        "cancelled_count": cancelled_count,
    }


# ─────────────────────────────────────────────────────────────────────────
# Escritura — crear/actualizar/borrar eventos
# ─────────────────────────────────────────────────────────────────────────

def _build_attendees(attendee_emails: Optional[List[str]]) -> Optional[List[dict]]:
    """
    Arma la lista de `attendees` para el body del evento. Se usa para que
    el profesor quede explícitamente como invitado del evento (además de
    ser el dueño del calendario), de forma que Google Meet lo reconozca
    como participante autorizado y no le pida "Pedir unirme" al entrar.
    Siempre se combina con sendUpdates="none" en la llamada a la API para
    no disparar el correo de invitación de Google Calendar.
    """
    if not attendee_emails:
        return None
    return [{"email": email, "responseStatus": "accepted"} for email in attendee_emails]


def _teacher_attendees(class_: Class) -> List[str]:
    """El profesor como invitado explicito (igual que los hooks de calendar_sync._teacher_attendee_emails)."""
    email = class_.teacher.user.email if class_.teacher and class_.teacher.user else None
    return [email] if email else []


def _event_fingerprint(title: str, description: str, class_: Class, attendees: List[str]) -> str:
    """Huella corta de lo que la sync empuja a Google para esta clase."""
    import hashlib
    raw = "|".join([
        title, description, class_.start_time_utc.isoformat(), class_.end_time_utc.isoformat(),
        class_.meet_link or "", ",".join(attendees),
    ])
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:32]


def create_calendar_event(
    service,
    calendar_id: str,
    title: str,
    start_utc: datetime,
    end_utc: datetime,
    description: str = "",
    meet_link: Optional[str] = None,
    attendee_emails: Optional[List[str]] = None,
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

    attendees = _build_attendees(attendee_emails)
    if attendees:
        event_body["attendees"] = attendees

    try:
        event = _with_retries(
            service.events()
            .insert(calendarId=calendar_id, body=event_body, sendUpdates="none")
            .execute
        )
        return event.get("id")
    except HttpError as e:
        logger.error(f"Error creando evento en Google Calendar ({http_error_kind(e)}): {e}")
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
    attendee_emails: Optional[List[str]] = None,
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

    attendees = _build_attendees(attendee_emails)
    if attendees:
        event_body["attendees"] = attendees

    try:
        event = _with_retries(
            service.events()
            .insert(calendarId=calendar_id, body=event_body, conferenceDataVersion=1, sendUpdates="none")
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
    attendee_emails: Optional[List[str]] = None,
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

    attendees = _build_attendees(attendee_emails)
    if attendees:
        event["attendees"] = attendees

    try:
        updated = _with_retries(
            service.events()
            .update(calendarId=calendar_id, eventId=event_id, body=event, conferenceDataVersion=1, sendUpdates="none")
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
    attendee_emails: Optional[List[str]] = None,
) -> bool:
    try:
        event = _with_retries(
            service.events().get(calendarId=calendar_id, eventId=event_id).execute
        )
    except HttpError as e:
        if http_error_kind(e) == "gone":
            logger.info(f"Evento {event_id} ya no existe en Google (borrado externamente)")
            return False
        # Error transitorio / permiso / cuota: NO es "el evento no existe" (el llamador no debe recrearlo).
        logger.warning(f"Error obteniendo evento {event_id} ({http_error_kind(e)}): {e}")
        raise

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

    attendees = _build_attendees(attendee_emails)
    if attendees:
        event["attendees"] = attendees

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
            .update(calendarId=calendar_id, eventId=event_id, body=event, conferenceDataVersion=1, sendUpdates="none")
            .execute
        )
        return True
    except HttpError as e:
        if http_error_kind(e) == "gone":
            return False
        logger.warning(f"Error actualizando evento {event_id} ({http_error_kind(e)}): {e}")
        raise


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

    calendar_id = calendar_id_for(token)
    now = utc_now()
    window_end = now + timedelta(days=SYNC_WINDOW_DAYS)

    external_busy_count = 0
    try:
        busy = get_busy_ranges(service, calendar_id, now, window_end)
        external_busy_count = len(busy)
    except Exception as e:
        logger.warning(f"Fase A (lectura busy) falló para teacher_id={teacher_id}: {e}")

    # Fase A.2 (lectura de eventos reales) — importa clases externas
    # reconocidas (Preply, etc.) como Class(class_type="external"). Se
    # hace siempre, sin importar si luego falla el push de abajo, para
    # que una API caída a mitad de sync no le cueste al profesor perder
    # la importación de este ciclo.
    imported_new = imported_updated = imported_cancelled = 0
    try:
        imported = import_external_classes_for_teacher(
            teacher_id, service, calendar_id, db, now, window_end,
        )
        imported_new = imported["new_count"]
        imported_updated = imported["updated_count"]
        imported_cancelled = imported["cancelled_count"]
        if imported_new or imported_updated or imported_cancelled:
            db.commit()
    except Exception as e:
        logger.warning(f"Fase A.2 (import clases externas) falló para teacher_id={teacher_id}: {e}")
        db.rollback()

    new_count = 0
    updated_count = 0
    deleted_count = 0
    error_count = 0

    # G1: las clases `external` (Preply) son de solo lectura: NUNCA se empujan
    # (ni update/create/delete) sobre el evento original de Preply.
    classes_in_window = db.query(Class).filter(
        Class.teacher_id == teacher_id,
        Class.class_type != ClassType.external,
        Class.start_time_utc >= now,
        Class.start_time_utc <= window_end,
    ).all()

    skipped_count = 0
    for class_ in classes_in_window:
        try:
            is_cancelled = class_.status == "cancelled"

            if is_cancelled:
                if class_.google_event_id:
                    if delete_calendar_event(service, calendar_id, class_.google_event_id):
                        class_.google_event_id = None
                        class_.google_sync_hash = None
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
            attendees = _teacher_attendees(class_)
            fingerprint = _event_fingerprint(title, description, class_, attendees)

            if class_.google_event_id and class_.google_sync_hash == fingerprint:
                skipped_count += 1   # nada cambio desde el ultimo push: cero llamadas a Google
                continue

            if class_.google_event_id:
                updated = update_calendar_event(
                    service, calendar_id, class_.google_event_id,
                    start_utc=class_.start_time_utc, end_utc=class_.end_time_utc,
                    meet_link=class_.meet_link, attendee_emails=attendees,
                )
                if updated:
                    class_.google_sync_hash = fingerprint
                    updated_count += 1
                    continue
                class_.google_event_id = None   # el evento ya no existe en Google: se recrea abajo
                class_.google_sync_hash = None

            event_id = create_calendar_event(
                service, calendar_id, title,
                class_.start_time_utc, class_.end_time_utc,
                description=description, meet_link=class_.meet_link, attendee_emails=attendees,
            )
            if event_id:
                class_.google_event_id = event_id
                class_.google_sync_hash = fingerprint
                new_count += 1
            else:
                error_count += 1

        except HttpError as e:
            kind = http_error_kind(e)
            if kind == "quota":
                logger.warning(f"Cuota de la API de Google agotada sincronizando teacher_id={teacher_id}: {e}")
                token.last_error = "Límite de cuota de la API de Google alcanzado; se reintenta en la próxima sync"
                db.commit()
                break
            if kind == "permission":
                logger.error(f"Google denegó el permiso sincronizando la clase {class_.id} (teacher_id={teacher_id}): {e}")
                token.last_error = "Google denegó el permiso sobre el calendario (403); reconecta Google Calendar"
            else:
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
        f"{external_busy_count} bloques externos detectados, "
        f"{imported_new} clases externas importadas (Preply, etc.)"
    )
    logger.info(f"[calendar_sync] teacher_id={teacher_id}: {msg}")
    return {
        "ok": error_count == 0,
        "message": msg,
        "new_count": new_count,
        "updated_count": updated_count,
        "skipped_count": skipped_count,
        "deleted_count": deleted_count,
        "error_count": error_count,
        "external_busy_count": external_busy_count,
        "imported_new_count": imported_new,
        "imported_updated_count": imported_updated,
        "imported_cancelled_count": imported_cancelled,
    }


# Ventana "activa" y espera ociosa (mismos valores que core/scheduler.py: CALENDAR_ACTIVE_WINDOW / CALENDAR_IDLE_GAP)
ACTIVE_WINDOW = timedelta(hours=3)
IDLE_RESYNC_AFTER = timedelta(hours=5, minutes=30)


def _teachers_needing_sync(db: Session, tokens: List[GoogleCalendarToken], now: datetime) -> List[GoogleCalendarToken]:
    """Solo los profesores con una clase propia (no Preply) en curso o en la ventana activa, o cuya ultima sync
    es antigua (ciclo ocioso: importar Preply / refrescar). El resto se salta: cero llamadas a Google."""
    if not tokens:
        return []
    active_ids = {
        r[0] for r in db.query(Class.teacher_id).filter(
            Class.teacher_id.in_([t.teacher_id for t in tokens]),
            Class.class_type != ClassType.external,
            Class.status.in_(["pending", "pending_trial", "confirmed", "cancelled"]),
            Class.end_time_utc > now,
            Class.start_time_utc <= now + ACTIVE_WINDOW,
        ).distinct().all()
    }
    out = []
    for t in tokens:
        last = t.last_synced_at
        if last is not None and last.tzinfo is None:
            last = last.replace(tzinfo=UTC)
        if t.teacher_id in active_ids or last is None or now - last >= IDLE_RESYNC_AFTER:
            out.append(t)
    return out


def run_calendar_sync_for_all_teachers(db: Session) -> dict:
    tokens = db.query(GoogleCalendarToken).filter(
        GoogleCalendarToken.is_active == True,
        GoogleCalendarToken.needs_reauth == False,
    ).all()
    total = len(tokens)
    tokens = _teachers_needing_sync(db, tokens, utc_now())
    teacher_ids = [t.teacher_id for t in tokens]

    results = []
    for teacher_id in teacher_ids:
        try:
            result = sync_calendar_logic(teacher_id, db)
            results.append({"teacher_id": teacher_id, **result})
        except Exception as e:
            # Un profesor que falla no frena a los demas: se limpia la sesion y se sigue.
            logger.error(f"Fallo sincronizando teacher_id={teacher_id}: {e}")
            try:
                db.rollback()
            except Exception:
                pass
            results.append({"teacher_id": teacher_id, "ok": False, "message": str(e)})

    logger.info(f"[calendar_sync] Corrida completa: {len(results)} de {total} profesores procesados")
    return {"teachers_synced": len(results), "teachers_skipped": total - len(results), "results": results}
