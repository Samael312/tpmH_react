"""student lifetime completed classes counter

Revision ID: 7e2d8419661a
Revises: d4e6f8a0b2c4
Create Date: 2026-09-02 00:00:00.000000

Añade student_profiles.total_completed_classes: contador incremental de
por vida de clases completadas (individuales + grupales, status
'completed'/'no_show'), independiente de enrollments/paquetes concretos
— no se resetea con renovaciones ni cambios de paquete.
"""
from alembic import op
import sqlalchemy as sa

revision = '7e2d8419661a'
down_revision = 'd4e6f8a0b2c4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'student_profiles',
        sa.Column(
            'total_completed_classes',
            sa.Integer(),
            nullable=False,
            server_default='0',
        ),
    )
    # Backfill: reconstruye el histórico a partir de las clases que ya
    # están en estado completed/no_show, tanto individuales
    # (classes.student_id) como grupales (class_participants, excluyendo
    # participantes cancelados).
    op.execute("""
        UPDATE student_profiles sp
        SET total_completed_classes = COALESCE(counts.total, 0)
        FROM (
            SELECT student_id, SUM(cnt) AS total
            FROM (
                SELECT student_id, COUNT(*) AS cnt
                FROM classes
                WHERE status IN ('completed', 'no_show')
                  AND student_id IS NOT NULL
                GROUP BY student_id
                UNION ALL
                SELECT cp.student_id, COUNT(*) AS cnt
                FROM class_participants cp
                JOIN classes c ON c.id = cp.class_id
                WHERE c.status IN ('completed', 'no_show')
                  AND cp.attendance_status != 'cancelled'
                GROUP BY cp.student_id
            ) sub
            GROUP BY student_id
        ) counts
        WHERE sp.id = counts.student_id
    """)


def downgrade() -> None:
    op.drop_column('student_profiles', 'total_completed_classes')
