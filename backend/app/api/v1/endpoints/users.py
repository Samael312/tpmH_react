import logging
from typing import List

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status, UploadFile, File
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload
from app.core.phone import normalize_phone
from app.schemas.validators import clean_person_name, clean_username
from app.db.base import get_db
from app.core.rate_limit import limiter, user_or_ip_key
from app.auth.dependencies import get_current_student, get_current_user
from app.auth.passwords import hash_password, verify_password
from app.models.user import User
from app.schemas.user import (
    UserResponse, UpdateProfileRequest, ChangePasswordRequest, StudentProfileResponse, DeleteAccountRequest,
)
from app.models.student_preferences import StudentSchedulePreference
from app.core.timezone import convert_local_time_to_utc, validate_timezone
from app.core.schedule_recalc import recalculate_student_preferences_timezone
from app.schemas.preferences import SetPreferencesRequest, PreferenceSlotResponse
from app.core.storage import upload_file_stream, delete_file, ALLOWED_IMAGE_TYPES, MAX_AVATAR_SIZE
from app.models.teacher import TeacherProfile, TeacherStatus
from app.core.teacher_students import link_student_to_teacher
from app.models.student_teacher_link import StudentTeacherLink
from app.models.payment import Payment
from app.core.class_logic import get_student_booking_stage
from app.core.spoken_languages import (
    SpokenLanguagesError, get_catalog as get_spoken_catalog, normalize_spoken_languages,
)
from app.models.package import Enrollment, EnrollmentStatus
from app.core.platform_config import get_platform_config  # Fase 14, E9: una lectura por petición

logger = logging.getLogger(__name__)

router = APIRouter()


# ─── HELPER DE AVATAR / FOTO DE PERFIL ───────────────────────────────────────

