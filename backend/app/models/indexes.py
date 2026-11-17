"""
Indices de rendimiento (Fase 11).

PostgreSQL NO indexa las claves foraneas solas: sin estos indices cada consulta del tipo
"las clases de este profesor" o "los pagos de este alumno" recorre la tabla entera. Con pocos datos no se
nota; al crecer, cada consulta lenta consume horas de computo de la base.

Se declaran aqui (y no en cada modelo) para tener la lista completa en un solo sitio. La migracion
`b1d5e6f7a8c9_performance_indexes.py` crea exactamente los mismos; `tests/audit/test_performance_indexes.py`
comprueba que las dos listas coinciden.

Cada entrada: (nombre, tabla, columnas...).
"""
from sqlalchemy import Index

from app.db.base import Base

INDEX_SPECS: list[tuple] = [
    # Clases: agenda del profesor / del alumno, jobs por vencimiento (estado + fecha), pagos y enrollments.
    ("ix_classes_teacher_start", "classes", "teacher_id", "start_time_utc"),
    ("ix_classes_student_start", "classes", "student_id", "start_time_utc"),
    ("ix_classes_status_start", "classes", "status", "start_time_utc"),
    ("ix_classes_enrollment", "classes", "enrollment_id"),
    ("ix_classes_cohort", "classes", "cohort_id"),
    ("ix_class_participants_student", "class_participants", "student_id"),
    # Enrollments y paquetes
    ("ix_enrollments_student_status", "enrollments", "student_id", "status"),
    ("ix_enrollments_teacher_status", "enrollments", "teacher_id", "status"),
    ("ix_enrollments_cohort", "enrollments", "cohort_id"),
    ("ix_packages_teacher", "packages", "teacher_id"),
    # Dinero
    ("ix_payments_student", "payments", "student_id"),
    ("ix_payments_teacher_status", "payments", "teacher_id", "status"),
    ("ix_payments_status", "payments", "status"),
    ("ix_withdrawals_teacher_status", "withdrawals", "teacher_id", "status"),
    # Contenido del profesor y sus asignaciones
    ("ix_materials_teacher", "materials", "teacher_id"),
    ("ix_material_assignments_student", "material_assignments", "student_id"),
    ("ix_material_assignments_material", "material_assignments", "material_id"),
    ("ix_homework_teacher", "homework", "teacher_id"),
    ("ix_homework_assignments_student", "homework_assignments", "student_id"),
    ("ix_homework_assignments_homework", "homework_assignments", "homework_id"),
    ("ix_reviews_teacher", "reviews", "teacher_id"),
    ("ix_teacher_availability_teacher", "teacher_availability", "teacher_id"),
    ("ix_teacher_availability_exceptions_teacher", "teacher_availability_exceptions", "teacher_id"),
    # Avisos del staff: se piden los no leidos, los mas nuevos primero
    ("ix_notifications_unread", "notifications", "is_read", "created_at"),
    # Cada peticion autenticada busca el perfil por user_id (current_user.student_profile / teacher_profile)
    ("ix_teacher_profiles_user", "teacher_profiles", "user_id"),
    ("ix_student_profiles_user", "student_profiles", "user_id"),
]


def _declare() -> None:
    for name, table, *cols in INDEX_SPECS:
        t = Base.metadata.tables[table]
        if any(ix.name == name for ix in t.indexes):
            continue
        Index(name, *(t.c[c] for c in cols))


_declare()
