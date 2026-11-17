"""Fase 8: idiomas que habla el usuario (users.spoken_languages) y su catalogo editable

Revision ID: f8b3c4d5e6a7
Revises: e7a1b2c3d4f5
Create Date: 2026-11-17 00:00:00.000000
"""
import json

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'f8b3c4d5e6a7'
down_revision = 'e7a1b2c3d4f5'
branch_labels = None
depends_on = None

CATALOG_VALUE = [
    "Español", "Inglés", "Portugués", "Francés", "Italiano", "Alemán",
    "Chino", "Árabe", "Ruso", "Japonés", "Coreano", "Neerlandés",
]


def upgrade() -> None:
    # Sin relleno de datos: los usuarios actuales quedan en [].
    op.add_column(
        "users",
        sa.Column("spoken_languages", postgresql.JSONB(), server_default=sa.text("'[]'::jsonb"), nullable=False),
    )
    # El catalogo `languages` (idiomas que se ensenan) no se toca; este es distinto.
    op.get_bind().execute(
        sa.text(
            "INSERT INTO system_catalogs (key, label, value) VALUES (:k, :l, CAST(:v AS JSONB)) "
            "ON CONFLICT (key) DO NOTHING"
        ),
        {"k": "spoken_languages", "l": "Idiomas que habla el usuario", "v": json.dumps(CATALOG_VALUE, ensure_ascii=False)},
    )


def downgrade() -> None:
    op.get_bind().execute(sa.text("DELETE FROM system_catalogs WHERE key = 'spoken_languages'"))
    op.drop_column("users", "spoken_languages")
