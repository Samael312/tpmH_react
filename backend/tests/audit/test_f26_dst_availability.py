"""Fase 26: horario de verano (H1-H5 de docs/TIMEZONE_AUDIT.md).

La disponibilidad semanal se guarda en HORA LOCAL del profesor (dia local + HH:MM local) y se expande por
fecha con zoneinfo: 18:00-20:00 en Madrid es 18:00-20:00 en Madrid antes y despues de los cambios de hora.
Borde del cambio: hora inexistente (salto de primavera) -> se salta (se sujeta al instante del salto);
hora ambigua (retroceso de otono) -> primera ocurrencia (fold=0).
SQLite del harness de tests/audit; "ahora" congelado en tzmod.
"""
import importlib.util
import sqlite3
from datetime import datetime as _RealDT, timedelta, timezone as dt_tz
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

import app.core.timezone as tzmod
from app.core.cache import cache_invalidate_prefix
from app.core.class_logic import can_book_slot, get_buffer_minutes_for_type
from app.models.availability import TeacherAvailability
from app.models.class_ import Class, ClassType
from tests.audit.conftest import hdr

API = "/api/v1"
UTC = dt_tz.utc
NOW = "2026-11-19T10:00:00+00:00"


@pytest.fixture(autouse=True)
def _clean_cache():
    cache_invalidate_prefix("slots:")
    yield
    cache_invalidate_prefix("slots:")


def _freeze(monkeypatch, iso_utc=NOW):
    fixed = _RealDT.fromisoformat(iso_utc)

    class FakeDT(_RealDT):
        @classmethod
        def now(cls, tz=None):
            return fixed.astimezone(tz) if tz else fixed.replace(tzinfo=None)

    monkeypatch.setattr(tzmod, "datetime", FakeDT)
    return fixed


def _put_weekly(client, user, tz, slots):
    body = {"timezone": tz, "slots": [
        {"day_of_week": d, "start_time_local": s, "end_time_local": e} for d, s, e in slots]}
    r = client.put(f"{API}/availability/me/weekly", json=body, headers=hdr(user))
    assert r.status_code == 200, r.text
    return r.json()


def _slots(client, date, user, tz, duration=25, class_type="trial"):
    r = client.get(f"{API}/availability/profe/slots",
                   params={"date": date, "duration": duration, "class_type": class_type, "tz": tz},
                   headers=hdr(user))
    assert r.status_code == 200, r.text
    return r.json()


def _u(s):
    return _RealDT.fromisoformat(s.replace("Z", "+00:00")).astimezone(UTC)


def _z(y, m, d, h=0, mi=0):
    return _RealDT(y, m, d, h, mi, tzinfo=UTC)


def _local_starts(client, date, user, tz, only_free=True):
    tzo = ZoneInfo(tz)
    return [_u(s["start_time_utc"]).astimezone(tzo).strftime("%H:%M")
            for s in _slots(client, date, user, tz) if s["is_available"] or not only_free]


def _can_book(db, w, start, duration=25, class_type="trial"):
    occ = timedelta(minutes=duration + get_buffer_minutes_for_type(class_type, db))
    return can_book_slot(start, w["tp"].id, w["sp"].id, start + occ, db,
                         enforce_min_notice=False, enforce_availability=True)


def _add_class(db, w, start, minutes=50, buffer=10, status="confirmed"):
    db.add(Class(teacher_id=w["tp"].id, student_id=w["sp"].id, class_type=ClassType.regular,
                 start_time_utc=start, end_time_utc=start + timedelta(minutes=minutes), duration=minutes,
                 buffer_minutes=buffer, status=status))
    db.commit()


EVENING = ["18:00", "18:30", "19:00", "19:30"]  # trial 25 + 5 de margen dentro de 18:00-20:00


# ─── H1/H5: 18:00-20:00 local es 18:00-20:00 local todo el anio ─────────────

# (zona, dia de la semana, lunes laborable antes/despues de cada cambio de hora, 2027)
DST_CASES = [
    # Madrid: cambia el domingo 28-mar y el 31-oct de 2027
    ("Europe/Madrid", ["2027-03-22", "2027-03-29", "2027-04-05", "2027-10-25", "2027-11-01", "2027-07-12", "2027-01-11"]),
    # Nueva York: 14-mar y 7-nov de 2027
    ("America/New_York", ["2027-03-08", "2027-03-15", "2027-10-25", "2027-11-01", "2027-11-08", "2027-07-12"]),
    # Auckland (hemisferio sur): 4-abr y 26-sep de 2027
    ("Pacific/Auckland", ["2027-03-29", "2027-04-05", "2027-09-20", "2027-09-27", "2027-01-11"]),
    # controles sin DST
    ("America/Bogota", ["2027-03-22", "2027-03-29", "2027-10-25", "2027-11-01"]),
    ("Asia/Kolkata", ["2027-03-22", "2027-03-29", "2027-10-25", "2027-11-01"]),
]


