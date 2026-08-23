"""add reminder_sent_at to classes

Revision ID: a3f5c7d9e1b2
Revises: e1f2a3b4c5d6
Create Date: 2026-08-23 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'a3f5c7d9e1b2'
down_revision = 'e1f2a3b4c5d6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'classes',
        sa.Column('reminder_sent_at', sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column('classes', 'reminder_sent_at')
