from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, status, Query
from app.core.pagination import Pagination, paginate
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session, joinedload
from app.core.phone import normalize_phone
from sqlalchemy import func, or_ as sa_or
from typing import List, Optional
from datetime import timedelta
from app.schemas.admin import AdminUserUpdate, BanStudentRequest
from app.db.base import get_db
from app.auth.dependencies import get_current_staff, require_superadmin
from app.models.user import User, UserRole
from app.models.teacher import TeacherProfile, TeacherStatus
from app.models.student import StudentProfile
from app.models.class_ import Class
from app.models.payment import Payment, Withdrawal, TeacherWallet
from app.models.package import Enrollment, EnrollmentStatus
from app.models.teacher_appeal import TeacherAppeal
from app.models.notification import Notification
from app.models.support_ticket import SupportCategory, SupportTicket, SupportTicketStatus
from app.core.email import send_teacher_status_update_email, send_support_ticket_response_email, send_teacher_video_review_email
from app.core.storage import delete_file
from app.core.chat_ws import chat_manager
from app.core.timezone import utc_now
from app.core.notifications import create_notification, get_unread_count
from app.core.teacher_students import backfill_student_teacher_links
from app.core.platform_config import resolve_featured_teacher
from app.schemas.admin import (
    PlatformStatsResponse,
    TeacherAdminResponse,
    UpdateTeacherStatusRequest,
    UpdateCommissionRequest,
    UserAdminResponse,
    PaginatedUsersResponse,
    UpdateUserStatusRequest,
)
from app.schemas.notifications import (
    NotificationResponse,
    UnreadCountResponse,
    ResolveAppealRequest,
    TeacherAppealResponse,
    TeacherAppealWithTeacherResponse,
)
from app.schemas.support import (
    ResolveSupportTicketRequest,
    SupportTicketWithUserResponse,
)
from app.models.payment_config import PlatformConfig
from app.core.platform_config import get_or_create_platform_config, resolve_featured_teacher, serialize_platform_config
from app.api.v1.endpoints.public import invalidate_landing_cache
from app.core.chat import invalidate_chat_settings
# Fase 14, E9: una lectura por petición. Con alias: el endpoint GET /admin/platform-config de este módulo
# también se llama get_platform_config y taparía el import (el PATCH recibía el dict del endpoint).
from app.core.platform_config import get_platform_config as load_platform_config


def _get_teacher_wallet_balance(teacher_id: int, db: Session) -> float:
    """
    Corrección QA: TeacherProfile.balance es un campo legacy que nunca se
    actualiza en ningún flujo (pagos, retiros, etc.) — el saldo real vive
    en TeacherWallet.available_balance, que sí se mantiene al día con cada
    pago validado. El listado/detalle de profesores en el panel de
    superadmin debe reflejar ese saldo real, no el campo muerto.
    Si el profesor todavía no tiene wallet creado (nunca cobró nada), el
    saldo disponible es 0.0.
    """
    wallet = db.query(TeacherWallet).filter(TeacherWallet.teacher_id == teacher_id).first()
    return wallet.available_balance if wallet else 0.0


router = APIRouter()


# ─── SCHEMAS LOCALES ────────────────────────────────────────────────────────

class PlatformConfigUpdate(BaseModel):
    platform_name: Optional[str] = None
    platform_tagline: Optional[str] = None
    is_single_tenant: Optional[bool] = None
    featured_teacher_username: Optional[str] = None
    show_teacher_whatsapp: Optional[bool] = None
    # N2: toggle del chat interno + su configuración de retención/reactivación.
    chat_enabled: Optional[bool] = None
    chat_retention_days: Optional[int] = None
    chat_reactivation_hours: Optional[int] = None
    # Mini-CMS del landing (N3). El admin siempre manda el objeto completo
    # (todas las claves de LANDING_CONTENT_DEFAULTS) — se guarda tal cual,
    # se completa contra los defaults recién al leer (ver get_landing_content).
    landing_content: Optional[dict] = None


# ─── DEPENDENCIES ───────────────────────────────────────────────────────────



# ─── MÉTRICAS GLOBALES ───────────────────────────────────────────────────────

