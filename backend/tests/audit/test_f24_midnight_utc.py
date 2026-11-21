"""Fase 24: medianoche UTC (C1-C6 de docs/TIMEZONE_AUDIT.md).

Rejilla de huecos y validacion de reservas comparten motor (core/slot_availability.py):
lo que la rejilla ofrece se puede reservar y lo que marca ocupado se rechaza, para franjas que
cruzan 00:00 UTC, clases que cruzan la medianoche, bloqueos, Google y dias LOCALES (`tz`).
SQLite del harness de tests/audit; "ahora" congelado en tzmod como las sondas de tests/tz_probes.
"""
from datetime import datetime as _RealDT, timedelta, timezone as dt_tz
from zoneinfo import ZoneInfo

import pytest

import app.api.v1.endpoints.availability as av
import app.core.timezone as tzmod
from app.core.cache import cache_invalidate_prefix
from app.core.class_logic import can_book_slot, get_buffer_minutes_for_type, is_within_teacher_availability
from app.models.availability import TeacherAvailability, TeacherAvailabilityException
from app.models.class_ import Class, ClassType
from app.models.google_calendar import GoogleCalendarToken
from tests.audit.conftest import hdr

API = "/api/v1"
UTC = dt_tz.utc
NOW = "2026-11-19T10:00:00+00:00"  # jueves; Madrid/Bogota/etc. sin cambio de hora en nov-dic


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


def _slots(client, date, user, tz=None, duration=25, class_type="trial", end_date=None):
    params = {"date": date, "duration": duration, "class_type": class_type}
    if tz:
        params["tz"] = tz
    if end_date:
        params["end_date"] = end_date
    r = client.get(f"{API}/availability/profe/slots", params=params, headers=hdr(user))
    assert r.status_code == 200, r.text
    return r.json()


def _u(s):
    return _RealDT.fromisoformat(s.replace("Z", "+00:00")).astimezone(UTC)


def _z(y, m, d, h=0, mi=0):
    return _RealDT(y, m, d, h, mi, tzinfo=UTC)


def _can_book(db, w, start, duration=25, class_type="trial"):
    occ = timedelta(minutes=duration + get_buffer_minutes_for_type(class_type, db))
    return can_book_slot(start, w["tp"].id, w["sp"].id, start + occ, db,
                         enforce_min_notice=False, enforce_availability=True)


def _book_trial(client, w, start_iso):
    return client.post(f"{API}/payments/book", json={
        "teacher_username": "profe", "start_time_utc": start_iso,
        "end_time_utc": start_iso, "duration_minutes": 25}, headers=hdr(w["s_user"]))


def _add_class(db, w, start, minutes=50, buffer=10, status="confirmed"):
    db.add(Class(teacher_id=w["tp"].id, student_id=w["sp"].id, class_type=ClassType.regular,
                 start_time_utc=start, end_time_utc=start + timedelta(minutes=minutes), duration=minutes,
                 buffer_minutes=buffer, status=status))
    db.commit()


def _block(db, w, start, end):
    db.add(TeacherAvailabilityException(teacher_id=w["tp"].id, start_time_utc=start, end_time_utc=end,
                                        is_available=False, reason="bloqueo"))
    db.commit()


# ─── C1: Bogota 18-22 = 23:00-03:00Z ────────────────────────────────────────

@pytest.mark.parametrize("start,ok", [
    (_z(2026, 11, 30, 23, 0), True),
    (_z(2026, 12, 1, 0, 30), True),
    (_z(2026, 12, 1, 2, 30), True),     # bloque 02:30-03:00 cabe justo
    (_z(2026, 12, 1, 2, 45), False),    # se pasa de las 03:00Z
    (_z(2026, 11, 30, 22, 30), False),  # antes de las 23:00Z
])
def test_c1_bogota_evening_range_booking_validation(client, world, db, monkeypatch, start, ok):
    _freeze(monkeypatch)
    _put_weekly(client, world["t_user"], "America/Bogota", [(0, "18:00", "22:00")])
    assert _can_book(db, world, start)[0] is ok


