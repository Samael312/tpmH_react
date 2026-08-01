"""package clases ilimitadas

Revision ID: 2bcc750ee099
Revises: fa0e67aa3389
Create Date: 2026-08-02 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = '2bcc750ee099'
down_revision = 'fa0e67aa3389'
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.alter_column('packages', 'classes_count', existing_type=sa.Integer(), nullable=True)
    op.alter_column('enrollments', 'classes_total', existing_type=sa.Integer(), nullable=True)

def downgrade() -> None:
    op.alter_column('enrollments', 'classes_total', existing_type=sa.Integer(), nullable=False)
    op.alter_column('packages', 'classes_count', existing_type=sa.Integer(), nullable=False)