"""teacher appeals, notifications, rejection feedback, user ban fields

Revision ID: c3d4e5f6a7b8
Revises: d2e3f4a5b6c7
Create Date: 2026-08-18 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, Sequence[str], None] = 'd2e3f4a5b6c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ─── TeacherProfile: retroalimentación de rechazo + apelaciones ───
    op.add_column('teacher_profiles', sa.Column('rejection_reason', sa.String(), nullable=True))
    op.add_column('teacher_profiles', sa.Column('rejection_feedback_seen', sa.Boolean(), server_default=sa.true(), nullable=True))
    op.add_column('teacher_profiles', sa.Column('appeal_count', sa.Integer(), server_default='0', nullable=True))
    op.add_column('teacher_profiles', sa.Column('appeal_exhausted', sa.Boolean(), server_default=sa.false(), nullable=True))

    # ─── User: baneo ───
    op.add_column('users', sa.Column('is_banned', sa.Boolean(), server_default=sa.false(), nullable=True))
    op.add_column('users', sa.Column('ban_reason', sa.String(), nullable=True))
    op.add_column('users', sa.Column('banned_at', sa.DateTime(timezone=True), nullable=True))

    # ─── TeacherAppeal ───
    op.create_table(
        'teacher_appeals',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('teacher_id', sa.Integer(), nullable=False),
        sa.Column('appeal_number', sa.Integer(), nullable=False),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('status', sa.String(), server_default='pending', nullable=True),
        sa.Column('admin_response', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('resolved_by', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['teacher_id'], ['teacher_profiles.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_teacher_appeals_id'), 'teacher_appeals', ['id'], unique=False)

    # ─── Notification ───
    op.create_table(
        'notifications',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('recipient_role', sa.String(), server_default='staff', nullable=False),
        sa.Column('type', sa.String(), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('message', sa.String(), nullable=True),
        sa.Column('related_teacher_id', sa.Integer(), nullable=True),
        sa.Column('is_read', sa.Boolean(), server_default=sa.false(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['related_teacher_id'], ['teacher_profiles.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_notifications_id'), 'notifications', ['id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_notifications_id'), table_name='notifications')
    op.drop_table('notifications')
    op.drop_index(op.f('ix_teacher_appeals_id'), table_name='teacher_appeals')
    op.drop_table('teacher_appeals')

    op.drop_column('users', 'banned_at')
    op.drop_column('users', 'ban_reason')
    op.drop_column('users', 'is_banned')

    op.drop_column('teacher_profiles', 'appeal_exhausted')
    op.drop_column('teacher_profiles', 'appeal_count')
    op.drop_column('teacher_profiles', 'rejection_feedback_seen')
    op.drop_column('teacher_profiles', 'rejection_reason')