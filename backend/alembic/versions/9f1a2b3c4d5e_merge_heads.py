"""merge heads

El árbol de migraciones había quedado con 5 heads sin converger
(2bcc750ee099, f3a4b5c6d7e8, d2e3f4a5b6c7, b1b2c3d4e5f6, c5d7e9f1a3b4) —
cada una fue agregada sobre una rama distinta sin que nadie las
encadenara entre sí. `alembic upgrade head` se rompe con múltiples heads
sin resolver, así que este merge no hace ningún cambio de esquema: solo
une las 5 ramas en un único head para que las migraciones futuras (y los
deploys) puedan seguir encadenándose con normalidad.

Revision ID: 9f1a2b3c4d5e
Revises: 2bcc750ee099, f3a4b5c6d7e8, d2e3f4a5b6c7, b1b2c3d4e5f6, c5d7e9f1a3b4
Create Date: 2026-09-12 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = '9f1a2b3c4d5e'
down_revision = ('2bcc750ee099', 'f3a4b5c6d7e8', 'd2e3f4a5b6c7', 'b1b2c3d4e5f6', 'c5d7e9f1a3b4')
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
