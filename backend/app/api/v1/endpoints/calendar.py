from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.db.base import get_db
from app.auth.dependencies import get_current_teacher_or_professor_admin
from app.models.user import User
from app.models.google_calendar import GoogleCalendarToken
from app.core.google_calendar import get_auth_url, exchange_code_for_tokens
from app.core.config import settings

router = APIRouter()


@router.get("/auth-url")
def get_google_auth_url(
    current_user: User = Depends(get_current_teacher_or_professor_admin),
):
    """
    Devuelve la URL para que el profesor conecte su Google Calendar.
    El frontend redirige al usuario a esta URL.
    """
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google Calendar no está configurado en este servidor"
        )

    auth_url = get_auth_url()
    return {"auth_url": auth_url}


@router.get("/callback")
def google_calendar_callback(
    code: str = Query(...),
    db: Session = Depends(get_db),
):
    """
    Google redirige aquí después de que el usuario autoriza.
    Intercambia el código por tokens y los guarda.

    Nota: Este endpoint no tiene auth JWT porque Google
    redirige aquí directamente desde el navegador.
    El estado del usuario viene de la sesión.
    """
    try:
        tokens = exchange_code_for_tokens(code)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error obteniendo tokens de Google: {str(e)}"
        )

    # Redirigir al frontend con los tokens para que los envíe
    # al endpoint de guardado con autenticación JWT
    frontend_url = (
        f"{settings.FRONTEND_URL}/settings/calendar"
        f"?access_token={tokens['access_token']}"
        f"&refresh_token={tokens.get('refresh_token', '')}"
    )
    return RedirectResponse(url=frontend_url)


@router.post("/connect")
def connect_google_calendar(
    access_token: str,
    refresh_token: str,
    calendar_id: str = "primary",
    current_user: User = Depends(get_current_teacher_or_professor_admin),
    db: Session = Depends(get_db)
):
    """
    Guarda los tokens de Google Calendar del profesor.
    Se llama desde el frontend después del callback.
    """
    teacher_id = current_user.teacher_profile.id

    existing = db.query(GoogleCalendarToken).filter(
        GoogleCalendarToken.teacher_id == teacher_id
    ).first()

    if existing:
        # Actualizar tokens existentes
        existing.access_token = access_token
        existing.refresh_token = refresh_token
        existing.calendar_id = calendar_id
        existing.is_active = True
    else:
        # Crear nuevo registro
        token = GoogleCalendarToken(
            teacher_id=teacher_id,
            access_token=access_token,
            refresh_token=refresh_token,
            calendar_id=calendar_id,
            is_active=True,
        )
        db.add(token)

    db.commit()
    return {"message": "Google Calendar conectado correctamente"}


@router.patch("/toggle")
def toggle_calendar_sync(
    is_active: bool,
    current_user: User = Depends(get_current_teacher_or_professor_admin),
    db: Session = Depends(get_db)
):
    """
    El profesor activa o desactiva la sync sin borrar los tokens.
    Útil para pausar temporalmente sin reconectar.
    """
    token = db.query(GoogleCalendarToken).filter(
        GoogleCalendarToken.teacher_id == current_user.teacher_profile.id
    ).first()

    if not token:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No tienes Google Calendar conectado"
        )

    token.is_active = is_active
    db.commit()

    state = "activada" if is_active else "desactivada"
    return {"message": f"Sincronización {state}"}


@router.delete("/disconnect")
def disconnect_google_calendar(
    current_user: User = Depends(get_current_teacher_or_professor_admin),
    db: Session = Depends(get_db)
):
    """El profesor desconecta su Google Calendar y borra los tokens"""
    token = db.query(GoogleCalendarToken).filter(
        GoogleCalendarToken.teacher_id == current_user.teacher_profile.id
    ).first()

    if token:
        db.delete(token)
        db.commit()

    return {"message": "Google Calendar desconectado"}


@router.get("/status")
def get_calendar_status(
    current_user: User = Depends(get_current_teacher_or_professor_admin),
    db: Session = Depends(get_db)
):
    """Estado de la conexión de Google Calendar del profesor"""
    token = db.query(GoogleCalendarToken).filter(
        GoogleCalendarToken.teacher_id == current_user.teacher_profile.id
    ).first()

    if not token:
        return {
            "connected": False,
            "is_active": False,
            "calendar_id": None,
        }

    return {
        "connected": True,
        "is_active": token.is_active,
        "calendar_id": token.calendar_id,
    }