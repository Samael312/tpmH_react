"""teacher video and profile theme

Revision ID: 6a1f2b3c4d5e
Revises: 2bcc750ee099
Create Date: 2026-08-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '6a1f2b3c4d5e'
down_revision: Union[str, Sequence[str], None] = '2bcc750ee099'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('teacher_profiles', sa.Column('video_url', sa.String(), nullable=True))
    op.add_column('teacher_profiles', sa.Column('video_public_id', sa.String(), nullable=True))
    op.add_column(
        'teacher_profiles',
        sa.Column('theme_color', sa.String(), nullable=True, server_default='#ec4899')
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('teacher_profiles', 'theme_color')
    op.drop_column('teacher_profiles', 'video_public_id')
    op.drop_column('teacher_profiles', 'video_url')