"""Fase 9: correos agrupados (chat y recordatorios de clase) para gastar menos cuota de Resend."""
from datetime import timedelta

import pytest

from tests.audit.conftest import _mk_user, future
from app.core import chat as chat_core
from app.core import chat_digest
from app.core import email as email_mod
from app.core import email_settings as es
from app.core import scheduler as sch
from app.core.platform_config import get_or_create_platform_config
from app.core.timezone import utc_now
from app.models.chat import ChatConversation, ChatConversationType, ChatMessage, ChatReadState
from app.models.class_ import Class
from app.models.student import StudentProfile


@pytest.fixture
def sent(monkeypatch):
    """Captura los correos que el job pide enviar."""
    box = {"single": [], "digest": [], "reminder_student": [], "reminder_teacher": [], "reminder_digest": []}
    monkeypatch.setattr(chat_digest, "send_new_chat_message_teacher_email", lambda **kw: box["single"].append(kw) or True)
    monkeypatch.setattr(chat_digest, "send_chat_digest_teacher_email", lambda **kw: box["digest"].append(kw) or True)
    monkeypatch.setattr(sch, "send_class_reminder_email", lambda **kw: box["reminder_student"].append(kw) or True)
    monkeypatch.setattr(sch, "send_class_reminder_teacher_email", lambda **kw: box["reminder_teacher"].append(kw) or True)
    monkeypatch.setattr(sch, "send_class_reminders_teacher_digest_email", lambda **kw: box["reminder_digest"].append(kw) or True)
    monkeypatch.setattr(sch, "request_reschedule", lambda *a, **k: None)
    return box


def _student(db, name):
    u = _mk_user(db, "student", name)
    sp = StudentProfile(user_id=u.id, user_username=u.username, timezone="UTC")
    db.add(sp)
    db.flush()
    return u, sp


def _convo(db, w, name):
    u, sp = _student(db, name)
    c = ChatConversation(conversation_type=ChatConversationType.direct, teacher_id=w["tp"].id, student_id=sp.id)
    db.add(c)
    db.commit()
    return u, c


def _say(db, convo, user, text="hola"):
    cfg = get_or_create_platform_config(db)
    return chat_core.send_message(db, cfg, convo, user, text)


# ─── chat ──────────────────────────────────────────────────────────────────────

def test_first_student_message_marks_pending_without_emailing(db, world, sent):
    u, c = _convo(db, world, "ana")
    _msg, should, _dup = _say(db, c, u)
    db.refresh(c)
    assert should is True and c.teacher_notify_pending_at is not None
    assert sent["single"] == [] and sent["digest"] == []


def test_second_message_inside_window_does_not_notify_again(db, world, sent):
    u, c = _convo(db, world, "ana")
    _say(db, c, u, "uno")
    first = db.get(ChatConversation, c.id).teacher_notify_pending_at
    _m, should, _d = _say(db, c, u, "dos")
    assert should is False
    assert db.get(ChatConversation, c.id).teacher_notify_pending_at == first


def test_teacher_messages_never_mark_pending(db, world, sent):
    u, c = _convo(db, world, "ana")
    _say(db, c, world["t_user"], "hola alumno")
    assert db.get(ChatConversation, c.id).teacher_notify_pending_at is None


def test_digest_waits_for_the_delay(db, world, sent):
    u, c = _convo(db, world, "ana")
    _say(db, c, u)
    assert chat_digest.send_pending_digests(db) == 0          # aun no pasaron 10 min
    assert sent["single"] == []
    assert db.get(ChatConversation, c.id).teacher_notify_pending_at is not None


def test_one_conversation_sends_the_single_email(db, world, sent):
    u, c = _convo(db, world, "ana")
    _say(db, c, u, "necesito ayuda con el present perfect")
    later = utc_now() + chat_digest.CHAT_DIGEST_DELAY + timedelta(minutes=1)
    assert chat_digest.send_pending_digests(db, now=later) == 1
    assert len(sent["single"]) == 1 and sent["digest"] == []
    assert "present perfect" in sent["single"][0]["message_preview"]
    assert f"conversation={c.id}" in sent["single"][0]["conversation_url"]
    assert db.get(ChatConversation, c.id).teacher_notify_pending_at is None


def test_many_conversations_send_ONE_digest(db, world, sent):
    for n in ("ana", "beto", "carla"):
        u, c = _convo(db, world, n)
        _say(db, c, u, f"mensaje de {n}")
        _say(db, c, u, "y otro")
    later = utc_now() + chat_digest.CHAT_DIGEST_DELAY + timedelta(minutes=1)
    assert chat_digest.send_pending_digests(db, now=later) == 1
    assert sent["single"] == [] and len(sent["digest"]) == 1
    items = sent["digest"][0]["items"]
    assert len(items) == 3 and all(n == 2 for _name, n, _p in items)


