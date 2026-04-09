from sqlalchemy.orm import Session
from typing import Optional
from app.models.user import User
from app.models.class_ import Class
from app.models.homework import HomeworkAssignment
from app.models.package import Enrollment
from app.models.package import Package
from app.models.teacher import TeacherProfile
from app.core.timezone import utc_now
from datetime import timedelta


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
    }


def get_teacher_data_for_chipi(user: User, db: Session) -> dict:
    """Recopila datos relevantes del profesor para el contexto de Chipi"""
    now = utc_now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)

    teacher_profile = user.teacher_profile
    if not teacher_profile:
        return {"name": user.name}

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

    return {
        "name": user.name,
        "timezone": teacher_profile.timezone or "UTC",
        "balance": teacher_profile.balance,
        "classes_today": classes_today,
        "pending_students": active_students,
        "teacher_status": teacher_profile.status,
    }