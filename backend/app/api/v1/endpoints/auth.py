from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func
from sqlalchemy.orm import Session
import logging
import secrets
from app.db.base import get_db
from app.core.rate_limit import limiter
from app.models.user import User, UserRole
from app.models.teacher import TeacherProfile
from app.models.student import StudentProfile
from app.auth.passwords import hash_password, verify_password
from app.auth.session import (
    REFRESH_COOKIE, clear_auth_cookies, revoke_all_sessions, revoke_refresh_family,
    rotate_refresh_token, set_auth_cookies,
)
from app.auth.google import verify_google_token
from app.schemas.auth import (
    RegisterRequest, 
    LoginRequest, 
    TokenResponse, 
    GoogleAuthRequest, 
    GoogleAuthResponse, 
    GoogleRegisterRequest,
    ForgotPasswordRequest,
    ForgotUsernameRequest,
    ResetPasswordRequest,
    )
from datetime import timedelta
from app.models.password_reset import PasswordResetToken
from app.core.email import send_password_reset_email, send_username_recovery_email  
from app.core.timezone import utc_now
from pydantic import BaseModel, EmailStr
from app.core.email import send_welcome_email, send_verification_email
from app.models.email_verification import EmailVerificationToken
from app.auth.dependencies import get_current_user
import hashlib

logger = logging.getLogger(__name__)

router = APIRouter()


EMAIL_VERIFICATION_TTL_HOURS = 24


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _issue_verification_email(user: User, db: Session) -> None:
    """Invalida los tokens previos, crea uno nuevo y envia el correo (SEC-04). Nunca rompe el flujo que lo llama."""
    try:
        db.query(EmailVerificationToken).filter(
            EmailVerificationToken.user_id == user.id, EmailVerificationToken.is_used == False  # noqa: E712
        ).update({"is_used": True})
        raw = secrets.token_urlsafe(32)
        db.add(EmailVerificationToken(
            user_id=user.id,
            token_hash=_hash_token(raw),
            expires_at=utc_now() + timedelta(hours=EMAIL_VERIFICATION_TTL_HOURS),
        ))
        db.commit()
        send_verification_email(to_email=user.email, user_name=user.name, verify_token=raw)
    except Exception:
        db.rollback()
        logger.exception("No se pudo enviar el email de verificacion")


class VerifyEmailRequest(BaseModel):
    token: str


@router.post("/verify-email")
@limiter.limit("20/hour")
def verify_email(request: Request, data: VerifyEmailRequest, db: Session = Depends(get_db)):
    """SEC-04: consume el token del correo y marca la cuenta como verificada. Un solo uso, 24 h."""
    record = (
        db.query(EmailVerificationToken)
        .filter(
            EmailVerificationToken.token_hash == _hash_token(data.token.strip()),
            EmailVerificationToken.is_used == False,  # noqa: E712
            EmailVerificationToken.expires_at > utc_now(),  # comparacion en SQL: evita naive vs aware
        )
        .with_for_update()
        .first()
    )
    if not record:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El enlace de verificación no es válido o expiró")
    user = db.query(User).filter(User.id == record.user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El enlace de verificación no es válido o expiró")
    record.is_used = True
    user.is_verified = True
    db.commit()
    return {"message": "Email verificado correctamente"}


@router.post("/resend-verification")
@limiter.limit("3/hour")
def resend_verification(request: Request, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """SEC-04: reenvia el correo de verificacion al usuario autenticado (no permite enumerar cuentas)."""
    if current_user.is_verified:
        return {"message": "Tu email ya está verificado"}
    _issue_verification_email(current_user, db)
    return {"message": "Te enviamos un nuevo enlace de verificación"}


@router.post("/register", response_model=TokenResponse)
@limiter.limit("5/hour")
def register(request: Request, response: Response, data: RegisterRequest, db: Session = Depends(get_db)):

    # 1. Verificar que el email no existe
    if db.query(User).filter(func.lower(User.email) == data.email.lower()).first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Este email ya está registrado"
        )

    # 2. Verificar que el username no existe
    if db.query(User).filter(func.lower(User.username) == data.username.lower()).first():
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

    send_welcome_email(to_email=user.email, user_name=user.name, role=user.role)
    _issue_verification_email(user, db)
    token = set_auth_cookies(response, user, db)  # SEC-05: sesion en cookies HttpOnly (el JSON se mantiene en la transicion)
    return TokenResponse(
        access_token=token,
        user_id=user.id,
        role=user.role,
        name=user.name,
        surname=user.surname,
        username=user.username,
        email=user.email,
        avatar_url=user.avatar,  # recién creado: nunca tiene profile_photo_url todavía
    )

@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
def login(request: Request, response: Response, data: LoginRequest, db: Session = Depends(get_db)):

    # Buscar por username O por email — el usuario usa lo que prefiera
    user = (
        db.query(User)
        .filter(
            # AUD-16: el registro guarda el usuario en minusculas; el login no debe distinguir mayusculas.
            (func.lower(User.username) == data.login.strip().lower())
            | (func.lower(User.email) == data.login.strip().lower())
        )
        .first()
    )

    # Mismo mensaje para usuario no encontrado y contraseña incorrecta
    # Nunca le digas al atacante cuál de los dos falló
    # Cuenta creada solo con Google: password_hash es NULL (verify_password daba 500).
    if not user or not user.password_hash or not verify_password(data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales incorrectas"
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cuenta desactivada, contacta con soporte."
        )

    token = set_auth_cookies(response, user, db)

    # La foto "real" (la que el usuario subió como estudiante/profesor) tiene
    # prioridad sobre el avatar de Google, que puede estar desactualizado o
    # ni siquiera existir si la cuenta no se creó con Google.
    avatar_url = (
        (user.teacher_profile.profile_photo_url if user.teacher_profile else None)
        or (user.student_profile.profile_photo_url if user.student_profile else None)
        or user.avatar
    )

    return TokenResponse(
        access_token=token,
        user_id=user.id,
        role=user.role,
        name=user.name,
        surname=user.surname,
        username=user.username,
        email=user.email,
        avatar_url=avatar_url,
    )

@router.post("/google", response_model=GoogleAuthResponse)
@limiter.limit("20/minute")
async def google_login(request: Request, response: Response, data: GoogleAuthRequest, db: Session = Depends(get_db)):
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

    user = db.query(User).filter(func.lower(User.email) == google_data["email"]).first()

    if not user:
        return GoogleAuthResponse(
            needs_registration=True,
            name=google_data["name"],
            surname=google_data["surname"],
            email=google_data["email"],
            avatar=google_data.get("avatar"),
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cuenta desactivada, contacta con soporte."
        )

    # SEC-04: la cuenta ya vinculada a OTRO Google no se puede reclamar; y una cuenta local solo se vincula
    # si su email ya esta verificado (si no, quien la creo con la contrasena podria conservar el acceso).
    if user.google_id and user.google_id != google_data["google_id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Esta cuenta está vinculada a otra cuenta de Google."
        )
    if not user.google_id:
        if not user.is_verified:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Verifica tu email con el enlace que te enviamos antes de iniciar sesión con Google."
            )
        user.google_id = google_data["google_id"]
        db.commit()

    token = set_auth_cookies(response, user, db)
    avatar_url = (
        (user.teacher_profile.profile_photo_url if user.teacher_profile else None)
        or (user.student_profile.profile_photo_url if user.student_profile else None)
        or user.avatar
    )
    return GoogleAuthResponse(
        access_token=token,
        user_id=user.id,
        role=user.role,
        name=user.name,
        username=user.username,
        email=user.email,
        surname=user.surname,
        avatar=avatar_url,
    )


