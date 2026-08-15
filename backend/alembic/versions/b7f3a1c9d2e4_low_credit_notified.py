"""add low_credit_notified_at to enrollments

Revision ID: b7f3a1c9d2e4
Revises: 46d2eba190a4
Create Date: 2026-08-15 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'b7f3a1c9d2e4'
down_revision = '46d2eba190a4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'enrollments',
        sa.Column('low_credit_notified_at', sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column('enrollments', 'low_credit_notified_at')