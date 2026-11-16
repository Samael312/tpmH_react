import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_teacher, get_db
from app.auth.jwt import create_oauth_state, decode_oauth_state
from app.core.google_calendar import (
    exchange_code_for_tokens,
    get_auth_url,
    revoke_token,
    sync_calendar_logic,
)
from app.models.google_calendar import GoogleCalendarToken
from app.models.user import User

# NOTA: Sin prefix="/calendar" para evitar duplicidad con router.py
logger = logging.getLogger(__name__)
router = APIRouter(tags=["calendar"])


@router.get("/status")
def calendar_status(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_teacher),
):
    token = (
        db.query(GoogleCalendarToken)
        .filter(GoogleCalendarToken.teacher_id == current.teacher_profile.id)
        .first()
    )
    return {
        "connected": token is not None,
        "calendar_id": token.calendar_id if token else None,
        "last_sync_at": (
            token.last_synced_at.isoformat()
            if token and token.last_synced_at
            else None
        ),
        "sync_enabled": token.is_active if token else False,
        "needs_reauth": token.needs_reauth if token else False,
        "last_error": token.last_error if token else None,
    }


@router.get("/auth-url")
def get_google_auth_url(current: User = Depends(get_current_teacher)):
    # SEC-06: state firmado (antes era el id del profesor en claro y el callback no lo validaba).
    return {"auth_url": get_auth_url(state=create_oauth_state(current.teacher_profile.id))}


@router.post("/callback")
def calendar_callback(
    payload: dict,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_teacher),
):
    code = payload.get("code")
    code_verifier = payload.get("code_verifier")

    if not code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Código OAuth requerido",
        )

    # SEC-06: el `state` debe existir, estar firmado, no haber vencido y pertenecer a ESTE profesor.
    state_teacher_id = decode_oauth_state(str(payload.get("state") or ""))
    if state_teacher_id is None or state_teacher_id != current.teacher_profile.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La autorización con Google no es válida o expiró. Vuelve a iniciar la conexión.",
        )

    try:
        credentials = exchange_code_for_tokens(code, code_verifier=code_verifier)
    except Exception:
        # SEC-06: no devolver el texto de la excepcion de Google al cliente.
        logger.exception("Calendar: error al canjear el codigo OAuth")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se pudo conectar con Google Calendar. Inténtalo de nuevo.",
        )

    token = (
        db.query(GoogleCalendarToken)
        .filter(GoogleCalendarToken.teacher_id == current.teacher_profile.id)
        .first()
    )

    if not token:
        token = GoogleCalendarToken(
            user_id=current.id,
            teacher_id=current.teacher_profile.id,
        )
        db.add(token)

    token.access_token = credentials["access_token"]
    token.refresh_token = credentials.get("refresh_token") or token.refresh_token
    token.token_expiry = credentials.get("token_expiry")
    token.calendar_id = current.email or "primary"
    token.is_active = True
    token.needs_reauth = False
    token.last_error = None

    db.commit()
    return {"ok": True, "message": "Calendario conectado correctamente"}


@router.post("/toggle")
def toggle_sync(
    payload: dict,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_teacher),
):
    token = (
        db.query(GoogleCalendarToken)
        .filter(GoogleCalendarToken.teacher_id == current.teacher_profile.id)
        .first()
    )
    if not token:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Calendario no conectado",
        )

    token.is_active = payload.get("enabled", not token.is_active)
    db.commit()
    return {"sync_enabled": token.is_active}


@router.post("/sync")
def manual_sync(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_teacher),
):
    """Fuerza una sincronización manual inmediata para este profesor."""
    token = (
        db.query(GoogleCalendarToken)
        .filter(GoogleCalendarToken.teacher_id == current.teacher_profile.id)
        .first()
    )
    if not token:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Calendario no conectado",
        )
    if token.needs_reauth:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El token expiró — reconecta tu Google Calendar",
        )

    return sync_calendar_logic(current.teacher_profile.id, db)


@router.post("/disconnect")
def disconnect_calendar(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_teacher),
):
    token = (
        db.query(GoogleCalendarToken)
        .filter(GoogleCalendarToken.teacher_id == current.teacher_profile.id)
        .first()
    )
    if token:
        try:
            revoke_token(token.access_token)
        except Exception:
            pass
        db.delete(token)
        db.commit()

    return {"ok": True, "message": "Calendario desconectado"}