"""god mode audit log

Tabla base para el Modo Dios (superadmin / teacher_admin): registra
cada acción ejecutada fuera de las reglas normales de negocio
(ajuste de créditos, cambio forzado de paquete/cohorte, forzado de
estado de clase, edición de pagos, etc.).

Es deliberadamente un log de solo-lectura desde la API: no se
exponen endpoints de edición ni borrado sobre esta tabla.

Revision ID: f1e2d3c4b5a6
Revises: d3f6a8b1c9e2
Create Date: 2026-08-30 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'f1e2d3c4b5a6'
down_revision = 'd3f6a8b1c9e2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'god_mode_audit_logs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('actor_user_id', sa.Integer(), nullable=False),
        sa.Column('actor_role', sa.String(), nullable=False),
        sa.Column('action', sa.String(), nullable=False),
        sa.Column('entity_type', sa.String(), nullable=False),
        sa.Column('entity_id', sa.Integer(), nullable=False),
        sa.Column('reason', sa.String(), nullable=False),
        sa.Column('before_data', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('after_data', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['actor_user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_god_mode_audit_logs_id'), 'god_mode_audit_logs', ['id'], unique=False)
    op.create_index(op.f('ix_god_mode_audit_logs_action'), 'god_mode_audit_logs', ['action'], unique=False)
    op.create_index(op.f('ix_god_mode_audit_logs_entity_type'), 'god_mode_audit_logs', ['entity_type'], unique=False)
    op.create_index(op.f('ix_god_mode_audit_logs_entity_id'), 'god_mode_audit_logs', ['entity_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_god_mode_audit_logs_entity_id'), table_name='god_mode_audit_logs')
    op.drop_index(op.f('ix_god_mode_audit_logs_entity_type'), table_name='god_mode_audit_logs')
    op.drop_index(op.f('ix_god_mode_audit_logs_action'), table_name='god_mode_audit_logs')
    op.drop_index(op.f('ix_god_mode_audit_logs_id'), table_name='god_mode_audit_logs')
    op.drop_table('god_mode_audit_logs')
