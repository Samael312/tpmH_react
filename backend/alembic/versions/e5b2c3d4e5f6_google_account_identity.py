"""Fase 17: identidad de la cuenta de Google conectada + calendar_id "primary"

- google_google_calendar.google_account_sub / google_account_email (nullables; se rellenan al (re)conectar).
- Indice unico parcial sobre google_account_sub: una cuenta de Google = un solo profesor.
- calendar_id: las filas antiguas guardaban el email de la plataforma; se normalizan a "primary" (el codigo ya
  trata cualquier valor con "@" como "primary", asi que es seguro aunque esta migracion no corra).

Revision ID: e5b2c3d4e5f6
Revises: e4a1b2c3d4f5
Create Date: 2026-11-21 10:30:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'e5b2c3d4e5f6'
down_revision = 'e4a1b2c3d4f5'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('google_google_calendar', sa.Column('google_account_sub', sa.String(), nullable=True))
    op.add_column('google_google_calendar', sa.Column('google_account_email', sa.String(), nullable=True))
    op.create_index(
        'uq_google_calendar_account_sub', 'google_google_calendar', ['google_account_sub'], unique=True,
        postgresql_where=sa.text('google_account_sub IS NOT NULL'),
        sqlite_where=sa.text('google_account_sub IS NOT NULL'),
    )
    op.execute("UPDATE google_google_calendar SET calendar_id = 'primary' "
               "WHERE calendar_id IS NULL OR calendar_id LIKE '%@%'")


def downgrade():
    op.drop_index('uq_google_calendar_account_sub', table_name='google_google_calendar')
    op.drop_column('google_google_calendar', 'google_account_email')
    op.drop_column('google_google_calendar', 'google_account_sub')
