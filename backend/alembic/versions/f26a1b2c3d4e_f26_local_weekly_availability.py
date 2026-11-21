"""Fase 26: disponibilidad semanal del profesor en HORA LOCAL (horario de verano)

Antes: `teacher_availability` guardaba `HH:MM` UTC (+ `day_of_week` UTC + `local_day_of_week`) calculado con el
desfase de la PROXIMA fecha de ese dia (`convert_local_time_to_utc`), de modo que con DST el profesor ofrecia
una hora distinta a la elegida durante ~31-34 semanas al anio y cada cambio de zona congelaba el desfase.

Ahora: `day_of_week` = dia LOCAL, `start_time_local`/`end_time_local` = hora de reloj local, interpretadas con la
zona IANA ACTUAL de `teacher_profiles.timezone`; el UTC de cada fecha se calcula al consultar.

Datos: cada fila se convierte con la zona actual del profesor y la MISMA referencia que usaba el codigo viejo
(la proxima ocurrencia de ese dia local a partir de hoy), asi lo que se ofrecia hoy sigue siendo lo mismo.
Profesor sin zona o con zona invalida -> 'UTC' (las filas se quedan como estaban en HH:MM). La duracion de la
franja se conserva (fin = inicio + ((fin_utc - inicio_utc) mod 24 h); 0 -> 24 h).
Downgrade: mejor esfuerzo (usa el desfase de hoy; el desfase de verano vuelve a quedar congelado).

Revision ID: f26a1b2c3d4e
Revises: f25a1b2c3d4e
Create Date: 2026-11-21 22:00:00.000000
"""
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from alembic import op
import sqlalchemy as sa

revision = 'f26a1b2c3d4e'
down_revision = 'f25a1b2c3d4e'
branch_labels = None
depends_on = None

UTC = timezone.utc
_DAY = timedelta(hours=24)


def _zone(name):
    """ZoneInfo de la zona del profesor; nula o invalida -> UTC."""
    try:
        return ZoneInfo(name) if name else ZoneInfo("UTC")
    except Exception:
        return ZoneInfo("UTC")


def _next_weekday(dow, tz, now):
    """Fecha local de la proxima ocurrencia (hoy incluido) del dia `dow` (0=lunes), como el codigo viejo."""
    now_local = now.astimezone(tz)
    return now_local.date() + timedelta(days=(dow - now_local.weekday()) % 7)


def _hm(text):
    h, m = text.split(":")
    return int(h), int(m)


def _duration(start_hhmm, end_hhmm):
    sh, sm = _hm(start_hhmm)
    eh, em = _hm(end_hhmm)
    d = timedelta(hours=eh, minutes=em) - timedelta(hours=sh, minutes=sm)
    if d <= timedelta(0):
        d += _DAY
    return d


def convert_rows_utc_to_local(rows, zones, now):
    """rows: (id, teacher_id, day_of_week_utc, local_day_of_week|None, start_utc, end_utc);
    zones: {teacher_id: nombre IANA | None}. Devuelve [(id, day_of_week_local, start_local, end_local)]."""
    out = []
    for rid, tid, utc_dow, local_dow, s_utc, e_utc in rows:
        tz = _zone(zones.get(tid))
        try:
            sh, sm = _hm(s_utc)
            dur = _duration(s_utc, e_utc)
            if local_dow is None:
                # fila antigua sin dia local: proxima fecha UTC con ese dia UTC, y el dia local sale del instante
                base = now.astimezone(UTC).date()
                d = base + timedelta(days=(utc_dow - base.weekday()) % 7)
                inst = datetime(d.year, d.month, d.day, sh, sm, tzinfo=UTC)
                local_dow = inst.astimezone(tz).weekday()
                start_local = inst.astimezone(tz)
            else:
                ref = _next_weekday(local_dow, tz, now)
                cands = [datetime(x.year, x.month, x.day, sh, sm, tzinfo=UTC)
                         for x in (ref - timedelta(days=1), ref, ref + timedelta(days=1))]
                on_ref = [c for c in cands if c.astimezone(tz).date() == ref]
                best = [c for c in on_ref if c.weekday() == utc_dow] or on_ref or [cands[1]]
                start_local = best[0].astimezone(tz)
            end_local = start_local + dur
            out.append((rid, local_dow, start_local.strftime("%H:%M"), end_local.strftime("%H:%M")))
        except (ValueError, AttributeError):
            out.append((rid, local_dow if local_dow is not None else utc_dow, s_utc, e_utc))
    return out


def convert_rows_local_to_utc(rows, zones, now):
    """rows: (id, teacher_id, day_of_week_local, start_local, end_local). Devuelve
    [(id, day_of_week_utc, local_day_of_week, start_utc, end_utc)] con el desfase de la proxima ocurrencia."""
    out = []
    for rid, tid, dow, s_loc, e_loc in rows:
        tz = _zone(zones.get(tid))
        try:
            sh, sm = _hm(s_loc)
            dur = _duration(s_loc, e_loc)
            ref = _next_weekday(dow, tz, now)
            inst = datetime(ref.year, ref.month, ref.day, sh, sm, tzinfo=tz).astimezone(UTC)
            out.append((rid, inst.weekday(), dow, inst.strftime("%H:%M"), (inst + dur).strftime("%H:%M")))
        except (ValueError, AttributeError):
            out.append((rid, dow, dow, s_loc, e_loc))
    return out


def upgrade():
    bind = op.get_bind()
    zones = {r[0]: r[1] for r in bind.execute(sa.text("SELECT id, timezone FROM teacher_profiles")).fetchall()}
    rows = bind.execute(sa.text(
        "SELECT id, teacher_id, day_of_week, local_day_of_week, start_time_utc, end_time_utc FROM teacher_availability"
    )).fetchall()
    converted = convert_rows_utc_to_local([tuple(r) for r in rows], zones, datetime.now(UTC))

    op.alter_column('teacher_availability', 'start_time_utc', new_column_name='start_time_local')
    op.alter_column('teacher_availability', 'end_time_utc', new_column_name='end_time_local')
    for rid, dow, s, e in converted:
        bind.execute(sa.text(
            "UPDATE teacher_availability SET day_of_week = :d, start_time_local = :s, end_time_local = :e WHERE id = :i"
        ), {"d": dow, "s": s, "e": e, "i": rid})
    op.drop_column('teacher_availability', 'local_day_of_week')


def downgrade():
    bind = op.get_bind()
    zones = {r[0]: r[1] for r in bind.execute(sa.text("SELECT id, timezone FROM teacher_profiles")).fetchall()}
    rows = bind.execute(sa.text(
        "SELECT id, teacher_id, day_of_week, start_time_local, end_time_local FROM teacher_availability"
    )).fetchall()
    converted = convert_rows_local_to_utc([tuple(r) for r in rows], zones, datetime.now(UTC))

    op.add_column('teacher_availability', sa.Column('local_day_of_week', sa.Integer(), nullable=True))
    op.alter_column('teacher_availability', 'start_time_local', new_column_name='start_time_utc')
    op.alter_column('teacher_availability', 'end_time_local', new_column_name='end_time_utc')
    for rid, utc_dow, local_dow, s, e in converted:
        bind.execute(sa.text(
            "UPDATE teacher_availability SET day_of_week = :d, local_day_of_week = :l, start_time_utc = :s,"
            " end_time_utc = :e WHERE id = :i"
        ), {"d": utc_dow, "l": local_dow, "s": s, "e": e, "i": rid})