def test_c1_bogota_booking_after_midnight_utc_is_201(client, world, db, monkeypatch):
    _freeze(monkeypatch)
    _put_weekly(client, world["t_user"], "America/Bogota", [(0, "18:00", "22:00")])
    sl = _slots(client, "2026-11-30", world["s_user"], tz="America/Bogota")
    avail = [s["start_time_utc"] for s in sl if s["is_available"]]
    assert "2026-12-01T00:30:00Z" in avail or any(_u(a) == _z(2026, 12, 1, 0, 30) for a in avail)
    r = _book_trial(client, world, "2026-12-01T00:30:00Z")
    assert r.status_code == 201, r.text


# ─── C2: clase que cruza la medianoche UTC bloquea los dos dias ─────────────

def test_c2_class_crossing_utc_midnight_blocks_both_days(client, world, db, monkeypatch):
    _freeze(monkeypatch)
    _put_weekly(client, world["t_user"], "America/Bogota", [(0, "18:00", "22:00")])
    _add_class(db, world, _z(2026, 11, 30, 23, 30), minutes=50, buffer=10)  # 23:30-00:20 (+10 = 00:30)
    sl = {_u(s["start_time_utc"]): s["is_available"]
          for s in _slots(client, "2026-11-30", world["s_user"], tz="America/Bogota")}
    assert sl[_z(2026, 11, 30, 23, 0)] is True        # su bloque (23:00-23:30) termina cuando empieza la clase
    assert sl[_z(2026, 11, 30, 23, 30)] is False
    assert sl[_z(2026, 12, 1, 0, 0)] is False         # cola de la clase tras medianoche
    assert sl[_z(2026, 12, 1, 0, 30)] is True
    # la reserva coincide
    assert _can_book(db, world, _z(2026, 12, 1, 0, 0))[0] is False
    assert _can_book(db, world, _z(2026, 12, 1, 0, 30))[0] is True
    # y consultando por dia UTC (cliente antiguo) el martes tambien sale ocupado
    tue = {_u(s["start_time_utc"]): s["is_available"] for s in _slots(client, "2026-12-01", world["s_user"])}
    assert tue[_z(2026, 12, 1, 0, 0)] is False


# ─── C3: bloqueos parciales tras medianoche UTC ─────────────────────────────

def test_c3_partial_block_after_utc_midnight_applies(client, world, db, monkeypatch):
    _freeze(monkeypatch)
    _put_weekly(client, world["t_user"], "America/Bogota", [(0, "18:00", "22:00")])
    _block(db, world, _z(2026, 12, 1, 1, 0), _z(2026, 12, 1, 2, 0))
    sl = {_u(s["start_time_utc"]): s["is_available"]
          for s in _slots(client, "2026-11-30", world["s_user"], tz="America/Bogota")}
    assert sl[_z(2026, 12, 1, 0, 30)] is True
    assert sl[_z(2026, 12, 1, 1, 0)] is False
    assert sl[_z(2026, 12, 1, 1, 30)] is False
    assert sl[_z(2026, 12, 1, 2, 0)] is True
    assert _can_book(db, world, _z(2026, 12, 1, 1, 0))[0] is False
    ok, msg = is_within_teacher_availability(world["tp"].id, _z(2026, 12, 1, 1, 0), _z(2026, 12, 1, 1, 30), db)
    assert ok is False and "bloque" in msg


