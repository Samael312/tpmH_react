"""Fase 13 (A1): bloqueo temporal de la cuenta tras logins fallidos

Anade `users.failed_login_count` (0 por defecto) y `users.locked_until` (NULL = no bloqueada).
Retrocompatible: el codigo anterior ignora las columnas.

Revision ID: c2e6f7a8b9d0
Revises: b1d5e6f7a8c9
Create Date: 2026-11-18 10:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'c2e6f7a8b9d0'
down_revision = 'b1d5e6f7a8c9'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('failed_login_count', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('users', sa.Column('locked_until', sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column('users', 'locked_until')
    op.drop_column('users', 'failed_login_count')
