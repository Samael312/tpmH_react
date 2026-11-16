"""Fase 2 — ANÁLISIS DE VALORES LÍMITE.

Cada caso prueba el valor justo dentro y justo fuera del borde de una regla.
"""
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from tests.audit.conftest import hdr, future
from tests.audit.helpers import (
    API, iso, book, set_status, age_class, ready_student, restrict_availability,
)
from app.core.class_logic import (
    can_book_slot, get_business_rules, is_within_teacher_availability,
)
from app.core.timezone import utc_now
from app.models.class_ import Class
from app.models.payment_config import PlatformConfig
from app.schemas.payments import WithdrawalRequestV2


def _at(day_offset_h, hh, mm=0):
    d = future(day_offset_h).replace(hour=hh, minute=mm, second=0, microsecond=0)
    return d


# ─── Disponibilidad: bordes de la ventana 08:00-20:00 ───────────────────────

@pytest.mark.parametrize("start_hhmm, minutes, ok", [
    ((8, 0), 50, True),      # empieza justo al abrir
    ((7, 59), 50, False),    # 1 min antes de abrir
    ((19, 10), 50, True),    # termina justo al cerrar (20:00)
    ((19, 11), 50, False),   # termina 1 min después de cerrar
    ((20, 0), 50, False),    # empieza al cerrar
    ((12, 0), 50, True),     # centro
    ((0, 0), 50, False),     # madrugada
    ((23, 30), 50, False),   # cruza medianoche
])
def test_availability_window_edges(world, db, start_hhmm, minutes, ok):
    restrict_availability(db, world)
    start = _at(72, *start_hhmm)
    got, _ = is_within_teacher_availability(world["tp"].id, start, start + timedelta(minutes=minutes), db)
    assert got is ok, f"{start_hhmm}+{minutes}min -> {got}, esperado {ok}"


def test_availability_enforced_only_when_requested(world, db):
    """can_book_slot solo exige disponibilidad si el llamador lo pide (alumno sí, staff no)."""
    restrict_availability(db, world)
    start = _at(72, 3)
    end = start + timedelta(minutes=50)
    assert can_book_slot(start, world["tp"].id, world["sp"].id, end, db, enforce_availability=True)[0] is False
    assert can_book_slot(start, world["tp"].id, world["sp"].id, end, db, enforce_availability=False)[0] is True


# ─── Antelación mínima de reserva ───────────────────────────────────────────

def test_min_booking_notice_edges(world, db):
    hours = get_business_rules(db)["min_booking_hours"]
    base = utc_now() + timedelta(hours=hours)
    too_soon = base - timedelta(minutes=1)
    just_ok = base + timedelta(minutes=1)
    args = (world["tp"].id, world["sp"].id)
    assert can_book_slot(too_soon, args[0], args[1], too_soon + timedelta(minutes=50), db)[0] is False
    assert can_book_slot(just_ok, args[0], args[1], just_ok + timedelta(minutes=50), db)[0] is True


def test_min_booking_hours_zero_is_respected(world, db):
    """AUD-10: con min_booking_hours=0 se puede reservar casi de inmediato."""
    cfg = db.query(PlatformConfig).first()
    cfg.min_booking_hours = 0
    db.commit()
    assert get_business_rules(db)["min_booking_hours"] == 0
    soon = utc_now() + timedelta(minutes=5)
    assert can_book_slot(soon, world["tp"].id, world["sp"].id, soon + timedelta(minutes=50), db)[0] is True


@pytest.mark.parametrize("field, value", [
    ("min_cancel_hours", 0), ("min_reschedule_hours_student", 0),
    ("low_credit_threshold", 0), ("low_credit_renotify_days", 0),
])
def test_business_rules_zero_for_each_field(db, field, value):
    cfg = db.query(PlatformConfig).first() or PlatformConfig()
    setattr(cfg, field, value)
    db.add(cfg)
    db.commit()
    assert get_business_rules(db)[field] == value


# ─── Retiro mínimo ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("amount, ok", [
    (-1, False), (0, False), (0.01, False), (9.99, False),
    (10.0, True), (10.01, True), (500, True),
])
def test_withdrawal_minimum_edges(amount, ok):
    if ok:
        assert WithdrawalRequestV2(amount=amount, payment_info="x").amount == amount
    else:
        with pytest.raises(ValidationError):
            WithdrawalRequestV2(amount=amount, payment_info="x")


# ─── Completar clase: justo antes / justo después de que empiece ────────────

def _move_class(db, cid, delta):
    db.expire_all()
    c = db.get(Class, cid)
    c.start_time_utc = utc_now() + delta
    c.end_time_utc = c.start_time_utc + timedelta(minutes=c.duration)
    db.commit()


@pytest.mark.parametrize("delta, expected", [
    (timedelta(minutes=1), 400),     # empieza en 1 min: aún no ocurrió
    (timedelta(hours=48), 400),      # claramente futura
    (timedelta(seconds=-30), 200),   # ya empezó hace 30 s
    (timedelta(hours=-3), 200),      # pasada
])
def test_complete_class_time_edges(client, world, db, delta, expected):
    eid, _ = ready_student(client, world)
    cid = book(client, world, future(72), enrollment_id=eid).json()["class_id"]
    _move_class(db, cid, delta)
    assert set_status(client, world, cid, "completed").status_code == expected


# ─── Duración vs paquete (50 min) ───────────────────────────────────────────

def test_duration_edges_against_package(client, world, db):
    eid, _ = ready_student(client, world)
    expected = {49: 400, 51: 400, 80: 400, 0: 422, -50: 422}
    for i, (dur, code) in enumerate(expected.items()):
        r = book(client, world, future(72 + 24 * i), enrollment_id=eid, duration=dur)
        assert r.status_code in (code, 400, 422), (dur, r.status_code)
        assert r.status_code != 201, f"duración {dur} aceptada"
    assert book(client, world, future(200), enrollment_id=eid, duration=50).status_code == 201


# ─── Zonas horarias ─────────────────────────────────────────────────────────

def test_offset_and_z_and_naive_datetimes(client, world, db):
    eid, _ = ready_student(client, world)
    start = _at(96, 12)
    end = start + timedelta(minutes=50)

    def raw(s, e):
        return client.post(f"{API}/payments/book", json={
            "enrollment_id": eid, "start_time_utc": s, "end_time_utc": e, "duration_minutes": 50,
        }, headers=hdr(world["s_user"]))

    # naive -> 422 (no 500)
    assert raw(start.replace(tzinfo=None).isoformat(), end.replace(tzinfo=None).isoformat()).status_code == 422
    # mezcla naive/aware -> 422
    assert raw(start.isoformat(), end.replace(tzinfo=None).isoformat()).status_code == 422
    # mismo instante expresado con offset +02:00 -> aceptado
    plus2 = timezone(timedelta(hours=2))
    r = raw(start.astimezone(plus2).isoformat(), end.astimezone(plus2).isoformat())
    assert r.status_code == 201, r.text
    # y la hora guardada es la correcta (12:00 UTC)
    db.expire_all()
    stored = db.get(Class, r.json()["class_id"]).start_time_utc
    assert stored.replace(tzinfo=timezone.utc) == start