@pytest.mark.parametrize("zone,mondays", DST_CASES)
def test_weekly_evening_is_same_local_hour_before_and_after_dst(client, world, db, monkeypatch, zone, mondays):
    _freeze(monkeypatch)
    _put_weekly(client, world["t_user"], zone, [(0, "18:00", "20:00")])
    for d in mondays:
        assert _local_starts(client, d, world["s_user"], zone) == EVENING, (zone, d)


def test_madrid_utc_instants_follow_the_offset_of_each_date(client, world, db, monkeypatch):
    _freeze(monkeypatch)
    _put_weekly(client, world["t_user"], "Europe/Madrid", [(0, "18:00", "20:00")])
    winter = [_u(s["start_time_utc"]) for s in _slots(client, "2027-03-22", world["s_user"], "Europe/Madrid")]
    summer = [_u(s["start_time_utc"]) for s in _slots(client, "2027-03-29", world["s_user"], "Europe/Madrid")]
    assert winter[0] == _z(2027, 3, 22, 17, 0)   # CET +1
    assert summer[0] == _z(2027, 3, 29, 16, 0)   # CEST +2
    assert _can_book(db, world, _z(2027, 3, 29, 16, 0))[0] is True
    assert _can_book(db, world, _z(2027, 3, 29, 17, 0))[0] is True    # 19:00 local, cabe
    assert _can_book(db, world, _z(2027, 3, 29, 15, 30))[0] is False  # 17:30 local
    assert _can_book(db, world, _z(2027, 3, 29, 18, 0))[0] is False   # 20:00 local


@pytest.mark.parametrize("zone,first_monday", [
    ("Europe/Madrid", "2027-03-22"), ("Europe/Madrid", "2027-10-25"),
    ("America/New_York", "2027-03-08"), ("America/New_York", "2027-11-01"),
    ("Pacific/Auckland", "2027-03-29"), ("Pacific/Auckland", "2027-09-20"),
    ("America/Bogota", "2027-03-22"), ("Asia/Kolkata", "2027-10-25"),
])
def test_grid_equals_booking_across_transition_week(client, world, db, monkeypatch, zone, first_monday):
    """Para la semana que contiene el cambio de hora: lo que la rejilla marca libre se reserva y lo que no, se rechaza."""
    _freeze(monkeypatch)
    tzo = ZoneInfo(zone)
    _put_weekly(client, world["t_user"], zone, [(d, "18:00", "20:00") for d in range(7)] + [(2, "06:30", "09:00")])
    mon = _RealDT.fromisoformat(first_monday)
    free = 0
    for i in range(10):
        day = (mon + timedelta(days=i)).strftime("%Y-%m-%d")
        for s in _slots(client, day, world["s_user"], zone):
            st = _u(s["start_time_utc"])
            assert st.astimezone(tzo).strftime("%Y-%m-%d") == day
            ok, msg = _can_book(db, world, st)
            assert ok is s["is_available"], (zone, day, s["start_time_utc"], msg)
            free += s["is_available"]
        # el mismo dia ofrece siempre 18:00-19:30 (y el miercoles ademas 06:30-08:30)
        hours = _local_starts(client, day, world["s_user"], zone)
        assert hours[-4:] == EVENING, (zone, day, hours)
    assert free >= 40
    # hueco que no pertenece a ninguna franja local se rechaza (17:30 y 20:00 locales)
    for h, m in [(17, 30), (20, 0)]:
        t = _RealDT.fromisoformat(f"{first_monday}T{h:02d}:{m:02d}:00").replace(tzinfo=tzo).astimezone(UTC)
        assert _can_book(db, world, t)[0] is False


# ─── franjas que cruzan la medianoche local cerca del DST ───────────────────

