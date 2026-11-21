from fastapi import APIRouter, Depends, HTTPException, logger, Request, Response, status, Query, UploadFile, File
from app.core.rate_limit import limiter, user_or_ip_key
from app.core.pagination import Pagination, paginate
from app.core.http_cache import set_public_cache
from sqlalchemy.orm import Session, contains_eager
from typing import List, Optional 
from app.db.base import get_db
from app.auth.dependencies import get_current_user, get_current_teacher, get_current_teacher_or_teacher_admin
from app.models.user import User, UserRole
from app.models.teacher import TeacherProfile, TeacherStatus
from app.schemas.teacher import (
    TeacherProfileResponse,
    UpdateTeacherProfileRequest,
    TeacherPublicResponse
)
from app.models.student import StudentProfile
from app.core.storage import upload_file_stream, delete_file, ALLOWED_VIDEO_TYPES, MAX_VIDEO_SIZE
from app.models.package import Enrollment
from app.models.material import Material, MaterialAssignment
from app.core.email import send_admin_new_teacher_pending_email
from app.core.phone import normalize_phone
from app.core.notifications import create_notification, get_user_unread_count
from app.models.notification import Notification
from app.models.teacher_appeal import TeacherAppeal
from app.schemas.notifications import CreateAppealRequest, NotificationResponse, TeacherAppealResponse, UnreadCountResponse
from app.core.schedule_recalc import apply_teacher_timezone_change
from app.core.platform_config import get_or_create_platform_config
from app.core.spoken_languages import read_spoken_languages, speaks as speaks_language
from app.schemas.user import SpokenLanguageItem
from pydantic import BaseModel

router = APIRouter()

def _to_public(t: TeacherProfile, hide_whatsapp: bool = False) -> TeacherPublicResponse:
    """Convierte un TeacherProfile a su respuesta pública, incluyendo
    nombre y apellido que viven en el User relacionado (no en TeacherProfile)."""
    resp = TeacherPublicResponse.model_validate(t)
    if t.user:
        resp.name = t.user.name
        resp.surname = t.user.surname
        resp.spoken_languages = [SpokenLanguageItem(**i) for i in read_spoken_languages(t.user.spoken_languages)]
    # Interruptor global de admin (platform_config.show_teacher_whatsapp):
    # oculta el WhatsApp de TODOS los profesores sin tocar lo que cada uno
    # cargó en su propio perfil.
    if hide_whatsapp and resp.social_links and "whatsapp" in resp.social_links:
        resp.social_links = {k: v for k, v in resp.social_links.items() if k != "whatsapp"}
    return resp

