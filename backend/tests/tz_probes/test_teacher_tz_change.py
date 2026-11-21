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
        [(r.day_of_week, r.start_time_local, r.end_time_local)
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

def _utc_hhmm(tz, row, on):
    """(dia UTC, 'HH:MM' inicio UTC, 'HH:MM' fin UTC) de una fila local expandida en la fecha `on`."""
    from zoneinfo import ZoneInfo
    from app.core.slot_availability import local_range_to_utc
    s, e = local_range_to_utc(on, row[1], row[2], ZoneInfo(tz))
    return (s.weekday(), s.strftime("%H:%M"), e.strftime("%H:%M"))


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
    """Fase 26: la fila guarda la hora LOCAL tal cual; su expansion a UTC es la que antes se guardaba."""
    _reset_teacher(db, world["tp"], tz)
    r = _put_weekly(client, world["t_user"], tz, [local])
    assert r.status_code == 200, r.text
    assert _rows(db, world["tp"]) == [(local[0], local[1], local[2])]
    assert _utc_hhmm(tz, local, _next_utc_date(0, min_days=1)) == expected[1:]


@pytest.mark.parametrize("old_tz,new_tz,expected", [
    ("America/Bogota", "Asia/Tokyo", (6, "23:00", "03:00")),      # 08-12 Tokio -> dom 23:00-03:00
    ("Asia/Tokyo", "Etc/GMT+12", (0, "20:00", "00:00")),          # 08-12 UTC-12 -> lun 20:00-00:00
    ("Asia/Kolkata", "Pacific/Kiritimati", (6, "18:00", "22:00")),
    ("Pacific/Kiritimati", "Asia/Kolkata", (0, "02:30", "06:30")),
])
def test_ok_tz_change_preserves_local_time_and_day(client, world, db, old_tz, new_tz, expected):
    """Fase 26: cambiar de zona NO toca las filas (hora y dia locales intactos); solo cambia su UTC."""
    _reset_teacher(db, world["tp"], old_tz)
    assert _put_weekly(client, world["t_user"], old_tz, [(0, "08:00", "12:00")]).status_code == 200
    r = _patch_tz(client, world["t_user"], new_tz)
    assert r.status_code == 200, r.text
    assert _rows(db, world["tp"]) == [(0, "08:00", "12:00")]
    assert _utc_hhmm(new_tz, (0, "08:00", "12:00"), _next_utc_date(0, min_days=1)) == expected


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

def test_fixed_wrapped_slot_respects_next_day_classes_and_blocks(client, world, db):
    """CORREGIDO Fase 24. Fila del lunes 22:00-02:00 UTC (= Bogota 17-21). Las clases y excepciones del
    martes 00:00-02:00 UTC ahora se ven (consulta por dia local en Bogota): slots ocupados salen ocupados."""
    tp = world["tp"]
    _reset_teacher(db, tp, "UTC")
    db.add(TeacherAvailability(teacher_id=tp.id, day_of_week=0, start_time_local="22:00", end_time_local="02:00", is_available=True))
    mon = _next_utc_date(0)
    tue = mon + timedelta(days=1)
    db.add(Class(teacher_id=tp.id, student_id=world["sp"].id, class_type=ClassType.regular,
                 status="confirmed", start_time_utc=_utc(tue, 0), end_time_utc=_utc(tue, 0, 50),
                 duration=50))
    db.add(TeacherAvailabilityException(teacher_id=tp.id, start_time_utc=_utc(tue, 1),
                                        end_time_utc=_utc(tue, 2), is_available=False, reason="bloqueo"))
    db.commit()
    r = client.get(f"{API}/availability/{tp.user_username}/slots",
                   params={"date": mon.isoformat(), "duration": 25, "class_type": "regular", "tz": "America/Bogota"},
                   headers=hdr(world["s_user"]))
    assert r.status_code == 200, r.text
    by_start = {s["start_time_utc"][:16]: s["is_available"] for s in r.json()}
    assert by_start[f"{tue.isoformat()}T00:00"] is False  # ocupado por la clase
    assert by_start[f"{tue.isoformat()}T01:00"] is False  # bloqueado por excepcion


def test_fixed_wrapped_slot_after_midnight_accepted_by_booking_validation(client, world, db):
    """CORREGIDO Fase 24: el slot martes 00:30 UTC se ofrece (dia local lunes en Bogota) y la validacion de
    reserva del alumno (enforce_availability) tambien lo acepta (mira la cola de la fila del lunes)."""
    tp = world["tp"]
    _reset_teacher(db, tp, "UTC")
    db.add(TeacherAvailability(teacher_id=tp.id, day_of_week=0, start_time_local="22:00", end_time_local="02:00", is_available=True))
    db.commit()
    mon = _next_utc_date(0)
    tue = mon + timedelta(days=1)
    r = client.get(f"{API}/availability/{tp.user_username}/slots",
                   params={"date": mon.isoformat(), "duration": 25, "class_type": "regular", "tz": "America/Bogota"},
                   headers=hdr(world["s_user"]))
    offered = {s["start_time_utc"][:16] for s in r.json() if s["is_available"]}
    assert f"{tue.isoformat()}T00:30" in offered
    ok, _ = is_within_teacher_availability(tp.id, _utc(tue, 0, 30), _utc(tue, 1, 5), db)
    assert ok is True
    # y antes de medianoche si se acepta
    ok2, _ = is_within_teacher_availability(tp.id, _utc(mon, 22, 30), _utc(mon, 23, 5), db)
    assert ok2 is True


# ─── P2: valores de zona horaria invalidos/vacios en el perfil ──────────────

@pytest.mark.parametrize("bad", ["Foo/Bar", "UTC+3", ""])
def test_fixed_profile_invalid_tz_rejected_422(client, world, db, bad):
    """CORREGIDO Fase 21 (menor 7): el esquema valida la zona con ZoneInfo -> 422, ya no 500."""
    tp = world["tp"]
    before = tp.timezone
    r = _patch_tz(client, world["t_user"], bad)
    assert r.status_code == 422
    db.expire_all()
    assert db.get(TeacherProfile, tp.id).timezone == before


def test_fixed_profile_invalid_tz_not_saved_when_old_tz_empty(client, world, db):
    """CORREGIDO Fase 21: aunque la tz vieja sea vacia, la nueva invalida se rechaza (422) y no se guarda."""
    tp = world["tp"]
    tp.timezone = None
    db.commit()
    r = _patch_tz(client, world["t_user"], "Foo/Bar")
    assert r.status_code == 422
    db.expire_all()
    assert db.get(TeacherProfile, tp.id).timezone is None


def test_fixed_profile_empty_string_tz_rejected(client, world, db):
    """CORREGIDO Fase 21: "" ya no se guarda (ZoneInfo('') falla -> 422)."""
    tp = world["tp"]
    _reset_teacher(db, tp, "America/Bogota")
    assert _patch_tz(client, world["t_user"], "").status_code == 422
    db.expire_all()
    assert db.get(TeacherProfile, tp.id).timezone == "America/Bogota"


def test_fixed_profile_null_tz_rejected(client, world, db):
    """CORREGIDO Fase 27 (Z3): `timezone: null` explicito se rechaza con 422 y la zona no cambia;
    el siguiente cambio sigue recalculando el horario."""
    tp = world["tp"]
    _reset_teacher(db, tp, "America/Bogota")
    _put_weekly(client, world["t_user"], "America/Bogota", [(0, "09:00", "11:00")])
    assert _rows(db, tp) == [(0, "09:00", "11:00")]
    r = _patch_tz(client, world["t_user"], None)
    assert r.status_code == 422
    db.expire_all()
    assert db.get(TeacherProfile, tp.id).timezone == "America/Bogota"


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

def test_fixed_weekly_tz_mismatch_with_profile_updates_profile_zone(client, world, db):
    """Fase 26 (Z4): la zona con la que se escribe el horario pasa a ser la del perfil, y como el horario
    es local no hay recalculo posterior que corra nada."""
    tp = world["tp"]
    _reset_teacher(db, tp, "UTC")  # perfil dice UTC (p.ej. navegador en otra tz o default)
    _put_weekly(client, world["t_user"], "America/Bogota", [(0, "09:00", "11:00")])
    db.expire_all()
    assert db.get(TeacherProfile, tp.id).timezone == "America/Bogota"
    assert _patch_tz(client, world["t_user"], "America/Bogota").status_code == 200
    assert _rows(db, tp) == [(0, "09:00", "11:00")]  # el profe queria 09-11 Bogota


# ─── P4: (CORREGIDO Fase 26, H3) el cambio de zona ya no usa ningun desfase: la hora local no se toca ─

def test_fixed_dst_tz_change_keeps_local_hour(client, world, db, monkeypatch):
    tp = world["tp"]
    _reset_teacher(db, tp, "Europe/Madrid")
    _fixed_now(monkeypatch, datetime(2027, 7, 5, 12, tzinfo=dt_tz.utc))   # verano (UTC+2)
    _put_weekly(client, world["t_user"], "Europe/Madrid", [(0, "09:00", "11:00")])
    assert _rows(db, tp) == [(0, "09:00", "11:00")]
    _fixed_now(monkeypatch, datetime(2027, 1, 11, 12, tzinfo=dt_tz.utc))  # invierno (UTC+1)
    assert _patch_tz(client, world["t_user"], "America/Bogota").status_code == 200
    assert _rows(db, tp) == [(0, "09:00", "11:00")]   # antes: 08:00-10:00 para siempre


# ─── P5: (CORREGIDO Fase 26, Z7) el dia local no se corre nunca al cambiar de zona ───

def test_fixed_tz_change_never_shifts_local_day(client, world, db):
    tp = world["tp"]
    _reset_teacher(db, tp, "Asia/Tokyo")
    _put_weekly(client, world["t_user"], "Asia/Tokyo", [(0, "08:00", "10:00")])  # lunes local (= domingo en UTC)
    assert _patch_tz(client, world["t_user"], "America/Bogota").status_code == 200
    assert _rows(db, tp) == [(0, "08:00", "10:00")]   # sigue siendo lunes 08:00 (ahora Bogota)


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
    assert len(s0) >= 28  # 10:00 -> 10:00 del dia siguiente: el dia UTC lunes solo trae los inicios hasta 23:30


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
