from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
import requests
from google_auth_oauthlib.flow import Flow
from datetime import datetime, timedelta
from typing import Optional
import logging

from app.core.config import settings
from app.core.timezone import utc_now, UTC

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/calendar"]


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


def get_auth_url() -> str:
    """
    Genera la URL de autorización de Google.
    El frontend redirige al usuario aquí para conectar su calendar.
    """
    flow = get_oauth_flow()
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",  # Fuerza mostrar pantalla de permisos
    )
    return auth_url


def exchange_code_for_tokens(code: str) -> dict:
    """
    Intercambia el código de autorización por tokens.
    Se llama una sola vez después de que el usuario autoriza.
    """
    flow = get_oauth_flow()
    flow.fetch_token(code=code)
    credentials = flow.credentials

    return {
        "access_token": credentials.token,
        "refresh_token": credentials.refresh_token,
        "token_expiry": credentials.expiry,
    }


def get_calendar_service(
    access_token: str,
    refresh_token: Optional[str],
    token_expiry: Optional[datetime],
):
    """
    Crea el cliente de Google Calendar con los tokens guardados.
    Refresca el token automáticamente si está expirado.
    """
    credentials = Credentials(
        token=access_token,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        scopes=SCOPES,
    )

    if token_expiry:
        credentials.expiry = token_expiry

    # Refrescar si está expirado
    if credentials.expired and credentials.refresh_token:
        credentials.refresh(Request())

    return build("calendar", "v3", credentials=credentials)


def create_calendar_event(
    service,
    calendar_id: str,
    title: str,
    start_utc: datetime,
    end_utc: datetime,
    description: str = "",
    meet_link: Optional[str] = None,
) -> Optional[str]:
    """
    Crea un evento en Google Calendar.

    Returns:
        event_id de Google si se creó correctamente, None si falló
    """
    event_body = {
        "summary": title,
        "description": description,
        "start": {
            "dateTime": start_utc.isoformat(),
            "timeZone": "UTC",
        },
        "end": {
            "dateTime": end_utc.isoformat(),
            "timeZone": "UTC",
        },
    }

    if meet_link:
        event_body["location"] = meet_link
        event_body["description"] += f"\n\nGoogle Meet: {meet_link}"

    try:
        event = service.events().insert(
            calendarId=calendar_id,
            body=event_body
        ).execute()
        return event.get("id")
    except Exception as e:
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
    """Actualiza un evento existente (reagendamiento)"""
    try:
        event = service.events().get(
            calendarId=calendar_id,
            eventId=event_id
        ).execute()

        if start_utc:
            event["start"]["dateTime"] = start_utc.isoformat()
        if end_utc:
            event["end"]["dateTime"] = end_utc.isoformat()
        if meet_link:
            event["location"] = meet_link

        service.events().update(
            calendarId=calendar_id,
            eventId=event_id,
            body=event
        ).execute()
        return True
    except Exception as e:
        logger.error(f"Error actualizando evento: {e}")
        return False


def delete_calendar_event(
    service,
    calendar_id: str,
    event_id: str,
) -> bool:
    """Elimina un evento (cancelación)"""
    try:
        service.events().delete(
            calendarId=calendar_id,
            eventId=event_id
        ).execute()
        return True
    except Exception as e:
        logger.error(f"Error eliminando evento: {e}")
        return False

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

def sync_calendar_logic(teacher_id: int, calendar_id: str, access_token: str, refresh_token: str, db):
    """
    Lógica placeholder para sincronizar el calendario.
    Aquí deberías recorrer las clases del profesor en tu BD y enviarlas a Google.
    """
    try:
        service = get_calendar_service(access_token, refresh_token, None)
        # Aquí irá tu lógica real de sincronización en el futuro
        return {"ok": True, "message": "Calendario sincronizado correctamente"}
    except Exception as e:
        logger.error(f"Error en sincronización manual: {e}")
        return {"ok": False, "message": "Error sincronizando calendario"}