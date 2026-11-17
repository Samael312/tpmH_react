"""Fase 9: jobs "por vencimiento" (no mantienen despierta la BD de Neon) y recalculo al escribir clases."""
from datetime import timedelta

import pytest

from tests.audit.conftest import future
from app.core import scheduler as sch
from app.core.timezone import utc_now
from app.models.class_ import Class
from app.models.google_calendar import GoogleCalendarToken
from app.models.payment_config import PlatformConfig
from app.models.user import User


def _cls(db, w, start, status="confirmed", minutes=50, **kw):
    c = Class(teacher_id=w["tp"].id, student_id=w["sp"].id, start_time_utc=start,
              end_time_utc=start + timedelta(minutes=minutes), duration=minutes, status=status,
              subject="English", **kw)
    db.add(c)
    db.commit()
    return c


def _job(job_id):
    return sch._JOBS_BY_ID[job_id]


def _due(job_id, db):
    j = _job(job_id)
    return j.next_due(j, db, utc_now())


@pytest.fixture(autouse=True)
def _reset_jobs():
    for j in sch.DUE_JOBS:
        j.last_run = None
    yield
    for j in sch.DUE_JOBS:
        j.last_run = None


def test_without_classes_nothing_is_due(db, world):
    for j in sch.DUE_JOBS:
        if j.id != "sync_teacher_calendars":
            assert j.next_due(j, db, utc_now()) is None


# ─── finalize ──────────────────────────────────────────────────────────────────

def test_finalize_due_is_end_of_first_class(db, world):
    a = _cls(db, world, future(5))
    _cls(db, world, future(30))
    assert abs(_due("finalize_expired_classes", db) - (a.end_time_utc + timedelta(seconds=1))) < timedelta(seconds=2)


def test_finalize_due_uses_72h_for_finalized(db, world):
    c = _cls(db, world, future(-10), status="finalized")
    expect = c.end_time_utc + timedelta(hours=sch.CLASS_STATUS_WINDOW_HOURS)
    assert abs(_due("finalize_expired_classes", db) - expect) < timedelta(seconds=5)


def test_finalize_due_in_the_past_when_overdue(db, world):
    _cls(db, world, future(-3))
    assert _due("finalize_expired_classes", db) < utc_now()


def test_finalize_ignores_terminal_states(db, world):
    for st in ("completed", "cancelled", "no_show"):
        _cls(db, world, future(-5), status=st)
    assert _due("finalize_expired_classes", db) is None


# ─── meet links ────────────────────────────────────────────────────────────────

def test_meet_due_is_start_minus_window(db, world):
    c = _cls(db, world, future(5))
    minutes = sch.get_business_rules(db)["meet_link_autogen_minutes"]
    assert abs(_due("generate_meet_links", db) - (c.start_time_utc - timedelta(minutes=minutes))) < timedelta(seconds=2)


def test_meet_skips_classes_with_link_external_and_past(db, world):
    _cls(db, world, future(5), meet_link="http://x")
    _cls(db, world, future(6), class_type="external")
    _cls(db, world, future(-2))
    assert _due("generate_meet_links", db) is None


def test_meet_follows_platform_window_setting(db, world):
    c = _cls(db, world, future(5))
    cfg = db.query(PlatformConfig).first() or PlatformConfig(is_single_tenant=False)
    cfg.meet_link_autogen_minutes = 120
    db.add(cfg)
    db.commit()
    assert abs(_due("generate_meet_links", db) - (c.start_time_utc - timedelta(minutes=120))) < timedelta(seconds=2)


# ─── recordatorios ─────────────────────────────────────────────────────────────

def test_reminder_due_is_25h_before(db, world):
    c = _cls(db, world, future(48))
    assert abs(_due("class_reminders", db) - (c.start_time_utc - timedelta(hours=25))) < timedelta(seconds=2)


def test_reminder_ignores_sent_and_too_close(db, world):
    _cls(db, world, future(48), reminder_sent_at=utc_now())
    _cls(db, world, future(10))           # menos de 23 h: la ventana ya paso
    assert _due("class_reminders", db) is None


def test_reminder_in_window_is_due_now(db, world):
    _cls(db, world, future(24))
    assert _due("class_reminders", db) <= utc_now()


