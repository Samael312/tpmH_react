"""Fase 27: zona horaria nula (Z3) y recordatorios de reservas tardias (E2).

Sin red: los correos se capturan con monkeypatch; BD SQLite de tests/audit.
"""
from datetime import timedelta

import pytest

from tests.audit.conftest import hdr, future
from app.core import scheduler as sch
from app.core.timezone import utc_now
from app.models.class_ import Class
from app.models.student import StudentProfile
from app.models.teacher import TeacherProfile

API = "/api/v1"
JOB = lambda: sch._JOBS_BY_ID["class_reminders"]  # noqa: E731


# ─── Z3: zona nula ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("bad", [None, "", "   ", "Marte/Base"])
def test_teacher_patch_rejects_null_blank_invalid_tz(client, world, db, bad):
    r = client.patch(f"{API}/teachers/me/profile", json={"timezone": bad}, headers=hdr(world["t_user"]))
    assert r.status_code == 422
    db.expire_all()
    assert db.get(TeacherProfile, world["tp"].id).timezone == "UTC"


def test_teacher_patch_without_timezone_still_ok(client, world, db):
    r = client.patch(f"{API}/teachers/me/profile", json={"title": "Profe"}, headers=hdr(world["t_user"]))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(TeacherProfile, world["tp"].id).timezone == "UTC"


def test_teacher_patch_valid_tz_is_stripped_and_saved(client, world, db):
    r = client.patch(f"{API}/teachers/me/profile", json={"timezone": " Asia/Tokyo "}, headers=hdr(world["t_user"]))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(TeacherProfile, world["tp"].id).timezone == "Asia/Tokyo"


@pytest.mark.parametrize("bad", [None, "", "  ", "Marte/Base", 5])
def test_student_patch_rejects_null_blank_invalid_tz(client, world, db, bad):
    r = client.patch(f"{API}/users/me/student-profile", json={"timezone": bad}, headers=hdr(world["s_user"]))
    assert r.status_code == 422
    db.expire_all()
    assert db.get(StudentProfile, world["sp"].id).timezone == "UTC"


def test_student_patch_other_fields_without_tz_ok_and_valid_tz_saved(client, world, db):
    r = client.patch(f"{API}/users/me/student-profile", json={"goal": "viajar"}, headers=hdr(world["s_user"]))
    assert r.status_code == 200, r.text
    r = client.patch(f"{API}/users/me/student-profile", json={"timezone": "America/Bogota"},
                     headers=hdr(world["s_user"]))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(StudentProfile, world["sp"].id).timezone == "America/Bogota"


def test_users_me_rejects_explicit_null_timezone(client, world):
    r = client.patch(f"{API}/users/me", json={"timezone": None}, headers=hdr(world["s_user"]))
    assert r.status_code == 422
    r = client.patch(f"{API}/users/me", json={"name": "Nuevo"}, headers=hdr(world["s_user"]))
    assert r.status_code == 200, r.text


def test_legacy_null_zone_rows_still_readable(client, world, db):
    world["sp"].timezone = None
    world["tp"].timezone = None
    db.commit()
    assert client.get(f"{API}/users/me/student-profile", headers=hdr(world["s_user"])).status_code == 200
    # y un cambio posterior a una zona valida sigue funcionando
    r = client.patch(f"{API}/teachers/me/profile", json={"timezone": "Asia/Tokyo"}, headers=hdr(world["t_user"]))
    assert r.status_code == 200, r.text


# ─── E2: recordatorio tardio ─────────────────────────────────────────────────

@pytest.fixture
def mails(monkeypatch):
    sent = []
    for name in ("send_class_reminder_email", "send_class_reminder_teacher_email",
                 "send_class_reminders_teacher_digest_email"):
        monkeypatch.setattr(sch, name, lambda *a, _n=name, **k: sent.append((_n, k)) or True)
    return sent


def _cls(db, w, start, status="confirmed", minutes=50, **kw):
    if "class_type" in kw and kw["class_type"] == "external":
        kw["student_id"] = None
    c = Class(teacher_id=w["tp"].id, student_id=kw.pop("student_id", w["sp"].id), start_time_utc=start,
              end_time_utc=start + timedelta(minutes=minutes), duration=minutes, status=status,
              subject="English", **kw)
    db.add(c)
    db.commit()
    return c


