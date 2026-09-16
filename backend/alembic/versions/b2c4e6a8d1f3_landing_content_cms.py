"""landing_content: mini-CMS del contenido hardcodeado del landing (N3)

Agrega `landing_content` (JSONB, nullable) a `platform_config`. Guarda
únicamente lo que el admin sobreescribió desde /admin/settings; los
defaults completos viven en código (ver
app.core.platform_config.LANDING_CONTENT_DEFAULTS) y se mezclan recién
al leer, así que no hace falta backfillear nada acá — una fila con
landing_content=NULL simplemente usa el 100% de los defaults.

Revision ID: b2c4e6a8d1f3
Revises: d3e4f5a6b7c8
Create Date: 2026-09-11 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'b2c4e6a8d1f3'
down_revision: Union[str, Sequence[str], None] = 'd3e4f5a6b7c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'platform_config',
        sa.Column('landing_content', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('platform_config', 'landing_content')
