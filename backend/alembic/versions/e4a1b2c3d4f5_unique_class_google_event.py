"""Fase 17 (G2): indice unico (teacher_id, google_event_id) en classes

Antes de crear el indice se eliminan los duplicados (se conserva la fila mas antigua).
Una fila duplicada que tenga dependientes (pagos, participantes, tickets) o que no sea
`external` NO se borra: solo se le limpia google_event_id.

Revision ID: e4a1b2c3d4f5
Revises: d3f7a8b9c0e1
Create Date: 2026-11-21 10:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'e4a1b2c3d4f5'
down_revision = 'd3f7a8b9c0e1'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    dups = bind.execute(sa.text(
        "SELECT id, class_type FROM ("
        " SELECT id, class_type, ROW_NUMBER() OVER ("
        "  PARTITION BY teacher_id, google_event_id ORDER BY id) AS rn"
        " FROM classes WHERE google_event_id IS NOT NULL"
        ") t WHERE rn > 1"
    )).fetchall()

    if dups:
        ids = [r[0] for r in dups]
        referenced = set()
        for table in ("payments", "class_participants", "support_tickets"):
            for i in range(0, len(ids), 500):
                chunk = ids[i:i + 500]
                stmt = sa.text(f"SELECT DISTINCT class_id FROM {table} WHERE class_id IN :ids").bindparams(
                    sa.bindparam("ids", expanding=True))
                referenced.update(r[0] for r in bind.execute(stmt, {"ids": chunk}))
        to_delete = [r[0] for r in dups if str(r[1]).lower().endswith("external") and r[0] not in referenced]
        to_clear = [i for i in ids if i not in set(to_delete)]
        for i in range(0, len(to_delete), 500):
            bind.execute(sa.text("DELETE FROM classes WHERE id IN :ids").bindparams(
                sa.bindparam("ids", expanding=True)), {"ids": to_delete[i:i + 500]})
        for i in range(0, len(to_clear), 500):
            bind.execute(sa.text("UPDATE classes SET google_event_id = NULL WHERE id IN :ids").bindparams(
                sa.bindparam("ids", expanding=True)), {"ids": to_clear[i:i + 500]})

    op.create_index(
        'uq_classes_teacher_google_event', 'classes', ['teacher_id', 'google_event_id'], unique=True,
        postgresql_where=sa.text('google_event_id IS NOT NULL'),
        sqlite_where=sa.text('google_event_id IS NOT NULL'),
    )


def downgrade():
    op.drop_index('uq_classes_teacher_google_event', table_name='classes')
