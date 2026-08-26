"""group classes: cohorts, participants, package/enrollment fields

Revision ID: b4e6d1f9a2c3
Revises: a3f5c7d9e1b2
Create Date: 2026-08-26 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'b4e6d1f9a2c3'
down_revision = 'a3f5c7d9e1b2'
branch_labels = None
depends_on = None


cohort_status_enum = sa.Enum(
    "filling", "confirmed", "in_progress", "completed", "cancelled",
    name="cohortstatus",
)


def upgrade() -> None:
    # ── group_cohorts ────────────────────────────────────────────────
    # No se crea el enum explícitamente: create_table() ya lo genera
    # automáticamente al usar la columna Enum (evita el CREATE TYPE duplicado).
    op.create_table(
        "group_cohorts",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("package_id", sa.Integer(), sa.ForeignKey("packages.id"), nullable=False),
        sa.Column("teacher_id", sa.Integer(), sa.ForeignKey("teacher_profiles.id"), nullable=False),
        sa.Column("start_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", cohort_status_enum, nullable=False, server_default="filling"),
        sa.Column("min_students", sa.Integer(), nullable=False),
        sa.Column("max_students", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
    )

    # ── packages: soporte de clases grupales ────────────────────────
    op.add_column("packages", sa.Column("is_group", sa.Boolean(), nullable=True, server_default=sa.false()))
    op.add_column("packages", sa.Column("min_students", sa.Integer(), nullable=True))
    op.add_column("packages", sa.Column("max_students", sa.Integer(), nullable=True))

    # ── enrollments: vínculo a cohorte + saldo fraccional de migración ─
    op.add_column("enrollments", sa.Column("cohort_id", sa.Integer(), sa.ForeignKey("group_cohorts.id"), nullable=True))
    op.add_column("enrollments", sa.Column("credit_balance_usd", sa.Float(), nullable=True))

    # ── classes: student_id pasa a nullable + cohort_id ─────────────
    op.alter_column("classes", "student_id", existing_type=sa.Integer(), nullable=True)
    op.add_column("classes", sa.Column("cohort_id", sa.Integer(), sa.ForeignKey("group_cohorts.id"), nullable=True))

    # ClassType gana el valor "group" (enum ya existente en Postgres)
    op.execute("ALTER TYPE classtype ADD VALUE IF NOT EXISTS 'group'")

    # ── class_participants ───────────────────────────────────────────
    op.create_table(
        "class_participants",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("class_id", sa.Integer(), sa.ForeignKey("classes.id"), nullable=False),
        sa.Column("student_id", sa.Integer(), sa.ForeignKey("student_profiles.id"), nullable=False),
        sa.Column("enrollment_id", sa.Integer(), sa.ForeignKey("enrollments.id"), nullable=False),
        sa.Column("attendance_status", sa.String(), nullable=True, server_default="confirmed"),
        sa.UniqueConstraint("class_id", "student_id", name="uq_class_participant"),
    )


def downgrade() -> None:
    op.drop_table("class_participants")

    op.drop_column("classes", "cohort_id")
    # Nota: revertir student_id a NOT NULL fallará si ya existen clases
    # grupales con student_id NULL. Solo es seguro en un downgrade
    # inmediato, antes de usar la funcionalidad en producción.
    op.alter_column("classes", "student_id", existing_type=sa.Integer(), nullable=False)

    op.drop_column("enrollments", "credit_balance_usd")
    op.drop_column("enrollments", "cohort_id")

    op.drop_column("packages", "max_students")
    op.drop_column("packages", "min_students")
    op.drop_column("packages", "is_group")

    op.drop_table("group_cohorts")
    cohort_status_enum.drop(op.get_bind(), checkfirst=True)

    # Nota: Postgres no permite quitar un valor de un enum existente
    # (ClassType.group) sin recrear el tipo por completo; se deja
    # intencionalmente fuera del downgrade automático.
