from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.db.base import get_db
from app.auth.dependencies import get_current_user
from app.auth.passwords import hash_password, verify_password
from app.models.user import User
from app.models.student import StudentProfile
from app.schemas.user import UserResponse, UpdateProfileRequest, ChangePasswordRequest

router = APIRouter()

@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    """Devuelve los datos del usuario autenticado"""
    return current_user


@router.patch("/me", response_model=UserResponse)
def update_profile(
    data: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Actualiza datos básicos del perfil.
    Solo actualiza los campos que se envían (PATCH parcial).
    """
    # Verificar username único si se está cambiando
    if data.username and data.username != current_user.username:
        existing = db.query(User).filter(
            User.username == data.username
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Este nombre de usuario ya está en uso"
            )
        # Actualizar caché de username en el perfil
        # (Arquitectura híbrida: sincronización manual)
        if current_user.role == "student" and current_user.student_profile:
            current_user.student_profile.user_username = data.username
        elif current_user.role == "teacher" and current_user.teacher_profile:
            current_user.teacher_profile.user_username = data.username

    # Verificar email único si se está cambiando
    if data.email and data.email != current_user.email:
        existing = db.query(User).filter(
            User.email == data.email
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Este email ya está registrado"
            )

    # Actualizar solo los campos que vienen en el request
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(current_user, field, value)

    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/me/change-password")
def change_password(
    data: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Cambia la contraseña verificando la actual"""

    # Usuarios de Google no tienen contraseña
    if not current_user.password_hash:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tu cuenta usa login con Google, no tiene contraseña"
        )

    if not verify_password(data.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La contraseña actual es incorrecta"
        )

    current_user.password_hash = hash_password(data.new_password)
    db.commit()

    return {"message": "Contraseña actualizada correctamente"}


@router.delete("/me")
def delete_account(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Elimina la cuenta del usuario.
    Desactiva en lugar de borrar para preservar historial de clases.
    """
    current_user.is_active = False
    db.commit()

    return {"message": "Cuenta desactivada correctamente"}


@router.patch("/me/student-profile")
def update_student_profile(
    data: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Actualiza datos del perfil de estudiante (timezone, goal, etc.)"""

    if current_user.role != "student":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo para estudiantes"
        )

    profile = current_user.student_profile
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Perfil de estudiante no encontrado"
        )

    allowed_fields = {"timezone", "goal", "preferred_payment_methods"}
    for field, value in data.items():
        if field in allowed_fields:
            setattr(profile, field, value)

    db.commit()
    db.refresh(profile)

    return {"message": "Perfil actualizado"}