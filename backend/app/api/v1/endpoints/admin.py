from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.core.phone import normalize_phone
from sqlalchemy import func
from typing import List, Optional
from datetime import datetime, timedelta
from app.schemas.admin import AdminUserUpdate, BanStudentRequest
from app.db.base import get_db
from app.auth.dependencies import get_current_user, get_current_staff
from app.models.user import User, UserRole
from app.models.teacher import TeacherProfile, TeacherStatus
from app.models.student import StudentProfile
from app.models.class_ import Class
from app.models.payment import Payment, Withdrawal
from app.models.package import Enrollment, EnrollmentStatus
from app.models.teacher_appeal import TeacherAppeal
from app.models.notification import Notification
from app.core.email import send_teacher_status_update_email
from app.core.timezone import utc_now, UTC
from app.core.notifications import create_notification, get_unread_count
from app.models.student_teacher_link import StudentTeacherLink
from app.core.teacher_students import link_student_to_teacher
from app.schemas.admin import (
    PlatformStatsResponse,
    TeacherAdminResponse,
    UpdateTeacherStatusRequest,
    UpdateCommissionRequest,
    UserAdminResponse,
    UpdateUserStatusRequest,
)
from app.schemas.notifications import (
    NotificationResponse,
    UnreadCountResponse,
    ResolveAppealRequest,
    TeacherAppealResponse,
    TeacherAppealWithTeacherResponse,
)
from app.models.payment_config import PlatformConfig


router = APIRouter()


# ─── SCHEMAS LOCALES ────────────────────────────────────────────────────────

class PlatformConfigUpdate(BaseModel):
    platform_name: Optional[str] = None
    platform_tagline: Optional[str] = None
    is_single_tenant: Optional[bool] = None
    featured_teacher_username: Optional[str] = None


# ─── DEPENDENCIES ───────────────────────────────────────────────────────────

def require_superadmin(current_user: User = Depends(get_current_user)) -> User:
    """Verifica que el usuario sea superadmin"""
    if current_user.role != UserRole.superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Se requieren permisos de superadministrador"
        )
    return current_user


# ─── MÉTRICAS GLOBALES ───────────────────────────────────────────────────────

