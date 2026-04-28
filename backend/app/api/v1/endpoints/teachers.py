from fastapi import APIRouter, Depends, HTTPException, logger, status, Query, UploadFile, File
from sqlalchemy.orm import Session
from typing import List, Optional 
from app.db.base import get_db
from app.auth.dependencies import get_current_user, get_current_teacher
from app.models.user import User
from app.models.teacher import TeacherProfile, TeacherStatus
from app.schemas.teacher import (
    TeacherProfileResponse,
    UpdateTeacherProfileRequest,
    TeacherPublicResponse
)
from app.core.storage import upload_file, delete_file

router = APIRouter()

# Dejamos solo esta versión de la ruta raíz ("/") que ya maneja los filtros opcionales
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
    teachers = db.query(TeacherProfile).filter(
        TeacherProfile.status == TeacherStatus.approved
    ).all()

    # Filtrar por materia
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

@router.post("/me/photo")
async def upload_teacher_photo(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db)
):
    """
    Sube la foto de perfil a Cloudinary y actualiza la URL en la base de datos.
    Si ya existía una foto, la borra de Cloudinary para ahorrar espacio.
    """
    profile = current_user.teacher_profile
    if not profile:
        raise HTTPException(status_code=404, detail="Perfil de profesor no encontrado")

    try:
        # 1. Leer el contenido del archivo
        file_bytes = await file.read()
        
        # 2. Subir a Cloudinary (usamos la carpeta 'profiles')
        result = upload_file(
            file_bytes=file_bytes,
            filename=file.filename,
            content_type=file.content_type,
            folder="tpm/profiles" 
        )

        # 3. (Opcional) Borrar la foto vieja si existe
        if profile.profile_photo_public_id:
            delete_file(profile.profile_photo_public_id, resource_type="image")

        # 4. Actualizar el modelo en la base de datos
        # Asegúrate de que tu modelo TeacherProfile tenga estos campos
        profile.profile_photo_url = result["url"]
        profile.profile_photo_public_id = result["public_id"]

        db.commit()
        db.refresh(profile)

        return {
            "message": "Foto actualizada correctamente",
            "url": result["url"]
        }

    except ValueError as e:
        # Errores de validación (tamaño, tipo de archivo)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail="Error interno al procesar la imagen")