def test_midnight_crossing_range_near_dst_madrid(client, world, db, monkeypatch):
    """Sab 22:00 -> dom 01:00 locales: antes (CET) 21:00Z-00:00Z, despues (CEST) 20:00Z-23:00Z."""
    _freeze(monkeypatch)
    _put_weekly(client, world["t_user"], "Europe/Madrid", [(5, "22:00", "01:00")])
    for sat, utc_start in (("2027-03-20", _z(2027, 3, 20, 21)), ("2027-04-03", _z(2027, 4, 3, 20))):
        sl = _slots(client, sat, world["s_user"], "Europe/Madrid")
        assert [_u(s["start_time_utc"]) for s in sl][:1] == [utc_start]
        sun = _slots(client, (_RealDT.fromisoformat(sat) + timedelta(days=1)).strftime("%Y-%m-%d"),
                     world["s_user"], "Europe/Madrid")
        tzo = ZoneInfo("Europe/Madrid")
        sun_local = [_u(s["start_time_utc"]).astimezone(tzo).strftime("%H:%M") for s in sun]
        assert sun_local == ["00:00", "00:30"], (sat, sun_local)   # la cola de la noche del sabado
        for s in sl + sun:
            assert _can_book(db, world, _u(s["start_time_utc"]))[0] is s["is_available"]
    # una clase en la cola (domingo 00:00 local tras el cambio) bloquea su hueco
    _add_class(db, world, _z(2027, 4, 3, 22, 0), minutes=25, buffer=5)  # 00:00 CEST del domingo 4-abr
    cache_invalidate_prefix("slots:")
    sun = {_u(s["start_time_utc"]): s["is_available"]
           for s in _slots(client, "2027-04-04", world["s_user"], "Europe/Madrid")}
    assert sun[_z(2027, 4, 3, 22, 0)] is False and sun[_z(2027, 4, 3, 22, 30)] is True


def test_midnight_crossing_new_york_on_changeover_night(client, world, db, monkeypatch):
    """NY sab 13-mar-2027 22:00 -> dom 02:00 (02:00 no existe): termina en el salto (07:00Z). Tiene 5 h reales -> 4 h."""
    _freeze(monkeypatch)
    _put_weekly(client, world["t_user"], "America/New_York", [(5, "22:00", "02:00")])
    sat = [_u(s["start_time_utc"]) for s in _slots(client, "2027-03-13", world["s_user"], "America/New_York")]
    sun = [_u(s["start_time_utc"]) for s in _slots(client, "2027-03-14", world["s_user"], "America/New_York")]
    allv = sat + sun
    assert allv[0] == _z(2027, 3, 14, 3, 0)    # 22:00 EST
    assert allv[-1] == _z(2027, 3, 14, 6, 30)  # ultimo hueco (30 min) antes de las 07:00Z (salto 02:00->03:00 EDT)
    assert _can_book(db, world, _z(2027, 3, 14, 6, 30))[0] is True
    assert _can_book(db, world, _z(2027, 3, 14, 7, 0))[0] is False


# ─── hora inexistente / ambigua ─────────────────────────────────────────────

def test_nonexistent_local_hours_are_skipped(client, world, db, monkeypatch):
    """Madrid dom 28-mar-2027: 02:00-03:00 locales no existen. Franja 02:30-04:00 -> empieza en el salto (03:00 CEST)."""
    _freeze(monkeypatch)
    _put_weekly(client, world["t_user"], "Europe/Madrid", [(6, "02:30", "04:00"), (6, "10:00", "12:00")])
    tzo = ZoneInfo("Europe/Madrid")
    got = [_u(s["start_time_utc"]).astimezone(tzo).strftime("%H:%M")
           for s in _slots(client, "2027-03-28", world["s_user"], "Europe/Madrid")]
    assert got == ["03:00", "03:30", "10:00", "10:30", "11:00", "11:30"]
    assert _can_book(db, world, _z(2027, 3, 28, 1, 0))[0] is True      # 03:00 CEST
    assert _can_book(db, world, _z(2027, 3, 28, 0, 30))[0] is False    # 01:30 CET "inexistente"... fuera de la franja
    # franja entera dentro del hueco -> sin huecos, sin romper
    _put_weekly(client, world["t_user"], "Europe/Madrid", [(6, "02:10", "02:50")])
    assert _slots(client, "2027-03-28", world["s_user"], "Europe/Madrid") == []


def test_ambiguous_local_hours_use_first_occurrence(client, world, db, monkeypatch):
    """Madrid dom 31-oct-2027: 02:00-03:00 ocurren dos veces. Franja 02:30-04:00 empieza en la primera (CEST)."""
    _freeze(monkeypatch)
    _put_weekly(client, world["t_user"], "Europe/Madrid", [(6, "02:30", "04:00")])
    sl = [_u(s["start_time_utc"]) for s in _slots(client, "2027-10-31", world["s_user"], "Europe/Madrid")]
    assert sl[0] == _z(2027, 10, 31, 0, 30)    # 02:30 CEST (primera ocurrencia)
    assert sl[-1] == _z(2027, 10, 31, 2, 30)   # termina 04:00 CET (03:00Z)
    assert len(sl) == 5                        # 5 h... 2,5 h reales: 00:30Z-03:00Z
    for s in sl:
        assert _can_book(db, world, s)[0] is True
    assert _can_book(db, world, _z(2027, 10, 31, 0, 0))[0] is False


