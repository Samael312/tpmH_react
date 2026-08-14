from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, Body
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from typing import List, Optional
import logging
from app.core.email import send_material_assigned_email
from app.db.base import get_db
from app.auth.dependencies import get_current_user, get_current_teacher, get_current_student, get_current_approved_teacher
from app.models.user import User
from app.models.material import Material, MaterialAssignment
from app.models.student import StudentProfile
from app.schemas.materials import (
    MaterialCreate,
    MaterialUpdate,
    MaterialResponse,
    AssignMaterialRequest,
    MaterialAssignmentResponse,
    UpdateProgressRequest,
)
from app.core.storage import upload_file, delete_file

router = APIRouter()
logger = logging.getLogger(__name__)


# ─── ENDPOINTS DEL PROFESOR ─────────────────────────────────────────────────

@router.post(
    "/",
    response_model=MaterialResponse,
    status_code=status.HTTP_201_CREATED
)
async def create_material(
    title: str = Form(...),
    category: str = Form(...),
    description: Optional[str] = Form(None),
    level: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db)
):
    """
    El profesor crea un material.
    Puede ser un archivo subido o solo metadatos
    (para sets de vocabulario que se crean por separado).
    """
    file_url = None
    file_public_id = None
    file_type = None

    # Si hay archivo lo subimos a Cloudinary
    if file:
        file_bytes = await file.read()
        try:
            upload_result = upload_file(
                file_bytes=file_bytes,
                filename=file.filename,
                content_type=file.content_type,
                folder=f"materials/teacher_{current_user.teacher_profile.id}",
                display_name=title
            )
            file_url = upload_result["url"]
            file_public_id = upload_result["public_id"]
            file_type = upload_result["resource_type"]
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e)
            )

    material = Material(
        teacher_id=current_user.teacher_profile.id,
        title=title,
        description=description,
        category=category,
        level=level,
        file_url=file_url,
        file_public_id=file_public_id,
        file_type=file_type,
    )

    db.add(material)
    db.commit()
    db.refresh(material)

    return material


@router.patch("/{material_id}", response_model=MaterialResponse)
def update_material(
    material_id: int,
    data: MaterialUpdate,
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db)
):
    """
    Edita los datos de un material existente: título, descripción,
    categoría y/o nivel. No reemplaza el archivo ni las palabras de
    vocabulario — eso se maneja desde sus propios endpoints.
    """
    material = db.query(Material).filter(
        Material.id == material_id,
        Material.teacher_id == current_user.teacher_profile.id
    ).first()

    if not material:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Material no encontrado"
        )

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(material, field, value)

    db.commit()
    db.refresh(material)

    return material


@router.post("/{material_id}/vocabulary")
def set_vocabulary_words(
    material_id: int,
    words: List[str] = Body(..., embed=True),
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db)
):
    """
    Establece las palabras de un set de vocabulario.
    Las palabras se capitalizan automáticamente.
    """
    material = db.query(Material).filter(
        Material.id == material_id,
        Material.teacher_id == current_user.teacher_profile.id
    ).first()

    if not material:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Material no encontrado"
        )

    seen = set()
    clean_words = []
    for word in words:
        word_clean = word.strip().capitalize()
        if word_clean and word_clean not in seen:
            seen.add(word_clean)
            clean_words.append(word_clean)

    material.vocabulary_words = clean_words
    material.category = "vocabulary"
    db.commit()

    return {"message": f"{len(clean_words)} palabras guardadas", "words": clean_words}

