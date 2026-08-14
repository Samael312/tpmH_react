from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.auth.dependencies import get_db, get_current_teacher
from app.models.user import User
from app.models.google_calendar import GoogleCalendarToken
from app.core.google_calendar import (
    get_auth_url, exchange_code_for_tokens,
    sync_calendar_logic, revoke_token,
)

router = APIRouter(tags=["calendar"])


@router.get("/status")
def calendar_status(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_teacher),
):
    token = db.query(GoogleCalendarToken).filter(
        GoogleCalendarToken.teacher_id == current.teacher_profile.id
    ).first()
    return {
        "connected": token is not None,
        "calendar_id": token.calendar_id if token else None,
        "last_sync_at": token.last_synced_at.isoformat() if token and token.last_synced_at else None,
        "sync_enabled": token.is_active if token else False,
        "needs_reauth": token.needs_reauth if token else False,
        "last_error": token.last_error if token else None,
    }


@router.get("/auth-url")
def get_google_auth_url(current: User = Depends(get_current_teacher)):
    return {"auth_url": get_auth_url(state=str(current.teacher_profile.id))}


@router.post("/callback")
def calendar_callback(
    payload: dict,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_teacher),
):
    code = payload.get("code")
    if not code:
        raise HTTPException(400, "Código OAuth requerido")

    credentials = exchange_code_for_tokens(code)

    token = db.query(GoogleCalendarToken).filter(
        GoogleCalendarToken.teacher_id == current.teacher_profile.id
    ).first()

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
    token = db.query(GoogleCalendarToken).filter(
        GoogleCalendarToken.teacher_id == current.teacher_profile.id
    ).first()
    if not token:
        raise HTTPException(404, "Calendario no conectado")

    token.is_active = payload.get("enabled", not token.is_active)
    db.commit()
    return {"sync_enabled": token.is_active}


@router.post("/sync")
def manual_sync(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_teacher),
):
    """Fuerza una sincronización manual inmediata para este profesor."""
    token = db.query(GoogleCalendarToken).filter(
        GoogleCalendarToken.teacher_id == current.teacher_profile.id
    ).first()
    if not token:
        raise HTTPException(404, "Calendario no conectado")
    if token.needs_reauth:
        raise HTTPException(409, "El token expiró — reconecta tu Google Calendar")

    return sync_calendar_logic(current.teacher_profile.id, db)


@router.post("/disconnect")
def disconnect_calendar(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_teacher),
):
    token = db.query(GoogleCalendarToken).filter(
        GoogleCalendarToken.teacher_id == current.teacher_profile.id
    ).first()
    if token:
        try:
            revoke_token(token.access_token)
        except Exception:
            pass
        db.delete(token)
        db.commit()

    return {"ok": True, "message": "Calendario desconectado"}