"""class_type external + external_source (import Preply)

Revision ID: b9c1d3e5f7a9
Revises: e5f7a9b1c3d5
Create Date: 2026-09-03 00:00:00.000000

Soporta clases "importadas" desde el Google Calendar del profesor
(ej. clases de Preply cuyo título contiene esa palabra), ver
core/google_calendar.py::import_external_classes_for_teacher.

- ClassType gana el valor "external".
- classes.external_source guarda el origen ("preply" por ahora),
  NULL para cualquier clase creada normalmente en la plataforma.
"""
from alembic import op
import sqlalchemy as sa

revision = 'b9c1d3e5f7a9'
down_revision = 'e5f7a9b1c3d5'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ClassType gana el valor "external" (enum ya existente en Postgres,
    # mismo patrón que el ALTER TYPE usado para agregar "group").
    op.execute("ALTER TYPE classtype ADD VALUE IF NOT EXISTS 'external'")

    op.add_column(
        'classes',
        sa.Column('external_source', sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('classes', 'external_source')
    # Nota: Postgres no permite quitar un valor de un enum existente
    # (ClassType.external) sin recrear el tipo por completo; se deja
    # intencionalmente fuera del downgrade automático (mismo criterio
    # que ClassType.group en b4e6d1f9a2c3).