@router.get("/stats", response_model=PlatformStatsResponse)
def get_platform_stats(
    current_user: User = Depends(get_current_staff),
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
    # BUG-01 fix: el ciclo de vida real de Payment.status es
    # pending_review -> approved | rejected. "completed" nunca existió,
    # por lo que estas métricas siempre daban 0.
    # Fase 20 (M10): ingresos = lo cobrado de verdad: sin reembolsos (dinero que sale) ni otorgamientos manuales ($0 / cortesias).
    revenue_result = db.query(
        func.sum(Payment.amount_total)
    ).filter(
        Payment.status == "approved",
        sa_or(Payment.payment_type.is_(None), Payment.payment_type != "refund"),
        Payment.is_manual_grant.isnot(True),
    ).scalar()
    total_revenue = float(revenue_result or 0)

    teacher_payments_result = db.query(
        func.sum(Payment.amount_teacher)
    ).filter(
        Payment.status == "approved"
    ).scalar()
    total_paid_to_teachers = float(teacher_payments_result or 0)

    platform_result = db.query(
        func.sum(Payment.amount_platform)
    ).filter(
        Payment.status == "approved"
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
    response: Response,
    page: Pagination = Depends(),
    status_filter: Optional[str] = Query(None),
    has_video: Optional[bool] = Query(None, description="true = solo los que ya subieron el video de presentación"),
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db)
):
    """
    Lista todos los profesores con sus métricas.
    Filtrable por estado: pending, approved, rejected, suspended, y por
    has_video (Fase 14, E6: antes ese filtro se hacía en el navegador
    sobre la lista completa).
    """
    query = db.query(TeacherProfile)

    if has_video is True:
        query = query.filter(TeacherProfile.video_url.isnot(None), TeacherProfile.video_url != "")
    elif has_video is False:
        query = query.filter((TeacherProfile.video_url.is_(None)) | (TeacherProfile.video_url == ""))

    if status_filter:
        try:
            status_enum = TeacherStatus(status_filter)
            query = query.filter(TeacherProfile.status == status_enum)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Estado inválido: {status_filter}"
            )

    teachers = paginate(query.order_by(TeacherProfile.id), page, response).options(joinedload(TeacherProfile.user)).all()

    # Metricas en lote (antes: 3 consultas por profesor).
    teacher_ids = [t.id for t in teachers]
    classes_by_teacher: dict[int, int] = {}
    students_by_teacher: dict[int, int] = {}
    wallet_by_teacher: dict[int, float] = {}
    if teacher_ids:
        classes_by_teacher = dict(
            db.query(Class.teacher_id, func.count(Class.id))
            .filter(Class.teacher_id.in_(teacher_ids)).group_by(Class.teacher_id).all()
        )
        students_by_teacher = dict(
            db.query(Enrollment.teacher_id, func.count(func.distinct(Enrollment.student_id)))
            .filter(Enrollment.teacher_id.in_(teacher_ids)).group_by(Enrollment.teacher_id).all()
        )
        wallet_by_teacher = dict(
            db.query(TeacherWallet.teacher_id, TeacherWallet.available_balance)
            .filter(TeacherWallet.teacher_id.in_(teacher_ids)).all()
        )

    # Profesores con al menos una apelación "pending" — para el indicador
    # en la pestaña "Rechazados" del admin.
    pending_appeal_teacher_ids = {
        row[0] for row in db.query(TeacherAppeal.teacher_id).filter(
            TeacherAppeal.status == "pending"
        ).distinct().all()
    }

    result = []

    for teacher in teachers:
        total_classes = classes_by_teacher.get(teacher.id, 0)
        total_students = students_by_teacher.get(teacher.id, 0)

        result.append(TeacherAdminResponse(
            id=teacher.id,
            user_id=teacher.user_id,
            username=teacher.user.username,
            name=teacher.user.name,
            surname=teacher.user.surname,
            email=teacher.user.email,
            status=teacher.status,
            commission_rate=teacher.commission_rate,
            balance=wallet_by_teacher.get(teacher.id, 0.0),
            total_classes=total_classes,
            total_students=total_students,
            created_at=teacher.created_at,
            video_url=teacher.video_url,
            video_pending_url=teacher.video_pending_url,
            video_pending_rejection_reason=teacher.video_pending_rejection_reason,
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
        balance=_get_teacher_wallet_balance(teacher.id, db),
        total_classes=total_classes,
        total_students=total_students,
        created_at=teacher.created_at,
        video_url=teacher.video_url,
            video_pending_url=teacher.video_pending_url,
            video_pending_rejection_reason=teacher.video_pending_rejection_reason,
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
    current_user: User = Depends(get_current_staff),
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
    invalidate_landing_cache()

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


class RejectPendingVideoRequest(BaseModel):
    reason: str

    @field_validator("reason")
    @classmethod
    def _reason(cls, v):
        v = (v or "").strip()
        if not v or len(v) > 500:
            raise ValueError("El motivo es obligatorio (máx. 500 caracteres)")
        return v


def _promote_pending_video(teacher: TeacherProfile) -> Optional[str]:
    """Pasa el video pendiente a publico y limpia rechazo/apelacion. Devuelve el public_id viejo a borrar."""
    old_public_id = teacher.video_public_id
    teacher.video_url = teacher.video_pending_url
    teacher.video_public_id = teacher.video_pending_public_id
    teacher.video_pending_url = None
    teacher.video_pending_public_id = None
    teacher.video_pending_rejection_reason = None
    teacher.video_pending_appeal_used = False
    return None if old_public_id == teacher.video_public_id else old_public_id


def _drop_pending_video(teacher: TeacherProfile) -> Optional[str]:
    """Descarta el video pendiente. Devuelve su public_id para borrarlo de Cloudinary tras el commit."""
    pending_public_id = teacher.video_pending_public_id
    teacher.video_pending_url = None
    teacher.video_pending_public_id = None
    teacher.video_pending_rejection_reason = None
    teacher.video_pending_appeal_used = False
    return pending_public_id


def _delete_cloud_video(public_id: Optional[str]) -> None:
    if public_id:
        try:
            delete_file(public_id, resource_type="video")
        except Exception:
            pass


@router.patch(
    "/teachers/{teacher_id}/pending-video/approve"
)
def approve_teacher_pending_video(
    teacher_id: int,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """Fase 23: promueve el video pendiente a video publico y borra el anterior de Cloudinary."""
    teacher = _pending_video_teacher_or_error(teacher_id, current_user, db)
    to_delete = _promote_pending_video(teacher)
    create_notification(
        db, type="teacher_video_review", title="Video aprobado",
        message="Tu video nuevo fue aprobado y ya es visible en tu perfil.",
        related_teacher_id=teacher.id, recipient_role="teacher", recipient_user_id=teacher.user_id,
    )
    db.commit()
    _delete_cloud_video(to_delete)
    invalidate_landing_cache()
    if teacher.user:
        send_teacher_video_review_email(teacher.user.email, teacher.user.name, approved=True)
    return {"message": "Video aprobado", "teacher_id": teacher_id, "video_url": teacher.video_url}


@router.patch(
    "/teachers/{teacher_id}/pending-video/reject"
)
def reject_teacher_pending_video(
    teacher_id: int,
    data: RejectPendingVideoRequest,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """Fase 23: rechaza el video pendiente (con motivo). El profesor conserva el video anterior y puede apelar
    una vez; el archivo pendiente se conserva hasta resolver la apelacion o hasta que suba otro video."""
    teacher = _pending_video_teacher_or_error(teacher_id, current_user, db)
    teacher.video_pending_rejection_reason = data.reason
    teacher.video_pending_appeal_used = False
    create_notification(
        db, type="teacher_video_review", title="Video rechazado",
        message=f"Tu video nuevo fue rechazado. Motivo: {data.reason}. Tu video anterior sigue visible; puedes apelar o subir otro.",
        related_teacher_id=teacher.id, recipient_role="teacher", recipient_user_id=teacher.user_id,
    )
    db.commit()
    if teacher.user:
        send_teacher_video_review_email(teacher.user.email, teacher.user.name, approved=False, reason=data.reason)
    return {"message": "Video rechazado", "teacher_id": teacher_id}


def _pending_video_teacher_or_error(teacher_id: int, current_user: User, db: Session) -> TeacherProfile:
    teacher = db.query(TeacherProfile).filter(TeacherProfile.id == teacher_id).first()
    if not teacher:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profesor no encontrado")
    # Separacion de funciones: un teacher_admin no aprueba/rechaza su propio video.
    if current_user.role == UserRole.teacher_admin and teacher.user_id == current_user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No puedes revisar tu propio video; lo hace otro miembro del staff")
    if not teacher.video_pending_url:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El profesor no tiene un video pendiente de revisión")
    if teacher.video_pending_rejection_reason:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Este video ya fue rechazado; solo se resuelve por apelación o con un video nuevo")
    return teacher


@router.patch(
    "/teachers/{teacher_id}/commission"
)
def update_teacher_commission(
    teacher_id: int,
    data: UpdateCommissionRequest,
    current_user: User = Depends(get_current_staff),
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

    # Separación de funciones: un teacher_admin no fija su propia comisión.
    if current_user.role == UserRole.teacher_admin:
        own = current_user.teacher_profile
        if own and own.id == teacher.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No puedes cambiar tu propia comisión; la fija el superadmin"
            )

    old_rate = teacher.commission_rate if teacher.commission_rate is not None else 0.15
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
            kind=a.kind or "profile",
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

    # Separacion de funciones: un teacher_admin no resuelve apelaciones sobre su propio perfil.
    if current_user.role == UserRole.teacher_admin and teacher.user_id == current_user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No puedes resolver una apelación sobre tu propio perfil")

    now = utc_now()
    appeal.admin_response = data.admin_response
    appeal.resolved_at = now
    appeal.resolved_by = current_user.id

    if appeal.kind == "video":
        approved = data.action == "approve"
        appeal.status = "approved" if approved else "rejected"
        to_delete = None
        if teacher.video_pending_url:
            to_delete = _promote_pending_video(teacher) if approved else _drop_pending_video(teacher)
        create_notification(
            db, type="teacher_video_review",
            title="Apelación de video aprobada" if approved else "Apelación de video rechazada",
            message=("Tu video nuevo fue aprobado y ya es visible en tu perfil." if approved
                     else "Tu apelación fue rechazada; se descartó el video nuevo y conservas el anterior."),
            related_teacher_id=teacher.id, recipient_role="teacher", recipient_user_id=teacher.user_id,
        )
        db.commit()
        _delete_cloud_video(to_delete)
        if approved:
            invalidate_landing_cache()
        if teacher.user:
            send_teacher_video_review_email(teacher.user.email, teacher.user.name, approved=approved,
                                            reason=data.admin_response)
        return {
            "message": "Apelación aprobada" if approved else "Apelación rechazada",
            "appeal_exhausted": False,
        }

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


# ─── TICKETS DE SOPORTE (bandeja del admin) ─────────────────────────────────
# Bugs, errores o dudas que un student/teacher reportó porque Chipi no pudo
# resolverlas. Flujo simple tipo apelación: 1 mensaje → 1 respuesta que cierra
# el ticket. Accesible tanto a superadmin como a teacher_admin (get_current_staff).

@router.get(
    "/support-tickets",
    response_model=List[SupportTicketWithUserResponse],
)
def list_support_tickets(
    response: Response,
    page: Pagination = Depends(),
    status_filter: Optional[str] = Query(None, description="pending | answered"),
    category_filter: Optional[str] = Query(None, description="bug | error | question | other"),
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """Bandeja global de tickets de soporte, filtrable por estado y categoría."""
    query = db.query(SupportTicket).options(joinedload(SupportTicket.user))
    if status_filter:
        query = query.filter(SupportTicket.status == status_filter)
    if category_filter:
        query = query.filter(SupportTicket.category == category_filter)

    tickets = paginate(query.order_by(SupportTicket.created_at.desc()), page, response).all()

    result = []
    for t in tickets:
        user = t.user
        if not user:
            continue
        result.append(SupportTicketWithUserResponse(
            id=t.id,
            category=t.category.value if hasattr(t.category, "value") else t.category,
            subject=t.subject,
            message=t.message,
            screen_context=t.screen_context,
            status=t.status.value if hasattr(t.status, "value") else t.status,
            admin_response=t.admin_response,
            created_at=t.created_at,
            resolved_at=t.resolved_at,
            user_notified_seen=t.user_notified_seen or False,
            class_id=t.class_id, requested_status=t.requested_status, decision=t.decision,
            user_id=user.id,
            user_name=user.name,
            user_surname=user.surname,
            user_username=user.username,
            user_email=user.email,
            user_role=user.role.value if hasattr(user.role, "value") else user.role,
        ))
    return result


def _apply_class_correction(ticket: SupportTicket, db: Session) -> None:
    """Aplica una correccion aprobada. No hace commit (lo hace el caller)."""
    from app.core.class_logic import cancel_class_and_refund, sync_student_lifetime_class_counter
    from app.models.class_ import Class

    class_ = db.query(Class).filter(Class.id == ticket.class_id).first()
    if not class_ or class_.status != "no_show":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "La clase ya no esta en no_show: no se puede aplicar la correccion. Rechaza el ticket.",
        )
    if ticket.requested_status == "completed":
        # no_show y completed consumen el credito por igual: el contador del paquete no cambia.
        sync_student_lifetime_class_counter(class_, "no_show", "completed", db=db)
        class_.status = "completed"
    elif ticket.requested_status == "cancelled":
        cancel_class_and_refund(class_, db, apply_late_cancel_penalty=False)  # devuelve el credito
    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Estado solicitado invalido")


@router.patch("/support-tickets/{ticket_id}/resolve", response_model=SupportTicketWithUserResponse)
def resolve_support_ticket(
    ticket_id: int,
    data: ResolveSupportTicketRequest,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """
    Responde y cierra un ticket pendiente. Notifica al usuario por email y
    reactiva el aviso in-app (user_notified_seen=False) en su bandeja.
    """
    ticket = db.query(SupportTicket).filter(
        SupportTicket.id == ticket_id,
        SupportTicket.status == SupportTicketStatus.pending,
    ).first()
    if not ticket:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ticket no encontrado o ya respondido")

    user = ticket.user
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuario del ticket no encontrado")

    if ticket.category == SupportCategory.class_correction:
        # NEG-02: solo el superadmin aprueba/rechaza; al aprobar se aplica el cambio.
        if current_user.role != UserRole.superadmin:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo el superadmin resuelve correcciones de clase")
        if data.decision is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Indica la decision: approved o rejected")
        if data.decision == "approved":
            _apply_class_correction(ticket, db)
        ticket.decision = data.decision
    elif data.decision is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La decision solo aplica a correcciones de clase")

    ticket.admin_response = data.admin_response
    ticket.status = SupportTicketStatus.answered
    ticket.resolved_at = utc_now()
    ticket.resolved_by = current_user.id
    ticket.user_notified_seen = False

    db.commit()
    db.refresh(ticket)

    portal_path = "/teacher/support" if user.role in (UserRole.teacher, UserRole.teacher_admin) else "/dashboard/support"
    send_support_ticket_response_email(
        to_email=user.email,
        user_name=user.name,
        subject=ticket.subject,
        admin_response=ticket.admin_response,
        portal_path=portal_path,
    )

    return SupportTicketWithUserResponse(
        id=ticket.id,
        category=ticket.category.value if hasattr(ticket.category, "value") else ticket.category,
        subject=ticket.subject,
        message=ticket.message,
        screen_context=ticket.screen_context,
        status=ticket.status.value if hasattr(ticket.status, "value") else ticket.status,
        admin_response=ticket.admin_response,
        created_at=ticket.created_at,
        resolved_at=ticket.resolved_at,
        user_notified_seen=ticket.user_notified_seen or False,
        class_id=ticket.class_id, requested_status=ticket.requested_status, decision=ticket.decision,
        user_id=user.id,
        user_name=user.name,
        user_surname=user.surname,
        user_username=user.username,
        user_email=user.email,
        user_role=user.role.value if hasattr(user.role, "value") else user.role,
    )


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
    # N1: solo las del panel de staff; los avisos dirigidos a un usuario (recipient_user_id) no son suyos.
    notif = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.recipient_role == "staff",
        Notification.recipient_user_id.is_(None),
    ).first()
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
    response_model=PaginatedUsersResponse
)
def list_all_users(
    role: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(None),
    is_banned: Optional[bool] = Query(None),
    search: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_staff),
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
    active_count = total if is_active is True else (
        0 if is_active is False else query.filter(User.is_active.is_(True)).count()
    )
    users = query.order_by(
        User.created_at.desc()
    ).offset(skip).limit(limit).all()

    # BUG-10 fix: antes 'total' se calculaba y se descartaba (el
    # response_model era una lista plana). Ahora se envuelve la respuesta
    # para que el frontend pueda paginar de verdad en vez de truncar
    # silenciosamente en 'limit'.
    return {"total": total, "active_count": active_count, "users": users}


@router.patch(
    "/users/{user_id}/status"
)
def update_user_status(
    user_id: int,
    data: UpdateUserStatusRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_staff),
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
    if not data.is_active:
        background_tasks.add_task(chat_manager.close_user, user.id)  # corta sus websockets de chat ya

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
    background_tasks: BackgroundTasks,
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
    # Corta ya sus websockets de chat (una tarea async corre en el event loop tras responder).
    background_tasks.add_task(chat_manager.close_user, user.id)

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
            "total_completed_classes": 0,
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
        # Contador de por vida (no ligado a un enrollment/paquete concreto):
        # sobrevive a renovaciones, cambios de paquete y cuenta también
        # clases grupales — ver app.core.class_logic.
        "total_completed_classes": student_profile.total_completed_classes,
    }


# ─── CONFIGURACIÓN DE PLATAFORMA ─────────────────────────────────────────────

# ─── CONFIGURACIÓN DE PLATAFORMA ─────────────────────────────────────────────

@router.get("/platform-config")
def get_platform_config(db: Session = Depends(get_db)):
    """
    Configuración pública de la plataforma.
    Endpoint público — el frontend lo consulta al cargar.
    """
    config = get_or_create_platform_config(db)
    return serialize_platform_config(db, config)


_LIVE_ENROLLMENT_STATUSES = [
    EnrollmentStatus.active,
    EnrollmentStatus.pending_renewal,
    EnrollmentStatus.pending_package_change,
]
_FUTURE_CLASS_STATUSES = ["pending", "pending_trial", "pending_payment", "confirmed"]


def _students_outside_featured(db: Session, featured_id: int) -> list:
    """Alumnos con enrollment vivo o clase futura con un profesor distinto de `featured_id` (pre-check multi->single)."""
    now = utc_now()
    pairs = set()
    for sid, tid in db.query(Enrollment.student_id, Enrollment.teacher_id).filter(
        Enrollment.teacher_id != featured_id,
        Enrollment.status.in_(_LIVE_ENROLLMENT_STATUSES),
    ).distinct().all():
        pairs.add((sid, tid))
    for sid, tid in db.query(Class.student_id, Class.teacher_id).filter(
        Class.student_id.isnot(None),
        Class.teacher_id != featured_id,
        Class.start_time_utc > now,
        Class.status.in_(_FUTURE_CLASS_STATUSES),
    ).distinct().all():
        pairs.add((sid, tid))
    students = sorted({sid for sid, _ in pairs})
    names = {}
    if students:
        names = {sp.id: sp.user_username for sp in db.query(StudentProfile).filter(StudentProfile.id.in_(students)).all()}
    teacher_ids = {tid for _, tid in pairs}
    tnames = {}
    if teacher_ids:
        tnames = {t.id: t.user_username for t in db.query(TeacherProfile).filter(TeacherProfile.id.in_(teacher_ids)).all()}
    by_student = {}
    for sid, tid in sorted(pairs):
        by_student.setdefault(sid, []).append(tnames.get(tid))
    return [{"student_username": names.get(sid), "teachers": by_student[sid]} for sid in students]


@router.get("/platform-config/single-blockers")
def single_tenant_blockers(
    featured_teacher_username: Optional[str] = None,
    current_user: User = Depends(require_superadmin),
    db: Session = Depends(get_db),
):
    """¿Se puede activar single-tenant (o cambiar la destacada) con esa profesora? Es la misma comprobación que
    hace el PATCH, para que el panel bloquee la opción antes de intentarlo.

    Sin `featured_teacher_username` usa la destacada guardada (o la del entorno). Sin ninguna, no hay nada que
    comprobar: `blocked` es False y `target` None (el PATCH rechazará single sin destacada por su cuenta).
    """
    if featured_teacher_username:
        target = db.query(TeacherProfile).filter(TeacherProfile.user_username == featured_teacher_username).first()
        if not target:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profesor no encontrado")
    else:
        target = resolve_featured_teacher(db, load_platform_config(db))
    if target is None:
        return {"blocked": False, "target": None, "affected_students": 0, "sample": []}
    affected = _students_outside_featured(db, target.id)
    return {
        "blocked": bool(affected),
        "target": target.user_username,
        "affected_students": len(affected),
        "sample": affected[:10],
    }


@router.patch("/platform-config")
def update_platform_config(
    data: PlatformConfigUpdate,
    current_user: User = Depends(require_superadmin),
    db: Session = Depends(get_db)
):
    """El superadmin (o teacher_admin, como staff) configura el modo de la plataforma"""

    config = load_platform_config(db)
    if not config:
        config = PlatformConfig()
        db.add(config)
        db.flush()
    else:
        # Bloquea la fila: dos PATCH concurrentes (o un backfill a medias) se serializan.
        db.query(PlatformConfig).filter(PlatformConfig.id == config.id).with_for_update().populate_existing().first()

    was_single_tenant = config.is_single_tenant
    # La destacada que estaba en uso, resuelta igual que al reservar (BD o FEATURED_TEACHER_USERNAME): si venía
    # del entorno, featured_teacher_id es NULL y antes nadie quedaba vinculado al pasar a multi.
    previous_featured = resolve_featured_teacher(db, config) if was_single_tenant else None
    previous_featured_id = previous_featured.id if previous_featured else None

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
    if data.show_teacher_whatsapp is not None:
        config.show_teacher_whatsapp = data.show_teacher_whatsapp
    if data.chat_enabled is not None:
        config.chat_enabled = data.chat_enabled
    if data.chat_retention_days is not None:
        if data.chat_retention_days < 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Los días de retención no pueden ser negativos",
            )
        config.chat_retention_days = data.chat_retention_days
    if data.chat_reactivation_hours is not None:
        if data.chat_reactivation_hours < 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Las horas de reactivación no pueden ser negativas",
            )
        config.chat_reactivation_hours = data.chat_reactivation_hours
    if data.landing_content is not None:
        config.landing_content = data.landing_content

    new_single = config.is_single_tenant
    if data.is_single_tenant is True:
        featured_now = resolve_featured_teacher(db, config)
        if featured_now is None:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No se puede activar el modo single-tenant sin una profesora destacada "
                       "(featured_teacher_username o FEATURED_TEACHER_USERNAME).",
            )
    if new_single:
        # Bloqueo (sin force): entrar en single, o cambiar la destacada dentro de single, no se permite mientras
        # haya alumnos con paquete vivo o clase futura con profesores distintos de la nueva destacada. Cuando ya no
        # quede ninguno, la opción se vuelve a habilitar sola.
        featured_target = resolve_featured_teacher(db, config)
        if featured_target is not None and (not was_single_tenant or featured_target.id != previous_featured_id):
            affected = _students_outside_featured(db, featured_target.id)
            if affected:
                db.rollback()
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "message": "No se puede activar single-tenant ni cambiar la destacada: hay alumnos con "
                                   "paquetes vivos o clases futuras con otros profesores. Cuando terminen o se "
                                   "resuelvan, la opción se habilita de nuevo.",
                        "affected_students": len(affected),
                        "sample": affected[:10],
                    },
                )

    if data.is_single_tenant is False and not new_single:
        # Atómico: links + teacher.students + conversaciones en ESTA misma transacción que el cambio de modo.
        # Corre siempre que se pida multi (no solo al venir de single), así un reintento tras un fallo repara.
        backfill_student_teacher_links(db, commit=False)

    db.commit()
    invalidate_landing_cache()
    invalidate_chat_settings()  # el chat cachea 30 s si está activo y las horas de reactivación
    return {"message": "Configuración actualizada"}

