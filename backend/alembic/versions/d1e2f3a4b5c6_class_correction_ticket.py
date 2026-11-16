"""NEG-02: ticket de soporte para corregir clases pasadas a no_show automatico

Revision ID: d1e2f3a4b5c6
Revises: c9d0e1f2a3b4
Create Date: 2026-11-16 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'd1e2f3a4b5c6'
down_revision = 'c9d0e1f2a3b4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE no puede ir dentro de una transaccion en algunas versiones de PostgreSQL.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE supportcategory ADD VALUE IF NOT EXISTS 'class_correction'")
    op.add_column("support_tickets", sa.Column("class_id", sa.Integer(), sa.ForeignKey("classes.id"), nullable=True))
    op.add_column("support_tickets", sa.Column("requested_status", sa.String(), nullable=True))
    op.add_column("support_tickets", sa.Column("decision", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("support_tickets", "decision")
    op.drop_column("support_tickets", "requested_status")
    op.drop_column("support_tickets", "class_id")
    # El valor 'class_correction' del enum no se puede quitar de PostgreSQL sin recrear el tipo.
