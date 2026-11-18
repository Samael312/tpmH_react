"""Fase 13 (A9): avisos dirigidos a un usuario (notifications.recipient_user_id)

Retrocompatible: la columna es NULL para los avisos de staff, que siguen filtrandose por recipient_role.

Revision ID: d3f7a8b9c0e1
Revises: c2e6f7a8b9d0
Create Date: 2026-11-18 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'd3f7a8b9c0e1'
down_revision = 'c2e6f7a8b9d0'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('notifications', sa.Column('recipient_user_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_notifications_recipient_user', 'notifications', 'users', ['recipient_user_id'], ['id'])
    op.create_index('ix_notifications_recipient_user_id', 'notifications', ['recipient_user_id'])


def downgrade():
    op.drop_index('ix_notifications_recipient_user_id', table_name='notifications')
    op.drop_constraint('fk_notifications_recipient_user', 'notifications', type_='foreignkey')
    op.drop_column('notifications', 'recipient_user_id')