def _process_and_update_user_avatar(
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
        # 1-2. Subir el archivo a Cloudinary sin cargarlo entero en RAM
        result = upload_file_stream(
            file.file,
            filename=file.filename,
            content_type=file.content_type,
            folder="tpm/avatars",
            allowed_types=ALLOWED_IMAGE_TYPES,  # Fase 21: el avatar solo admite imágenes (<= 5 MB)
            max_bytes=MAX_AVATAR_SIZE,
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
    response: Response,
    data: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Actualiza datos básicos del perfil.
    Solo actualiza los campos que se envían (PATCH parcial).

    Cambiar el email (Fase 21, S1): se guarda en minúsculas, se compara sin distinguir mayúsculas, la cuenta
    pasa a NO verificada, se envía el enlace de verificación al email nuevo y se cierran las demás sesiones
    (la actual recibe cookies nuevas). Así un atacante con sesión robada no puede dejar la cuenta atada al
    correo de otra persona (que luego entraría con Google) ni conservar el acceso.
    """
    def _check(fn, value):
        try:
            return fn(value)
        except ValueError as e:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))

    username_changed = False
    if data.username and data.username != (current_user.username or "").lower():
        data.username = _check(clean_username, data.username)
        existing = db.query(User).filter(
            func.lower(User.username) == data.username,
            User.id != current_user.id,
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Este nombre de usuario ya está en uso"
            )
        username_changed = True
    if username_changed:
        if current_user.role == "student" and current_user.student_profile:
            current_user.student_profile.user_username = data.username
        elif current_user.role in ("teacher", "teacher_admin") and current_user.teacher_profile:
            current_user.teacher_profile.user_username = data.username

    email_changed = False
    if data.email and data.email != (current_user.email or "").strip().lower():
        if current_user.google_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Tu cuenta está vinculada con Google: el email no se puede editar aquí."
            )
        existing = db.query(User).filter(
            func.lower(User.email) == data.email,
            User.id != current_user.id,
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Este email ya está registrado"
            )
        email_changed = True

    for field in ("name", "surname"):
        value = getattr(data, field)
        if value is not None and value != getattr(current_user, field):
            setattr(data, field, _check(clean_person_name, value))

    update_data = data.model_dump(exclude_unset=True)
    if update_data.get("tour_completed", True) is None:
        update_data.pop("tour_completed")   # la columna es NOT NULL: un null explícito se ignora
    if "username" in update_data and update_data["username"] is not None:
        update_data["username"] = update_data["username"].lower()

    # Fase 8: idiomas que habla. Validacion y normalizacion en el servidor (catalogo, max 10, sin repetidos).
    if "spoken_languages" in update_data:
        try:
            update_data["spoken_languages"] = normalize_spoken_languages(
                update_data["spoken_languages"], get_spoken_catalog(db)
            )
        except SpokenLanguagesError as e:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))
    # Terminar el onboarding exige al menos un idioma (usuarios que ya lo terminaron no se ven afectados).
    if update_data.get("onboarding_completed") is True and not current_user.onboarding_completed:
        resulting = update_data.get("spoken_languages", current_user.spoken_languages or [])
        if not resulting:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Indica al menos un idioma que hablas")
    # La foto de perfil es obligatoria para los alumnos (la pantalla de onboarding ya la exige; aqui se aplica tambien en
    # el servidor para que no se pueda saltar llamando a la API). Las cuentas de Google traen la suya.
    if (
        update_data.get("onboarding_completed") is True
        and not current_user.onboarding_completed
        and getattr(current_user.role, "value", current_user.role) == "student"
        and not (update_data.get("avatar") or current_user.avatar)
    ):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Sube una foto de perfil para terminar el registro")

    if "phone_number" in update_data:
        normalized_phone = normalize_phone(update_data["phone_number"])
        if normalized_phone and normalized_phone != current_user.phone_number:
            existing_phone = db.query(User).filter(
                User.phone_number == normalized_phone,
                User.id != current_user.id
            ).first()
            if existing_phone:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Este número de teléfono ya está registrado por otro usuario"
                )
        update_data["phone_number"] = normalized_phone

    if not email_changed:
        update_data.pop("email", None)  # mismo correo con otras mayúsculas: no es un cambio
    for field, value in update_data.items():
        setattr(current_user, field, value)

    if email_changed:
        from app.auth.session import revoke_all_sessions, set_auth_cookies
        from app.api.v1.endpoints.auth import _issue_verification_email
        current_user.is_verified = False
        revoke_all_sessions(db, current_user.id)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Este email ya está registrado")
        set_auth_cookies(response, current_user, db)  # la sesión actual sigue viva con cookies nuevas
        _issue_verification_email(current_user, db)
        db.refresh(current_user)
        return current_user

    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/me/change-password")
@limiter.limit("10/hour")
def change_password(
    request: Request,
    response: Response,
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
    # SEC-05: tras cambiar la contrasena se cierran TODAS las demas sesiones; la actual recibe cookies nuevas.
    from app.auth.session import revoke_all_sessions, set_auth_cookies
    revoke_all_sessions(db, current_user.id)
    db.commit()
    set_auth_cookies(response, current_user, db)

    return {"message": "Contraseña actualizada correctamente"}


def _account_deletion_blockers(user: User, db: Session) -> list[str]:
    """
    SEC-06: motivos por los que NO se puede borrar la cuenta todavia (dinero o compromisos pendientes).
    Borrar con saldo/retiros/paquetes en curso dejaba al usuario sin forma de reclamarlos.
    """
    from app.core.timezone import utc_now
    from app.models.class_ import Class
    from app.models.payment import TeacherWallet, Withdrawal

    reasons: list[str] = []
    now = utc_now()
    live = ~Class.status.in_(["cancelled", "expired"])
    open_enrollment = Enrollment.status.in_(
        [EnrollmentStatus.active, EnrollmentStatus.pending_renewal, EnrollmentStatus.pending_package_change]
    )

    sp = user.student_profile
    if sp:
        if db.query(Class).filter(Class.student_id == sp.id, Class.start_time_utc > now, live).first():
            reasons.append("Tienes clases futuras agendadas. Cancélalas antes de eliminar tu cuenta.")
        for e in db.query(Enrollment).filter(Enrollment.student_id == sp.id, open_enrollment).all():
            has_credit = (
                (e.prepaid_unlimited_credits or 0) > 0 if e.classes_total is None
                else (e.classes_used or 0) < e.classes_total
            )
            if has_credit:
                reasons.append("Tienes un paquete con clases disponibles. Úsalas o pide un reembolso antes de eliminar tu cuenta.")
                break
        if db.query(Payment).filter(Payment.student_id == sp.id, Payment.status == "pending_review").first():
            reasons.append("Tienes pagos pendientes de revisión.")

    tp = user.teacher_profile
    if tp:
        wallet = db.query(TeacherWallet).filter(TeacherWallet.teacher_id == tp.id).first()
        if wallet and (wallet.available_balance or 0) > 0:
            reasons.append(f"Tienes ${wallet.available_balance:.2f} disponibles en tu billetera. Retíralos antes de eliminar tu cuenta.")
        if db.query(Withdrawal).filter(Withdrawal.teacher_id == tp.id, Withdrawal.status.in_(["pending", "processing"])).first():
            reasons.append("Tienes un retiro pendiente de procesar.")
        if db.query(Class).filter(Class.teacher_id == tp.id, Class.start_time_utc > now, live).first():
            reasons.append("Tienes clases futuras agendadas. Cancélalas o reasígnalas antes de eliminar tu cuenta.")
        if db.query(Enrollment).filter(Enrollment.teacher_id == tp.id, open_enrollment).first():
            reasons.append("Tienes alumnos con paquetes activos. Resuélvelos antes de eliminar tu cuenta.")
    return reasons


def _retire_teacher_profile(user: User, anon_tag: str, db: Session) -> None:
    """
    Fase 21 (S6): al borrar la cuenta de un profesor su perfil deja de ser visible (suspended), se borran sus
    medios (video, materiales; la foto ya se borró arriba), la conexión de Google Calendar y los datos de
    destino de sus retiros, y se desactivan sus paquetes. NO se cancela nada: ni clases de la plataforma ni
    eventos de Google (regla del dueño); las clases simplemente dejan de sincronizarse.
    """
    from app.models.google_calendar import GoogleCalendarToken
    from app.models.material import Material
    from app.models.package import Package
    from app.models.payment import Withdrawal

    tp = user.teacher_profile
    tp.user_username = anon_tag
    tp.status = TeacherStatus.suspended
    tp.bio = None
    tp.title = None
    tp.profile_photo_url = None
    tp.profile_photo_public_id = None
    tp.gallery = []
    tp.social_links = {}
    tp.certificates = []
    tp.skills = []

    if tp.video_public_id:
        delete_file(tp.video_public_id, resource_type="video")
    tp.video_url = None
    tp.video_public_id = None
    if tp.video_pending_public_id:
        delete_file(tp.video_pending_public_id, resource_type="video")
    tp.video_pending_url = None
    tp.video_pending_public_id = None

    for m in db.query(Material).filter(Material.teacher_id == tp.id).all():
        if m.file_public_id:
            kind = m.file_type if m.file_type in ("image", "video") else "raw"
            delete_file(m.file_public_id, resource_type=kind)
        m.file_url = None
        m.file_public_id = None
        m.is_active = False

    db.query(Package).filter(Package.teacher_id == tp.id).update({"is_active": False}, synchronize_session=False)
    db.query(Withdrawal).filter(Withdrawal.teacher_id == tp.id).update(
        {"destination_details": None}, synchronize_session=False
    )

    token = db.query(GoogleCalendarToken).filter(GoogleCalendarToken.teacher_id == tp.id).first()
    if token:
        from app.core.google_calendar import revoke_token
        try:
            revoke_token(token.access_token)
        except Exception:
            logger.warning("No se pudo revocar el token de Google del profesor %s", tp.id)
        db.delete(token)


@router.delete("/me")
def delete_account(
    data: DeleteAccountRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Elimina la cuenta del usuario.

    No es un hard-delete en cascada: los pagos, clases y enrollments se
    conservan (contabilidad/auditoría), pero el usuario se ANONIMIZA por
    completo — nombre, foto, teléfono, nacionalidad y credenciales de
    login se borran, y el email/username/teléfono/google_id quedan
    liberados (dejan de ser únicos) para que la persona pueda registrarse
    de nuevo con el mismo correo si quiere. La cuenta además se desactiva
    (is_active=False) para que ninguna sesión existente siga funcionando.
    """
    from app.core.timezone import utc_now

    # SEC-06: re-autenticacion + confirmacion explicita + sin compromisos pendientes.
    if data.confirm_username.strip().lower() != (current_user.username or "").lower():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El nombre de usuario de confirmación no coincide")
    if current_user.password_hash:
        if not data.password or not verify_password(data.password, current_user.password_hash):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "La contraseña es incorrecta")
    blockers = _account_deletion_blockers(current_user, db)
    if blockers:
        raise HTTPException(status.HTTP_409_CONFLICT, " ".join(blockers))

    anon_tag = f"deleted_{current_user.id}_{int(utc_now().timestamp())}"

    if current_user.student_profile and current_user.student_profile.profile_photo_public_id:
        delete_file(current_user.student_profile.profile_photo_public_id)
    if current_user.teacher_profile and current_user.teacher_profile.profile_photo_public_id:
        delete_file(current_user.teacher_profile.profile_photo_public_id)

    current_user.email = f"{anon_tag}@deleted.local"
    current_user.username = anon_tag
    current_user.name = "Usuario"
    current_user.surname = "eliminado"
    current_user.avatar = None
    current_user.phone_number = None
    current_user.nationality = None
    current_user.google_id = None
    current_user.password_hash = None
    current_user.is_active = False
    current_user.is_verified = False
    from app.auth.session import revoke_all_sessions
    revoke_all_sessions(db, current_user.id)

    if current_user.student_profile:
        current_user.student_profile.user_username = anon_tag
        current_user.student_profile.profile_photo_url = None
        current_user.student_profile.profile_photo_public_id = None

    if current_user.student_profile:
        # Los datos de destino de reembolsos son datos de pago personales: se borran (el pago y su importe se conservan).
        db.query(Payment).filter(
            Payment.student_id == current_user.student_profile.id,
            Payment.refund_payment_info.isnot(None),
        ).update({"refund_payment_info": None}, synchronize_session=False)

    if current_user.teacher_profile:
        _retire_teacher_profile(current_user, anon_tag, db)

    db.commit()
    # Corta ya sus websockets de chat abiertos (como en el baneo).
    from app.core.chat_ws import chat_manager
    background_tasks.add_task(chat_manager.close_user, current_user.id)

    return {
        "message": "Tu cuenta fue eliminada. Se borraron tus datos personales, tu foto y tus datos de "
                   "cobro o reembolso, y podrás registrarte de nuevo con el mismo correo si quieres; "
                   "el historial de pagos y clases se conserva anonimizado por motivos contables."
    }


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
@limiter.limit("20/hour", key_func=user_or_ip_key)  # cada subida va a Cloudinary
def upload_avatar_post(
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Sube o reemplaza la foto de perfil (POST /me/avatar)."""
    return _process_and_update_user_avatar(file, current_user, db)


@router.patch("/me/avatar")
@limiter.limit("20/hour", key_func=user_or_ip_key)  # cada subida va a Cloudinary
def upload_avatar_patch(
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Actualiza la foto de perfil (PATCH /me/avatar)."""
    return _process_and_update_user_avatar(file, current_user, db)


@router.post("/me/photo")
@limiter.limit("20/hour", key_func=user_or_ip_key)  # cada subida va a Cloudinary
def upload_photo_post(
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Alias de compatibilidad para subir foto (POST /me/photo)."""
    return _process_and_update_user_avatar(file, current_user, db)


@router.patch("/me/photo")
@limiter.limit("20/hour", key_func=user_or_ip_key)  # cada subida va a Cloudinary
def upload_photo_patch(
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Alias de compatibilidad para actualizar foto (PATCH /me/photo)."""
    return _process_and_update_user_avatar(file, current_user, db)


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
    """
    Actualiza datos del perfil de estudiante (timezone, goal, etc.).
    Si cambia la zona horaria, se recalculan las preferencias de horario
    (StudentSchedulePreference) para preservar la hora LOCAL configurada
    por el estudiante — solo se recalcula el UTC equivalente. Ver
    core/schedule_recalc.py.
    """
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
    # Fase 27 (Z3): una zona explicitamente nula/vacia/invalida nunca se guarda (omitirla si vale).
    if "timezone" in data:
        tz_value = data["timezone"]
        if not isinstance(tz_value, str) or not tz_value.strip() or not validate_timezone(tz_value.strip()):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Zona horaria no válida"
            )
        data["timezone"] = tz_value.strip()
    old_timezone = profile.timezone
    new_timezone = data.get("timezone")

    for field, value in data.items():
        if field in allowed_fields:
            setattr(profile, field, value)

    if new_timezone and new_timezone != old_timezone:
        recalculate_student_preferences_timezone(
            student_id=profile.id,
            old_tz=old_timezone,
            new_tz=new_timezone,
            db=db,
        )

    db.commit()
    db.refresh(profile)

    return StudentProfileResponse.model_validate(profile).model_dump()


@router.post("/me/preferences", response_model=List[PreferenceSlotResponse])
def set_schedule_preferences(
    data: SetPreferencesRequest,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    """
    El estudiante configura sus horas preferidas.
    Reemplaza todas las preferencias anteriores.
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
            start_utc, utc_day_of_week = convert_local_time_to_utc(
                slot.start_time_local, data.timezone, slot.day_of_week
            )
            end_utc, _ = convert_local_time_to_utc(
                slot.end_time_local, data.timezone, slot.day_of_week
            )
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e)
            )

        pref = StudentSchedulePreference(
            student_id=student_id,
            day_of_week=utc_day_of_week,
            local_day_of_week=slot.day_of_week,
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
    """Devuelve las preferencias de horario del estudiante en UTC para que el frontend las adapte"""
    student_profile = current_user.student_profile
    if not student_profile:
        return []

    return db.query(StudentSchedulePreference).filter(
        StudentSchedulePreference.student_id == student_profile.id
    ).order_by(
        StudentSchedulePreference.day_of_week,
        StudentSchedulePreference.start_time_utc
    ).all()


@router.put("/me/preferences", response_model=List[PreferenceSlotResponse])
def update_schedule_preferences(
    data: SetPreferencesRequest,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    """
    Actualiza (reemplaza) las preferencias de horario del estudiante vía PUT.
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
            start_utc, utc_day_of_week = convert_local_time_to_utc(
                slot.start_time_local, data.timezone, slot.day_of_week
            )
            end_utc, _ = convert_local_time_to_utc(
                slot.end_time_local, data.timezone, slot.day_of_week
            )
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e)
            )

        pref = StudentSchedulePreference(
            student_id=student_id,
            day_of_week=utc_day_of_week,
            local_day_of_week=slot.day_of_week,
            start_time_utc=start_utc,
            end_time_utc=end_utc,
        )
        db.add(pref)
        new_prefs.append(pref)

    db.commit()
    for pref in new_prefs:
        db.refresh(pref)

    return new_prefs

@router.get("/me/teachers")
def get_my_teachers(
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    """
    Profesores vinculados al estudiante, cada uno con su relación
    independiente (stage de reserva propio, enrollment activo si existe).
    En single-tenant siempre devuelve solo al featured teacher, para que
    el frontend use la misma forma de respuesta en ambos modos.
    """

    config = get_platform_config(db)
    student_id = current_user.student_profile.id

    if config and config.is_single_tenant:
        # Misma resolución que la reserva (BD o FEATURED_TEACHER_USERNAME del entorno).
        from app.core.platform_config import resolve_featured_teacher
        featured = resolve_featured_teacher(db, config)
        teacher_ids = [featured.id] if featured else []
    else:
        links = db.query(StudentTeacherLink).filter(
            StudentTeacherLink.student_id == student_id
        ).all()
        teacher_ids = [l.teacher_id for l in links]

    result = []
    for tid in teacher_ids:
        # joinedload: nombre y apellido salen de teacher.user; sin esto, una consulta más por profesor (Fase 14, E9).
        teacher = db.query(TeacherProfile).options(joinedload(TeacherProfile.user)).filter(TeacherProfile.id == tid).first()
        if not teacher:
            continue
        # GET: no debe escribir (heal=False); el barrido diario limpia los enrollments sin pagar.
        stage = get_student_booking_stage(student_id, tid, db, heal=False)
        active_enrollment = db.query(Enrollment).options(joinedload(Enrollment.package)).filter(
            Enrollment.student_id == student_id,
            Enrollment.teacher_id == tid,
            Enrollment.status.in_([EnrollmentStatus.active, EnrollmentStatus.pending_package_change]),
        ).first()
        if stage == "needs_package":
            active_enrollment = None  # el enrollment sin pagar ya esta "liberado" aunque aun no se haya cancelado

        # Profesor suspendido/rechazado mientras el estudiante sigue
        # vinculado a él (o incluso con paquete activo): sus créditos
        # quedan "congelados" (no puede agendar, ver el bloqueo en
        # POST /payments/book) y se le ofrece pedir reembolso.
        is_frozen = teacher.status != TeacherStatus.approved and active_enrollment is not None
        refund_pending = False
        if is_frozen:
            refund_pending = db.query(Payment).filter(
                Payment.enrollment_id == active_enrollment.id,
                Payment.status == "pending_review",
                Payment.payment_type == "refund",
            ).first() is not None

        result.append({
            "teacher_username": teacher.user_username,
            "name": teacher.user.name if teacher.user else None,
            "surname": teacher.user.surname if teacher.user else None,
            "title": teacher.title,
            "profile_photo_url": teacher.profile_photo_url,
            "theme_color": teacher.theme_color,
            "stage": stage,
            "status": teacher.status,
            "is_frozen": is_frozen,
            "refund_pending": refund_pending,
            "active_enrollment": {
                "id": active_enrollment.id,
                "package_name": active_enrollment.package.name if active_enrollment.package else None,
                "classes_used": active_enrollment.classes_used,
                "classes_total": active_enrollment.classes_total,
                "status": active_enrollment.status,
            } if active_enrollment else None,
        })

    return result


@router.post("/me/teachers/{teacher_username}")
def link_teacher(
    teacher_username: str,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    """
    Vincula al estudiante con un profesor adicional (solo multi-tenant).
    Idempotente — si el vínculo ya existe, no falla.
    """
    from app.models.payment_config import PlatformConfig
    from app.models.student_teacher_link import StudentTeacherLink

    config = get_platform_config(db)
    if not config or config.is_single_tenant:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La plataforma está en modo single-tenant; no aplica elegir profesor."
        )

    teacher = db.query(TeacherProfile).filter(
        TeacherProfile.user_username == teacher_username,
        TeacherProfile.status == TeacherStatus.approved
    ).first()
    if not teacher:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profesor no encontrado o no disponible")

    profile = current_user.student_profile
    from app.core.teacher_students import ensure_student_teacher_link
    # Tolera la carrera con otra petición (restricción única): nunca 500.
    if ensure_student_teacher_link(db, profile.id, teacher.id):
        db.commit()
        link_student_to_teacher(db, profile, teacher, old_teacher_username=None)

    return {"message": "Profesor añadido correctamente", "teacher_username": teacher_username}


@router.delete("/me/teachers/{teacher_username}")
def unlink_teacher(
    teacher_username: str,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    """
    Termina la relación con un profesor (solo multi-tenant). Bloqueado
    si hay un enrollment activo o cualquier solicitud pendiente
    (renovación o cambio de paquete) con ese profesor.
    """
    from app.models.payment_config import PlatformConfig
    from app.models.student_teacher_link import StudentTeacherLink
    from app.models.package import Enrollment, EnrollmentStatus

    config = get_platform_config(db)
    if not config or config.is_single_tenant:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La plataforma está en modo single-tenant; no aplica terminar relación."
        )

    teacher = db.query(TeacherProfile).filter(
        TeacherProfile.user_username == teacher_username
    ).first()
    if not teacher:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profesor no encontrado")

    profile = current_user.student_profile

    blocking_enrollment = db.query(Enrollment).filter(
        Enrollment.student_id == profile.id,
        Enrollment.teacher_id == teacher.id,
        Enrollment.status.in_([
            EnrollmentStatus.active,
            EnrollmentStatus.pending_renewal,
            EnrollmentStatus.pending_package_change,
        ]),
    ).first()

    if blocking_enrollment:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No puedes terminar la relación mientras tengas un paquete activo o "
                   "una solicitud pendiente con este profesor."
        )

    link = db.query(StudentTeacherLink).filter(
        StudentTeacherLink.student_id == profile.id,
        StudentTeacherLink.teacher_id == teacher.id,
    ).first()
    if link:
        db.delete(link)

    if teacher.students and profile.id in teacher.students:
        teacher.students = [sid for sid in teacher.students if sid != profile.id]

    db.commit()

    return {"message": "Relación terminada correctamente"}