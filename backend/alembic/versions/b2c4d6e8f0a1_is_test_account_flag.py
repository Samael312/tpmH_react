"""is_test_account flag on users

Agrega users.is_test_account (default False): marca las 4 cuentas fijas
de la suite backend/tests/flow (superadmin/teacher_admin/teacher/student)
para poder ocultarlas de superficies públicas/de cara al usuario (p. ej.
el marketplace de profesores en GET /teachers/) sin borrarlas ni afectar
accesos directos por username, que los propios tests necesitan.

Revision ID: b2c4d6e8f0a1
Revises: a4b6c8d0e2f4
Create Date: 2026-09-01 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'b2c4d6e8f0a1'
down_revision = 'a4b6c8d0e2f4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column('is_test_account', sa.Boolean(), server_default='false', nullable=False),
    )


def downgrade() -> None:
    op.drop_column('users', 'is_test_account')