# ─── cambio de zona del profesor: conserva la hora local ────────────────────

def test_teacher_zone_change_keeps_local_wall_time(client, world, db, monkeypatch):
    _freeze(monkeypatch)
    _put_weekly(client, world["t_user"], "Europe/Madrid", [(0, "18:00", "20:00")])
    r = client.patch(f"{API}/teachers/me/profile", json={"timezone": "America/Bogota"}, headers=hdr(world["t_user"]))
    assert r.status_code == 200, r.text
    for d in ("2027-01-11", "2027-04-05", "2027-10-25"):
        assert _local_starts(client, d, world["s_user"], "America/Bogota") == EVENING
    # en UTC: 23:00Z (Bogota -5) todo el anio
    first = _u(_slots(client, "2027-04-05", world["s_user"], "America/Bogota")[0]["start_time_utc"])
    assert first == _z(2027, 4, 5, 23, 0)
    rows = client.get(f"{API}/availability/me/weekly", headers=hdr(world["t_user"])).json()
    assert [(x["day_of_week"], x["start_time_local"], x["end_time_local"], x["timezone"]) for x in rows] == [
        (0, "18:00", "20:00", "America/Bogota")]
    # y de vuelta a Madrid: sigue siendo 18:00-20:00 local
    client.patch(f"{API}/teachers/me/profile", json={"timezone": "Europe/Madrid"}, headers=hdr(world["t_user"]))
    assert _local_starts(client, "2027-04-05", world["s_user"], "Europe/Madrid") == EVENING


def test_zone_change_does_not_touch_existing_classes_and_cache_is_invalidated(client, world, db, monkeypatch):
    _freeze(monkeypatch)
    _put_weekly(client, world["t_user"], "Europe/Madrid", [(0, "18:00", "20:00")])
    start = _z(2027, 4, 5, 16, 0)   # 18:00 CEST
    _add_class(db, world, start, minutes=25, buffer=5)
    before = _slots(client, "2027-04-05", world["s_user"], "Europe/Madrid")   # llena la cache
    assert before[0]["is_available"] is False
    client.patch(f"{API}/teachers/me/profile", json={"timezone": "Asia/Kolkata"}, headers=hdr(world["t_user"]))
    db.expire_all()
    assert db.query(Class).one().start_time_utc.replace(tzinfo=UTC) == start    # la clase es un instante UTC
    # el horario ahora es 18:00-20:00 Kolkata: la rejilla de Kolkata ya no usa la cache de Madrid
    ist = ZoneInfo("Asia/Kolkata")
    sl = _slots(client, "2027-04-05", world["s_user"], "Asia/Kolkata")
    assert _u(sl[0]["start_time_utc"]).astimezone(ist).strftime("%H:%M") == "18:00"
    # y en la rejilla de Madrid (consulta del mismo dia) ya no sale 18:00 CEST como hueco
    mad = _slots(client, "2027-04-05", world["s_user"], "Europe/Madrid")
    assert all(_u(s["start_time_utc"]) != start for s in mad)


# ─── contrato de la API semanal ─────────────────────────────────────────────

def test_weekly_api_exchanges_local_times_and_zone(client, world, db, monkeypatch):
    _freeze(monkeypatch)
    out = _put_weekly(client, world["t_user"], "Europe/Madrid", [(0, "18:00", "20:00"), (3, "22:00", "01:00")])
    assert {(r["day_of_week"], r["start_time_local"], r["end_time_local"], r["timezone"]) for r in out} == {
        (0, "18:00", "20:00", "Europe/Madrid"), (3, "22:00", "01:00", "Europe/Madrid")}
    got = client.get(f"{API}/availability/me/weekly", headers=hdr(world["t_user"])).json()
    assert [(r["day_of_week"], r["start_time_local"], r["end_time_local"]) for r in got] == [
        (0, "18:00", "20:00"), (3, "22:00", "01:00")]
    # la fila guarda la hora local tal cual (sin conversion a UTC)
    row = db.query(TeacherAvailability).filter(TeacherAvailability.day_of_week == 0,
                                               TeacherAvailability.teacher_id == world["tp"].id).one()
    assert (row.start_time_local, row.end_time_local) == ("18:00", "20:00")


