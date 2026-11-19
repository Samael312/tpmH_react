"""Sondas de auditoria: el PROFESOR cambia de zona horaria (y bordes de disponibilidad).

Convencion (igual que tests/tenant_probes): cada test `test_bug_*` afirma el
comportamiento ACTUAL; si pasa, el hallazgo existe hoy. Los `test_ok_*` son
controles: si pasan, esa parte funciona bien.
SQLite en memoria (harness de tests/audit); no toca .env ni la BD real.
"""
from datetime import datetime, timedelta, timezone as dt_tz

import pytest

import app.core.timezone as tzmod
from app.core.class_logic import is_within_teacher_availability
from app.core.timezone import utc_now
from app.models.availability import TeacherAvailability, TeacherAvailabilityException
from app.models.class_ import Class, ClassType
from app.models.teacher import TeacherProfile
from tests.audit.conftest import hdr

API = "/api/v1"


# ─── helpers ────────────────────────────────────────────────────────────────

def _reset_teacher(db, tp, tz):
    db.query(TeacherAvailability).filter(TeacherAvailability.teacher_id == tp.id).delete()
    tp.timezone = tz
    db.commit()


def _put_weekly(client, user, tz, slots):
    body = {"timezone": tz, "slots": [
        {"day_of_week": d, "start_time_local": s, "end_time_local": e} for d, s, e in slots]}
    return client.put(f"{API}/availability/me/weekly", json=body, headers=hdr(user))


def _patch_tz(client, user, tz):
    return client.patch(f"{API}/teachers/me/profile", json={"timezone": tz}, headers=hdr(user))


def _rows(db, tp):
    db.expire_all()
    return sorted(
        [(r.local_day_of_week, r.day_of_week, r.start_time_utc, r.end_time_utc)
         for r in db.query(TeacherAvailability).filter(TeacherAvailability.teacher_id == tp.id)],
    )


def _next_utc_date(weekday, min_days=4):
    d = (utc_now() + timedelta(days=min_days)).date()
    while d.weekday() != weekday:
        d += timedelta(days=1)
    return d


def _utc(d, h, m=0):
    return datetime(d.year, d.month, d.day, h, m, tzinfo=dt_tz.utc)


