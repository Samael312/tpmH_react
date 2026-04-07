from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.db.base import get_db
from app.models.user import User, UserRole
from app.models.teacher import TeacherProfile
from app.models.student import StudentProfile
from app.auth.passwords import hash_password, verify_password
from app.auth.jwt import create_access_token
from app.auth.google import verify_google_token
from app.schemas.auth import (
    RegisterRequest, LoginRequest,
    TokenResponse, GoogleAuthRequest
)

router = APIRouter()

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

@router.post("/google", response_model=TokenResponse)
async def google_login(data: GoogleAuthRequest, db: Session = Depends(get_db)):

    try:
        google_data = await verify_google_token(data.id_token)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )

    user = db.query(User).filter(User.email == google_data["email"]).first()

    if not user:
        # Generamos un username desde el email automáticamente
        # ejemplo: samuel.boscan.18@gmail.com -> samuel_boscan_18
        base_username = google_data["email"].split("@")[0].replace(".", "_")

        # Si ese username ya existe le añadimos un número
        username = base_username
        counter = 1
        while db.query(User).filter(User.username == username).first():
            username = f"{base_username}_{counter}"
            counter += 1

        user = User(
            username=username,
            email=google_data["email"],
            name=google_data["name"],
            surname=google_data["surname"],
            avatar=google_data["avatar"],
            google_id=google_data["google_id"],
            is_verified=google_data["is_verified"],
            role=UserRole.student
        )
        db.add(user)
        db.flush()
        db.add(StudentProfile(user_id=user.id, user_username=user.username))
        db.commit()
        db.refresh(user)
    else:
        user.google_id = google_data["google_id"]
        db.commit()

    token = create_access_token(user.id, user.role)
    return TokenResponse(
        access_token=token,
        role=user.role,
        name=user.name,
        username=user.username
    )