def test_read_conversation_is_skipped(db, world, sent):
    u, c = _convo(db, world, "ana")
    _say(db, c, u)
    db.add(ChatReadState(conversation_id=c.id, user_id=world["t_user"].id, last_read_at=utc_now() + timedelta(minutes=1)))
    db.commit()
    later = utc_now() + chat_digest.CHAT_DIGEST_DELAY + timedelta(minutes=5)
    assert chat_digest.send_pending_digests(db, now=later) == 0
    assert sent["single"] == [] and db.get(ChatConversation, c.id).teacher_notify_pending_at is None


def test_digest_not_sent_twice(db, world, sent):
    u, c = _convo(db, world, "ana")
    _say(db, c, u)
    later = utc_now() + chat_digest.CHAT_DIGEST_DELAY + timedelta(minutes=1)
    chat_digest.send_pending_digests(db, now=later)
    assert chat_digest.send_pending_digests(db, now=later) == 0
    assert len(sent["single"]) == 1


def test_inactive_teacher_gets_nothing_but_pending_is_cleared(db, world, sent):
    u, c = _convo(db, world, "ana")
    _say(db, c, u)
    world["t_user"].is_active = False
    db.commit()
    later = utc_now() + chat_digest.CHAT_DIGEST_DELAY + timedelta(minutes=1)
    assert chat_digest.send_pending_digests(db, now=later) == 0
    assert db.get(ChatConversation, c.id).teacher_notify_pending_at is None


def test_chat_digest_next_due(db, world, sent):
    assert chat_digest.next_due(db) is None
    u, c = _convo(db, world, "ana")
    _say(db, c, u)
    due = chat_digest.next_due(db)
    pending = db.get(ChatConversation, c.id).teacher_notify_pending_at
    assert abs(due - (pending + chat_digest.CHAT_DIGEST_DELAY)) < timedelta(seconds=1)
    assert sch._JOBS_BY_ID["chat_digest"].next_due(sch._JOBS_BY_ID["chat_digest"], db, utc_now()) == due


def test_chat_job_function_runs(db, world, sent):
    u, c = _convo(db, world, "ana")
    _say(db, c, u)
    c2 = db.get(ChatConversation, c.id)
    c2.teacher_notify_pending_at = utc_now() - timedelta(hours=1)
    db.commit()
    sch.send_chat_digests()
    assert len(sent["single"]) == 1


# ─── recordatorios de clase ────────────────────────────────────────────────────

def _class_in_window(db, w, hours=24, student_user=None, student_profile=None):
    sp = student_profile or w["sp"]
    t0 = utc_now() + timedelta(hours=hours)
    c = Class(teacher_id=w["tp"].id, student_id=sp.id, start_time_utc=t0, end_time_utc=t0 + timedelta(minutes=50),
              duration=50, status="confirmed", subject="English")
    db.add(c)
    db.commit()
    return c


def test_one_class_keeps_the_single_teacher_email(db, world, sent):
    _class_in_window(db, world)
    sch.send_class_reminders()
    assert len(sent["reminder_student"]) == 1
    assert len(sent["reminder_teacher"]) == 1 and sent["reminder_digest"] == []


def test_several_classes_send_one_teacher_digest_but_one_email_per_student(db, world, sent):
    _class_in_window(db, world, 23.5)
    for i, name in enumerate(("ana", "beto")):
        _u, sp = _student(db, name)
        db.commit()
        _class_in_window(db, world, 24 + i * 0.4, student_profile=sp)
    sch.send_class_reminders()
    assert len(sent["reminder_student"]) == 3                       # cada alumno su aviso
    assert sent["reminder_teacher"] == [] and len(sent["reminder_digest"]) == 1
    assert len(sent["reminder_digest"][0]["items"]) == 3


def test_reminder_marked_sent_so_it_does_not_repeat(db, world, sent):
    c = _class_in_window(db, world)
    sch.send_class_reminders()
    db.expire_all()
    assert db.get(Class, c.id).reminder_sent_at is not None
    sch.send_class_reminders()
    assert len(sent["reminder_student"]) == 1


# ─── plantillas ────────────────────────────────────────────────────────────────

def test_digest_templates_escape_html_and_use_right_category(monkeypatch):
    calls = []
    monkeypatch.setattr(email_mod, "_send", lambda to, subject, html, category="essential": calls.append((subject, html, category)) or True)
    email_mod.send_chat_digest_teacher_email("t@x.com", "Prof", [("<b>Ana</b>", 2, "<script>x</script>")], "http://u")
    email_mod.send_class_reminders_teacher_digest_email("t@x.com", "Prof", [("<i>Ana</i>", "Math", "lunes")])
    assert calls[0][2] == "chat_messages" and calls[1][2] == "class_reminders"
    assert "<script>" not in calls[0][1] and "&lt;script&gt;" in calls[0][1]
    assert "<i>Ana</i>" not in calls[1][1]
    assert "2 mensajes nuevos" in calls[0][1] and "1 clases" in calls[1][1]


def test_new_senders_are_registered_in_email_categories():
    assert es.EMAIL_CATEGORY["send_chat_digest_teacher_email"] == "chat_messages"
    assert es.EMAIL_CATEGORY["send_class_reminders_teacher_digest_email"] == "class_reminders"
