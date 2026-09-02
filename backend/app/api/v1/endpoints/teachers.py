from fastapi import APIRouter, Depends, HTTPException, logger, status, Query, UploadFile, File
from sqlalchemy.orm import Session
from typing import List, Optional 
from app.db.base import get_db
from app.auth.dependencies import get_current_user, get_current_teacher
from app.models.user import User, UserRole
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
from app.core.email import send_admin_new_teacher_pending_email
from app.core.phone import normalize_phone
from app.core.notifications import create_notification
from app.models.teacher_appeal import TeacherAppeal
from app.schemas.notifications import CreateAppealRequest, TeacherAppealResponse
from pydantic import BaseModel

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
    Endpoint público. Excluye cuentas fijas de la suite de tests
    (is_test_account=True) — no deben aparecer en el marketplace real.
    """
    teachers = db.query(TeacherProfile).join(User, TeacherProfile.user_id == User.id).filter(
        TeacherProfile.status == TeacherStatus.approved,
        User.is_test_account.is_(False),
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


@router.patch("/me/profile")
def update_my_teacher_profile(
    data: UpdateTeacherProfileRequest,
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db)
):
    """
    Actualiza el perfil del profesor autenticado.
    El cambio de zona horaria NO recalcula disponibilidad ni excepciones:
    las horas configuradas son fijas en el día (ej. "10:00-17:00") y no
    dependen de la zona horaria de la cuenta.
    """
    profile = current_user.teacher_profile
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Perfil no encontrado"
        )

    update_data = data.model_dump(exclude_unset=True)

    if "social_links" in update_data and update_data["social_links"]:
        wa = update_data["social_links"].get("whatsapp")
        if wa:
            update_data["social_links"]["whatsapp"] = normalize_phone(wa) or wa

    for field, value in update_data.items():
        setattr(profile, field, value)

    db.commit()
    db.refresh(profile)

    from app.api.v1.endpoints.public import invalidate_landing_cache
    invalidate_landing_cache()

    return TeacherProfileResponse.model_validate(profile).model_dump()

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
                "cohort_id": e.cohort_id,
                "is_group": bool(pkg.is_group) if pkg else False,
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
            # Contador de por vida (no ligado a un enrollment/paquete
            # concreto): sobrevive a renovaciones, cambios de paquete y
            # cuenta también clases grupales — ver app.core.class_logic.
            "total_completed_classes": sp.total_completed_classes,
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

    # Si el profesor agotó sus apelaciones, subir un nuevo video reinicia
    # por completo el ciclo de revisión: vuelve a "pending" y se limpian
    # los rastros del rechazo anterior.
    is_restart_after_exhausted_appeals = profile.appeal_exhausted
    if is_restart_after_exhausted_appeals or profile.status == TeacherStatus.rejected:
        profile.status = TeacherStatus.pending
        profile.rejection_reason = None
        profile.rejection_feedback_seen = True
        profile.appeal_count = 0
        profile.appeal_exhausted = False

    db.commit()
    db.refresh(profile)

    admin_emails = [a.email for a in db.query(User).filter(User.role == UserRole.superadmin, User.is_active == True).all()]
    for admin_email in admin_emails:
        send_admin_new_teacher_pending_email(
            to_email=admin_email, teacher_name=f"{current_user.name} {current_user.surname}",
            teacher_email=current_user.email,
            subjects_or_languages=(profile.subjects or []) + (profile.languages or []),
        )

    create_notification(
        db,
        type="teacher_pending",
        title="Nuevo video de presentación",
        message=f"{current_user.name} {current_user.surname} subió su video y espera revisión.",
        related_teacher_id=profile.id,
    )
    db.commit()

    from app.api.v1.endpoints.public import invalidate_landing_cache
    invalidate_landing_cache()

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

    from app.api.v1.endpoints.public import invalidate_landing_cache
    invalidate_landing_cache()

    return {"message": "Video eliminado"}

class MarkFeedbackSeenResponse(BaseModel):
    message: str


@router.patch("/me/feedback-seen", response_model=MarkFeedbackSeenResponse)
def mark_rejection_feedback_seen(
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """El profesor marcó como visto el banner de retroalimentación de rechazo."""
    profile = current_user.teacher_profile
    if not profile:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Perfil no encontrado")
    profile.rejection_feedback_seen = True
    db.commit()
    return MarkFeedbackSeenResponse(message="Retroalimentación marcada como vista")


@router.post("/me/appeal", response_model=TeacherAppealResponse, status_code=status.HTTP_201_CREATED)
def submit_appeal(
    data: CreateAppealRequest,
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    El profesor apela un rechazo. Máximo 2 apelaciones por ciclo de rechazo.
    Al agotar las 2, debe subir un nuevo video (POST /teachers/me/video)
    para reiniciar el ciclo — no se pueden presentar más apelaciones.
    """
    profile = current_user.teacher_profile
    if not profile:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Perfil no encontrado")

    if profile.status != TeacherStatus.rejected:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Solo puedes apelar cuando tu perfil está rechazado"
        )

    if profile.appeal_exhausted or (profile.appeal_count or 0) >= 2:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Ya usaste tus 2 apelaciones. Sube un nuevo video para reiniciar la revisión."
        )

    existing_pending = db.query(TeacherAppeal).filter(
        TeacherAppeal.teacher_id == profile.id,
        TeacherAppeal.status == "pending",
    ).first()
    if existing_pending:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ya tienes una apelación pendiente de revisión")

    appeal_number = (profile.appeal_count or 0) + 1
    appeal = TeacherAppeal(
        teacher_id=profile.id,
        appeal_number=appeal_number,
        message=data.message,
        status="pending",
    )
    db.add(appeal)
    profile.appeal_count = appeal_number
    db.commit()
    db.refresh(appeal)

    create_notification(
        db,
        type="teacher_appeal",
        title="Nueva apelación de profesor",
        message=f"{current_user.name} {current_user.surname} apeló su rechazo (apelación {appeal_number}/2).",
        related_teacher_id=profile.id,
    )
    db.commit()

    return appeal


@router.get("/me/appeals", response_model=List[TeacherAppealResponse])
def get_my_appeals(
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    profile = current_user.teacher_profile
    if not profile:
        return []
    return db.query(TeacherAppeal).filter(
        TeacherAppeal.teacher_id == profile.id
    ).order_by(TeacherAppeal.created_at.asc()).all()