@router.patch("/users/{user_id}")
def admin_update_user(
    user_id: int,
    data: AdminUserUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_staff),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "Usuario no encontrado")

    # Staff edita datos de usuarios, pero solo el superadmin cambia roles
    # (promover a teacher_admin da poderes de staff).
    if data.role is not None and data.role != user.role and current_user.role != UserRole.superadmin:
        raise HTTPException(403, "Solo el superadmin puede cambiar roles")

    # BUG-08 (parte 2) fix: el cambio de rol vía este endpoint está pensado
    # únicamente para alternar entre 'teacher' y 'teacher_admin' (staff que
    # opera como profesor). El cambio de rol entre 'student'/'teacher' queda
    # prohibido: no existe migración de StudentProfile/TeacherProfile, y un
    # usuario con el rol equivocado para su perfil rompe cualquier endpoint
    # que dependa de current_user.teacher_profile/student_profile.
    # (Nota: la parte 1 de BUG-08 —el orden de evaluación entre 'role' e
    # 'is_active' al proteger a otro superadmin— se deja tal cual, sin
    # control adicional, por decisión explícita de producto.)
    VALID_ROLE_TRANSITIONS = {
        UserRole.teacher: {UserRole.teacher_admin},
        UserRole.teacher_admin: {UserRole.teacher},
    }
    if data.role is not None and data.role != user.role:
        if data.role not in VALID_ROLE_TRANSITIONS.get(user.role, set()):
            raise HTTPException(
                400,
                "Solo se permite alternar el rol entre 'teacher' y 'teacher_admin'. "
                "El cambio de rol entre student/teacher no está soportado."
            )
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
    if data.is_active is False:
        background_tasks.add_task(chat_manager.close_user, user.id)  # corta sus websockets de chat ya
    return {"ok": True}