def test_c3_block_starting_right_after_window_blocks_last_slot(client, world, db, monkeypatch):
    """Un bloqueo que empieza dentro del margen del ultimo hueco del dia tambien lo bloquea."""
    _freeze(monkeypatch)
    _put_weekly(client, world["t_user"], "America/Bogota", [(0, "18:00", "22:00")])
    # dia local lunes Bogota = 05:00Z lun - 05:00Z mar; ultimo hueco 02:30Z (+30 min). Bloqueo 02:45-03:00Z
    _block(db, world, _z(2026, 12, 1, 2, 45), _z(2026, 12, 1, 3, 0))
    sl = {_u(s["start_time_utc"]): s["is_available"]
          for s in _slots(client, "2026-11-30", world["s_user"], tz="America/Bogota")}
    assert sl[_z(2026, 12, 1, 2, 30)] is False


# ─── C4: Google busy cruzando medianoche (simulado) ─────────────────────────

def test_c4_google_busy_across_midnight_blocks_slots_and_window_is_local_day(client, world, db, monkeypatch):
    _freeze(monkeypatch)
    _put_weekly(client, world["t_user"], "America/Bogota", [(0, "18:00", "22:00")])
    seen = []
    busy = [(_z(2026, 11, 30, 23, 30), _z(2026, 12, 1, 0, 30))]

    def fake_busy(teacher_id, time_min, time_max, db, strict=False):
        seen.append((time_min, time_max))
        return busy
    monkeypatch.setattr(av, "get_teacher_busy_ranges", fake_busy)
    sl = {_u(s["start_time_utc"]): s["is_available"]
          for s in _slots(client, "2026-11-30", world["s_user"], tz="America/Bogota")}
    assert sl[_z(2026, 11, 30, 23, 0)] is True
    assert sl[_z(2026, 11, 30, 23, 30)] is False
    assert sl[_z(2026, 12, 1, 0, 0)] is False
    assert sl[_z(2026, 12, 1, 0, 30)] is True
    # ventana pedida a Google: del 00:00 local del lunes (05:00Z) a 00:00 local del martes + bloque
    assert seen[0][0] == _z(2026, 11, 30, 5, 0)
    assert seen[0][1] >= _z(2026, 12, 1, 5, 30)


def test_c4_booking_checks_google_across_midnight(client, world, db, monkeypatch):
    _freeze(monkeypatch)
    _put_weekly(client, world["t_user"], "America/Bogota", [(0, "18:00", "22:00")])
    db.add(GoogleCalendarToken(user_id=world["t_user"].id, teacher_id=world["tp"].id, access_token="x",
                               is_active=True, needs_reauth=False))
    db.commit()
    import app.core.google_calendar as gc
    monkeypatch.setattr(gc, "get_teacher_busy_ranges",
                        lambda tid, a, b, d, strict=False: [(_z(2026, 11, 30, 23, 30), _z(2026, 12, 1, 0, 30))])
    assert _can_book(db, world, _z(2026, 12, 1, 0, 0))[0] is False
    assert _can_book(db, world, _z(2026, 12, 1, 0, 30))[0] is True


# ─── C5: el dia pedido es el dia LOCAL ──────────────────────────────────────

def test_c5_madrid_monday_30_does_not_show_tuesday_early_slots(client, world, db, monkeypatch):
    _freeze(monkeypatch)
    # Madrid (CET, +1): lun 20:00-23:30 y mar 00:00-03:00 locales
    _put_weekly(client, world["t_user"], "Europe/Madrid", [(0, "20:00", "23:30"), (1, "00:00", "03:00")])
    mad = ZoneInfo("Europe/Madrid")
    mon = [_u(s["start_time_utc"]).astimezone(mad) for s in
           _slots(client, "2026-11-30", world["s_user"], tz="Europe/Madrid")]
    assert mon and all(m.strftime("%Y-%m-%d") == "2026-11-30" for m in mon)
    assert mon[0].strftime("%H:%M") == "20:00" and mon[-1].strftime("%H:%M") == "23:00"
    tue = [_u(s["start_time_utc"]).astimezone(mad) for s in
           _slots(client, "2026-12-01", world["s_user"], tz="Europe/Madrid")]
    assert tue and all(m.strftime("%Y-%m-%d") == "2026-12-01" for m in tue)
    assert tue[0].strftime("%H:%M") == "00:00" and tue[-1].strftime("%H:%M") == "02:30"


