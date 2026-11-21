"""Fase 17: classes.google_sync_hash (huella de lo empujado a Google; la sync omite update si no cambio)

Revision ID: e6c3d4e5f6a7
Revises: e5b2c3d4e5f6
Create Date: 2026-11-21 10:45:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'e6c3d4e5f6a7'
down_revision = 'e5b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('classes', sa.Column('google_sync_hash', sa.String(length=32), nullable=True))


def downgrade():
    op.drop_column('classes', 'google_sync_hash')
