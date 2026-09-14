"""agrega min_classes_before_package_change a platform_config

D7: mínimo configurable por el admin de clases YA COMPLETADAS que un
estudiante debe tener en su paquete actual antes de poder pedir un
cambio de paquete (sube o baja, aplica a ambos sentidos). Default 0 =
sin restricción, para no cambiar el comportamiento actual de nadie al
aplicar la migración.

Revision ID: b1c2d3e4f5a6
Revises: a2b3c4d5e6f7
Create Date: 2026-09-14 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'b1c2d3e4f5a6'
down_revision = 'a2b3c4d5e6f7'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'platform_config',
        sa.Column('min_classes_before_package_change', sa.Integer(), nullable=False, server_default='0'),
    )


def downgrade():
    op.drop_column('platform_config', 'min_classes_before_package_change')
