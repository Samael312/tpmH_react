from sqlalchemy.orm import Session
from typing import Optional
from app.models.user import User
from app.models.class_ import Class
from app.models.homework import HomeworkAssignment
from app.models.package import Enrollment
from app.models.package import Package
from app.models.teacher import TeacherProfile
from app.models.payment import Payment, TeacherWallet, Withdrawal
from app.models.group_cohort import GroupCohort, CohortStatus
from app.models.support_ticket import SupportTicket, SupportTicketStatus
from app.core.platform_config import get_or_create_platform_config
from app.core.timezone import utc_now
from datetime import timedelta


def get_platform_context_for_chipi(db: Session) -> dict:
    """
    Datos de configuración global de la plataforma (modo single/multi-tenant,
    nombre, profesor destacado). Se agrega SIEMPRE al prompt, sin importar
    el rol, porque cambia cómo Chipi debe explicar la home y los planes.
    """
    config = get_or_create_platform_config(db)
    featured_teacher_name = None
    if config.is_single_tenant and config.featured_teacher_id:
        teacher = db.query(TeacherProfile).filter(
            TeacherProfile.id == config.featured_teacher_id
        ).first()
        if teacher and teacher.user:
            featured_teacher_name = f"{teacher.user.name} {teacher.user.surname}"

    return {
        "platform_name": config.platform_name,
        "is_single_tenant": bool(config.is_single_tenant),
        "featured_teacher_name": featured_teacher_name,
    }


def _open_support_tickets_count(user_id: int, db: Session) -> int:
    return db.query(SupportTicket).filter(
        SupportTicket.user_id == user_id,
        SupportTicket.status == SupportTicketStatus.pending,
    ).count()


def get_student_data_for_chipi(user: User, db: Session) -> dict:
    """
    Recopila datos relevantes del estudiante para el contexto de Chipi.
    Solo datos que Chipi realmente necesita — no sobrecargar el prompt.
    """
    now = utc_now()
    student_id = user.student_profile.id if user.student_profile else None

    if not student_id:
        return {"name": user.name}

    # Clases próximas
    upcoming_classes = db.query(Class).filter(
        Class.student_id == student_id,
        Class.start_time_utc >= now,
        Class.status.in_(["pending", "confirmed"])
    ).count()

    # Tareas pendientes
    pending_homework = db.query(HomeworkAssignment).filter(
        HomeworkAssignment.student_id == student_id,
        HomeworkAssignment.status == "pending"
    ).count()

    # Enrollment activo
    enrollment = db.query(Enrollment).filter(
        Enrollment.student_id == student_id,
        Enrollment.status == "active"
    ).first()

    enrollment_data = None
    if enrollment:
        package = db.query(Package).filter(
            Package.id == enrollment.package_id
        ).first()
        enrollment_data = {
            "package_name": package.name if package else "Desconocido",
            "classes_used": enrollment.classes_used,
            "classes_total": enrollment.classes_total,
        }

    return {
        "name": user.name,
        "timezone": user.student_profile.timezone or "UTC",
        "upcoming_classes": upcoming_classes,
        "pending_homework": pending_homework,
        "enrollment_status": enrollment_data,
        "open_tickets": _open_support_tickets_count(user.id, db),
    }


def get_teacher_data_for_chipi(user: User, db: Session, is_admin: bool = False) -> dict:
    """
    Recopila datos relevantes del profesor para el contexto de Chipi.
    Se usa tanto para role="teacher" como para role="teacher_admin"
    (mismo tipo de datos — un teacher_admin es, ante todo, un profesor).
    `is_admin` solo agrega la bandera para que el prompt sepa que
    además tiene permisos de staff (Modo Dios / tickets) sobre sí mismo.
    """
    now = utc_now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)

    teacher_profile = user.teacher_profile
    if not teacher_profile:
        return {"name": user.name, "is_admin": is_admin}

    # Clases de hoy
    classes_today = db.query(Class).filter(
        Class.teacher_id == teacher_profile.id,
        Class.start_time_utc >= today_start,
        Class.start_time_utc < today_end,
        Class.status.in_(["pending", "confirmed"])
    ).count()

    # Estudiantes activos
    active_students = db.query(Enrollment).filter(
        Enrollment.teacher_id == teacher_profile.id,
        Enrollment.status == "active"
    ).count()

    # Billetera real (available_balance/total_earned de TeacherWallet, no
    # el campo legacy TeacherProfile.balance)
    wallet = db.query(TeacherWallet).filter(
        TeacherWallet.teacher_id == teacher_profile.id
    ).first()
    available_balance = wallet.available_balance if wallet else teacher_profile.balance
    total_earned = wallet.total_earned if wallet else None

    # Retiros pendientes de procesar
    pending_withdrawals = db.query(Withdrawal).filter(
        Withdrawal.teacher_id == teacher_profile.id,
        Withdrawal.status.in_(["pending", "processing"]),
    ).count()

    # Pagos de sus estudiantes esperando validación
    pending_payments = db.query(Payment).filter(
        Payment.teacher_id == teacher_profile.id,
        Payment.status == "pending_review",
    ).count()

    # Cohortes de clases grupales abiertas/en curso
    open_cohorts = db.query(GroupCohort).filter(
        GroupCohort.teacher_id == teacher_profile.id,
        GroupCohort.status.in_([CohortStatus.filling, CohortStatus.confirmed, CohortStatus.in_progress]),
    ).count()

    return {
        "name": user.name,
        "timezone": teacher_profile.timezone or "UTC",
        "balance": available_balance,
        "total_earned": total_earned,
        "classes_today": classes_today,
        "pending_students": active_students,
        "teacher_status": teacher_profile.status,
        "pending_withdrawals": pending_withdrawals,
        "pending_payments_to_review": pending_payments,
        "open_cohorts": open_cohorts,
        "open_tickets": _open_support_tickets_count(user.id, db),
        "is_admin": is_admin,
    }


def get_staff_data_for_chipi(user: User, db: Session) -> dict:
    """
    Datos ligeros para superadmin (vista global de la plataforma, no de un
    profesor en particular). Se mantiene deliberadamente liviano — el staff
    ya conoce el panel de administración, Chipi solo da un resumen rápido.
    """
    pending_payments = db.query(Payment).filter(
        Payment.status == "pending_review"
    ).count()
    pending_withdrawals = db.query(Withdrawal).filter(
        Withdrawal.status.in_(["pending", "processing"])
    ).count()
    pending_teachers = db.query(TeacherProfile).filter(
        TeacherProfile.status == "pending"
    ).count()
    open_tickets = db.query(SupportTicket).filter(
        SupportTicket.status == SupportTicketStatus.pending
    ).count()

    return {
        "name": user.name,
        "pending_payments_platform": pending_payments,
        "pending_withdrawals_platform": pending_withdrawals,
        "pending_teachers_platform": pending_teachers,
        "open_tickets_platform": open_tickets,
    }