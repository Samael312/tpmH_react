"""add nationality

Revision ID: 7c2d9e1f4a6b
Revises: 6a1f2b3c4d5e
Create Date: 2026-08-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '7c2d9e1f4a6b'
down_revision: Union[str, Sequence[str], None] = '6a1f2b3c4d5e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('nationality', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'nationality')