@router.post("/{material_id}/assign")
def assign_material(
    material_id: int,
    data: AssignMaterialRequest,
    current_user: User = Depends(get_current_approved_teacher),
    db: Session = Depends(get_db)
):
    """Asigna un material a uno o varios de TUS estudiantes (StudentProfile.id)"""
    material = db.query(Material).filter(
        Material.id == material_id,
        Material.teacher_id == current_user.teacher_profile.id
    ).first()

    if not material:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material no encontrado")

    owned_ids = set(current_user.teacher_profile.students or [])

    assigned_count = 0
    already_assigned = 0
    skipped_not_mine = 0

    for student_profile_id in data.student_ids:
        if student_profile_id not in owned_ids:
            skipped_not_mine += 1
            continue

        student_profile = db.query(StudentProfile).filter(
            StudentProfile.id == student_profile_id
        ).first()
        if not student_profile:
            continue

        existing = db.query(MaterialAssignment).filter(
            MaterialAssignment.material_id == material_id,
            MaterialAssignment.student_id == student_profile.id
        ).first()

        if existing:
            already_assigned += 1
            continue

        assignment = MaterialAssignment(
            material_id=material_id,
            student_id=student_profile.id
        )
        db.add(assignment)
        assigned_count += 1

        if student_profile.user:
            send_material_assigned_email(
                to_email=student_profile.user.email,
                student_name=student_profile.user.name,
                teacher_name=f"{current_user.name} {current_user.surname}",
                material_title=material.title,
                category=material.category,
            )

    db.commit()

    return {
        "message": f"Material asignado a {assigned_count} estudiantes",
        "assigned": assigned_count,
        "already_assigned": already_assigned,
        "skipped_not_mine": skipped_not_mine,
    }


@router.get("/my-materials", response_model=List[MaterialResponse])
def get_my_materials_teacher(
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db)
):
    """Devuelve todos los materiales del profesor"""
    return db.query(Material).filter(
        Material.teacher_id == current_user.teacher_profile.id,
        Material.is_active == True
    ).order_by(Material.created_at.desc()).all()


@router.delete("/{material_id}")
def delete_material(
    material_id: int,
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db)
):
    """
    Elimina un material.
    Borra el archivo de Cloudinary y desactiva el material en BD.
    """
    material = db.query(Material).filter(
        Material.id == material_id,
        Material.teacher_id == current_user.teacher_profile.id
    ).first()

    if not material:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Material no encontrado"
        )

    # Borrar archivo de Cloudinary si existe
    if material.file_public_id:
        delete_file(material.file_public_id, material.file_type or "raw")

    # Desactivar en lugar de borrar para no romper referencias
    material.is_active = False
    db.commit()

    return {"message": "Material eliminado"}


# ─── ENDPOINTS DEL ESTUDIANTE Y PROXY ───────────────────────────────────────

@router.get(
    "/student/my-materials",
    response_model=List[MaterialAssignmentResponse]
)
def get_my_materials_student(
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    """Devuelve los materiales asignados al estudiante"""
    return db.query(MaterialAssignment).filter(
        MaterialAssignment.student_id == current_user.student_profile.id,
        Material.is_active == True
    ).join(Material).order_by(MaterialAssignment.assigned_at.desc()).all()


@router.patch(
    "/student/{assignment_id}/progress",
    response_model=MaterialAssignmentResponse
)
def update_material_progress(
    assignment_id: int,
    data: UpdateProgressRequest,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    """El estudiante actualiza su progreso en un material"""
    from datetime import datetime
    from app.core.timezone import utc_now

    assignment = db.query(MaterialAssignment).filter(
        MaterialAssignment.id == assignment_id,
        MaterialAssignment.student_id == current_user.student_profile.id
    ).first()

    if not assignment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asignación no encontrada"
        )

    assignment.progress = data.progress

    if data.progress == "completed":
        assignment.completed_at = utc_now()

    db.commit()
    db.refresh(assignment)

    return assignment


@router.get("/{material_id}/stream")
def stream_material_file(
    material_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Redirige directamente al archivo en Cloudinary de forma segura"""
    material = db.query(Material).filter(Material.id == material_id).first()
    if not material or not material.file_url:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Archivo no encontrado"
        )
    
    return RedirectResponse(url=material.file_url)