# ─── calendario ────────────────────────────────────────────────────────────────

def _token(db, w, **kw):
    db.add(GoogleCalendarToken(user_id=w["t_user"].id, teacher_id=w["tp"].id, access_token="x", **kw))
    db.commit()


def test_calendar_nothing_to_sync_without_tokens(db, world):
    _cls(db, world, future(1))
    assert _due("sync_teacher_calendars", db) is None


def test_calendar_ignores_inactive_or_reauth_tokens(db, world):
    _token(db, world, is_active=True, needs_reauth=True)
    assert _due("sync_teacher_calendars", db) is None


def test_calendar_idle_is_every_6h(db, world):
    _token(db, world, is_active=True, needs_reauth=False)
    j = _job("sync_teacher_calendars")
    j.last_run = utc_now()
    got = j.next_due(j, db, utc_now())
    assert abs(got - (j.last_run + sch.CALENDAR_IDLE_GAP)) < timedelta(seconds=2)


def test_calendar_active_is_every_30min(db, world):
    _token(db, world, is_active=True, needs_reauth=False)
    _cls(db, world, future(1))
    j = _job("sync_teacher_calendars")
    j.last_run = utc_now()
    got = j.next_due(j, db, utc_now())
    assert abs(got - (j.last_run + sch.CALENDAR_ACTIVE_GAP)) < timedelta(seconds=2)


def test_calendar_wakes_before_next_class_enters_window(db, world):
    _token(db, world, is_active=True, needs_reauth=False)
    c = _cls(db, world, future(5))        # fuera de la ventana de 3 h; la proxima sync idle seria en 6 h
    j = _job("sync_teacher_calendars")
    j.last_run = utc_now()
    got = j.next_due(j, db, utc_now())
    assert abs(got - (c.start_time_utc - sch.CALENDAR_ACTIVE_WINDOW)) < timedelta(seconds=2)


# ─── compute_run_at ────────────────────────────────────────────────────────────

def test_compute_run_at_bounds():
    j = sch.DueJob("t", lambda: None, lambda *a: None, timedelta(minutes=5))
    now = utc_now()
    assert compute_ok(j, None, now) == now + sch.MAX_SLEEP                      # nada pendiente: duerme el maximo
    assert compute_ok(j, now + timedelta(days=9), now) == now + sch.MAX_SLEEP   # nunca mas de MAX_SLEEP
    assert compute_ok(j, now - timedelta(hours=1), now) == now + timedelta(seconds=1)  # vencido: ya


def compute_ok(j, due, now):
    return sch.compute_run_at(j, due, now)


def test_compute_run_at_respects_min_gap():
    j = sch.DueJob("t", lambda: None, lambda *a: None, timedelta(minutes=5))
    now = utc_now()
    j.last_run = now - timedelta(minutes=1)
    assert sch.compute_run_at(j, now - timedelta(hours=1), now) == j.last_run + timedelta(minutes=5)


# ─── reprogramacion ────────────────────────────────────────────────────────────

class _FakeScheduler:
    def __init__(self, running=True):
        self.running = running
        self.jobs = {}

    def add_job(self, func, trigger=None, args=None, id=None, **kw):
        self.jobs[id] = (func, trigger, args)


@pytest.fixture
def fake_sched(monkeypatch):
    f = _FakeScheduler()
    monkeypatch.setattr(sch, "scheduler", f)
    return f


def test_reschedule_job_sets_date_trigger_at_due_time(db, world, fake_sched):
    c = _cls(db, world, future(6))
    sch.reschedule_job(_job("generate_meet_links"))
    func, trig, args = fake_sched.jobs["generate_meet_links"]
    minutes = sch.get_business_rules(db)["meet_link_autogen_minutes"]
    assert abs(trig.run_date - (c.start_time_utc - timedelta(minutes=minutes))) < timedelta(seconds=2)
    assert args == ["generate_meet_links"]


def test_reschedule_job_without_work_sleeps_max(db, world, fake_sched):
    sch.reschedule_job(_job("generate_meet_links"))
    _f, trig, _a = fake_sched.jobs["generate_meet_links"]
    assert abs(trig.run_date - (utc_now() + sch.MAX_SLEEP)) < timedelta(seconds=5)


