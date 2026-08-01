"""renewal requested package

Revision ID: f3a9c2b1d4e5
Revises: 7ad1889f2818
Create Date: 2026-08-01 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f3a9c2b1d4e5'
down_revision: Union[str, Sequence[str], None] = '7ad1889f2818'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'enrollments',
        sa.Column('renewal_requested_package_id', sa.Integer(), nullable=True)
    )
    op.create_foreign_key(
        'fk_enrollments_renewal_requested_package',
        'enrollments', 'packages',
        ['renewal_requested_package_id'], ['id']
    )


def downgrade() -> None:
    op.drop_constraint(
        'fk_enrollments_renewal_requested_package',
        'enrollments', type_='foreignkey'
    )
    op.drop_column('enrollments', 'renewal_requested_package_id')