"""Idioma del vocabulario (materials.language) para que el TTS pronuncie bien las palabras sueltas.

Antes el TTS recibia solo la palabra y adivinaba el idioma: «pera» o «uva» sonaban con fonetica inglesa.
Columna nueva y opcional: los vocabularios existentes quedan en NULL y se leen como antes.

Revision ID: f27a1b2c3d4e
Revises: f26a1b2c3d4e
Create Date: 2026-11-24 19:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'f27a1b2c3d4e'
down_revision = 'f26a1b2c3d4e'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('materials', sa.Column('language', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('materials', 'language')
