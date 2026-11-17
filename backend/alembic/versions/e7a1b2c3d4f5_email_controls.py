"""Fase 7: control de correos (interruptores, contador diario y modo ahorro)

Revision ID: e7a1b2c3d4f5
Revises: b8c9d0e1f2a3
Create Date: 2026-11-17 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'e7a1b2c3d4f5'
down_revision = 'b8c9d0e1f2a3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("platform_config", sa.Column("email_notifications", postgresql.JSONB(), nullable=True))
    op.add_column("platform_config", sa.Column("email_daily_limit", sa.Integer(), server_default="100", nullable=True))
    op.add_column("platform_config", sa.Column("email_auto_saver_enabled", sa.Boolean(), server_default="false", nullable=True))
    op.add_column("platform_config", sa.Column("email_auto_saver_percent", sa.Integer(), server_default="80", nullable=True))
    op.create_table(
        "email_log",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("outcome", sa.String(), nullable=False),
        sa.Column("reason", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_email_log_id", "email_log", ["id"])
    op.create_index("ix_email_log_day", "email_log", ["day"])


def downgrade() -> None:
    op.drop_index("ix_email_log_day", table_name="email_log")
    op.drop_index("ix_email_log_id", table_name="email_log")
    op.drop_table("email_log")
    op.drop_column("platform_config", "email_auto_saver_percent")
    op.drop_column("platform_config", "email_auto_saver_enabled")
    op.drop_column("platform_config", "email_daily_limit")
    op.drop_column("platform_config", "email_notifications")
