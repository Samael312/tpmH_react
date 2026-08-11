from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
import httpx
import logging
from app.db.base import get_db
from app.models.user import User, UserRole
from app.models.teacher import TeacherProfile
from app.models.student import StudentProfile
from app.auth.passwords import hash_password, verify_password
from app.auth.jwt import create_access_token
from app.auth.google import verify_google_token
from app.schemas.auth import (
    RegisterRequest, LoginRequest,
    TokenResponse, GoogleAuthRequest, GoogleAuthResponse,
    GoogleRegisterRequest
)
import secrets
from datetime import timedelta
from app.models.password_reset import PasswordResetToken
from app.core.email import send_password_reset_email
from app.core.timezone import utc_now
from pydantic import BaseModel, EmailStr
from app.core.storage import upload_file

logger = logging.getLogger(__name__)

router = APIRouter()

class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

@router.post("/register", response_model=TokenResponse)
def register(data: RegisterRequest, db: Session = Depends(get_db)):

    # 1. Verificar que el email no existe
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Este email ya está registrado"
        )

    # 2. Verificar que el username no existe
    if db.query(User).filter(User.username == data.username).first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Este nombre de usuario ya está en uso"
        )

    # 3. Crear usuario
    user = User(
        username=data.username,
        email=data.email,
        password_hash=hash_password(data.password),
        name=data.name,
        surname=data.surname,
        role=data.role
    )
    db.add(user)
    db.flush()

    # 4. Crear perfil según rol
    if data.role == UserRole.student:
        db.add(StudentProfile(user_id=user.id, user_username=user.username))
    elif data.role == UserRole.teacher:
        db.add(TeacherProfile(user_id=user.id, user_username=user.username))

    db.commit()
    db.refresh(user)

    token = create_access_token(user.id, user.role)
    return TokenResponse(
        access_token=token,
        role=user.role,
        name=user.name,
        username=user.username
    )

@router.post("/login", response_model=TokenResponse)
def login(data: LoginRequest, db: Session = Depends(get_db)):

    # Buscar por username O por email — el usuario usa lo que prefiera
    user = (
        db.query(User)
        .filter(
            (User.username == data.login) | (User.email == data.login)
        )
        .first()
    )

    # Mismo mensaje para usuario no encontrado y contraseña incorrecta
    # Nunca le digas al atacante cuál de los dos falló
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales incorrectas"
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cuenta desactivada"
        )

    token = create_access_token(user.id, user.role)
    return TokenResponse(
        access_token=token,
        role=user.role,
        name=user.name,
        username=user.username
    )

@router.post("/google", response_model=GoogleAuthResponse)
async def google_login(data: GoogleAuthRequest, db: Session = Depends(get_db)):
    """
    Paso 1 del flujo Google (GSI). Verifica el id_token contra Google.
    - Si el email ya tiene cuenta -> login normal, devuelve token.
    - Si no existe -> NO crea la cuenta. Devuelve needs_registration=True
      junto con los datos de Google para que el frontend pida
      username + rol antes de crear la cuenta.
    """
    try:
        google_data = await verify_google_token(data.id_token)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )

    user = db.query(User).filter(User.email == google_data["email"]).first()

    if not user:
        return GoogleAuthResponse(
            needs_registration=True,
            name=google_data["name"],
            surname=google_data["surname"],
            email=google_data["email"],
            avatar=google_data.get("avatar"),
        )

    # Si el usuario existía con password normal, vinculamos el google_id
    if not user.google_id:
        user.google_id = google_data["google_id"]
        db.commit()

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cuenta desactivada"
        )

    token = create_access_token(user.id, user.role)
    return GoogleAuthResponse(
        access_token=token,
        role=user.role,
        name=user.name,
        username=user.username,
        email=user.email,
        surname=user.surname,
        avatar=user.avatar,
    )


@router.post("/google/register", response_model=GoogleAuthResponse)
async def google_register(data: GoogleRegisterRequest, db: Session = Depends(get_db)):
    try:
        google_data = await verify_google_token(data.id_token)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if db.query(User).filter(User.email == google_data["email"]).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Este email ya está registrado")

    if db.query(User).filter(User.username == data.username).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Este nombre de usuario ya está en uso")

    avatar_url = None
    google_picture = google_data.get("avatar")
    if google_picture:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                img_res = await client.get(google_picture)
            if img_res.status_code == 200:
                content_type = img_res.headers.get("content-type", "image/jpeg").split(";")[0].strip()
                upload_result = upload_file(
                    file_bytes=img_res.content,
                    filename=f"google_avatar_{data.username}.jpg",
                    content_type=content_type,
                    folder="tpm/avatars",
                )
                avatar_url = upload_result["url"]
        except Exception as e:
            logger.warning(f"No se pudo re-hospedar la foto de Google para {data.username}: {e}")
            avatar_url = google_picture  # fallback: usar la URL original de Google

    user = User(
        username=data.username,
        email=google_data["email"],
        password_hash=None,
        name=google_data["name"],
        surname=google_data["surname"],
        avatar=avatar_url,
        google_id=google_data["google_id"],
        is_verified=google_data.get("is_verified") == "true",
        role=data.role,
    )
    db.add(user)
    db.flush()

    if data.role == "student":
        db.add(StudentProfile(user_id=user.id, user_username=user.username))
    else:
        db.add(TeacherProfile(user_id=user.id, user_username=user.username))

    db.commit()
    db.refresh(user)

    token = create_access_token(user.id, user.role)
    return GoogleAuthResponse(
        access_token=token,
        role=user.role,
        name=user.name,
        username=user.username,
        email=user.email,
        surname=user.surname,
        avatar=user.avatar,
    )

@router.post("/forgot-password")
def forgot_password(
    data: ForgotPasswordRequest,
    db: Session = Depends(get_db)
):
    """
    Inicia el flujo de recuperación de contraseña.
    Siempre devuelve 200 aunque el email no exista
    para no revelar qué emails están registrados.
    """
    user = db.query(User).filter(User.email == data.email).first()

    if user:
        # Invalidar tokens anteriores del mismo usuario
        db.query(PasswordResetToken).filter(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.is_used == False
        ).update({"is_used": True})

        # Crear nuevo token seguro
        token = secrets.token_urlsafe(32)
        reset_token = PasswordResetToken(
            user_id=user.id,
            token=token,
            expires_at=utc_now() + timedelta(hours=1)
        )
        db.add(reset_token)
        db.commit()

        # Enviar email
        send_password_reset_email(
            to_email=user.email,
            user_name=user.name,
            reset_token=token,
        )

    # Siempre el mismo mensaje — no revelamos si el email existe
    return {
        "message": "Si ese email está registrado recibirás un enlace en breve"
    }


@router.post("/reset-password")
def reset_password(
    data: ResetPasswordRequest,
    db: Session = Depends(get_db)
):
    """
    Establece la nueva contraseña usando el token del email.
    """
    now = utc_now()

    reset_token = db.query(PasswordResetToken).filter(
        PasswordResetToken.token == data.token,
        PasswordResetToken.is_used == False,
        PasswordResetToken.expires_at > now
    ).first()

    if not reset_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Token inválido o expirado"
        )

    # Actualizar contraseña
    user = db.query(User).filter(User.id == reset_token.user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuario no encontrado"
        )

    user.password_hash = hash_password(data.new_password)

    # Marcar token como usado
    reset_token.is_used = True

    db.commit()

    return {"message": "Contraseña actualizada correctamente"}