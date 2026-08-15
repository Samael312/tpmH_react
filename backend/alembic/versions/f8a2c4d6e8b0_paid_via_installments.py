"""add paid_via_installments to enrollments

Revision ID: f8a2c4d6e8b0
Revises: b7f3a1c9d2e4
Create Date: 2026-08-15 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'f8a2c4d6e8b0'
down_revision = 'b7f3a1c9d2e4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'enrollments',
        sa.Column('paid_via_installments', sa.Boolean(), server_default=sa.false(), nullable=False)
    )


def downgrade() -> None:
    op.drop_column('enrollments', 'paid_via_installments')