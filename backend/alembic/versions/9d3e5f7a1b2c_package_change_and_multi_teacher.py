"""package change requests and multi-teacher links

Revision ID: 9d3e5f7a1b2c
Revises: 8f1a2b3c4d5e
Create Date: 2026-08-07 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '9d3e5f7a1b2c'
down_revision: Union[str, Sequence[str], None] = '8f1a2b3c4d5e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── Nuevo valor del enum EnrollmentStatus ──
    # No se puede revertir en Postgres (ver downgrade), y no puede
    # usarse en la misma transacción en la que se agrega — no es
    # problema aquí porque esta migración solo la agrega.
    op.execute("ALTER TYPE enrollmentstatus ADD VALUE IF NOT EXISTS 'pending_package_change'")

    # ── Campo para guardar el paquete pedido al solicitar un cambio ──
    op.add_column(
        'enrollments',
        sa.Column('change_requested_package_id', sa.Integer(), nullable=True)
    )
    op.create_foreign_key(
        'fk_enrollments_change_requested_package',
        'enrollments', 'packages',
        ['change_requested_package_id'], ['id']
    )

    # ── Tabla de vínculos estudiante-profesor (multi-tenant) ──
    op.create_table(
        'student_teacher_links',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('student_id', sa.Integer(), nullable=False),
        sa.Column('teacher_id', sa.Integer(), nullable=False),
        sa.Column('linked_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['student_id'], ['student_profiles.id'], ),
        sa.ForeignKeyConstraint(['teacher_id'], ['teacher_profiles.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('student_id', 'teacher_id', name='uq_student_teacher_link'),
    )
    op.create_index(op.f('ix_student_teacher_links_id'), 'student_teacher_links', ['id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_student_teacher_links_id'), table_name='student_teacher_links')
    op.drop_table('student_teacher_links')
    op.drop_constraint('fk_enrollments_change_requested_package', 'enrollments', type_='foreignkey')
    op.drop_column('enrollments', 'change_requested_package_id')
    # Nota: Postgres no permite quitar un valor de un enum de forma
    # segura/directa. Si se necesita revertir por completo, hay que
    # recrear el tipo enrollmentstatus manualmente.