# Dejamos solo esta versión de la ruta raíz ("/") que ya maneja los filtros opcionales
@router.get("/", response_model=List[TeacherPublicResponse])
def list_approved_teachers(
    response: Response,
    subject: Optional[str] = Query(None, description="Filtrar por materia"),
    language: Optional[str] = Query(None, description="Filtrar por idioma que ENSEÑA"),
    speaks: Optional[str] = Query(None, max_length=40, description="Filtrar por idioma que HABLA (Fase 10)"),
    db: Session = Depends(get_db)
):
    """
    Lista profesores aprobados.
    Filtrable por materia e idioma.
    Endpoint público. Excluye cuentas fijas de la suite de tests
    (is_test_account=True) — no deben aparecer en el marketplace real.
    """
    teachers = db.query(TeacherProfile).join(User, TeacherProfile.user_id == User.id).options(
        contains_eager(TeacherProfile.user)
    ).filter(
        TeacherProfile.status == TeacherStatus.approved,
        User.is_test_account.is_(False),
        User.is_active.is_(True),  # Fase 21, S6: cuentas desactivadas/borradas no se listan
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

    # Filtrar por idioma que habla (Fase 10; lo guardado vive en User.spoken_languages)
    if speaks:
        teachers = [t for t in teachers if t.user and speaks_language(t.user.spoken_languages, speaks)]

    hide_whatsapp = not get_or_create_platform_config(db).show_teacher_whatsapp  # una sola consulta, no una por profesor
    set_public_cache(response)  # Fase 14, E4: misma respuesta para cualquiera (ver core/http_cache.py)
    return [_to_public(t, hide_whatsapp=hide_whatsapp) for t in teachers]


@router.get("/{username}", response_model=TeacherPublicResponse)
def get_teacher_profile(username: str, response: Response, db: Session = Depends(get_db)):
    """
    Perfil público de un profesor específico.
    Endpoint público — no requiere autenticación.
    """
    teacher = db.query(TeacherProfile).filter(
        TeacherProfile.user_username == username
    ).first()

    if not teacher or (teacher.user is not None and not teacher.user.is_active):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profesor no encontrado"
        )

    if teacher.status != TeacherStatus.approved:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profesor no disponible"
        )

    set_public_cache(response)  # solo en el 200: un 404 no se cachea (Fase 14, E4)
    return _to_public(teacher, hide_whatsapp=not get_or_create_platform_config(db).show_teacher_whatsapp)


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
    Si cambia la zona horaria, la disponibilidad semanal (guardada en hora local, Fase 26) conserva su
    hora local sin recalcular ("06:00-08:00" en Sydney sigue siendo "06:00-08:00" al pasar a Bogotá) y
    las excepciones puntuales se reinterpretan con la misma fecha y hora de reloj. Ver
    core/schedule_recalc.py.
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

    old_timezone = profile.timezone
    new_timezone = update_data.get("timezone")

    tz_changed = bool(new_timezone and new_timezone != old_timezone)
    for field, value in update_data.items():
        if field == "timezone" and tz_changed:
            continue  # lo aplica apply_teacher_timezone_change (excepciones + cache de huecos)
        setattr(profile, field, value)

    if tz_changed:
        apply_teacher_timezone_change(profile, new_timezone, db)

    db.commit()
    db.refresh(profile)

    from app.api.v1.endpoints.public import invalidate_landing_cache
    invalidate_landing_cache()

    return TeacherProfileResponse.model_validate(profile).model_dump()