@router.get("/stats", response_model=PlatformStatsResponse)
def get_platform_stats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    KPIs globales de la plataforma.
    Todas las métricas en una sola llamada para el dashboard.
    """
    now = utc_now()
    week_ago = now - timedelta(days=7)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    # ─── Usuarios ───────────────────────────────────────────────────────────
    total_users = db.query(User).count()
    total_students = db.query(User).filter(
        User.role == UserRole.student
    ).count()
    total_teachers = db.query(User).filter(
        User.role == UserRole.teacher
    ).count()

    total_teachers_pending = db.query(TeacherProfile).filter(
        TeacherProfile.status == TeacherStatus.pending
    ).count()
    total_teachers_approved = db.query(TeacherProfile).filter(
        TeacherProfile.status == TeacherStatus.approved
    ).count()

    new_users_this_week = db.query(User).filter(
        User.created_at >= week_ago
    ).count()

    # ─── Clases ─────────────────────────────────────────────────────────────
    total_classes = db.query(Class).count()

    classes_this_month = db.query(Class).filter(
        Class.created_at >= month_start
    ).count()

    classes_completed = db.query(Class).filter(
        Class.status == "completed"
    ).count()

    classes_cancelled = db.query(Class).filter(
        Class.status == "cancelled"
    ).count()

    new_classes_this_week = db.query(Class).filter(
        Class.created_at >= week_ago
    ).count()

    # ─── Finanzas ────────────────────────────────────────────────────────────
    revenue_result = db.query(
        func.sum(Payment.amount_total)
    ).filter(
        Payment.status == "completed"
    ).scalar()
    total_revenue = float(revenue_result or 0)

    teacher_payments_result = db.query(
        func.sum(Payment.amount_teacher)
    ).filter(
        Payment.status == "completed"
    ).scalar()
    total_paid_to_teachers = float(teacher_payments_result or 0)

    platform_result = db.query(
        func.sum(Payment.amount_platform)
    ).filter(
        Payment.status == "completed"
    ).scalar()
    total_platform_earnings = float(platform_result or 0)

    pending_withdrawals_result = db.query(
        func.sum(Withdrawal.amount)
    ).filter(
        Withdrawal.status == "pending"
    ).scalar()
    pending_withdrawals = float(pending_withdrawals_result or 0)

    return PlatformStatsResponse(
        total_users=total_users,
        total_students=total_students,
        total_teachers=total_teachers,
        total_teachers_pending=total_teachers_pending,
        total_teachers_approved=total_teachers_approved,
        total_classes=total_classes,
        classes_this_month=classes_this_month,
        classes_completed=classes_completed,
        classes_cancelled=classes_cancelled,
        total_revenue=total_revenue,
        total_paid_to_teachers=total_paid_to_teachers,
        total_platform_earnings=total_platform_earnings,
        pending_withdrawals=pending_withdrawals,
        new_users_this_week=new_users_this_week,
        new_classes_this_week=new_classes_this_week,
    )


# ─── GESTIÓN DE PROFESORES ───────────────────────────────────────────────────

@router.get(
    "/teachers",
    response_model=List[TeacherAdminResponse]
)
def list_all_teachers(
    status_filter: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Lista todos los profesores con sus métricas.
    Filtrable por estado: pending, approved, rejected, suspended.
    """
    query = db.query(TeacherProfile)

    if status_filter:
        try:
            status_enum = TeacherStatus(status_filter)
            query = query.filter(TeacherProfile.status == status_enum)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Estado inválido: {status_filter}"
            )

    teachers = query.all()

    # Profesores con al menos una apelación "pending" — para el indicador
    # en la pestaña "Rechazados" del admin.
    pending_appeal_teacher_ids = {
        row[0] for row in db.query(TeacherAppeal.teacher_id).filter(
            TeacherAppeal.status == "pending"
        ).distinct().all()
    }

    result = []

    for teacher in teachers:
        total_classes = db.query(Class).filter(
            Class.teacher_id == teacher.id
        ).count()

        total_students = db.query(Enrollment).filter(
            Enrollment.teacher_id == teacher.id
        ).distinct(Enrollment.student_id).count()

        result.append(TeacherAdminResponse(
            id=teacher.id,
            user_id=teacher.user_id,
            username=teacher.user.username,
            name=teacher.user.name,
            surname=teacher.user.surname,
            email=teacher.user.email,
            status=teacher.status,
            commission_rate=teacher.commission_rate,
            balance=teacher.balance,
            total_classes=total_classes,
            total_students=total_students,
            created_at=teacher.created_at,
            video_url=teacher.video_url,
            theme_color=teacher.theme_color,
            profile_photo_url=teacher.profile_photo_url,
            phone_number=teacher.user.phone_number,
            nationality=teacher.nationality,
            rejection_reason=teacher.rejection_reason,
            appeal_count=teacher.appeal_count or 0,
            appeal_exhausted=teacher.appeal_exhausted or False,
            has_pending_appeal=teacher.id in pending_appeal_teacher_ids,
        ))

    return result


