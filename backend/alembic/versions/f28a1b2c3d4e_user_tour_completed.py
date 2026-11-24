"""Guia interactiva post-onboarding: users.tour_completed.

Columna NOT NULL con server_default false (las cuentas nuevas ven la guia). Los usuarios que ya existen quedan en
true: la guia es solo para cuentas nuevas; pueden abrirla con «Ver guia de la plataforma» en su perfil.

Revision ID: f28a1b2c3d4e
Revises: f27a1b2c3d4e
Create Date: 2026-11-24 21:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'f28a1b2c3d4e'
down_revision = 'f27a1b2c3d4e'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('tour_completed', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.execute("UPDATE users SET tour_completed = true")


def downgrade() -> None:
    op.drop_column('users', 'tour_completed')
