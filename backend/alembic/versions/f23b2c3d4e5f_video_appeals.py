"""Fase 23: apelacion de un video pendiente rechazado (kind en teacher_appeals + motivo/uso en teacher_profiles)

Revision ID: f23b2c3d4e5f
Revises: f23a1b2c3d4e
Create Date: 2026-11-21 19:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'f23b2c3d4e5f'
down_revision = 'f23a1b2c3d4e'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('teacher_appeals', sa.Column('kind', sa.String(), nullable=False, server_default='profile'))
    op.add_column('teacher_profiles', sa.Column('video_pending_rejection_reason', sa.String(), nullable=True))
    op.add_column('teacher_profiles', sa.Column('video_pending_appeal_used', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    op.drop_column('teacher_profiles', 'video_pending_appeal_used')
    op.drop_column('teacher_profiles', 'video_pending_rejection_reason')
    op.drop_column('teacher_appeals', 'kind')
