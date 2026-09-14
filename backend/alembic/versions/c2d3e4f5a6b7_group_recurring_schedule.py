"""agrega horario recurrente (group_schedule_mode y afines) a packages

D14: paquetes grupales pueden tener un horario FIJO/recurrente semanal
(generación automática de todas las sesiones al cerrar el grupo) en vez
de agendado libre/manual (comportamiento de siempre, sigue siendo el
default para no afectar paquetes existentes).

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
Create Date: 2026-09-14 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = 'c2d3e4f5a6b7'
down_revision = 'b1c2d3e4f5a6'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'packages',
        sa.Column('group_schedule_mode', sa.String(), nullable=False, server_default='manual'),
    )
    op.add_column(
        'packages',
        sa.Column('group_recurring_days_of_week', JSONB(), nullable=True),
    )
    op.add_column(
        'packages',
        sa.Column('group_recurring_time_local', sa.String(length=5), nullable=True),
    )


def downgrade():
    op.drop_column('packages', 'group_recurring_time_local')
    op.drop_column('packages', 'group_recurring_days_of_week')
    op.drop_column('packages', 'group_schedule_mode')