@router.get("/me/students")
def get_my_students(
    response: Response,
    page: Pagination = Depends(),
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

    students = paginate(
        db.query(StudentProfile).filter(StudentProfile.id.in_(student_ids)).order_by(StudentProfile.id),
        page, response,
    ).all()

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
    response: Response,
    page: Pagination = Depends(),
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

    students = paginate(
        db.query(StudentProfile).filter(StudentProfile.id.in_(student_ids)).order_by(StudentProfile.id),
        page, response,
    ).all()

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
            "spoken_languages": read_spoken_languages(u.spoken_languages),
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
@limiter.limit("10/hour", key_func=user_or_ip_key)  # cada subida pesa hasta 100 MB en Cloudinary
def upload_teacher_video(
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Sube (o reemplaza) el video de presentación del profesor (solo video, <= 100 MB).
    Es un requisito obligatorio para que el superadmin pueda aprobar el perfil.

    Un video nuevo NUNCA sale a producción sin revisar. Primer video / perfil no aprobado: flujo de onboarding
    (video_url + perfil "pending"). Profesor ya aprobado: el video va a video_pending_* y el anterior sigue
    público hasta que el staff apruebe (Fase 23). Solo se avisa al staff al crearse un pendiente nuevo.
    """
    profile = current_user.teacher_profile
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Perfil no encontrado")

    if db.query(TeacherAppeal).filter(
        TeacherAppeal.teacher_id == profile.id, TeacherAppeal.kind == "video", TeacherAppeal.status == "pending",
    ).first():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Tu apelación sobre el video está en revisión; espera la resolución")

    try:
        result = upload_file_stream(
            file.file,
            filename=file.filename,
            content_type=file.content_type,
            folder=f"teacher_videos/teacher_{profile.id}",
            display_name=f"presentacion_{profile.user_username}",
            allowed_types=ALLOWED_VIDEO_TYPES,
            max_bytes=MAX_VIDEO_SIZE,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # Fase 23: un profesor YA aprobado y con video publico no pierde su perfil al reemplazar el video: el nuevo
    # queda "pendiente" (columnas video_pending_*) y el publico sigue viendo el anterior hasta que el staff lo apruebe.
    if profile.status == TeacherStatus.approved and profile.video_url:
        # Un pendiente ya rechazado cuenta como "nuevo" para el aviso al staff.
        had_pending = bool(profile.video_pending_url) and not profile.video_pending_rejection_reason
        if profile.video_pending_public_id:
            try:
                delete_file(profile.video_pending_public_id, resource_type="video")
            except Exception:
                pass
        profile.video_pending_url = result["url"]
        profile.video_pending_public_id = result["public_id"]
        profile.video_pending_rejection_reason = None
        profile.video_pending_appeal_used = False
        db.commit()

        if not had_pending:  # un reintento que pisa el mismo pendiente no vuelve a avisar al staff
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
                title="Video nuevo pendiente",
                message=f"{current_user.name} {current_user.surname} subió un video nuevo y espera revisión.",
                related_teacher_id=profile.id,
            )
            db.commit()

        return {
            "message": "Video recibido. Tu video actual sigue visible hasta que el equipo apruebe el nuevo.",
            "video_url": profile.video_url,
            "video_pending_url": profile.video_pending_url,
        }

    # Borrar el video anterior de Cloudinary si existía
    if profile.video_public_id:
        try:
            delete_file(profile.video_public_id, resource_type="video")
        except Exception:
            pass

    previous_status = profile.status
    had_video = bool(profile.video_url)
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

    state_changed_to_pending = profile.status == TeacherStatus.pending and (
        previous_status != TeacherStatus.pending or not had_video
    )

    db.commit()
    db.refresh(profile)

    if state_changed_to_pending:
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
        "video_pending_url": profile.video_pending_url,
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

    existing_pending = db.query(TeacherAppeal).filter(
        TeacherAppeal.teacher_id == profile.id,
        TeacherAppeal.status == "pending",
    ).first()
    if existing_pending:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ya tienes una apelación pendiente de revisión")

    # Fase 23: video nuevo rechazado de un profesor aprobado -> una sola apelacion por video.
    if profile.status != TeacherStatus.rejected and profile.video_pending_rejection_reason:
        if profile.video_pending_appeal_used:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ya apelaste este video. Sube uno nuevo para volver a revisión.")
        appeal = TeacherAppeal(teacher_id=profile.id, appeal_number=1, message=data.message, status="pending", kind="video")
        db.add(appeal)
        profile.video_pending_appeal_used = True
        db.commit()
        db.refresh(appeal)
        create_notification(
            db,
            type="teacher_appeal",
            title="Apelación de video nuevo",
            message=f"{current_user.name} {current_user.surname} apeló el rechazo de su video nuevo.",
            related_teacher_id=profile.id,
        )
        db.commit()
        return appeal

    if profile.status != TeacherStatus.rejected:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Solo puedes apelar cuando tu perfil o tu video nuevo están rechazados"
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


# ─── Avisos del profesor (Fase 13, A9) ───────────────────────────────────────
# Notificaciones dirigidas a UN usuario (`recipient_user_id`), p. ej. clases que pasaron solas a "no_show".
# Son distintas de las del staff (`/admin/notifications`): cada profesor solo ve las suyas.

@router.get("/me/notifications", response_model=List[NotificationResponse])
def list_my_notifications(
    response: Response,
    page: Pagination = Depends(),
    unread_only: bool = Query(False),
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db),
):
    query = db.query(Notification).filter(Notification.recipient_user_id == current_user.id)
    if unread_only:
        query = query.filter(Notification.is_read == False)  # noqa: E712
    return paginate(query.order_by(Notification.created_at.desc(), Notification.id.desc()), page, response).all()


@router.get("/me/notifications/unread-count", response_model=UnreadCountResponse)
def my_unread_notification_count(
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db),
):
    return UnreadCountResponse(unread_count=get_user_unread_count(db, current_user.id))


@router.patch("/me/notifications/{notification_id}/read")
def mark_my_notification_read(
    notification_id: int,
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db),
):
    notif = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.recipient_user_id == current_user.id,  # nunca el aviso de otro usuario
    ).first()
    if not notif:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Aviso no encontrado")
    notif.is_read = True
    db.commit()
    return {"message": "Aviso marcado como leído"}


@router.post("/me/notifications/mark-all-read")
def mark_all_my_notifications_read(
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db),
):
    db.query(Notification).filter(
        Notification.recipient_user_id == current_user.id,
        Notification.is_read == False,  # noqa: E712
    ).update({"is_read": True}, synchronize_session=False)
    db.commit()
    return {"message": "Todos los avisos marcados como leídos"}
