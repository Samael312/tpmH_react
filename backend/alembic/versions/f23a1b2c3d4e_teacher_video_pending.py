"""Fase 23: video pendiente de revision para profesores ya aprobados

Revision ID: f23a1b2c3d4e
Revises: f20a1b2c3d4e
Create Date: 2026-11-21 18:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'f23a1b2c3d4e'
down_revision = 'f20a1b2c3d4e'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('teacher_profiles', sa.Column('video_pending_url', sa.String(), nullable=True))
    op.add_column('teacher_profiles', sa.Column('video_pending_public_id', sa.String(), nullable=True))


def downgrade():
    op.drop_column('teacher_profiles', 'video_pending_public_id')
    op.drop_column('teacher_profiles', 'video_pending_url')
