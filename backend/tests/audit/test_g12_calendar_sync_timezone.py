"""Cobertura de `core/calendar_sync.py` (Meet automático y eventos) y `core/timezone.py`."""
from datetime import datetime, timedelta

import pytest

from app.core import calendar_sync as cs
from app.core import timezone as tzm
from app.core.timezone import UTC
from app.models.google_calendar import GoogleCalendarToken
from tests.audit.test_g1_god_mode_actions import mk_class


def mk_token(db, w):
    t = GoogleCalendarToken(user_id=w["t_user"].id, teacher_id=w["tp"].id, access_token="tok", refresh_token="ref")
    db.add(t)
    db.commit()
    return t


def boom(*a, **k):
    raise RuntimeError("google caído")


# ── calendar_sync ────────────────────────────────────────────────────────────────────────
def test_without_calendar_everything_is_a_noop(world, db):
    c = mk_class(db, world, hours=30)
    assert cs.sync_class_created(c, db) is None
    assert cs.sync_class_updated(c, "ev-1", db) is True
    assert cs.sync_class_updated(c, None, db) is True
    assert cs.generate_meet_link_for_class(c, db) is None
    assert cs.sync_class_cancelled(c.teacher_id, None, db) is True
    assert cs.sync_class_cancelled(c.teacher_id, "ev", db) is True


def test_service_unavailable_is_a_noop(world, db, monkeypatch):
    mk_token(db, world)
    monkeypatch.setattr(cs, "get_calendar_service_for_token", lambda t, d: None)
    assert cs._get_teacher_calendar_service(world["tp"].id, db) == (None, None)


def test_teacher_attendees(world, db):
    c = mk_class(db, world, hours=30)
    assert cs._teacher_attendee_emails(c) == [world["t_user"].email]
    c.teacher = None
    assert cs._teacher_attendee_emails(c) == []


def test_events_with_calendar(world, db, monkeypatch):
    mk_token(db, world)
    monkeypatch.setattr(cs, "get_calendar_service_for_token", lambda t, d: object())
    c = mk_class(db, world, hours=30)
    monkeypatch.setattr(cs, "create_calendar_event", lambda **k: "evt-1")
    assert cs.sync_class_created(c, db) == "evt-1"
    c.student = None
    assert cs.sync_class_created(c, db) == "evt-1"  # sin alumno usa «Estudiante»
    monkeypatch.setattr(cs, "update_calendar_event", lambda **k: True)
    assert cs.sync_class_updated(c, "ev-1", db) is True
    monkeypatch.setattr(cs, "delete_calendar_event", lambda **k: True)
    assert cs.sync_class_cancelled(c.teacher_id, "evt-1", db) is True
    # los fallos nunca rompen la reserva
    monkeypatch.setattr(cs, "create_calendar_event", boom)
    monkeypatch.setattr(cs, "update_calendar_event", boom)
    monkeypatch.setattr(cs, "delete_calendar_event", boom)
    assert cs.sync_class_created(c, db) is None
    assert cs.sync_class_updated(c, "ev-1", db) is True
    assert cs.sync_class_cancelled(c.teacher_id, "evt-1", db) is True


def test_generate_meet_link_paths(world, db, monkeypatch):
    mk_token(db, world)
    monkeypatch.setattr(cs, "get_calendar_service_for_token", lambda t, d: object())
    c = mk_class(db, world, hours=30)
    # evento existente que ya acepta Meet
    c.google_event_id = "ev-1"
    monkeypatch.setattr(cs, "add_meet_conference_to_event", lambda *a, **k: "https://meet.google.com/aaa")
    assert cs.generate_meet_link_for_class(c, db) == "https://meet.google.com/aaa"
    # el evento ya no existe: se crea otro con Meet
    monkeypatch.setattr(cs, "add_meet_conference_to_event", lambda *a, **k: None)
    monkeypatch.setattr(cs, "create_calendar_event_with_meet", lambda **k: ("ev-2", "https://meet.google.com/bbb"))
    assert cs.generate_meet_link_for_class(c, db) == "https://meet.google.com/bbb"
    assert c.google_event_id == "ev-2"
    # sin alumno y sin evento previo
    c.google_event_id = None
    c.student = None
    monkeypatch.setattr(cs, "create_calendar_event_with_meet", lambda **k: (None, None))
    assert cs.generate_meet_link_for_class(c, db) is None
    monkeypatch.setattr(cs, "create_calendar_event_with_meet", boom)
    assert cs.generate_meet_link_for_class(c, db) is None


# ── timezone ─────────────────────────────────────────────────────────────────────────────
def test_to_from_utc():
    assert tzm.to_utc("2025-04-14T09:00:00", "America/Caracas") == datetime(2025, 4, 14, 13, 0, tzinfo=UTC)
    with pytest.raises(ValueError):
        tzm.to_utc("2025-04-14T09:00:00", "Mars/Base")
    assert tzm.from_utc(datetime(2025, 4, 14, 13, 0), "America/Caracas").hour == 9  # naive se toma como UTC
    with pytest.raises(ValueError):
        tzm.from_utc(datetime(2025, 4, 14, 13, 0, tzinfo=UTC), "Mars/Base")


def test_build_weekly_range():
    a, b = tzm.build_weekly_range_utc("2025-04-14", "13:00", "22:00")
    assert (b - a) == timedelta(hours=9)
    a, b = tzm.build_weekly_range_utc("2025-04-14", "22:00", "02:00")
    assert b.day == 15  # cruza la medianoche
    with pytest.raises(ValueError):
        tzm.build_weekly_range_utc("no-fecha", "13:00", "22:00")


def test_local_utc_conversions():
    assert tzm.convert_local_time_to_utc("06:00", "Australia/Sydney", 0)[1] in (5, 6)
    assert tzm.convert_local_time_to_utc_string("09:00", "UTC", 2) == "09:00"
    with pytest.raises(ValueError):
        tzm.convert_local_time_to_utc("09:00", "Mars/Base", 0)
    assert tzm.convert_utc_time_to_local_string("10:00", "UTC", 0) == "10:00"
    assert tzm.convert_utc_time_to_local_string("14:00", "America/Caracas", 0) == "10:00"
    with pytest.raises(ValueError):
        tzm.convert_utc_time_to_local_string("10:00", "Mars/Base", 0)
    ref = datetime(2025, 4, 14, 12, tzinfo=UTC)  # lunes
    assert tzm.get_next_weekday_date(0, "UTC", ref) == "2025-04-14"
    assert tzm.get_next_weekday_date(2, "UTC", ref) == "2025-04-16"


def test_available_slots():
    t0 = datetime(2030, 1, 1, 9, tzinfo=UTC)
    av = [(t0, t0 + timedelta(hours=4))]
    busy = [(t0 + timedelta(hours=1), t0 + timedelta(hours=2))]
    slots = tzm.get_available_slots_utc(av, busy, 60)
    assert t0 in slots and (t0 + timedelta(hours=1)) not in slots and (t0 + timedelta(hours=2)) in slots
    assert tzm.get_available_slots_utc([], busy, 60) == []
    assert tzm.get_available_slots_utc(av, [], 30, step_minutes=15)


def test_format_local_datetime():
    d = datetime(2030, 1, 5, 13, 30, tzinfo=UTC)
    assert tzm.format_local_datetime(d, "America/Caracas").endswith("09:30")
    assert tzm.format_local_datetime(d).endswith("13:30")
    assert tzm.format_local_datetime(d, "Mars/Base").endswith("13:30")
    assert tzm.format_local_datetime(datetime(2030, 1, 5, 13, 30), "Mars/Base").endswith("13:30")
