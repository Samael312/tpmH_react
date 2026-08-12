"""add onboarding

Revision ID: c1b2c3d4e5f6
Revises: b1b2c3d4e5f6
Create Date: 2026-08-12 18:02:39.204486

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'b1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade():
    op.add_column("packages", sa.Column("allow_installments", sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column("packages", sa.Column("installment_count", sa.Integer(), nullable=True))
    op.add_column("packages", sa.Column("installment_amount", sa.Float(), nullable=True))

    op.add_column("enrollments", sa.Column("payment_status", sa.String(), server_default="unpaid", nullable=False))
    op.add_column("enrollments", sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("enrollments", sa.Column("installments_paid", sa.Integer(), server_default="0", nullable=False))
    op.add_column("enrollments", sa.Column("prepaid_unlimited_credits", sa.Integer(), server_default="0", nullable=False))

    op.add_column("classes", sa.Column("used_prepaid_credit", sa.Boolean(), server_default=sa.false(), nullable=False))


    op.add_column("payments", sa.Column("installment_index", sa.Integer(), nullable=True))
    op.add_column("payments", sa.Column("is_manual_grant", sa.Boolean(), server_default=sa.false(), nullable=False))

    # Backfill: enrollments activos existentes quedan operativos sin romper nada
    op.execute("""
        UPDATE enrollments
        SET unlocked_credits = COALESCE(classes_total, 0),
            payment_status = 'paid',
            activated_at = created_at
        WHERE status = 'active'
    """)