@router.post("/google/register", response_model=GoogleAuthResponse)
@limiter.limit("10/hour")
async def google_register(request: Request, response: Response, data: GoogleRegisterRequest, db: Session = Depends(get_db)):
    try:
        google_data = await verify_google_token(data.id_token)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if db.query(User).filter(func.lower(User.email) == google_data["email"]).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Este email ya está registrado")

    if db.query(User).filter(func.lower(User.username) == data.username.strip().lower()).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Este nombre de usuario ya está en uso")

    # F6 (verification_roadmap): antes se descargaba y re-hospedaba
    # automáticamente la foto de perfil de Google como avatar del usuario,
    # lo cual permitía saltarse por completo la carga de foto propia en el
    # onboarding. Ahora, igual que en el registro con email/password, el
    # usuario arranca sin avatar y el onboarding lo obliga a subir una
    # foto propia.
    avatar_url = None

    user = User(
        username=data.username,
        email=google_data["email"],
        password_hash=None,
        name=google_data["name"],
        surname=google_data["surname"],
        avatar=avatar_url,
        google_id=google_data["google_id"],
        is_verified=bool(google_data.get("is_verified")),  # bug: antes se comparaba un bool con "true" (siempre False)
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
    send_welcome_email(to_email=user.email, user_name=user.name, role=user.role)
    token = set_auth_cookies(response, user, db)
    return GoogleAuthResponse(
        access_token=token,
        user_id=user.id,
        role=user.role,
        name=user.name,
        username=user.username,
        email=user.email,
        surname=user.surname,
        avatar=user.avatar,
    )

@router.post("/refresh")
@limiter.limit("60/minute")
def refresh_session(request: Request, response: Response, db: Session = Depends(get_db)):
    """
    SEC-05: renueva la sesion con el refresh token de la cookie HttpOnly (rotacion: el anterior queda
    revocado). Si el token es desconocido/vencido/reutilizado responde 401 y limpia las cookies.
    """
    result = rotate_refresh_token(db, request.cookies.get(REFRESH_COOKIE))
    if result is None:
        db.rollback()
        clear_auth_cookies(response)
        response.status_code = status.HTTP_401_UNAUTHORIZED
        return {"detail": "Sesión expirada"}
    user, family_id = result
    set_auth_cookies(response, user, db, family_id=family_id)
    return {"message": "Sesión renovada"}


@router.post("/logout")
@limiter.limit("60/minute")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    """SEC-05: revoca la familia del refresh token y borra las cookies. No exige estar autenticado."""
    revoke_refresh_family(db, request.cookies.get(REFRESH_COOKIE))
    clear_auth_cookies(response)
    return {"message": "Sesión cerrada"}


@router.post("/forgot-password")
@limiter.limit("5/hour")
def forgot_password(
    request: Request,
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
@limiter.limit("10/hour")
def reset_password(
    request: Request,
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

    # SEC-05: cambiar la contrasena cierra todas las sesiones abiertas (incluida la de quien la robo)
    revoke_all_sessions(db, user.id)

    db.commit()

    return {"message": "Contraseña actualizada correctamente"}

@router.post("/forgot-username")
@limiter.limit("5/hour")
def forgot_username(
    request: Request,
    data: ForgotUsernameRequest,
    db: Session = Depends(get_db)
):
    """
    Envía el nombre de usuario asociado a un email.
    Igual que forgot-password: siempre devuelve el mismo mensaje,
    exista o no el email, para no revelar qué correos están registrados.
    """
    user = db.query(User).filter(User.email == data.email).first()

    if user:
        send_username_recovery_email(
            to_email=user.email,
            user_name=user.name,
            username=user.username,
        )

    return {
        "message": "Si ese email está registrado, te enviaremos tu nombre de usuario en breve"
    }