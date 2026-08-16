# backend/alembic/versions/d2e3f4a5b6c7_bank_transfer_mobile_payment.py
"""bank transfer and mobile payment methods

Revision ID: d2e3f4a5b6c7
Revises: f8a2c4d6e8b0
Create Date: 2026-08-15 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'd2e3f4a5b6c7'
down_revision = 'f8a2c4d6e8b0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('payment_config', sa.Column('bank_transfer_enabled', sa.Boolean(), server_default=sa.false(), nullable=True))
    op.add_column('payment_config', sa.Column('mobile_payment_enabled', sa.Boolean(), server_default=sa.false(), nullable=True))
    op.add_column('payment_config', sa.Column('bank_transfer_details', sa.String(), nullable=True))
    op.add_column('payment_config', sa.Column('mobile_payment_details', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('payment_config', 'mobile_payment_details')
    op.drop_column('payment_config', 'bank_transfer_details')
    op.drop_column('payment_config', 'mobile_payment_enabled')
    op.drop_column('payment_config', 'bank_transfer_enabled')