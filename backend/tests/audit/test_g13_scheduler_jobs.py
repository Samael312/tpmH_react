"""Cobertura de `core/scheduler.py`: trabajos periódicos, fallos y arranque del planificador."""
import asyncio
from datetime import timedelta

import pytest

from app.core import scheduler as sch
from app.core.timezone import utc_now
from app.models.class_ import ClassType
from app.models.class_participant import ClassParticipant
from app.models.group_cohort import CohortStatus
from app.models.package import Enrollment, EnrollmentStatus
from tests.audit.test_g1_god_mode_actions import mk_class, mk_student
from tests.audit.test_g10_classes import group_class


@pytest.fixture
def mails(monkeypatch):
    sent = []
    for name in ("send_class_reminder_email", "send_class_reminder_teacher_email",
                 "send_class_reminders_teacher_digest_email", "send_package_expiring_email"):
        monkeypatch.setattr(sch, name, lambda *a, _n=name, **k: sent.append((_n, k)) or True)
    return sent


def boom(*a, **k):
    raise RuntimeError("falla")


# ── cierre de clases ─────────────────────────────────────────────────────────────────────
def test_finalize_expired_classes(world, db, monkeypatch):
    mk_class(db, world, hours=-5, status="confirmed")
    sch.finalize_expired_classes()
    monkeypatch.setattr(sch, "finalize_past_classes", lambda d: 2)
    sch.finalize_expired_classes()
    monkeypatch.setattr(sch, "finalize_past_classes", boom)
    with pytest.raises(RuntimeError):
        sch.finalize_expired_classes()


# ── recordatorios ────────────────────────────────────────────────────────────────────────
def test_reminders_group_class_and_skips(world, db, mails):
    g, e = group_class(db, world, hours=12)
    # grupo sin participantes: se marca y no se envía nada
    empty, _ = group_class(db, world, hours=10, student=False)
    # clase sin alumno
    orphan = mk_class(db, world, hours=8)
    orphan.student_id = None
    db.commit()
    sch.send_class_reminders()
    names = [n for n, _ in mails]
    assert names.count("send_class_reminder_email") == 1
    assert names.count("send_class_reminder_teacher_email") == 1  # un solo correo al profesor
    db.expire_all()
    assert empty.reminder_sent_at is not None and orphan.reminder_sent_at is not None


def test_reminders_without_teacher_user_and_failures(world, db, mails, monkeypatch):
    c = mk_class(db, world, hours=12)
    world["tp"].user_id = 99999
    db.commit()
    sch.send_class_reminders()
    db.expire_all()
    assert c.reminder_sent_at is not None  # sin profesor: se marca como tratada
    world["tp"].user_id = world["t_user"].id
    c2 = mk_class(db, world, hours=11)
    db.commit()
    monkeypatch.setattr(sch, "send_class_reminder_email", boom)
    with pytest.raises(sch.JobFailed):
        sch.send_class_reminders()
    # el correo agrupado al profesor también puede fallar sin romper el job
    monkeypatch.setattr(sch, "send_class_reminder_email", lambda *a, **k: True)
    monkeypatch.setattr(sch, "send_class_reminder_teacher_email", boom)
    sch.send_class_reminders()


def test_reminders_student_user_missing(world, db, mails):
    c = mk_class(db, world, hours=12)
    world["sp"].user_id = 99999
    db.commit()
    sch.send_class_reminders()
    db.expire_all()
    assert c.reminder_sent_at is not None
    world["sp"].user_id = world["s_user"].id
    db.commit()


# ── resúmenes de chat ────────────────────────────────────────────────────────────────────
def test_chat_digest_job(monkeypatch):
    import app.core.chat_digest as cd
    monkeypatch.setattr(cd, "send_pending_digests", lambda db: 3)
    sch.send_chat_digests()
    monkeypatch.setattr(cd, "send_pending_digests", boom)
    with pytest.raises(RuntimeError):
        sch.send_chat_digests()


# ── enlaces de Meet ──────────────────────────────────────────────────────────────────────
def test_meet_link_job(world, db, monkeypatch):
    c = mk_class(db, world, hours=5, status="confirmed")
    c.start_time_utc = utc_now() + timedelta(minutes=5)
    c.end_time_utc = c.start_time_utc + timedelta(minutes=50)
    c.meet_link = None
    db.commit()
    monkeypatch.setattr(sch, "generate_meet_link_for_class", lambda cl, d: "https://meet.google.com/zzz")
    sch.generate_upcoming_meet_links()
    db.expire_all()
    assert c.meet_link == "https://meet.google.com/zzz"
    c2 = mk_class(db, world, hours=6, status="confirmed")
    c2.start_time_utc = utc_now() + timedelta(minutes=6)
    c2.end_time_utc = c2.start_time_utc + timedelta(minutes=50)
    c2.meet_link = None
    db.commit()
    monkeypatch.setattr(sch, "generate_meet_link_for_class", boom)
    with pytest.raises(sch.JobFailed):
        sch.generate_upcoming_meet_links()
    monkeypatch.setattr(sch, "get_business_rules", boom)
    with pytest.raises(RuntimeError):
        sch.generate_upcoming_meet_links()