def test_reschedule_job_survives_db_failure(world, fake_sched):
    j = sch.DueJob("boom", lambda: None, lambda *a: (_ for _ in ()).throw(RuntimeError("db down")), timedelta(minutes=1))
    sch.reschedule_job(j)   # no lanza
    _f, trig, _a = fake_sched.jobs["boom"]
    assert trig.run_date > utc_now() + timedelta(minutes=5)


def test_run_due_job_runs_then_reschedules_even_if_it_fails(db, world, fake_sched, monkeypatch):
    calls = []
    j = sch.DueJob("x", lambda: (calls.append(1), (_ for _ in ()).throw(RuntimeError("fallo")))[1],
                   lambda *a: None, timedelta(minutes=1))
    monkeypatch.setitem(sch._JOBS_BY_ID, "x", j)
    with pytest.raises(RuntimeError):
        sch._run_due_job("x")
    assert calls == [1] and j.last_run is not None and "x" in fake_sched.jobs


def test_end_to_end_meet_job_generates_then_goes_to_sleep(db, world, fake_sched, monkeypatch):
    minutes = sch.get_business_rules(db)["meet_link_autogen_minutes"]
    c = _cls(db, world, utc_now() + timedelta(minutes=minutes - 5))      # ya dentro de la ventana
    monkeypatch.setattr(sch, "generate_meet_link_for_class", lambda cl, d: "https://meet.example/abc")
    sch._run_due_job("generate_meet_links")
    db.expire_all()
    assert db.get(Class, c.id).meet_link == "https://meet.example/abc"
    _f, trig, _a = fake_sched.jobs["generate_meet_links"]
    assert trig.run_date > utc_now() + timedelta(hours=20)               # sin mas clases sin link: duerme


def test_request_reschedule_noop_when_scheduler_stopped(monkeypatch):
    f = _FakeScheduler(running=False)
    monkeypatch.setattr(sch, "scheduler", f)
    sch.request_reschedule()
    assert f.jobs == {}


def test_request_reschedule_replaces_single_job(monkeypatch):
    f = _FakeScheduler(running=True)
    monkeypatch.setattr(sch, "scheduler", f)
    sch.request_reschedule()
    sch.request_reschedule()
    assert list(f.jobs) == [sch.RESCHEDULE_ID]


# ─── ganchos de sesion ─────────────────────────────────────────────────────────

@pytest.fixture
def pokes(monkeypatch):
    sch.install_session_hooks()
    n = []
    monkeypatch.setattr(sch, "request_reschedule", lambda *a, **k: n.append(1))
    return n


def test_hook_fires_on_class_commit(db, world, pokes):
    _cls(db, world, future(5))
    assert len(pokes) == 1


def test_hook_fires_on_class_update(db, world, pokes):
    c = _cls(db, world, future(5))
    pokes.clear()
    c.start_time_utc = future(7)
    db.commit()
    assert len(pokes) == 1


def test_hook_does_not_fire_for_unrelated_tables(db, world, pokes):
    u = db.query(User).first()
    u.name = "otro"
    db.commit()
    assert pokes == []


def test_hook_not_fired_on_rollback(db, world, pokes):
    db.add(Class(teacher_id=world["tp"].id, student_id=world["sp"].id, start_time_utc=future(5),
                 end_time_utc=future(6), duration=50, status="confirmed", subject="x"))
    db.flush()
    db.rollback()
    db.commit()
    assert pokes == []


def test_hook_fires_for_platform_config_and_calendar_token(db, world, pokes):
    _token(db, world, is_active=True, needs_reauth=False)
    cfg = db.query(PlatformConfig).first() or PlatformConfig(is_single_tenant=False)
    cfg.meet_link_autogen_minutes = 45
    db.add(cfg)
    db.commit()
    assert len(pokes) == 2


def test_hook_install_is_idempotent(db, world, monkeypatch):
    sch.install_session_hooks()
    sch.install_session_hooks()
    n = []
    monkeypatch.setattr(sch, "request_reschedule", lambda *a, **k: n.append(1))
    _cls(db, world, future(5))
    assert len(n) == 1
