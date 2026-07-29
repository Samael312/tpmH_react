import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.orm import Session

from app.db.base import get_db
from app.auth.dependencies import get_current_student, get_current_user
from app.auth.passwords import hash_password, verify_password
from app.models.user import User
from app.models.student import StudentProfile
from app.schemas.user import UserResponse, UpdateProfileRequest, ChangePasswordRequest
from app.models.student_preferences import StudentSchedulePreference
from app.core.timezone import convert_local_time_to_utc_string, validate_timezone
from app.schemas.preferences import SetPreferencesRequest, PreferenceSlotResponse
from app.core.storage import upload_file, delete_file

logger = logging.getLogger(__name__)

router = APIRouter()


# ─── HELPER DE AVATAR / FOTO DE PERFIL ───────────────────────────────────────

async def _process_and_update_user_avatar(
    file: UploadFile,
    current_user: User,
    db: Session
) -> dict:
    """
    Lógica unificada para procesar la subida de foto/avatar.
    Funciona para cualquier rol (estudiante, profesor, etc.) y sincroniza
    las referencias en el usuario base y en sus perfiles asociados.
    """
    try:
        # 1. Leer los bytes del archivo cargado
        file_bytes = await file.read()

        # 2. Subir el archivo a Cloudinary
        result = upload_file(
            file_bytes=file_bytes,
            filename=file.filename,
            content_type=file.content_type,
            folder="tpm/avatars"
        )

        # 3. Buscar public_id anterior para limpiarlo de Cloudinary si existe
        old_public_id = getattr(current_user, "avatar_public_id", None)

        if not old_public_id and hasattr(current_user, "student_profile") and current_user.student_profile:
            old_public_id = getattr(current_user.student_profile, "profile_photo_public_id", None)

        if not old_public_id and hasattr(current_user, "teacher_profile") and current_user.teacher_profile:
            old_public_id = getattr(current_user.teacher_profile, "profile_photo_public_id", None)

        if old_public_id:
            try:
                delete_file(old_public_id, resource_type="image")
            except Exception as del_err:
                logger.warning(f"No se pudo eliminar la imagen previa ({old_public_id}): {del_err}")

        # 4. Actualizar tabla User
        current_user.avatar = result["url"]
        if hasattr(current_user, "avatar_public_id"):
            current_user.avatar_public_id = result["public_id"]

        # 5. Sincronizar en StudentProfile si existe
        if hasattr(current_user, "student_profile") and current_user.student_profile:
            current_user.student_profile.profile_photo_url = result["url"]
            current_user.student_profile.profile_photo_public_id = result["public_id"]

        # 6. Sincronizar en TeacherProfile si existe
        if hasattr(current_user, "teacher_profile") and current_user.teacher_profile:
            current_user.teacher_profile.profile_photo_url = result["url"]
            current_user.teacher_profile.profile_photo_public_id = result["public_id"]

        db.commit()
        db.refresh(current_user)

        return {
            "message": "Foto de perfil actualizada correctamente",
            "avatar_url": result["url"],
            "url": result["url"],
            "public_id": result["public_id"]
        }

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Error al actualizar avatar para el usuario {current_user.id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error interno al procesar la foto de perfil"
        )


# ─── ENDPOINTS DE USUARIO GENERAL ─────────────────────────────────────────────

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
    if data.username and data.username != current_user.username:
        existing = db.query(User).filter(
            User.username == data.username
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Este nombre de usuario ya está en uso"
            )
        if current_user.role == "student" and current_user.student_profile:
            current_user.student_profile.user_username = data.username
        elif current_user.role == "teacher" and current_user.teacher_profile:
            current_user.teacher_profile.user_username = data.username

    if data.email and data.email != current_user.email:
        existing = db.query(User).filter(
            User.email == data.email
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Este email ya está registrado"
            )

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


# ─── ENDPOINTS DE FOTO / AVATAR (GET, POST Y PATCH) ───────────────────────────

@router.get("/me/avatar")
def get_avatar(current_user: User = Depends(get_current_user)):
    """Obtiene la URL del avatar/foto del usuario autenticado."""
    avatar_url = getattr(current_user, "avatar", None)

    if not avatar_url and hasattr(current_user, "student_profile") and current_user.student_profile:
        avatar_url = getattr(current_user.student_profile, "profile_photo_url", None)

    if not avatar_url and hasattr(current_user, "teacher_profile") and current_user.teacher_profile:
        avatar_url = getattr(current_user.teacher_profile, "profile_photo_url", None)

    return {
        "avatar_url": avatar_url,
        "url": avatar_url
    }


@router.get("/me/photo")
def get_photo(current_user: User = Depends(get_current_user)):
    """Alias para obtener la foto de perfil (GET /me/photo)."""
    return get_avatar(current_user)


@router.post("/me/avatar")
async def upload_avatar_post(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Sube o reemplaza la foto de perfil (POST /me/avatar)."""
    return await _process_and_update_user_avatar(file, current_user, db)


@router.patch("/me/avatar")
async def upload_avatar_patch(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Actualiza la foto de perfil (PATCH /me/avatar)."""
    return await _process_and_update_user_avatar(file, current_user, db)


@router.post("/me/photo")
async def upload_photo_post(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Alias de compatibilidad para subir foto (POST /me/photo)."""
    return await _process_and_update_user_avatar(file, current_user, db)


@router.patch("/me/photo")
async def upload_photo_patch(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Alias de compatibilidad para actualizar foto (PATCH /me/photo)."""
    return await _process_and_update_user_avatar(file, current_user, db)


# ─── ENDPOINTS ESPECÍFICOS DE ESTUDIANTE ──────────────────────────────────────

@router.get("/me/student-profile")
def get_student_profile(
    current_user: User = Depends(get_current_user)
):
    """Devuelve los datos del perfil de estudiante del usuario autenticado"""
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

    return profile


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


@router.post("/me/preferences", response_model=List[PreferenceSlotResponse])
def set_schedule_preferences(
    data: SetPreferencesRequest,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    """
    El estudiante configura sus horas preferidas.
    Reemplaza todas las preferencias anteriores.
    El calendario las usa para resaltar slots en morado.
    """
    if not validate_timezone(data.timezone):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Zona horaria inválida: {data.timezone}"
        )

    student_id = current_user.student_profile.id

    db.query(StudentSchedulePreference).filter(
        StudentSchedulePreference.student_id == student_id
    ).delete()

    new_prefs = []
    for slot in data.slots:
        try:
            start_utc = convert_local_time_to_utc_string(
                slot.start_time_local, data.timezone
            )
            end_utc = convert_local_time_to_utc_string(
                slot.end_time_local, data.timezone
            )
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e)
            )

        pref = StudentSchedulePreference(
            student_id=student_id,
            day_of_week=slot.day_of_week,
            start_time_utc=start_utc,
            end_time_utc=end_utc,
        )
        db.add(pref)
        new_prefs.append(pref)

    db.commit()
    for pref in new_prefs:
        db.refresh(pref)

    return new_prefs


@router.get("/me/preferences", response_model=List[PreferenceSlotResponse])
def get_schedule_preferences(
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    """Devuelve las preferencias de horario del estudiante"""
    return db.query(StudentSchedulePreference).filter(
        StudentSchedulePreference.student_id == current_user.student_profile.id
    ).order_by(
        StudentSchedulePreference.day_of_week,
        StudentSchedulePreference.start_time_utc
    ).all()