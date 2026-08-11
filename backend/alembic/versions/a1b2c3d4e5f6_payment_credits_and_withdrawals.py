"""payment credits, installments, expiration and withdrawal fields

Revision ID: a1b2c3d4e5f6
Revises: 9d3e5f7a1b2c
Create Date: 2026-08-11
"""
from alembic import op
import sqlalchemy as sa

revision = "a1b2c3d4e5f6"
down_revision = "9d3e5f7a1b2c"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("packages", sa.Column("allows_installments", sa.Boolean(), server_default=sa.false(), nullable=False))

    op.add_column("enrollments", sa.Column("unlocked_credits", sa.Integer(), server_default="0", nullable=False))
    op.add_column("enrollments", sa.Column("payment_installment_status", sa.String(), server_default="unpaid", nullable=False))

    op.add_column("classes", sa.Column("payment_expires_at", sa.DateTime(timezone=True), nullable=True))

    op.add_column("payments", sa.Column("payment_type", sa.String(), nullable=True))
    op.add_column("payments", sa.Column("installment_number", sa.Integer(), nullable=True))

    op.add_column("withdrawals", sa.Column("reference", sa.String(), nullable=True))
    op.add_column("withdrawals", sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True))

    # Backfill: enrollments activos existentes deben poder seguir agendando
    # sin que el nuevo gate de créditos los bloquee de golpe.
    op.execute("""
        UPDATE enrollments
        SET unlocked_credits = COALESCE(classes_total, 0),
            payment_installment_status = 'fully_paid'
        WHERE status = 'active'
    """)


def downgrade():
    op.drop_column("withdrawals", "updated_at")
    op.drop_column("withdrawals", "reference")
    op.drop_column("payments", "installment_number")
    op.drop_column("payments", "payment_type")
    op.drop_column("classes", "payment_expires_at")
    op.drop_column("enrollments", "payment_installment_status")
    op.drop_column("enrollments", "unlocked_credits")
    op.drop_column("packages", "allows_installments")