def _count(mails, name):
    return [n for n, _ in mails].count(name)


def test_booked_12h_ahead_reminded_once_at_next_tick(db, world, mails):
    c = _cls(db, world, utc_now() + timedelta(hours=12))
    now = utc_now()
    due = sch._due_reminders(JOB(), db, now)
    assert due is not None and due <= now + timedelta(seconds=1)
    sch.send_class_reminders()
    assert _count(mails, "send_class_reminder_email") == 1
    assert _count(mails, "send_class_reminder_teacher_email") == 1
    student_kw = [k for n, k in mails if n == "send_class_reminder_email"][0]
    assert student_kw["hours_before"] == 12
    db.expire_all()
    assert db.get(Class, c.id).reminder_sent_at is not None
    # idempotente
    sch.send_class_reminders()
    sch.send_class_reminders()
    assert _count(mails, "send_class_reminder_email") == 1
    assert sch._due_reminders(JOB(), db, utc_now()) is None


def test_booked_24h_ahead_only_one_reminder(db, world, mails):
    c = _cls(db, world, utc_now() + timedelta(hours=24))
    sch.send_class_reminders()
    assert _count(mails, "send_class_reminder_email") == 1
    assert [k for n, k in mails if n == "send_class_reminder_email"][0]["hours_before"] == 24
    # mas tarde (12 h despues) el job vuelve a correr: ya no recuerda
    c.start_time_utc = utc_now() + timedelta(hours=12)  # simula el paso del tiempo
    c.end_time_utc = c.start_time_utc + timedelta(minutes=50)
    db.commit()
    sch.send_class_reminders()
    assert _count(mails, "send_class_reminder_email") == 1


def test_far_class_not_reminded_yet_and_due_is_25h_before(db, world, mails):
    c = _cls(db, world, utc_now() + timedelta(hours=48))
    sch.send_class_reminders()
    assert mails == []
    assert sch._due_reminders(JOB(), db, utc_now()) == c.start_time_utc - timedelta(hours=25)


def test_booked_20_min_ahead_gets_none(db, world, mails):
    _cls(db, world, utc_now() + timedelta(minutes=20))
    assert sch._due_reminders(JOB(), db, utc_now()) is None
    sch.send_class_reminders()
    assert mails == []


@pytest.mark.parametrize("status", ["cancelled", "finalized", "rejected"])
def test_dead_statuses_none(db, world, mails, status):
    _cls(db, world, utc_now() + timedelta(hours=12), status=status)
    assert sch._due_reminders(JOB(), db, utc_now()) is None
    sch.send_class_reminders()
    assert mails == []


def test_external_none(db, world, mails):
    _cls(db, world, utc_now() + timedelta(hours=12), class_type="external")
    assert sch._due_reminders(JOB(), db, utc_now()) is None
    sch.send_class_reminders()
    assert mails == []


@pytest.mark.parametrize("status", ["pending_trial", "pending"])
def test_pending_states_included(db, world, mails, status):
    c = _cls(db, world, utc_now() + timedelta(hours=10), status=status)
    assert sch._due_reminders(JOB(), db, utc_now()) is not None
    sch.send_class_reminders()
    assert _count(mails, "send_class_reminder_email") == 1
    db.expire_all()
    assert db.get(Class, c.id).reminder_sent_at is not None


def test_teacher_gets_digest_for_several_late_classes(db, world, mails):
    _cls(db, world, utc_now() + timedelta(hours=5))
    _cls(db, world, utc_now() + timedelta(hours=8))
    sch.send_class_reminders()
    assert _count(mails, "send_class_reminder_email") == 2
    assert _count(mails, "send_class_reminders_teacher_digest_email") == 1
    assert _count(mails, "send_class_reminder_teacher_email") == 0
    digest = [k for n, k in mails if n == "send_class_reminders_teacher_digest_email"][0]
    assert digest["hours_before"] == 5


def test_due_ignores_dead_and_sent_when_picking_earliest(db, world):
    _cls(db, world, utc_now() + timedelta(hours=3), status="cancelled")
    sent = _cls(db, world, utc_now() + timedelta(hours=4))
    sent.reminder_sent_at = utc_now()
    db.commit()
    far = _cls(db, world, utc_now() + timedelta(hours=60))
    assert sch._due_reminders(JOB(), db, utc_now()) == far.start_time_utc - timedelta(hours=25)
