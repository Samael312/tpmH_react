"""teacher_profile server-side defaults for status, commission_rate, balance

Antes, TeacherProfile.status / commission_rate / balance usaban solo
`default=` de SQLAlchemy (aplicado por el ORM al construir el INSERT),
no `server_default=` (a nivel de columna en la base). Cualquier INSERT
que no pasara por el ORM (SQL manual, un script de datos, una migración
de otra fuente) dejaba estas columnas en NULL. Como
TeacherProfileResponse las declara como campos obligatorios (no
Optional), la primera vez que ese perfil pasaba por cualquier endpoint
que arma esa respuesta, Pydantic tiraba un ValidationError sin manejar
-> 500 crudo (que además el navegador reporta como error de CORS,
porque la excepción no pasa "limpia" por el pipeline de headers).

Esta migración agrega server_default real a nivel de columna y
backfillea las filas existentes que hayan quedado en NULL por el mismo
motivo, para que este problema no pueda repetirse sin importar cómo se
inserten filas nuevas.

Revision ID: a4b6c8d0e2f4
Revises: b9c1d3e5f7a9
Create Date: 2026-09-06 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'c967d8ad6a4e'
down_revision = 'b9c1d3e5f7a9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Backfill de filas ya existentes que hayan quedado en NULL por
    #    haber sido insertadas sin pasar por el ORM.
    op.execute("UPDATE teacher_profiles SET status = 'pending' WHERE status IS NULL")
    op.execute("UPDATE teacher_profiles SET commission_rate = 0.15 WHERE commission_rate IS NULL")
    op.execute("UPDATE teacher_profiles SET balance = 0.0 WHERE balance IS NULL")

    # 2. Server-side defaults reales, para que esto no pueda volver a
    #    pasar sin importar qué inserte la fila (ORM, SQL manual, etc.)
    op.alter_column(
        'teacher_profiles', 'status',
        server_default='pending',
        existing_type=sa.Enum('pending', 'approved', 'rejected', 'suspended', name='teacherstatus'),
        existing_nullable=True,
    )
    op.alter_column(
        'teacher_profiles', 'commission_rate',
        server_default='0.15',
        existing_type=sa.Float(),
        existing_nullable=True,
    )
    op.alter_column(
        'teacher_profiles', 'balance',
        server_default='0.0',
        existing_type=sa.Float(),
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column('teacher_profiles', 'balance', server_default=None, existing_type=sa.Float(), existing_nullable=True)
    op.alter_column('teacher_profiles', 'commission_rate', server_default=None, existing_type=sa.Float(), existing_nullable=True)
    op.alter_column(
        'teacher_profiles', 'status',
        server_default=None,
        existing_type=sa.Enum('pending', 'approved', 'rejected', 'suspended', name='teacherstatus'),
        existing_nullable=True,
    )
