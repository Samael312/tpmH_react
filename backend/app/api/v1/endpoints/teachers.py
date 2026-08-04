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
from app.models.student import StudentProfile
from app.core.storage import upload_file, delete_file
from app.models.package import Enrollment
from app.models.material import Material, MaterialAssignment

router = APIRouter()

def _to_public(t: TeacherProfile) -> TeacherPublicResponse:
    """Convierte un TeacherProfile a su respuesta pública, incluyendo
    nombre y apellido que viven en el User relacionado (no en TeacherProfile)."""
    resp = TeacherPublicResponse.model_validate(t)
    if t.user:
        resp.name = t.user.name
        resp.surname = t.user.surname
    return resp

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

    return [_to_public(t) for t in teachers]


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

    return _to_public(teacher)


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

@router.get("/me/students")
def get_my_students(
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db)
):
    """
    Lista los estudiantes vinculados al profesor autenticado
    (teacher_profiles.students). La usan los modales de asignar
    material/tareas para buscar solo entre sus propios estudiantes.
    """
    profile = current_user.teacher_profile
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Perfil no encontrado")

    student_ids = profile.students or []
    if not student_ids:
        return []

    students = db.query(StudentProfile).filter(StudentProfile.id.in_(student_ids)).all()

    result = []
    for sp in students:
        u = sp.user
        if not u:
            continue
        result.append({
            "id": sp.id,          # StudentProfile.id — usar este para asignar
            "user_id": u.id,
            "username": u.username,
            "name": u.name,
            "surname": u.surname,
            "avatar": u.avatar or sp.profile_photo_url,
        })
    return result

@router.get("/me/students-full")
def get_my_students_full(
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Devuelve la info completa de los estudiantes vinculados al profesor:
    datos de contacto, progreso de paquetes (enrollments) y materiales
    asignados. Pensado para la página de gestión de Estudiantes.
    """
    profile = current_user.teacher_profile
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Perfil no encontrado")

    student_ids = profile.students or []
    if not student_ids:
        return []

    students = db.query(StudentProfile).filter(StudentProfile.id.in_(student_ids)).all()

    result = []
    for sp in students:
        u = sp.user
        if not u:
            continue

        enrollments = db.query(Enrollment).filter(
            Enrollment.student_id == sp.id,
            Enrollment.teacher_id == profile.id,
        ).order_by(Enrollment.created_at.desc()).all()

        enrollment_list = []
        for e in enrollments:
            pkg = e.package
            enrollment_list.append({
                "id": e.id,
                "package_name": pkg.name if pkg else "N/A",
                "subject": pkg.subject if pkg else None,
                "classes_used": e.classes_used,
                "classes_total": e.classes_total,
                "status": e.status,
                "created_at": e.created_at,
            })

        material_assignments = (
            db.query(MaterialAssignment)
            .join(Material, Material.id == MaterialAssignment.material_id)
            .filter(
                MaterialAssignment.student_id == sp.id,
                Material.teacher_id == profile.id,
            )
            .all()
        )

        materials_list = [
            {
                "id": ma.id,
                "material_id": ma.material_id,
                "title": ma.material.title,
                "category": ma.material.category,
                "level": ma.material.level,
                "progress": ma.progress,
                "assigned_at": ma.assigned_at,
            }
            for ma in material_assignments
        ]

        result.append({
            "id": sp.id,
            "user_id": u.id,
            "username": u.username,
            "name": u.name,
            "surname": u.surname,
            "email": u.email,
            "nationality": u.nationality,
            "phone_number": u.phone_number,
            "avatar": u.avatar or sp.profile_photo_url,
            "timezone": sp.timezone,
            "goal": sp.goal,
            "created_at": u.created_at,
            "enrollments": enrollment_list,
            "materials": materials_list,
        })

    return result

@router.post("/me/video")
async def upload_teacher_video(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Sube (o reemplaza) el video de presentación del profesor.
    Es un requisito obligatorio para que el superadmin pueda aprobar el perfil.
    """
    profile = current_user.teacher_profile
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Perfil no encontrado")

    file_bytes = await file.read()
    try:
        result = upload_file(
            file_bytes=file_bytes,
            filename=file.filename,
            content_type=file.content_type,
            folder=f"teacher_videos/teacher_{profile.id}",
            display_name=f"presentacion_{profile.user_username}",
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # Borrar el video anterior de Cloudinary si existía
    if profile.video_public_id:
        try:
            delete_file(profile.video_public_id, resource_type="video")
        except Exception:
            pass

    profile.video_url = result["url"]
    profile.video_public_id = result["public_id"]
    db.commit()
    db.refresh(profile)

    return {
        "message": "Video subido correctamente. Tu perfil está en revisión por el equipo.",
        "video_url": profile.video_url,
    }


@router.delete("/me/video")
def delete_teacher_video(
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """Elimina el video de presentación del profesor."""
    profile = current_user.teacher_profile
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Perfil no encontrado")

    if profile.video_public_id:
        try:
            delete_file(profile.video_public_id, resource_type="video")
        except Exception:
            pass

    profile.video_url = None
    profile.video_public_id = None
    db.commit()

    return {"message": "Video eliminado"}

