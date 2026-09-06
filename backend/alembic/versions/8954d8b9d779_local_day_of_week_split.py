"""split day_of_week into UTC day vs local_day_of_week

Bug de fondo (encontrado durante testing E2E de disponibilidad):

`TeacherAvailability.day_of_week` y `StudentSchedulePreference.day_of_week`
se guardaban como el día LOCAL que el usuario eligió en su propio
calendario, sin ajustar por el corrimiento de día que puede producir la
conversión a UTC (ej. "Lunes 06:00" en Sydney es en realidad "Domingo
20:00" UTC). Como `get_teacher_available_slots` sí asume que
`day_of_week` es el día real en UTC (compara contra `dt.weekday()` de la
fecha UTC pedida), cualquier profesor con horarios cercanos a la
medianoche en su zona podía aparecer no disponible cuando sí lo estaba,
u ofrecer accidentalmente un horario distinto al que configuró.

Esta migración:
1. Agrega `local_day_of_week` (el día que el usuario realmente eligió,
   estable para siempre, usado por schedule_recalc.py y por el frontend
   para dibujar la grilla semanal).
2. Backfillea `local_day_of_week = day_of_week` para las filas
   existentes (es la mejor reconstrucción posible: para la enorme
   mayoría de filas que nunca sufrieron el bug -osea que no estaban
   cerca de medianoche- esto YA es el valor correcto).
3. Recalcula `day_of_week` (ahora con semántica de día real en UTC) para
   cada fila existente, usando la zona horaria ACTUAL del dueño
   (profesor o estudiante) + local_day_of_week + la hora UTC ya
   guardada (que es correcta en cuanto al valor de horas:minutos, según
   el análisis — solo el día estaba mal).

Revision ID: 8954d8b9d779
Revises: c967d8ad6a4e
Create Date: 2026-09-06 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

revision = '8954d8b9d779'
down_revision = 'c967d8ad6a4e'
branch_labels = None
depends_on = None

UTC = ZoneInfo("UTC")


def _get_next_weekday_date(day_of_week: int, tz: ZoneInfo):
    """Misma lógica que app/core/timezone.py::get_next_weekday_date,
    reimplementada acá para que la migración no dependa del código de
    la app (que puede seguir cambiando después de esta fecha)."""
    now_local = datetime.now(tz)
    today_iso = now_local.weekday()  # 0=Lunes...6=Domingo
    days_ahead = (day_of_week - today_iso) % 7
    return (now_local + timedelta(days=days_ahead)).date()


def _recompute_utc_day(local_day_of_week: int, start_time_utc: str, tz_name: str):
    """Dado el día que el usuario eligió en su calendario + la hora UTC
    ya guardada (correcta en horas:minutos), devuelve el día de la
    semana real en UTC para esa combinación."""
    try:
        tz = ZoneInfo(tz_name or "UTC")
    except Exception:
        tz = UTC

    # 1. Reconstruimos la hora local aproximada (válida salvo el caso
    #    borde de un cambio de DST justo ese día, que no podemos
    #    resolver con certeza retroactivamente de todos modos).
    ref_date = _get_next_weekday_date(local_day_of_week, tz)
    h, m = map(int, start_time_utc.split(":"))
    dt_utc_ref = datetime(ref_date.year, ref_date.month, ref_date.day, h, m, tzinfo=UTC)
    dt_local = dt_utc_ref.astimezone(tz)
    local_time_str = dt_local.strftime("%H:%M")

    # 2. Reconvertimos esa hora local, anclada al día local real, para
    #    obtener el día de la semana real en UTC.
    ref_date_local = _get_next_weekday_date(local_day_of_week, tz)
    lh, lm = map(int, local_time_str.split(":"))
    dt_local2 = datetime(ref_date_local.year, ref_date_local.month, ref_date_local.day, lh, lm, tzinfo=tz)
    dt_utc2 = dt_local2.astimezone(UTC)
    return dt_utc2.weekday()


def _backfill_table(bind, table_name: str, owner_fk_col: str, owner_table: str, owner_pk_col: str):
    rows = bind.execute(sa.text(
        f"""
        SELECT r.id, r.day_of_week, r.start_time_utc, o.timezone AS tz
        FROM {table_name} r
        JOIN {owner_table} o ON o.{owner_pk_col} = r.{owner_fk_col}
        """
    )).fetchall()

    for row in rows:
        new_utc_day = _recompute_utc_day(row.day_of_week, row.start_time_utc, row.tz)
        bind.execute(
            sa.text(f"UPDATE {table_name} SET day_of_week = :d WHERE id = :id"),
            {"d": new_utc_day, "id": row.id},
        )


def upgrade() -> None:
    op.add_column('teacher_availability', sa.Column('local_day_of_week', sa.Integer(), nullable=True))
    op.add_column('student_schedule_preferences', sa.Column('local_day_of_week', sa.Integer(), nullable=True))

    # Backfill: el day_of_week actual (pre-migración) ES el día local
    # que el usuario eligió (ese era el bug: nunca se ajustaba).
    op.execute("UPDATE teacher_availability SET local_day_of_week = day_of_week WHERE local_day_of_week IS NULL")
    op.execute("UPDATE student_schedule_preferences SET local_day_of_week = day_of_week WHERE local_day_of_week IS NULL")

    bind = op.get_bind()
    _backfill_table(bind, 'teacher_availability', 'teacher_id', 'teacher_profiles', 'id')
    _backfill_table(bind, 'student_schedule_preferences', 'student_id', 'student_profiles', 'id')


def downgrade() -> None:
    # No revertimos el day_of_week recalculado (no hay forma de saber
    # cuál era el valor pre-migración sin haberlo respaldado aparte);
    # downgrade solo remueve la columna nueva.
    op.drop_column('student_schedule_preferences', 'local_day_of_week')
    op.drop_column('teacher_availability', 'local_day_of_week')