def test_c5_caracas_monday_includes_evening_and_not_sunday(client, world, db, monkeypatch):
    _freeze(monkeypatch)
    _put_weekly(client, world["t_user"], "America/Caracas", [(0, "18:00", "23:30"), (6, "19:00", "23:00")])
    ccs = ZoneInfo("America/Caracas")
    mon = [_u(s["start_time_utc"]).astimezone(ccs) for s in
           _slots(client, "2026-11-30", world["s_user"], tz="America/Caracas")]
    assert [m.strftime("%H:%M") for m in mon][:1] == ["18:00"] and mon[-1].strftime("%H:%M") == "23:00"
    assert all(m.strftime("%Y-%m-%d") == "2026-11-30" for m in mon)


def test_c5_legacy_date_without_tz_is_the_utc_day_and_unknown_tz_is_400(client, world, db, monkeypatch):
    _freeze(monkeypatch)
    _put_weekly(client, world["t_user"], "America/Bogota", [(0, "18:00", "22:00")])
    sl = _slots(client, "2026-11-30", world["s_user"])           # dia UTC lun: 23:00 y 23:30 solo
    assert [_u(s["start_time_utc"]).strftime("%d %H:%M") for s in sl] == ["30 23:00", "30 23:30"]
    r = client.get(f"{API}/availability/profe/slots", params={"date": "2026-11-30", "tz": "Mars/Olympus"},
                   headers=hdr(world["s_user"]))
    assert r.status_code == 400
    r = client.get(f"{API}/availability/profe/slots", params={"date": "2026-11-30", "end_date": "2026-11-20"},
                   headers=hdr(world["s_user"]))
    assert r.status_code == 400


def test_c5_multi_day_window_and_cache_key_includes_window(client, world, db, monkeypatch):
    _freeze(monkeypatch)
    _put_weekly(client, world["t_user"], "America/Bogota", [(0, "18:00", "22:00")])
    a = _slots(client, "2026-11-30", world["s_user"], tz="America/Bogota")
    b = _slots(client, "2026-11-30", world["s_user"], tz="Asia/Tokyo")      # mismo `date`, otra ventana
    c = _slots(client, "2026-11-30", world["s_user"], tz="America/Bogota", end_date="2026-12-06")
    assert {s["start_time_utc"] for s in a} != {s["start_time_utc"] for s in b}
    assert {s["start_time_utc"] for s in a} <= {s["start_time_utc"] for s in c}
    assert len(c) == len(a)  # una sola franja semanal: la semana completa trae solo el lunes
    # invalidacion: una clase nueva (commit) se refleja en la siguiente peticion, sin esperar el TTL
    _add_class(db, world, _z(2026, 12, 1, 0, 0), minutes=25, buffer=5)
    a2 = {_u(s["start_time_utc"]): s["is_available"] for s in _slots(client, "2026-11-30", world["s_user"], tz="America/Bogota")}
    assert a2[_z(2026, 12, 1, 0, 0)] is False


# ─── C6: preferencias que cruzan la medianoche UTC ──────────────────────────

def test_c6_preference_crossing_utc_midnight_is_preferred_on_both_sides(client, world, db, monkeypatch):
    _freeze(monkeypatch)
    r = client.put(f"{API}/users/me/preferences", json={"timezone": "America/Caracas", "slots": [
        {"day_of_week": 0, "start_time_local": "19:00", "end_time_local": "21:00"}]},
        headers=hdr(world["s_user"]))
    assert r.status_code == 200, r.text
    assert (r.json()[0]["start_time_utc"], r.json()[0]["end_time_utc"]) == ("23:00", "01:00")
    sl = {_u(s["start_time_utc"]): s["is_preferred"]
          for s in _slots(client, "2026-11-30", world["s_user"], tz="America/Caracas")}
    for h, m, exp in [(22, 30, False), (23, 0, True), (23, 30, True)]:
        assert sl[_z(2026, 11, 30, h, m)] is exp, (h, m)
    for h, m, exp in [(0, 0, True), (0, 30, True), (1, 0, False)]:
        assert sl[_z(2026, 12, 1, h, m)] is exp, (h, m)


