from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import List, Optional

from app.db.base import get_db
from app.auth.dependencies import get_current_user, get_current_teacher, get_current_student
from app.models.user import User
from app.models.material import Material, MaterialAssignment
from app.models.student import StudentProfile
from app.schemas.materials import (
    MaterialCreate,
    MaterialResponse,
    AssignMaterialRequest,
    MaterialAssignmentResponse,
    UpdateProgressRequest,
)
from app.core.storage import upload_file, delete_file

router = APIRouter()


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
                folder=f"materials/teacher_{current_user.teacher_profile.id}"
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


@router.post("/{material_id}/vocabulary")
def set_vocabulary_words(
    material_id: int,
    words: List[str],
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

    # Capitalizar y limpiar duplicados manteniendo orden
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
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db)
):
    """Asigna un material a uno o varios estudiantes"""
    material = db.query(Material).filter(
        Material.id == material_id,
        Material.teacher_id == current_user.teacher_profile.id
    ).first()

    if not material:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Material no encontrado"
        )

    assigned_count = 0
    already_assigned = 0

    for student_id in data.student_ids:
        # Verificar que el estudiante existe
        student = db.query(StudentProfile).filter(
            StudentProfile.id == student_id
        ).first()

        if not student:
            continue

        # Verificar que no está ya asignado
        existing = db.query(MaterialAssignment).filter(
            MaterialAssignment.material_id == material_id,
            MaterialAssignment.student_id == student_id
        ).first()

        if existing:
            already_assigned += 1
            continue

        assignment = MaterialAssignment(
            material_id=material_id,
            student_id=student_id
        )
        db.add(assignment)
        assigned_count += 1

    db.commit()

    return {
        "message": f"Material asignado a {assigned_count} estudiantes",
        "assigned": assigned_count,
        "already_assigned": already_assigned
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


# ─── ENDPOINTS DEL ESTUDIANTE ───────────────────────────────────────────────

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