@router.get("/teachers/{teacher_id}", response_model=TeacherAdminResponse)
def get_teacher_detail(
    teacher_id: int,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """
    Detalle de un profesor para el modal de revisión: incluye video,
    motivo de rechazo y estado de apelaciones. Usado por /admin/teachers
    al abrir el modal de detalle.
    """
    teacher = db.query(TeacherProfile).filter(TeacherProfile.id == teacher_id).first()
    if not teacher:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profesor no encontrado")

    total_classes = db.query(Class).filter(Class.teacher_id == teacher.id).count()
    total_students = db.query(Enrollment).filter(
        Enrollment.teacher_id == teacher.id
    ).distinct(Enrollment.student_id).count()

    has_pending_appeal = db.query(TeacherAppeal).filter(
        TeacherAppeal.teacher_id == teacher.id,
        TeacherAppeal.status == "pending",
    ).first() is not None

    return TeacherAdminResponse(
        id=teacher.id,
        user_id=teacher.user_id,
        username=teacher.user.username,
        name=teacher.user.name,
        surname=teacher.user.surname,
        email=teacher.user.email,
        status=teacher.status,
        commission_rate=teacher.commission_rate,
        balance=teacher.balance,
        total_classes=total_classes,
        total_students=total_students,
        created_at=teacher.created_at,
        video_url=teacher.video_url,
        theme_color=teacher.theme_color,
        profile_photo_url=teacher.profile_photo_url,
        phone_number=teacher.user.phone_number,
        nationality=teacher.nationality,
        rejection_reason=teacher.rejection_reason,
        appeal_count=teacher.appeal_count or 0,
        appeal_exhausted=teacher.appeal_exhausted or False,
        has_pending_appeal=has_pending_appeal,
    )


@router.get(
    "/teachers/{teacher_id}/appeals",
    response_model=List[TeacherAppealResponse],
)
def get_teacher_appeals(
    teacher_id: int,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """Historial de apelaciones de un profesor, para el modal de detalle."""
    return db.query(TeacherAppeal).filter(
        TeacherAppeal.teacher_id == teacher_id
    ).order_by(TeacherAppeal.created_at.asc()).all()


@router.patch(
    "/teachers/{teacher_id}/status"
)
def update_teacher_status(
    teacher_id: int,
    data: UpdateTeacherStatusRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Aprueba, rechaza o suspende un profesor.
    Es el flujo principal de onboarding de nuevos profesores.
    """
    teacher = db.query(TeacherProfile).filter(
        TeacherProfile.id == teacher_id
    ).first()

    if not teacher:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profesor no encontrado"
        )

    try:
        new_status = TeacherStatus(data.status)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Estado inválido: {data.status}"
        )

    if new_status == TeacherStatus.approved and not teacher.video_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El profesor debe subir su video de presentación antes de poder ser aprobado"
        )

    old_status = teacher.status
    teacher.status = new_status

    if new_status == TeacherStatus.rejected:
        teacher.rejection_reason = data.reason
        teacher.rejection_feedback_seen = False
        # Nuevo rechazo → reinicia el contador de apelaciones de este ciclo
        teacher.appeal_count = 0
        teacher.appeal_exhausted = False
    elif new_status == TeacherStatus.approved:
        # Al aprobar, limpiamos cualquier rastro del ciclo de rechazo anterior
        teacher.rejection_reason = None
        teacher.rejection_feedback_seen = True
        teacher.appeal_count = 0
        teacher.appeal_exhausted = False

    db.commit()

    action_map = {
        TeacherStatus.approved: "aprobado",
        TeacherStatus.rejected: "rechazado",
        TeacherStatus.suspended: "suspendido",
        TeacherStatus.pending: "puesto en revisión",
    }

    if teacher.user:
        send_teacher_status_update_email(
            to_email=teacher.user.email, teacher_name=teacher.user.name,
            new_status=new_status, reason=data.reason,
        )

    return {
        "message": f"Profesor {action_map.get(new_status, 'actualizado')} correctamente",
        "teacher_id": teacher_id,
        "old_status": old_status,
        "new_status": new_status,
        "reason": data.reason
    }


@router.patch(
    "/teachers/{teacher_id}/commission"
)
def update_teacher_commission(
    teacher_id: int,
    data: UpdateCommissionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Actualiza la comisión de un profesor específico.
    Permite personalizar la comisión por profesor.
    """
    if not 0.0 <= data.commission_rate <= 1.0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La comisión debe estar entre 0.0 y 1.0"
        )

    teacher = db.query(TeacherProfile).filter(
        TeacherProfile.id == teacher_id
    ).first()

    if not teacher:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profesor no encontrado"
        )

    old_rate = teacher.commission_rate
    teacher.commission_rate = data.commission_rate
    db.commit()

    return {
        "message": "Comisión actualizada correctamente",
        "teacher_id": teacher_id,
        "old_commission": f"{old_rate * 100:.1f}%",
        "new_commission": f"{data.commission_rate * 100:.1f}%"
    }


# ─── APELACIONES DE PROFESORES (bandeja del admin) ──────────────────────────

@router.get(
    "/appeals",
    response_model=List[TeacherAppealWithTeacherResponse],
)
def list_appeals(
    status_filter: Optional[str] = Query(None, description="pending | approved | rejected"),
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """
    Bandeja global de apelaciones — usada en Visión Global y en la pestaña
    Rechazados de Profesores. Por defecto muestra todas; filtrable por status.
    """
    query = db.query(TeacherAppeal)
    if status_filter:
        query = query.filter(TeacherAppeal.status == status_filter)

    appeals = query.order_by(TeacherAppeal.created_at.desc()).all()

    result = []
    for a in appeals:
        teacher = a.teacher
        if not teacher or not teacher.user:
            continue
        result.append(TeacherAppealWithTeacherResponse(
            id=a.id,
            teacher_id=a.teacher_id,
            appeal_number=a.appeal_number,
            message=a.message,
            status=a.status,
            admin_response=a.admin_response,
            created_at=a.created_at,
            resolved_at=a.resolved_at,
            teacher_username=teacher.user.username,
            teacher_name=teacher.user.name,
            teacher_surname=teacher.user.surname,
            teacher_status=teacher.status,
        ))
    return result


@router.patch("/appeals/{appeal_id}/resolve")
def resolve_appeal(
    appeal_id: int,
    data: ResolveAppealRequest,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """
    Resuelve una apelación pendiente.
    - approve: el profesor vuelve a "approved" (perfil público).
    - reject: incrementa el conteo de apelaciones agotadas. Al llegar a 2,
      el perfil permanece "rejected" pero se marca appeal_exhausted=True,
      lo que habilita en el dashboard del profesor la opción de subir un
      nuevo video para reiniciar el ciclo completo de revisión.
    """
    appeal = db.query(TeacherAppeal).filter(
        TeacherAppeal.id == appeal_id,
        TeacherAppeal.status == "pending",
    ).first()
    if not appeal:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Apelación no encontrada o ya resuelta")

    teacher = db.query(TeacherProfile).filter(TeacherProfile.id == appeal.teacher_id).first()
    if not teacher:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profesor no encontrado")

    now = utc_now()
    appeal.admin_response = data.admin_response
    appeal.resolved_at = now
    appeal.resolved_by = current_user.id

    if data.action == "approve":
        appeal.status = "approved"
        teacher.status = TeacherStatus.approved
        teacher.rejection_reason = None
        teacher.rejection_feedback_seen = True
        teacher.appeal_count = 0
        teacher.appeal_exhausted = False
    else:
        appeal.status = "rejected"
        if (teacher.appeal_count or 0) >= 2:
            teacher.appeal_exhausted = True
        teacher.rejection_feedback_seen = False  # nueva retroalimentación por ver

    db.commit()

    if teacher.user:
        send_teacher_status_update_email(
            to_email=teacher.user.email,
            teacher_name=teacher.user.name,
            new_status=teacher.status,
            reason=data.admin_response or teacher.rejection_reason,
        )

    return {
        "message": "Apelación aprobada" if data.action == "approve" else "Apelación rechazada",
        "appeal_exhausted": teacher.appeal_exhausted,
    }


# ─── NOTIFICACIONES (panel de staff) ─────────────────────────────────────────

@router.get("/notifications", response_model=List[NotificationResponse])
def list_notifications(
    unread_only: bool = Query(False),
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    query = db.query(Notification).filter(Notification.recipient_role == "staff")
    if unread_only:
        query = query.filter(Notification.is_read == False)
    return query.order_by(Notification.created_at.desc()).limit(limit).all()


@router.get("/notifications/unread-count", response_model=UnreadCountResponse)
def unread_notification_count(
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    return UnreadCountResponse(unread_count=get_unread_count(db, "staff"))


@router.patch("/notifications/{notification_id}/read")
def mark_notification_read(
    notification_id: int,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    notif = db.query(Notification).filter(Notification.id == notification_id).first()
    if not notif:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notificación no encontrada")
    notif.is_read = True
    db.commit()
    return {"message": "Notificación marcada como leída"}


@router.post("/notifications/mark-all-read")
def mark_all_notifications_read(
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    db.query(Notification).filter(
        Notification.recipient_role == "staff",
        Notification.is_read == False,
    ).update({"is_read": True})
    db.commit()
    return {"message": "Todas las notificaciones marcadas como leídas"}


# ─── GESTIÓN DE USUARIOS ─────────────────────────────────────────────────────

@router.get(
    "/users",
    response_model=List[UserAdminResponse]
)
def list_all_users(
    role: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(None),
    is_banned: Optional[bool] = Query(None),
    search: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Lista todos los usuarios con filtros y paginación.
    Por defecto NO incluye baneados en /admin/students — ese listado usa
    is_banned=False explícitamente desde el frontend; este endpoint general
    deja el filtro abierto para la vista separada de baneados.
    """
    query = db.query(User)

    if role:
        try:
            role_enum = UserRole(role)
            query = query.filter(User.role == role_enum)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Rol inválido: {role}"
            )

    if is_active is not None:
        query = query.filter(User.is_active == is_active)

    if is_banned is not None:
        query = query.filter(User.is_banned == is_banned)

    if search:
        search_term = f"%{search}%"
        query = query.filter(
            User.name.ilike(search_term) |
            User.surname.ilike(search_term) |
            User.email.ilike(search_term) |
            User.username.ilike(search_term)
        )

    total = query.count()
    users = query.order_by(
        User.created_at.desc()
    ).offset(skip).limit(limit).all()

    return users


@router.patch(
    "/users/{user_id}/status"
)
def update_user_status(
    user_id: int,
    data: UpdateUserStatusRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Activa o desactiva un usuario (distinto de banear).
    No se puede desactivar a sí mismo ni a otro superadmin.
    """
    user = db.query(User).filter(User.id == user_id).first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuario no encontrado"
        )

    if user.id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No puedes desactivar tu propia cuenta"
        )

    if user.role == UserRole.superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No puedes modificar el estado de otro superadmin"
        )

    user.is_active = data.is_active
    db.commit()

    action = "activado" if data.is_active else "desactivado"
    return {
        "message": f"Usuario {action} correctamente",
        "user_id": user_id,
        "is_active": data.is_active,
        "reason": data.reason
    }


# ─── BANEO DE ESTUDIANTES ────────────────────────────────────────────────────

@router.post("/students/{user_id}/ban")
def ban_student(
    user_id: int,
    data: BanStudentRequest,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """
    Banea a un estudiante: lo desactiva, cancela sus enrollments activos y
    sus clases futuras/pendientes, y deja registrado el motivo. El email
    queda "quemado" por el unique constraint existente en users.email, así
    que no puede volver a registrarse con el mismo correo.
    """
    user = db.query(User).filter(User.id == user_id, User.role == UserRole.student).first()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Estudiante no encontrado")

    if user.is_banned:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Este estudiante ya está baneado")

    student_profile = user.student_profile
    now = utc_now()

    user.is_active = False
    user.is_banned = True
    user.ban_reason = data.reason
    user.banned_at = now

    if student_profile:
        # Cancelar enrollments activos / pendientes
        db.query(Enrollment).filter(
            Enrollment.student_id == student_profile.id,
            Enrollment.status.in_([
                EnrollmentStatus.active,
                EnrollmentStatus.pending_renewal,
                EnrollmentStatus.pending_package_change,
            ]),
        ).update({"status": EnrollmentStatus.cancelled}, synchronize_session=False)

        # Cancelar clases futuras/pendientes
        db.query(Class).filter(
            Class.student_id == student_profile.id,
            Class.status.in_(["pending", "pending_trial", "pending_payment", "confirmed"]),
        ).update({"status": "cancelled"}, synchronize_session=False)

    db.commit()

    return {"message": "Estudiante baneado correctamente", "user_id": user_id}


@router.post("/students/{user_id}/unban")
def unban_student(
    user_id: int,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """Revierte el baneo. No reactiva enrollments/clases canceladas automáticamente."""
    user = db.query(User).filter(User.id == user_id, User.role == UserRole.student).first()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Estudiante no encontrado")

    if not user.is_banned:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Este estudiante no está baneado")

    user.is_banned = False
    user.ban_reason = None
    user.banned_at = None
    user.is_active = True
    db.commit()

    return {"message": "Estudiante reactivado correctamente", "user_id": user_id}


@router.get("/students/{user_id}/detail")
def get_student_detail(
    user_id: int,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """
    Detalle completo de un estudiante para el desplegable en /admin/students:
    enrollments (paquetes) y materiales asignados, con nombre del profesor
    y del recurso. Usado bajo demanda al expandir la card.
    """
    from app.models.material import MaterialAssignment, Material

    user = db.query(User).filter(User.id == user_id, User.role == UserRole.student).first()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Estudiante no encontrado")

    student_profile = user.student_profile
    if not student_profile:
        return {
            "created_at": user.created_at,
            "goal": None,
            "timezone": None,
            "enrollments": [],
            "materials": [],
        }

    enrollments = db.query(Enrollment).filter(
        Enrollment.student_id == student_profile.id
    ).order_by(Enrollment.created_at.desc()).all()

    enrollment_list = []
    for e in enrollments:
        teacher_user = e.teacher.user if e.teacher and e.teacher.user else None
        enrollment_list.append({
            "id": e.id,
            "package_name": e.package.name if e.package else "N/A",
            "subject": e.package.subject if e.package else None,
            "teacher_name": f"{teacher_user.name} {teacher_user.surname}" if teacher_user else None,
            "classes_used": e.classes_used,
            "classes_total": e.classes_total,
            "status": e.status,
            "created_at": e.created_at,
        })

    material_assignments = db.query(MaterialAssignment).filter(
        MaterialAssignment.student_id == student_profile.id
    ).join(Material).all()

    materials_list = [
        {
            "id": ma.id,
            "title": ma.material.title,
            "category": ma.material.category,
            "progress": ma.progress,
            "assigned_at": ma.assigned_at,
        }
        for ma in material_assignments
    ]

    return {
        "created_at": user.created_at,
        "goal": student_profile.goal,
        "timezone": student_profile.timezone,
        "enrollments": enrollment_list,
        "materials": materials_list,
    }


# ─── CONFIGURACIÓN DE PLATAFORMA ─────────────────────────────────────────────

# ─── CONFIGURACIÓN DE PLATAFORMA ─────────────────────────────────────────────

@router.get("/platform-config")
def get_platform_config(db: Session = Depends(get_db)):
    """
    Configuración pública de la plataforma.
    Endpoint público — el frontend lo consulta al cargar.
    """
    config = db.query(PlatformConfig).first()

    if not config:
        config = PlatformConfig()
        db.add(config)
        db.commit()
        db.refresh(config)

    featured_teacher = None
    if config.featured_teacher_id:
        teacher = db.query(TeacherProfile).filter(
            TeacherProfile.id == config.featured_teacher_id
        ).first()
        if teacher:
            featured_teacher = {
                "username": teacher.user_username,
                "name": f"{teacher.user.name} {teacher.user.surname}",
                "title": teacher.title,
                "bio": teacher.bio,
                "avatar": teacher.user.avatar,
                "subjects": teacher.subjects,
            }

    return {
        "platform_name": config.platform_name,
        "platform_tagline": config.platform_tagline,
        "is_single_tenant": config.is_single_tenant,
        "featured_teacher": featured_teacher,
    }


@router.patch("/platform-config")
def update_platform_config(
    data: PlatformConfigUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """El superadmin configura el modo de la plataforma"""

    config = db.query(PlatformConfig).first()
    if not config:
        config = PlatformConfig()
        db.add(config)
        db.flush()

    was_single_tenant = config.is_single_tenant
    previous_featured_id = config.featured_teacher_id

    if data.featured_teacher_username:
        teacher = db.query(TeacherProfile).filter(
            TeacherProfile.user_username == data.featured_teacher_username
        ).first()
        if not teacher:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Profesor no encontrado"
            )
        config.featured_teacher_id = teacher.id
    elif data.featured_teacher_username == "":
        config.featured_teacher_id = None

    if data.platform_name is not None:
        config.platform_name = data.platform_name
    if data.platform_tagline is not None:
        config.platform_tagline = data.platform_tagline
    if data.is_single_tenant is not None:
        config.is_single_tenant = data.is_single_tenant

    switching_to_multi = (
        was_single_tenant
        and data.is_single_tenant is False
        and previous_featured_id is not None
    )
    if switching_to_multi:
        student_ids_with_history = {
            e.student_id for e in db.query(Enrollment).filter(
                Enrollment.teacher_id == previous_featured_id
            ).all()
        } | {
            c.student_id for c in db.query(Class).filter(
                Class.teacher_id == previous_featured_id
            ).all()
        }

        featured_teacher = db.query(TeacherProfile).filter(
            TeacherProfile.id == previous_featured_id
        ).first()

        for student_id in student_ids_with_history:
            existing_link = db.query(StudentTeacherLink).filter(
                StudentTeacherLink.student_id == student_id,
                StudentTeacherLink.teacher_id == previous_featured_id,
            ).first()
            if existing_link:
                continue

            db.add(StudentTeacherLink(
                student_id=student_id,
                teacher_id=previous_featured_id,
            ))

            if featured_teacher:
                student_profile = db.query(StudentProfile).filter(
                    StudentProfile.id == student_id
                ).first()
                if student_profile:
                    link_student_to_teacher(
                        db, student_profile, featured_teacher,
                        old_teacher_username=None,
                    )

    db.commit()
    return {"message": "Configuración actualizada"}

@router.patch("/users/{user_id}")
def admin_update_user(
    user_id: int,
    data: AdminUserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_superadmin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "Usuario no encontrado")

    if data.role is not None:
        user.role = data.role

    if data.is_active is not None:
        if user.id == current_user.id:
            raise HTTPException(400, "No puedes desactivar tu propia cuenta")
        if user.role == UserRole.superadmin:
            raise HTTPException(403, "No puedes modificar el estado de otro superadmin")
        user.is_active = data.is_active

    if data.phone_number is not None:
            normalized = normalize_phone(data.phone_number)
            if normalized and normalized != user.phone_number:
                existing = db.query(User).filter(
                    User.phone_number == normalized,
                    User.id != user.id
                ).first()
                if existing:
                    raise HTTPException(400, "Este número de teléfono ya está en uso por otro usuario")
            user.phone_number = normalized
            
    db.commit()
    return {"ok": True}