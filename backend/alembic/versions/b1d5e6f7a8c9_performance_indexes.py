"""Fase 11: indices de rendimiento en claves foraneas y columnas de filtro

Solo anade indices (retrocompatible: el codigo anterior sigue funcionando igual, solo mas lento).
`if_not_exists` hace la migracion idempotente por si algun indice se creo a mano antes.
En tablas muy grandes convendria CREATE INDEX CONCURRENTLY; con el volumen actual el bloqueo dura milisegundos.

Revision ID: b1d5e6f7a8c9
Revises: a9c4d5e6f7a8
Create Date: 2026-11-17 12:00:00.000000
"""
from alembic import op

revision = 'b1d5e6f7a8c9'
down_revision = 'a9c4d5e6f7a8'
branch_labels = None
depends_on = None

# Debe coincidir con app/models/indexes.py (INDEX_SPECS); lo comprueba tests/audit/test_performance_indexes.py.
INDEXES = [
    ("ix_classes_teacher_start", "classes", ["teacher_id", "start_time_utc"]),
    ("ix_classes_student_start", "classes", ["student_id", "start_time_utc"]),
    ("ix_classes_status_start", "classes", ["status", "start_time_utc"]),
    ("ix_classes_enrollment", "classes", ["enrollment_id"]),
    ("ix_classes_cohort", "classes", ["cohort_id"]),
    ("ix_class_participants_student", "class_participants", ["student_id"]),
    ("ix_enrollments_student_status", "enrollments", ["student_id", "status"]),
    ("ix_enrollments_teacher_status", "enrollments", ["teacher_id", "status"]),
    ("ix_enrollments_cohort", "enrollments", ["cohort_id"]),
    ("ix_packages_teacher", "packages", ["teacher_id"]),
    ("ix_payments_student", "payments", ["student_id"]),
    ("ix_payments_teacher_status", "payments", ["teacher_id", "status"]),
    ("ix_payments_status", "payments", ["status"]),
    ("ix_withdrawals_teacher_status", "withdrawals", ["teacher_id", "status"]),
    ("ix_materials_teacher", "materials", ["teacher_id"]),
    ("ix_material_assignments_student", "material_assignments", ["student_id"]),
    ("ix_material_assignments_material", "material_assignments", ["material_id"]),
    ("ix_homework_teacher", "homework", ["teacher_id"]),
    ("ix_homework_assignments_student", "homework_assignments", ["student_id"]),
    ("ix_homework_assignments_homework", "homework_assignments", ["homework_id"]),
    ("ix_reviews_teacher", "reviews", ["teacher_id"]),
    ("ix_teacher_availability_teacher", "teacher_availability", ["teacher_id"]),
    ("ix_teacher_availability_exceptions_teacher", "teacher_availability_exceptions", ["teacher_id"]),
    ("ix_notifications_unread", "notifications", ["is_read", "created_at"]),
    ("ix_teacher_profiles_user", "teacher_profiles", ["user_id"]),
    ("ix_student_profiles_user", "student_profiles", ["user_id"]),
]


def upgrade() -> None:
    for name, table, cols in INDEXES:
        op.create_index(name, table, cols, if_not_exists=True)


def downgrade() -> None:
    for name, table, _cols in reversed(INDEXES):
        op.drop_index(name, table_name=table, if_exists=True)