# ─── zonas extremas + propiedad rejilla == reserva ──────────────────────────

ZONES = ["America/Bogota", "America/Caracas", "Asia/Kolkata", "Pacific/Auckland", "Etc/GMT+12",
         "Pacific/Kiritimati", "Europe/Madrid", "America/Los_Angeles"]


@pytest.mark.parametrize("zone", ZONES)
def test_grid_equals_booking_for_every_zone(client, world, db, monkeypatch, zone):
    """Cada hueco que la rejilla marca libre se puede reservar y cada uno ocupado se rechaza, y los
    huecos devueltos caen todos en el dia local pedido."""
    _freeze(monkeypatch)
    tzo = ZoneInfo(zone)
    # franjas locales: tarde que acaba antes de medianoche y madrugada, varios dias
    _put_weekly(client, world["t_user"], zone, [
        (0, "18:00", "23:30"), (1, "00:00", "03:00"), (1, "20:00", "23:00"),
        (2, "07:00", "11:00"), (4, "12:00", "16:00"), (5, "22:00", "23:30"), (6, "00:30", "02:00")])
    # una clase, un bloqueo parcial y una clase cancelada (no ocupa) cerca de medianoche local de 2 dias
    for day in ("2026-11-30", "2026-12-01"):
        local_mid = _RealDT.fromisoformat(f"{day}T00:00:00").replace(tzinfo=tzo).astimezone(UTC)
        _add_class(db, world, local_mid - timedelta(minutes=40), minutes=50, buffer=10)   # cruza medianoche local
        _block(db, world, local_mid + timedelta(hours=1), local_mid + timedelta(hours=1, minutes=40))
    _add_class(db, world, _z(2026, 12, 2, 0, 0), minutes=50, buffer=10, status="cancelled")
    cache_invalidate_prefix("slots:")

    total = free = busy = 0
    for day in ("2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"):
        for s in _slots(client, day, world["s_user"], tz=zone):
            st = _u(s["start_time_utc"])
            assert st.astimezone(tzo).strftime("%Y-%m-%d") == day
            ok, msg = _can_book(db, world, st)
            assert ok is s["is_available"], (zone, day, s["start_time_utc"], s["is_available"], msg)
            total += 1
            free += s["is_available"]
            busy += not s["is_available"]
    assert free > 10 and busy > 0
    # un hueco fuera de cualquier franja se rechaza
    thu = _RealDT(2026, 12, 10, 13, 17, tzinfo=tzo).astimezone(UTC)   # jueves local: sin franjas
    assert _can_book(db, world, thu)[0] is False


@pytest.mark.parametrize("zone", ["Asia/Kolkata", "Pacific/Auckland", "Etc/GMT+12", "Pacific/Kiritimati", "America/Caracas"])
def test_extreme_zone_range_booking_roundtrip(client, world, db, monkeypatch, zone):
    _freeze(monkeypatch)
    _put_weekly(client, world["t_user"], zone, [(0, "08:00", "12:00"), (0, "20:00", "23:30")])
    tzo = ZoneInfo(zone)
    sl = [s for s in _slots(client, "2026-11-30", world["s_user"], tz=zone) if s["is_available"]]
    assert [_u(s["start_time_utc"]).astimezone(tzo).strftime("%H:%M") for s in sl][:1] == ["08:00"]
    assert len(sl) == 8 + 7
    for s in sl:
        assert _can_book(db, world, _u(s["start_time_utc"]))[0] is True
