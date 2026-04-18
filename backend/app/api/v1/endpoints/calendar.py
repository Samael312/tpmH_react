from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.auth.dependencies import get_db, get_current_teacher
from app.models import User, google_calendar as CalendarToken
from app.core.google_calendar import (
    get_auth_url, exchange_code_for_tokens,
    sync_calendar_logic, revoke_token,
)
from datetime import datetime

router = APIRouter(prefix="/calendar", tags=["calendar"])


@router.get("/status")
def calendar_status(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_teacher),
):
    """Devuelve el estado de conexión actual del Google Calendar del profesor"""
    token = (
        db.query(CalendarToken)
        .filter(CalendarToken.user_id == current.id)
        .first()
    )
    return {
        "connected":    token is not None,
        "calendar_id":  token.calendar_id if token else None,
        "last_sync_at": token.last_sync_at.isoformat() if token and token.last_sync_at else None,
        "sync_enabled": token.sync_enabled if token else False,
    }


@router.get("/auth-url")
def get_google_auth_url(current: User = Depends(get_current_teacher)):
    """Devuelve la URL a la que el frontend debe redirigir para iniciar sesión con Google"""
    # Pasamos el ID del usuario como 'state' por seguridad
    return {"auth_url": get_auth_url(state=str(current.id))}


@router.post("/callback")
def calendar_callback(
    payload: dict,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_teacher),
):
    """El frontend llama a este endpoint pasando el código devuelto por Google"""
    code = payload.get("code")
    if not code:
        raise HTTPException(400, "Código OAuth requerido")

    # Intercambiamos el código por los tokens
    credentials = exchange_code_for_tokens(code)

    token = (
        db.query(CalendarToken)
        .filter(CalendarToken.user_id == current.id)
        .first()
    )
    
    if not token:
        token = CalendarToken(user_id=current.id)
        db.add(token)

    token.access_token  = credentials["access_token"]
    token.refresh_token = credentials.get("refresh_token")
    token.token_expiry  = credentials.get("expiry")
    token.calendar_id   = current.email
    token.sync_enabled  = True

    db.commit()
    return {"ok": True, "message": "Calendario conectado correctamente"}


@router.post("/toggle")
def toggle_sync(
    payload: dict,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_teacher),
):
    """Activa o desactiva la sincronización sin borrar la conexión"""
    token = (
        db.query(CalendarToken)
        .filter(CalendarToken.user_id == current.id)
        .first()
    )
    if not token:
        raise HTTPException(404, "Calendario no conectado")

    # Si se envía 'enabled', se usa ese valor. Si no, se invierte el actual.
    token.sync_enabled = payload.get("enabled", not token.sync_enabled)
    db.commit()
    return {"sync_enabled": token.sync_enabled}


@router.post("/sync")
def manual_sync(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_teacher),
):
    """Fuerza una sincronización manual inmediata"""
    token = (
        db.query(CalendarToken)
        .filter(CalendarToken.user_id == current.id)
        .first()
    )
    if not token:
        raise HTTPException(404, "Calendario no conectado")

    result = sync_calendar_logic(
        teacher_id=current.id,
        calendar_id=token.calendar_id,
        access_token=token.access_token,
        refresh_token=token.refresh_token,
        db=db,
    )

    token.last_sync_at = datetime.utcnow()
    db.commit()

    return result


@router.post("/disconnect")
def disconnect_calendar(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_teacher),
):
    """Desconecta el calendario, revoca los tokens en Google y borra el registro de la BD"""
    token = (
        db.query(CalendarToken)
        .filter(CalendarToken.user_id == current.id)
        .first()
    )
    if token:
        try:
            revoke_token(token.access_token)
        except Exception:
            pass # Si falla revocar en Google, igual lo borramos localmente
        
        db.delete(token)
        db.commit()
        
    return {"ok": True, "message": "Calendario desconectado"}