def test_put_weekly_with_other_zone_updates_teacher_zone(client, world, db, monkeypatch):
    _freeze(monkeypatch)
    _put_weekly(client, world["t_user"], "America/Bogota", [(0, "18:00", "20:00")])
    db.expire_all()
    assert world["tp"].timezone == "America/Bogota"


# ─── migracion de datos UTC -> local ────────────────────────────────────────

def _load_migration():
    p = next((Path(__file__).resolve().parents[2] / "alembic" / "versions").glob("*f26_local_weekly*.py"))
    spec = importlib.util.spec_from_file_location("mig_f26", p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


# fila UTC vieja = lo que escribia convert_local_time_to_utc con la fecha de la proxima ocurrencia de ese dia
# local_day, utc_day, start_utc, end_utc  <- tomadas del comportamiento antiguo en 2026-11-19 (jueves)
MIG_CASES = [
    # Madrid (CET en nov): lunes 18:00-20:00 local = 17:00-19:00Z
    ("Europe/Madrid", 0, 0, "17:00", "19:00", ("18:00", "20:00", 0)),
    # NY (EST): lunes 18-20 = 23:00-01:00Z (cruza medianoche UTC; dia UTC = lunes)
    ("America/New_York", 0, 0, "23:00", "01:00", ("18:00", "20:00", 0)),
    # Bogota: lunes 18-22 = 23:00-03:00Z
    ("America/Bogota", 0, 0, "23:00", "03:00", ("18:00", "22:00", 0)),
    # Kolkata: lunes 03:00-05:00 = domingo 21:30-23:30Z (dia UTC 6)
    ("Asia/Kolkata", 0, 6, "21:30", "23:30", ("03:00", "05:00", 0)),
    # Auckland (NZDT en nov, +13): lunes 08:00-10:00 = domingo 19:00-21:00Z
    ("Pacific/Auckland", 0, 6, "19:00", "21:00", ("08:00", "10:00", 0)),
    # sin zona / invalida -> UTC
    (None, 2, 2, "09:00", "12:00", ("09:00", "12:00", 2)),
    ("Mars/Olympus", 4, 4, "09:00", "12:00", ("09:00", "12:00", 4)),
    # fila antigua sin local_day_of_week: se deduce desde el dia UTC y la zona
    ("Asia/Kolkata", None, 6, "21:30", "23:30", ("03:00", "05:00", 0)),
]


@pytest.mark.parametrize("zone,local_dow,utc_dow,s,e,expected", MIG_CASES)
def test_migration_converts_utc_rows_to_local_wall_time(zone, local_dow, utc_dow, s, e, expected):
    mig = _load_migration()
    con = sqlite3.connect(":memory:")
    con.execute("CREATE TABLE teacher_profiles (id INTEGER PRIMARY KEY, timezone TEXT)")
    con.execute("CREATE TABLE teacher_availability (id INTEGER PRIMARY KEY, teacher_id INTEGER, day_of_week INTEGER,"
                " local_day_of_week INTEGER, start_time_utc TEXT, end_time_utc TEXT, is_available BOOLEAN)")
    con.execute("INSERT INTO teacher_profiles VALUES (1, ?)", (zone,))
    con.execute("INSERT INTO teacher_availability VALUES (1, 1, ?, ?, ?, ?, 1)", (utc_dow, local_dow, s, e))
    rows = con.execute("SELECT id, teacher_id, day_of_week, local_day_of_week, start_time_utc, end_time_utc FROM"
                       " teacher_availability").fetchall()
    zones = dict(con.execute("SELECT id, timezone FROM teacher_profiles").fetchall())
    out = mig.convert_rows_utc_to_local(rows, zones, _RealDT(2026, 11, 19, 10, 0, tzinfo=UTC))
    assert out == [(1, expected[2], expected[0], expected[1])]


def test_migration_downgrade_roundtrip_is_inverse_for_current_offsets():
    mig = _load_migration()
    now = _RealDT(2026, 11, 19, 10, 0, tzinfo=UTC)
    zones = {1: "Europe/Madrid", 2: "Asia/Kolkata", 3: "America/Bogota"}
    old = [(1, 1, 0, 0, "17:00", "19:00"), (2, 2, 6, 0, "21:30", "23:30"), (3, 3, 0, 0, "23:00", "03:00")]
    local = mig.convert_rows_utc_to_local(old, zones, now)
    back = mig.convert_rows_local_to_utc([(i, t, dow, s, e) for (i, dow, s, e), (_, t, *_x) in zip(local, old)],
                                         zones, now)
    assert back == [(1, 0, 0, "17:00", "19:00"), (2, 6, 0, "21:30", "23:30"), (3, 0, 0, "23:00", "03:00")]
