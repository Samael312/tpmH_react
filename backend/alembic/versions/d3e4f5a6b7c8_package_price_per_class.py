"""agrega price_per_class a packages

Correcciones Extra (informe D1-D14, decisión de negocio confirmada):
precio de una clase suelta dentro del paquete, cargado a mano por el
profesor en la creación/edición del paquete en vez de derivarse siempre
como price/classes_count. Obligatorio para paquetes finitos (validado
en el schema: price_per_class * classes_count == price); no aplica a
paquetes ilimitados. Nullable a nivel de DB para no romper paquetes ya
existentes, que quedan en NULL hasta que el profesor los vuelva a
guardar (ver app.core.class_logic.get_price_per_class para el fallback
al cálculo derivado mientras tanto).

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
Create Date: 2026-09-15 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'd3e4f5a6b7c8'
down_revision = 'c2d3e4f5a6b7'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'packages',
        sa.Column('price_per_class', sa.Float(), nullable=True),
    )


def downgrade():
    op.drop_column('packages', 'price_per_class')
