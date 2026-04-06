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
    """Registro con email y contraseña"""

    # 1. Verificar que el email no existe
    existing = db.query(User).filter(User.email == data.email).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Este email ya está registrado"
        )

    # 2. Crear el usuario
    user = User(
        email=data.email,
        password_hash=hash_password(data.password),
        name=data.name,
        surname=data.surname,
        role=data.role
    )
    db.add(user)
    db.flush()  # Obtiene el id sin hacer commit todavía

    # 3. Crear perfil según el rol
    if data.role == UserRole.student:
        db.add(StudentProfile(user_id=user.id))
    elif data.role == UserRole.teacher:
        db.add(TeacherProfile(user_id=user.id))

    db.commit()
    db.refresh(user)

    # 4. Devolver token
    token = create_access_token(user.id, user.role)
    return TokenResponse(
        access_token=token,
        role=user.role,
        name=user.name
    )

@router.post("/login", response_model=TokenResponse)
def login(data: LoginRequest, db: Session = Depends(get_db)):
    """Login con email y contraseña"""

    # 1. Buscar usuario
    user = db.query(User).filter(User.email == data.email).first()

    # 2. Verificar credenciales
    # Importante: el mismo mensaje de error para email y password
    # Si dices "email no encontrado" le das info a un atacante
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
        name=user.name
    )

@router.post("/google", response_model=TokenResponse)
async def google_login(data: GoogleAuthRequest, db: Session = Depends(get_db)):
    """Login o registro con Google"""

    # 1. Verificar token con Google
    try:
        google_data = await verify_google_token(data.id_token)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )

    # 2. Buscar si el usuario ya existe
    user = db.query(User).filter(
        User.email == google_data["email"]
    ).first()

    # 3. Si no existe lo creamos automáticamente
    if not user:
        user = User(
            email=google_data["email"],
            name=google_data["name"],
            surname=google_data["surname"],
            avatar=google_data["avatar"],
            google_id=google_data["google_id"],
            is_verified=google_data["is_verified"],
            role=UserRole.student  # Google siempre registra como estudiante
        )
        db.add(user)
        db.flush()
        db.add(StudentProfile(user_id=user.id))
        db.commit()
        db.refresh(user)
    else:
        # Si existe actualizamos el google_id por si acaso
        user.google_id = google_data["google_id"]
        db.commit()

    token = create_access_token(user.id, user.role)
    return TokenResponse(
        access_token=token,
        role=user.role,
        name=user.name
    )