def _fixed_now(monkeypatch, fixed):
    class _DT(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed.astimezone(tz) if tz else fixed.replace(tzinfo=None)
    monkeypatch.setattr(tzmod, "datetime", _DT)


# ─── Controles: conversion y recalculo basico ───────────────────────────────

@pytest.mark.parametrize("tz,local,expected", [
    # Bogota UTC-5: lunes 17-21 local -> lunes 22:00-02:00 UTC (cruza medianoche UTC)
    ("America/Bogota", (0, "17:00", "21:00"), (0, 0, "22:00", "02:00")),
    # Tokio UTC+9: lunes 08-10 -> domingo 23:00-01:00 UTC
    ("Asia/Tokyo", (0, "08:00", "10:00"), (0, 6, "23:00", "01:00")),
    # Kolkata UTC+5:30: lunes 03-05 -> domingo 21:30-23:30 UTC
    ("Asia/Kolkata", (0, "03:00", "05:00"), (0, 6, "21:30", "23:30")),
    # Kiritimati UTC+14: lunes 08-10 -> domingo 18:00-20:00 UTC
    ("Pacific/Kiritimati", (0, "08:00", "10:00"), (0, 6, "18:00", "20:00")),
    # UTC-12: lunes 20-23 -> martes 08:00-11:00 UTC
    ("Etc/GMT+12", (0, "20:00", "23:00"), (0, 1, "08:00", "11:00")),
    # Bogota, franja local que cruza medianoche local (22:00-02:00) -> mar 03:00-07:00 UTC
    ("America/Bogota", (0, "22:00", "02:00"), (0, 1, "03:00", "07:00")),
])
def test_ok_put_weekly_extreme_offsets(client, world, db, tz, local, expected):
    _reset_teacher(db, world["tp"], tz)
    r = _put_weekly(client, world["t_user"], tz, [local])
    assert r.status_code == 200, r.text
    assert _rows(db, world["tp"]) == [expected]


@pytest.mark.parametrize("old_tz,new_tz,expected", [
    ("America/Bogota", "Asia/Tokyo", (0, 6, "23:00", "03:00")),      # 08-12 Tokio -> dom 23:00-03:00
    ("Asia/Tokyo", "Etc/GMT+12", (0, 0, "20:00", "00:00")),          # 08-12 UTC-12 -> lun 20:00-00:00
    ("Asia/Kolkata", "Pacific/Kiritimati", (0, 6, "18:00", "22:00")),
    ("Pacific/Kiritimati", "Asia/Kolkata", (0, 0, "02:30", "06:30")),
])
def test_ok_tz_change_preserves_local_time_and_day(client, world, db, old_tz, new_tz, expected):
    _reset_teacher(db, world["tp"], old_tz)
    assert _put_weekly(client, world["t_user"], old_tz, [(0, "08:00", "12:00")]).status_code == 200
    r = _patch_tz(client, world["t_user"], new_tz)
    assert r.status_code == 200, r.text
    assert _rows(db, world["tp"]) == [expected]


def test_ok_same_tz_twice_and_same_offset_is_noop(client, world, db):
    _reset_teacher(db, world["tp"], "America/Bogota")
    _put_weekly(client, world["t_user"], "America/Bogota", [(2, "09:00", "11:00")])
    before = _rows(db, world["tp"])
    assert _patch_tz(client, world["t_user"], "America/Bogota").status_code == 200
    assert _patch_tz(client, world["t_user"], "America/Lima").status_code == 200  # mismo offset
    assert _rows(db, world["tp"]) == before


def test_ok_booked_class_instant_not_moved_by_tz_change(client, world, db):
    tp = world["tp"]
    _reset_teacher(db, tp, "America/Bogota")
    _put_weekly(client, world["t_user"], "America/Bogota", [(0, "09:00", "12:00")])
    d = _next_utc_date(0)
    c = Class(teacher_id=tp.id, student_id=world["sp"].id, class_type=ClassType.regular,
              status="confirmed", start_time_utc=_utc(d, 14), end_time_utc=_utc(d, 14, 50),
              duration=50, teacher_timezone="America/Bogota", student_timezone="UTC")
    db.add(c)
    db.commit()
    assert _patch_tz(client, world["t_user"], "Asia/Tokyo").status_code == 200
    db.expire_all()
    c = db.get(Class, c.id)
    assert c.start_time_utc.replace(tzinfo=dt_tz.utc) == _utc(d, 14)
    assert c.teacher_timezone == "America/Bogota"  # snapshot no se toca


# ─── P1: franja semanal que cruza medianoche UTC ────────────────────────────

def test_bug_wrapped_slot_ignores_next_day_classes_and_blocks(client, world, db):
    """Fila del lunes 22:00-02:00 UTC (= Bogota 17-21). Las clases y excepciones del
    martes 00:00-02:00 UTC NO se ven en la consulta del lunes -> slots ocupados se
    ofrecen como libres."""
    tp = world["tp"]
    _reset_teacher(db, tp, "UTC")
    db.add(TeacherAvailability(teacher_id=tp.id, day_of_week=0, local_day_of_week=0,
                               start_time_utc="22:00", end_time_utc="02:00", is_available=True))
    mon = _next_utc_date(0)
    tue = mon + timedelta(days=1)
    db.add(Class(teacher_id=tp.id, student_id=world["sp"].id, class_type=ClassType.regular,
                 status="confirmed", start_time_utc=_utc(tue, 0), end_time_utc=_utc(tue, 0, 50),
                 duration=50))
    db.add(TeacherAvailabilityException(teacher_id=tp.id, start_time_utc=_utc(tue, 1),
                                        end_time_utc=_utc(tue, 2), is_available=False, reason="bloqueo"))
    db.commit()
    r = client.get(f"{API}/availability/{tp.user_username}/slots",
                   params={"date": mon.isoformat(), "duration": 25, "class_type": "regular"}, headers=hdr(world["s_user"]))
    assert r.status_code == 200, r.text
    by_start = {s["start_time_utc"][:16]: s["is_available"] for s in r.json()}
    assert by_start[f"{tue.isoformat()}T00:00"] is True   # ocupado por la clase, se ofrece libre
    assert by_start[f"{tue.isoformat()}T01:00"] is True   # bloqueado por excepcion, se ofrece libre


def test_bug_wrapped_slot_after_midnight_rejected_by_booking_validation(client, world, db):
    """El slot martes 00:30 UTC se OFRECE (consulta del lunes) pero la validacion de
    reserva del alumno (enforce_availability) lo rechaza: solo mira filas del martes."""
    tp = world["tp"]
    _reset_teacher(db, tp, "UTC")
    db.add(TeacherAvailability(teacher_id=tp.id, day_of_week=0, local_day_of_week=0,
                               start_time_utc="22:00", end_time_utc="02:00", is_available=True))
    db.commit()
    mon = _next_utc_date(0)
    tue = mon + timedelta(days=1)
    r = client.get(f"{API}/availability/{tp.user_username}/slots",
                   params={"date": mon.isoformat(), "duration": 25, "class_type": "regular"}, headers=hdr(world["s_user"]))
    offered = {s["start_time_utc"][:16] for s in r.json() if s["is_available"]}
    assert f"{tue.isoformat()}T00:30" in offered
    ok, _ = is_within_teacher_availability(tp.id, _utc(tue, 0, 30), _utc(tue, 1, 5), db)
    assert ok is False
    # y antes de medianoche si se acepta
    ok2, _ = is_within_teacher_availability(tp.id, _utc(mon, 22, 30), _utc(mon, 23, 5), db)
    assert ok2 is True


# ─── P2: valores de zona horaria invalidos/vacios en el perfil ──────────────

@pytest.mark.parametrize("bad", ["Foo/Bar", "UTC+3"])
def test_bug_profile_invalid_tz_crashes_500(client, world, db, bad):
    r = _patch_tz(client, world["t_user"], bad)
    assert r.status_code == 500  # ZoneInfo(new_tz) en _recalc_exception_rows sin capturar


def test_bug_profile_invalid_tz_saved_when_old_tz_empty(client, world, db):
    """Si la tz vieja es vacia/None no se recalcula y NADA valida la nueva: se guarda basura."""
    tp = world["tp"]
    tp.timezone = None
    db.commit()
    r = _patch_tz(client, world["t_user"], "Foo/Bar")
    assert r.status_code == 200
    db.expire_all()
    assert db.get(TeacherProfile, tp.id).timezone == "Foo/Bar"


@pytest.mark.parametrize("empty", ["", None])
def test_bug_profile_empty_tz_saved_then_next_change_skips_recalc(client, world, db, empty):
    tp = world["tp"]
    _reset_teacher(db, tp, "America/Bogota")
    _put_weekly(client, world["t_user"], "America/Bogota", [(0, "09:00", "11:00")])
    assert _rows(db, tp) == [(0, 0, "14:00", "16:00")]
    r = _patch_tz(client, world["t_user"], empty)
    assert r.status_code == 200
    db.expire_all()
    assert db.get(TeacherProfile, tp.id).timezone == empty
    # ahora pasa a Tokio: old_tz vacio -> recalc omitido -> el horario queda en 04:00-06:00 Tokio
    assert _patch_tz(client, world["t_user"], "Asia/Tokyo").status_code == 200
    assert _rows(db, tp) == [(0, 0, "14:00", "16:00")]  # deberia ser (0, 6, "00:00", "02:00")


def test_bug_legacy_alias_tz_accepted(client, world, db):
    """'EST' (offset fijo -5, sin DST) y 'Etc/GMT+3' (= UTC-3, signo invertido) se aceptan."""
    for tz in ("EST", "Etc/GMT+3"):
        assert _patch_tz(client, world["t_user"], tz).status_code == 200
    assert tzmod.validate_timezone("EST") is True


def test_bug_users_me_timezone_silently_ignored(client, world, db):
    """PATCH /users/me acepta `timezone` (UpdateProfileRequest) pero User no tiene esa
    columna: 200 y no cambia nada (ni perfil de profesor ni recalc)."""
    tp = world["tp"]
    r = client.patch(f"{API}/users/me", json={"timezone": "Asia/Tokyo"}, headers=hdr(world["t_user"]))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(TeacherProfile, tp.id).timezone == "UTC"


# ─── P3: la tz del cuerpo de PUT /weekly no se guarda ni se compara con el perfil ─

def test_bug_weekly_tz_mismatch_with_profile_breaks_later_recalc(client, world, db):
    tp = world["tp"]
    _reset_teacher(db, tp, "UTC")  # perfil dice UTC (p.ej. navegador en otra tz o default)
    _put_weekly(client, world["t_user"], "America/Bogota", [(0, "09:00", "11:00")])  # 14-16 UTC
    db.expire_all()
    assert db.get(TeacherProfile, tp.id).timezone == "UTC"  # PUT no actualiza el perfil
    assert _patch_tz(client, world["t_user"], "America/Bogota").status_code == 200
    # recalc cree que 14:00 era hora local UTC -> lo pasa a 14:00 Bogota = 19:00 UTC
    assert _rows(db, tp) == [(0, 0, "19:00", "21:00")]  # el profe queria 09-11 Bogota (14-16)


# ─── P4: recalculo con DST usa el offset de HOY, no el del momento en que se guardo ─

def test_bug_dst_recalc_bakes_wrong_local_hour(client, world, db, monkeypatch):
    tp = world["tp"]
    _reset_teacher(db, tp, "Europe/Madrid")
    _fixed_now(monkeypatch, datetime(2027, 7, 5, 12, tzinfo=dt_tz.utc))   # verano (UTC+2)
    _put_weekly(client, world["t_user"], "Europe/Madrid", [(0, "09:00", "11:00")])
    assert _rows(db, tp) == [(0, 0, "07:00", "09:00")]
    _fixed_now(monkeypatch, datetime(2027, 1, 11, 12, tzinfo=dt_tz.utc))  # invierno (UTC+1)
    assert _patch_tz(client, world["t_user"], "America/Bogota").status_code == 200
    # 07:00 UTC se lee como 08:00 Madrid (invierno) -> 08:00 Bogota = 13:00 UTC; el profe dijo 09:00
    assert _rows(db, tp) == [(0, 0, "13:00", "15:00")]


# ─── P5: filas viejas sin local_day_of_week se corren de DIA ────────────────

def test_bug_legacy_row_without_local_day_shifts_day(client, world, db):
    tp = world["tp"]
    _reset_teacher(db, tp, "Asia/Tokyo")
    # lunes 08:00-10:00 Tokio = domingo 23:00-01:00 UTC, fila vieja sin local_day_of_week
    db.add(TeacherAvailability(teacher_id=tp.id, day_of_week=6, local_day_of_week=None,
                               start_time_utc="23:00", end_time_utc="01:00", is_available=True))
    db.commit()
    assert _patch_tz(client, world["t_user"], "America/Bogota").status_code == 200
    # ancla = domingo (dia UTC) -> domingo 08:00 Bogota = domingo 13:00 UTC; deberia ser lunes 13:00
    assert _rows(db, tp) == [(None, 6, "13:00", "15:00")]


# ─── P6: excepciones al cambiar de tz ───────────────────────────────────────

def test_bug_tz_change_rewrites_past_exceptions(client, world, db):
    tp = world["tp"]
    _reset_teacher(db, tp, "America/Bogota")
    past = (utc_now() - timedelta(days=20)).replace(hour=14, minute=0, second=0, microsecond=0)
    e = TeacherAvailabilityException(teacher_id=tp.id, start_time_utc=past,
                                     end_time_utc=past + timedelta(hours=2), is_available=False, reason="pasada")
    db.add(e)
    db.commit()
    assert _patch_tz(client, world["t_user"], "Asia/Tokyo").status_code == 200
    db.expire_all()
    moved = db.get(TeacherAvailabilityException, e.id).start_time_utc.replace(tzinfo=dt_tz.utc)
    assert moved != past  # el historial se reescribe (14h antes)


def test_bug_tz_change_silently_orphans_booked_class(client, world, db):
    """Tras el cambio, la clase confirmada queda fuera de la disponibilidad (semanal y
    extra) y dentro de un bloqueo que antes no la tocaba. Respuesta sin avisos; el
    resumen de recalculate_teacher_schedule_timezone se descarta."""
    tp = world["tp"]
    _reset_teacher(db, tp, "America/Bogota")
    _put_weekly(client, world["t_user"], "America/Bogota", [(0, "09:00", "12:00")])  # 14-17 UTC
    mon = _next_utc_date(0)
    db.add(Class(teacher_id=tp.id, student_id=world["sp"].id, class_type=ClassType.regular,
                 status="confirmed", start_time_utc=_utc(mon, 14), end_time_utc=_utc(mon, 14, 50),
                 duration=50))
    # bloqueo 23:00-24:00 local Bogota del lunes (= mar 04-05 UTC); en Tokio pasa a lun 14-15 UTC
    db.add(TeacherAvailabilityException(teacher_id=tp.id, start_time_utc=_utc(mon + timedelta(days=1), 4),
                                        end_time_utc=_utc(mon + timedelta(days=1), 5), is_available=False))
    db.commit()
    assert is_within_teacher_availability(tp.id, _utc(mon, 14), _utc(mon, 15), db)[0] is True
    r = _patch_tz(client, world["t_user"], "Asia/Tokyo")
    assert r.status_code == 200
    body = r.json()
    assert not any(k in body for k in ("weekly_changes", "exception_changes", "warnings", "affected_classes"))
    db.expire_all()
    ok, msg = is_within_teacher_availability(tp.id, _utc(mon, 14), _utc(mon, 15), db)
    assert ok is False and "bloque" in msg
    assert db.query(Class).filter(Class.teacher_id == tp.id, Class.status == "confirmed").count() == 1


def test_bug_block_exception_over_booked_class_accepted(client, world, db):
    tp = world["tp"]
    _reset_teacher(db, tp, "UTC")
    d = _next_utc_date(2)
    db.add(Class(teacher_id=tp.id, student_id=world["sp"].id, class_type=ClassType.regular,
                 status="confirmed", start_time_utc=_utc(d, 10), end_time_utc=_utc(d, 10, 50), duration=50))
    db.commit()
    r = client.post(f"{API}/availability/me/exceptions", headers=hdr(world["t_user"]), json={
        "date": d.isoformat(), "timezone": "UTC", "is_full_day": True, "is_available": False,
        "reason": "vacaciones"})
    assert r.status_code == 201  # sin aviso ni 409; la clase sigue confirmada


# ─── P7: validacion de franjas semanales ────────────────────────────────────

def test_bug_weekly_validation_gaps(client, world, db):
    tp = world["tp"]
    _reset_teacher(db, tp, "UTC")
    r = _put_weekly(client, world["t_user"], "UTC", [
        (0, "10:00", "10:00"),   # start == end -> se interpreta como 24 h
        (1, "18:00", "09:00"),   # start > end -> nocturna de 15 h, sin confirmacion
        (2, "09:00", "12:00"), (2, "10:00", "11:00"), (2, "09:00", "12:00"),  # solapes/duplicados
        (3, "09:07", "10:44"),   # minutos arbitrarios
    ])
    assert r.status_code == 200, r.text
    assert len(_rows(db, tp)) == 6
    wed = _next_utc_date(3)
    s = client.get(f"{API}/availability/{tp.user_username}/slots",
                   params={"date": wed.isoformat(), "duration": 25, "class_type": "regular"}, headers=hdr(world["s_user"])).json()
    assert s and s[0]["start_time_utc"][11:16] == "09:07"  # slots a :07 y :37
    mon = _next_utc_date(0)
    s0 = client.get(f"{API}/availability/{tp.user_username}/slots",
                    params={"date": mon.isoformat(), "duration": 25, "class_type": "regular"}, headers=hdr(world["s_user"])).json()
    assert len(s0) >= 40  # 10:00 -> 10:00 del dia siguiente


def test_ok_weekly_rejects_24_00(client, world, db):
    r = _put_weekly(client, world["t_user"], "UTC", [(0, "09:00", "24:00")])
    assert r.status_code == 422


# ─── P8: excepciones parciales/de dia completo ──────────────────────────────

def test_bug_partial_exception_cannot_cross_local_midnight(client, world, db):
    d = _next_utc_date(4)
    r = client.post(f"{API}/availability/me/exceptions", headers=hdr(world["t_user"]), json={
        "date": d.isoformat(), "timezone": "America/Bogota", "is_full_day": False,
        "start_time_local": "22:00", "end_time_local": "02:00", "is_available": True})
    assert r.status_code == 400


def test_ok_full_day_block_covers_local_day_multi_day(client, world, db):
    d = _next_utc_date(1)
    r = client.post(f"{API}/availability/me/exceptions", headers=hdr(world["t_user"]), json={
        "date": d.isoformat(), "end_date": (d + timedelta(days=2)).isoformat(),
        "timezone": "Asia/Kolkata", "is_full_day": True, "is_available": False})
    assert r.status_code == 201, r.text
    rows = r.json()
    assert len(rows) == 3
    # dia LOCAL: 00:00 Kolkata = 18:30 UTC del dia anterior
    assert rows[0]["start_time_utc"].startswith(f"{(d - timedelta(days=1)).isoformat()}T18:30")
    assert all(x["is_full_day"] for x in rows)


def test_bug_full_day_on_dst_day_reported_as_partial(client, world, db):
    # 2027-03-14: Nueva York salta a DST -> el dia local dura 23 h
    r = client.post(f"{API}/availability/me/exceptions", headers=hdr(world["t_user"]), json={
        "date": "2027-03-14", "timezone": "America/New_York", "is_full_day": True, "is_available": False})
    assert r.status_code == 201, r.text
    assert r.json()[0]["is_full_day"] is False
