"""meet link autogen minutes configurable

Agrega platform_config.meet_link_autogen_minutes (default 30): minutos
antes del inicio de la clase en los que el job automático genera el
Meet link si la clase todavía no tiene uno asignado. Antes era una
constante fija (MEET_LINK_AUTOGEN_MINUTES_BEFORE) en core/scheduler.py,
ahora configurable por el superadmin junto al resto de las reglas de
negocio (ver core/class_logic.py::get_business_rules).

Revision ID: a4b6c8d0e2f4
Revises: f1e2d3c4b5a6
Create Date: 2026-08-31 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'a4b6c8d0e2f4'
down_revision = 'f1e2d3c4b5a6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'platform_config',
        sa.Column('meet_link_autogen_minutes', sa.Integer(), server_default='30', nullable=True),
    )


def downgrade() -> None:
    op.drop_column('platform_config', 'meet_link_autogen_minutes')