# ─── CONTROL DE CORREOS (Fase 7) ─────────────────────────────────────────────

class EmailSettingsUpdate(BaseModel):
    notifications: Optional[dict[str, bool]] = None
    daily_limit: Optional[int] = None
    auto_saver_enabled: Optional[bool] = None
    auto_saver_percent: Optional[int] = None


def _serialize_email_settings(db: Session) -> dict:
    from app.core import email_settings as es

    cfg = get_or_create_platform_config(db)
    usage = es.usage_today(db)
    sent = sum(u.get("sent", 0) for u in usage.values())
    limit = es.get_limit(cfg)
    emails_by_category: dict[str, list[str]] = {}
    for fn, cat in es.EMAIL_CATEGORY.items():
        emails_by_category.setdefault(cat, []).append(fn)

    categories = []
    for key, meta in es.CATEGORIES.items():
        u = usage.get(key, {})
        categories.append({
            "key": key,
            "label": meta["label"],
            "probability": meta["probability"],
            "essential": meta["essential"],
            "enabled": es.is_category_enabled(cfg, key),
            "sent_today": u.get("sent", 0),
            "skipped_today": u.get("skipped", 0),
            "failed_today": u.get("failed", 0),
            "emails": sorted(emails_by_category.get(key, [])),
        })
    skipped = sum(u.get("skipped", 0) for u in usage.values())
    failed = sum(u.get("failed", 0) for u in usage.values())
    return {
        "categories": categories,
        "sent_today": sent,
        "daily_limit": limit,
        "auto_saver_enabled": bool(cfg.email_auto_saver_enabled),
        "auto_saver_percent": es.get_saver_percent(cfg),
        "auto_saver_active": es.saver_active(cfg, sent),
        "skipped_today": skipped,
        "failed_today": failed,
        # Banner del panel: hoy se omitieron o fallaron correos
        "alert": bool(skipped or failed),
    }


