# backend/alembic/versions/a1b2c3d4e5f6_calendar_token_health.py
"""google calendar token health fields

Revision ID: b1b2c3d4e5f6
Revises: a1b2c3d4e5f6
Create Date: 2026-08-11 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'b1b2c3d4e5f6'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('google_google_calendar', sa.Column('needs_reauth', sa.Boolean(), nullable=True, server_default=sa.false()))
    op.add_column('google_google_calendar', sa.Column('last_synced_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('google_google_calendar', sa.Column('last_error', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('google_google_calendar', 'last_error')
    op.drop_column('google_google_calendar', 'last_synced_at')
    op.drop_column('google_google_calendar', 'needs_reauth')