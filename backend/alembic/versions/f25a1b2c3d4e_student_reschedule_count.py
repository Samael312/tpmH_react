"""Fase 25 (m2): tope de reagendados por alumno (classes.student_reschedule_count)

Revision ID: f25a1b2c3d4e
Revises: f23b2c3d4e5f
Create Date: 2026-11-21 20:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'f25a1b2c3d4e'
down_revision = 'f23b2c3d4e5f'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('classes', sa.Column('student_reschedule_count', sa.Integer(), nullable=False, server_default='0'))


def downgrade():
    op.drop_column('classes', 'student_reschedule_count')
