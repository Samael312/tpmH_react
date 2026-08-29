"""class durations catalog rework + prep buffers

Duraciones de clase pasan a un pool cerrado [25, 50, 80, 110]:
- trial_duration_minutes (nuevo, default 25): duración única de la clase
  de prueba, editable por el superadmin desde el mismo pool.
- buffer_trial_minutes / buffer_regular_minutes / buffer_group_minutes
  (nuevos, defaults 5/10/10): minutos de margen que se descuentan del
  final real de la clase respecto al bloque que ocupa en la agenda del
  profesor, editables por el superadmin.
- allowed_class_durations / allowed_package_durations: se normalizan a
  defaults dentro del nuevo pool ([50, 80, 110]); el valor libre anterior
  ([30, 60]) queda reemplazado porque ya no son duraciones válidas.
- classes.buffer_minutes (nuevo, default 10): margen fijado por clase al
  crearla, según su class_type y la config vigente en ese momento.

Revision ID: c4d5e6f7a8b9
Revises: b4e6d1f9a2c3
Create Date: 2026-08-29 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'c4d5e6f7a8b9'
down_revision = 'b4e6d1f9a2c3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('platform_config', sa.Column('trial_duration_minutes', sa.Integer(), server_default='25', nullable=True))
    op.add_column('platform_config', sa.Column('buffer_trial_minutes', sa.Integer(), server_default='5', nullable=True))
    op.add_column('platform_config', sa.Column('buffer_regular_minutes', sa.Integer(), server_default='10', nullable=True))
    op.add_column('platform_config', sa.Column('buffer_group_minutes', sa.Integer(), server_default='10', nullable=True))

    op.add_column('classes', sa.Column('buffer_minutes', sa.Integer(), server_default='10', nullable=False))

    conn = op.get_bind()

    # Normaliza catálogos de duración existentes al nuevo pool cerrado.
    # No tocamos clases ya creadas (siguen guardando su duración/horario
    # original tal cual; es un ambiente de desarrollo, no importa).
    conn.execute(sa.text(
        "UPDATE platform_config SET allowed_class_durations = '[50,80,110]'::jsonb"
    ))
    conn.execute(sa.text(
        "UPDATE platform_config SET allowed_package_durations = '[50,80,110]'::jsonb"
    ))

    # Clases de prueba existentes: margen de prueba (5min). El resto
    # (regular/group) se queda con el default de columna (10min).
    conn.execute(sa.text(
        "UPDATE classes SET buffer_minutes = 5 WHERE class_type = 'trial'"
    ))


def downgrade() -> None:
    op.drop_column('classes', 'buffer_minutes')
    op.drop_column('platform_config', 'buffer_group_minutes')
    op.drop_column('platform_config', 'buffer_regular_minutes')
    op.drop_column('platform_config', 'buffer_trial_minutes')
    op.drop_column('platform_config', 'trial_duration_minutes')
