from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from datetime import datetime, timedelta

from app.db.base import get_db
from app.auth.dependencies import get_currtent_user
from app.models.user import User, UserRole
from app.models.teacher import TeacherProfile, TeacherStatus
from app.models.student import StudentProfile
from app.models.class_ import Class
from app.models.payment import Payment, Withdrawal
from app.models.package import Enrollment
from app.core.timezone import utc_now, UTC
from app.schemas.admin import (
    PlatformStatsResponse,
    TeacherAdminResponse,
    UpdateTeacherStatusRequest,
    UpdateCommissionRequest,
    UserAdminResponse,
    UpdateUserStatusRequest,
)
from app.models.payment_config import PlatformConfig


router = APIRouter()


# ─── MÉTRICAS GLOBALES ───────────────────────────────────────────────────────

@router.get("/stats", response_model=PlatformStatsResponse)
def get_platform_stats(
    current_user: User = Depends(get_currtent_user),
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
    # Total revenue: suma de todos los pagos completados
    revenue_result = db.query(
        func.sum(Payment.amount_total)
    ).filter(
        Payment.status == "completed"
    ).scalar()
    total_revenue = float(revenue_result or 0)

    # Total pagado a profesores
    teacher_payments_result = db.query(
        func.sum(Payment.amount_teacher)
    ).filter(
        Payment.status == "completed"
    ).scalar()
    total_paid_to_teachers = float(teacher_payments_result or 0)

    # Ganancias de la plataforma (comisiones)
    platform_result = db.query(
        func.sum(Payment.amount_platform)
    ).filter(
        Payment.status == "completed"
    ).scalar()
    total_platform_earnings = float(platform_result or 0)

    # Retiros pendientes
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
    current_user: User = Depends(get_currtent_user),
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
    result = []

    for teacher in teachers:
        # Métricas por profesor
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
        ))

    return result


@router.patch(
    "/teachers/{teacher_id}/status"
)
def update_teacher_status(
    teacher_id: int,
    data: UpdateTeacherStatusRequest,
    current_user: User = Depends(get_currtent_user),
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

    old_status = teacher.status
    teacher.status = new_status
    db.commit()

    # Log del cambio para auditoría
    action_map = {
        TeacherStatus.approved: "aprobado",
        TeacherStatus.rejected: "rechazado",
        TeacherStatus.suspended: "suspendido",
        TeacherStatus.pending: "puesto en revisión",
    }

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
    current_user: User = Depends(get_currtent_user),
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


# ─── GESTIÓN DE USUARIOS ─────────────────────────────────────────────────────

@router.get(
    "/users",
    response_model=List[UserAdminResponse]
)
def list_all_users(
    role: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(None),
    search: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_currtent_user),
    db: Session = Depends(get_db)
):
    """
    Lista todos los usuarios con filtros y paginación.
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

    # Búsqueda por nombre, apellido, email o username
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
    current_user: User = Depends(get_currtent_user),
    db: Session = Depends(get_db)
):
    """
    Activa o desactiva un usuario.
    No se puede desactivar a sí mismo ni a otro superadmin.
    """
    user = db.query(User).filter(User.id == user_id).first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuario no encontrado"
        )

    # Protecciones
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


# ─── GESTIÓN DE RETIROS ──────────────────────────────────────────────────────

@router.get("/withdrawals/pending")
def get_pending_withdrawals(
    current_user: User = Depends(get_currtent_user),
    db: Session = Depends(get_db)
):
    """
    Lista todos los retiros pendientes de procesar.
    El superadmin los procesa manualmente hasta integrar Stripe Connect.
    """
    withdrawals = db.query(Withdrawal).filter(
        Withdrawal.status == "pending"
    ).order_by(Withdrawal.created_at.asc()).all()

    result = []
    for w in withdrawals:
        teacher = db.query(TeacherProfile).filter(
            TeacherProfile.id == w.teacher_id
        ).first()

        result.append({
            "id": w.id,
            "teacher_id": w.teacher_id,
            "teacher_username": teacher.user.username if teacher else "unknown",
            "teacher_name": f"{teacher.user.name} {teacher.user.surname}" if teacher else "unknown",
            "amount": w.amount,
            "created_at": w.created_at,
            "status": w.status,
        })

    return result


@router.patch("/withdrawals/{withdrawal_id}/process")
def process_withdrawal(
    withdrawal_id: int,
    current_user: User = Depends(get_currtent_user),
    db: Session = Depends(get_db)
):
    """
    Marca un retiro como procesado.
    Por ahora es manual. En Fase 3 se automatiza con Stripe Connect.
    """
    withdrawal = db.query(Withdrawal).filter(
        Withdrawal.id == withdrawal_id,
        Withdrawal.status == "pending"
    ).first()

    if not withdrawal:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Retiro no encontrado o ya procesado"
        )

    withdrawal.status = "completed"

    # Descontar del balance del profesor
    teacher = db.query(TeacherProfile).filter(
        TeacherProfile.id == withdrawal.teacher_id
    ).first()

    if teacher:
        teacher.balance = max(0, teacher.balance - withdrawal.amount)

    db.commit()

    return {
        "message": "Retiro procesado correctamente",
        "withdrawal_id": withdrawal_id,
        "amount": withdrawal.amount,
    }

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
    featured_teacher_username: Optional[str] = None,
    platform_name: Optional[str] = None,
    platform_tagline: Optional[str] = None,
    is_single_tenant: Optional[bool] = None,
    current_user: User = Depends(get_currtent_user),
    db: Session = Depends(get_db)
):
    """El superadmin configura el modo de la plataforma"""
    config = db.query(PlatformConfig).first()
    if not config:
        config = PlatformConfig()
        db.add(config)

    if featured_teacher_username:
        teacher = db.query(TeacherProfile).filter(
            TeacherProfile.user_username == featured_teacher_username
        ).first()
        if not teacher:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Profesor no encontrado"
            )
        config.featured_teacher_id = teacher.id

    if platform_name:
        config.platform_name = platform_name
    if platform_tagline:
        config.platform_tagline = platform_tagline
    if is_single_tenant is not None:
        config.is_single_tenant = is_single_tenant

    db.commit()
    return {"message": "Configuración actualizada"}