def test_calendar_sync_job(monkeypatch):
    monkeypatch.setattr(sch, "run_calendar_sync_for_all_teachers", lambda d: {})
    sch.sync_all_teacher_calendars()
    monkeypatch.setattr(sch, "run_calendar_sync_for_all_teachers", boom)
    with pytest.raises(RuntimeError):
        sch.sync_all_teacher_calendars()


# ── paquetes por vencer ──────────────────────────────────────────────────────────────────
def test_low_credit_job(world, db, mails, monkeypatch):
    low = Enrollment(student_id=world["sp"].id, package_id=world["pkg"].id, teacher_id=world["tp"].id, status=EnrollmentStatus.active,
                     payment_status="paid", classes_total=4, classes_used=4, unlocked_credits=4)
    renotified = Enrollment(student_id=world["sp"].id, package_id=world["pkg"].id, teacher_id=world["tp"].id, status=EnrollmentStatus.active,
                            payment_status="paid", classes_total=4, classes_used=4, unlocked_credits=4, low_credit_notified_at=utc_now())
    plenty = Enrollment(student_id=world["sp"].id, package_id=world["pkg"].id, teacher_id=world["tp"].id, status=EnrollmentStatus.active,
                        payment_status="paid", classes_total=40, classes_used=0, unlocked_credits=40)
    db.add_all([low, renotified, plenty])
    db.commit()
    sch.notify_low_credit_packages()
    assert [n for n, _ in mails].count("send_package_expiring_email") == 1
    # alumno sin usuario: se omite
    world["sp"].user_id = 99999
    low.low_credit_notified_at = None
    db.commit()
    mails.clear()
    sch.notify_low_credit_packages()
    assert mails == []
    world["sp"].user_id = world["s_user"].id
    db.commit()
    monkeypatch.setattr(sch, "get_business_rules", boom)
    sch.notify_low_credit_packages()  # el error se registra, no propaga


# ── purgas diarias ───────────────────────────────────────────────────────────────────────
def test_daily_purge_jobs(monkeypatch):
    import app.core.chat as chat_mod
    import app.core.class_logic as cl
    import app.core.retention as ret
    monkeypatch.setattr(chat_mod, "purge_old_messages", lambda d, days: 4)
    sch.purge_old_chat_messages()
    monkeypatch.setattr(chat_mod, "purge_old_messages", boom)
    sch.purge_old_chat_messages()
    monkeypatch.setattr(cl, "release_stale_unpaid_enrollments", lambda d: 2)
    sch.release_stale_enrollments()
    monkeypatch.setattr(cl, "release_stale_unpaid_enrollments", boom)
    sch.release_stale_enrollments()
    monkeypatch.setattr(ret, "purge_error_logs", lambda d: 1)
    monkeypatch.setattr(ret, "purge_email_log", lambda d: 1)
    monkeypatch.setattr(ret, "purge_user_notifications", lambda d: 1)
    sch.purge_old_logs()
    monkeypatch.setattr(ret, "purge_error_logs", boom)
    sch.purge_old_logs()


# ── reintentos y arranque ────────────────────────────────────────────────────────────────
def test_report_failure_and_run_due_job(monkeypatch):
    job = sch.DUE_JOBS[0]
    job.failures = 1
    sch.report_job_failure(job, RuntimeError("x"))
    job.failures = sch.MAX_JOB_ATTEMPTS
    sch.report_job_failure(job, RuntimeError("x"))
    import app.core.error_log as el
    monkeypatch.setattr(el, "log_error", boom)
    sch.report_job_failure(job, RuntimeError("x"))  # nunca lanza
    job.failures = 0
    monkeypatch.setattr(sch, "reschedule_job", lambda j: None)
    monkeypatch.setattr(job, "run", boom, raising=False) if hasattr(job, "__dataclass_fields__") and False else None
    original = job.run
    job.run = boom
    try:
        sch._run_due_job(job.id)
        assert job.failures == 1
    finally:
        job.run = original
        job.failures = 0


def test_reschedule_all_and_start_stop(monkeypatch):
    calls = []
    monkeypatch.setattr(sch, "reschedule_job", lambda j: calls.append(j.id))
    sch.reschedule_all_due_jobs()
    assert len(calls) == len(sch.DUE_JOBS)

    async def run():
        sch.start_scheduler()
        assert sch.scheduler.running
        sch.request_reschedule(1)
        sch.stop_scheduler()

    asyncio.run(run())
