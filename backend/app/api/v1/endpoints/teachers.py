from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List
from app.db.base import get_db
from app.auth.dependencies import get_current_user, get_current_teacher
from app.models.user import User
from app.models.teacher import TeacherProfile, TeacherStatus
from app.schemas.teacher import (
    TeacherProfileResponse,
    UpdateTeacherProfileRequest,
    TeacherPublicResponse
)

router = APIRouter()


@router.get("/", response_model=List[TeacherPublicResponse])
def list_approved_teachers(db: Session = Depends(get_db)):
    """
    Lista todos los profesores aprobados.
    Endpoint público — no requiere autenticación.
    Es lo que verá el estudiante al buscar profesor.
    """
    teachers = db.query(TeacherProfile).filter(
        TeacherProfile.status == TeacherStatus.approved
    ).all()
    return teachers


@router.get("/{username}", response_model=TeacherPublicResponse)
def get_teacher_profile(username: str, db: Session = Depends(get_db)):
    """
    Perfil público de un profesor específico.
    Endpoint público — no requiere autenticación.
    """
    teacher = db.query(TeacherProfile).filter(
        TeacherProfile.user_username == username
    ).first()

    if not teacher:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profesor no encontrado"
        )

    if teacher.status != TeacherStatus.approved:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profesor no disponible"
        )

    return teacher


@router.get("/me/profile", response_model=TeacherProfileResponse)
def get_my_teacher_profile(
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db)
):
    """Devuelve el perfil completo del profesor autenticado"""
    profile = current_user.teacher_profile
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Perfil no encontrado"
        )
    return profile


@router.patch("/me/profile", response_model=TeacherProfileResponse)
def update_my_teacher_profile(
    data: UpdateTeacherProfileRequest,
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db)
):
    """Actualiza el perfil del profesor autenticado"""
    profile = current_user.teacher_profile
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Perfil no encontrado"
        )

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(profile, field, value)

    db.commit()
    db.refresh(profile)
    return profile

@router.get("/", response_model=List[TeacherPublicResponse])
def list_approved_teachers(
    subject: Optional[str] = Query(None, description="Filtrar por materia"),
    language: Optional[str] = Query(None, description="Filtrar por idioma"),
    db: Session = Depends(get_db)
):
    """
    Lista profesores aprobados.
    Filtrable por materia e idioma.
    Endpoint público.
    """
    from app.models.teacher import TeacherStatus

    teachers = db.query(TeacherProfile).filter(
        TeacherProfile.status == TeacherStatus.approved
    ).all()

    # Filtrar por materia (JSONB contains)
    if subject:
        teachers = [
            t for t in teachers
            if t.subjects and subject.lower() in [
                s.lower() for s in t.subjects
            ]
        ]

    # Filtrar por idioma
    if language:
        teachers = [
            t for t in teachers
            if t.languages and language.lower() in [
                l.lower() for l in t.languages
            ]
        ]

    return teachers