@router.get("/email-settings")
def get_email_settings(
    current_user: User = Depends(require_superadmin),
    db: Session = Depends(get_db),
):
    """Interruptores por categoria, uso de hoy contra la cuota y estado del modo ahorro. Solo superadmin."""
    return _serialize_email_settings(db)


@router.put("/email-settings")
def update_email_settings(
    data: EmailSettingsUpdate,
    current_user: User = Depends(require_superadmin),
    db: Session = Depends(get_db),
):
    """
    Actualiza interruptores, limite diario y modo ahorro. Solo superadmin.
    Las categorias esenciales no se pueden apagar (422); una categoria desconocida tambien es 422.
    """
    from app.core import email_settings as es

    if data.notifications is not None:
        for key, enabled in data.notifications.items():
            meta = es.CATEGORIES.get(key)
            if meta is None:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Categoría desconocida: {key}")
            if meta["essential"] and enabled is False:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Los correos esenciales no se pueden apagar")
    if data.daily_limit is not None and not (1 <= data.daily_limit <= 1_000_000):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "El límite diario debe estar entre 1 y 1.000.000")
    if data.auto_saver_percent is not None and not (1 <= data.auto_saver_percent <= 100):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "El porcentaje del modo ahorro debe estar entre 1 y 100")

    cfg = get_or_create_platform_config(db)
    if data.notifications is not None:
        merged = dict(cfg.email_notifications or {})
        merged.update({k: v for k, v in data.notifications.items() if not es.CATEGORIES[k]["essential"]})
        cfg.email_notifications = merged  # reasignar: JSONB no detecta mutaciones in situ
    if data.daily_limit is not None:
        cfg.email_daily_limit = data.daily_limit
    if data.auto_saver_enabled is not None:
        cfg.email_auto_saver_enabled = data.auto_saver_enabled
    if data.auto_saver_percent is not None:
        cfg.email_auto_saver_percent = data.auto_saver_percent
    db.commit()
    return _serialize_email_settings(db)
