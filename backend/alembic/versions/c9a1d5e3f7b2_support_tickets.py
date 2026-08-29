"""support tickets: bugs, errores y dudas de student/teacher hacia staff

Revision ID: c9a1d5e3f7b2
Revises: c4d5e6f7a8b9
Create Date: 2026-08-29 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'c9a1d5e3f7b2'
down_revision = 'c4d5e6f7a8b9'
branch_labels = None
depends_on = None


support_category_enum = sa.Enum(
    "bug", "error", "question", "other",
    name="supportcategory",
)
support_ticket_status_enum = sa.Enum(
    "pending", "answered",
    name="supportticketstatus",
)


def upgrade() -> None:
    # No se crean los enums explícitamente: create_table() ya los genera
    # automáticamente al usar columnas Enum (evita el CREATE TYPE duplicado).
    op.create_table(
        "support_tickets",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("category", support_category_enum, nullable=False, server_default="question"),
        sa.Column("subject", sa.String(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("screen_context", sa.String(), nullable=True),
        sa.Column("status", support_ticket_status_enum, nullable=False, server_default="pending"),
        sa.Column("admin_response", sa.Text(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by", sa.Integer(), nullable=True),
        sa.Column("user_notified_seen", sa.Boolean(), nullable=True, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.add_column(
        "notifications",
        sa.Column("related_support_ticket_id", sa.Integer(), sa.ForeignKey("support_tickets.id"), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("notifications", "related_support_ticket_id")
    op.drop_table("support_tickets")

    support_ticket_status_enum.drop(op.get_bind(), checkfirst=True)
    support_category_enum.drop(op.get_bind(), checkfirst=True)
