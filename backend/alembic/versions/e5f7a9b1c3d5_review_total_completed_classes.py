"""review total completed classes

Revision ID: e5f7a9b1c3d5
Revises: 7e2d8419661a
Create Date: 2026-09-02 00:00:00.000000

Añade reviews.total_completed_classes: cuántas clases completó el
alumno CON ESE PROFESOR en particular (no el contador de por vida en
StudentProfile, que es global). Nullable — cuando es NULL y la reseña
tiene student_id, el valor se calcula en vivo a partir de
Class/ClassParticipant en el momento de servir la reseña. Para reseñas
legacy (sobre todo sin student_id, donde no hay forma de calcularlo)
Modo Dios permite cargarlo a mano.
"""
from alembic import op
import sqlalchemy as sa

revision = 'e5f7a9b1c3d5'
down_revision = '7e2d8419661a'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'reviews',
        sa.Column('total_completed_classes', sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('reviews', 'total_completed_classes')
