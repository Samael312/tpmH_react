"""Fase 9: tamano de cada material (cuota por profesor) y aviso de chat pendiente (correos agrupados)

Revision ID: a9c4d5e6f7a8
Revises: f8b3c4d5e6a7
Create Date: 2026-11-17 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'a9c4d5e6f7a8'
down_revision = 'f8b3c4d5e6a7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nulo en los materiales existentes (no se conoce su tamano): cuentan 0 para la cuota.
    op.add_column("materials", sa.Column("file_size", sa.BigInteger(), nullable=True))
    # Aviso de "mensaje nuevo" pendiente de agrupar; nulo = nada pendiente.
    op.add_column("chat_conversations", sa.Column("teacher_notify_pending_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("chat_conversations", "teacher_notify_pending_at")
    op.drop_column("materials", "file_size")
