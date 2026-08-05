"""package customization: icon, color, description type

Revision ID: 8f1a2b3c4d5e
Revises: 7c2d9e1f4a6b
Create Date: 2026-08-05 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '8f1a2b3c4d5e'
down_revision: Union[str, Sequence[str], None] = '7c2d9e1f4a6b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('packages', sa.Column('icon', sa.String(), nullable=True, server_default='📦'))
    op.add_column('packages', sa.Column('color', sa.String(), nullable=True, server_default='#ec4899'))
    op.add_column('packages', sa.Column('description_type', sa.String(), nullable=True, server_default='paragraph'))
    op.add_column('packages', sa.Column('description_items', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column('packages', 'description_items')
    op.drop_column('packages', 'description_type')
    op.drop_column('packages', 'color')
    op.drop_column('packages', 'icon')