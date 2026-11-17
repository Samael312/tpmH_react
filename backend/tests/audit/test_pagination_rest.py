"""Fase 5: paginacion (`limit`/`offset` + `X-Total-Count`) del resto de listados, y purga de logs."""
from datetime import timedelta

import pytest

from tests.audit.conftest import _mk_user, hdr, future
from app.core import retention
from app.core.teacher_students import link_student_to_teacher
from app.core.timezone import utc_now
from app.models.chat import ChatConversation, ChatConversationType
from app.models.class_ import Class
from app.models.email_log import EmailLog
from app.models.error_log import ErrorLog
from app.models.payment import Payment, Withdrawal
from app.models.student import StudentProfile
from app.models.support_ticket import SupportTicket

API = "/api/v1"
N = 6


def seed_payments(db, w):
    for _ in range(N):
        db.add(Payment(student_id=w["sp"].id, teacher_id=w["tp"].id, amount_total=10, amount_teacher=9,
                       amount_platform=1, payment_method="bank_transfer", payment_type="package", status="approved"))
    db.commit()


def seed_withdrawals(db, w):
    for _ in range(N):
        db.add(Withdrawal(teacher_id=w["tp"].id, amount=10, status="pending"))
    db.commit()


def seed_tickets(db, w):
    for i in range(N):
        db.add(SupportTicket(user_id=w["s_user"].id, subject=f"s{i}", message="m"))
    db.commit()


def seed_students(db, w):
    for i in range(N):
        u = _mk_user(db, "student", f"alu{i}")
        sp = StudentProfile(user_id=u.id, user_username=u.username, timezone="UTC")
        db.add(sp)
        db.flush()
        link_student_to_teacher(db, sp, w["tp"])
    db.commit()


def seed_conversations(db, w):
    for i in range(N):
        u = _mk_user(db, "student", f"chat{i}")
        sp = StudentProfile(user_id=u.id, user_username=u.username, timezone="UTC")
        db.add(sp)
        db.flush()
        db.add(ChatConversation(conversation_type=ChatConversationType.direct, teacher_id=w["tp"].id, student_id=sp.id))
    db.commit()


def seed_classes(db, w):
    for i in range(N):
        t0 = future(24 + i * 2)
        db.add(Class(teacher_id=w["tp"].id, student_id=w["sp"].id, start_time_utc=t0,
                     end_time_utc=t0 + timedelta(minutes=50), duration=50, status="confirmed", subject="English"))
    db.commit()


# (quien, url, sembrar, es_lista)
CASES = [
    ("s_user", "/payments/my-payments", seed_payments),
    ("t_user", "/payments/my-income", seed_payments),
    ("t_user", "/payments/my-withdrawals", seed_withdrawals),
    ("admin", "/payments/admin/withdrawals/pending", seed_withdrawals),
    ("s_user", "/support/tickets/me", seed_tickets),
    ("t_user", "/teachers/me/students", seed_students),
    ("t_user", "/teachers/me/students-full", seed_students),
    ("t_user", "/chat/conversations", seed_conversations),
]


@pytest.mark.parametrize("who,url,seed", CASES)
def test_listado_paginado(client, db, world, who, url, seed):
    seed(db, world)
    h = hdr(world[who])
    full = client.get(f"{API}{url}", headers=h)
    assert full.status_code == 200, full.text
    total = int(full.headers["X-Total-Count"])
    assert total == len(full.json()) and total >= N
    page = client.get(f"{API}{url}?limit=2&offset=1", headers=h)
    assert page.status_code == 200
    assert len(page.json()) == 2
    assert int(page.headers["X-Total-Count"]) == total
    assert page.json() == full.json()[1:3]
    beyond = client.get(f"{API}{url}?limit=5&offset={total}", headers=h)
    assert beyond.status_code == 200 and beyond.json() == []
    assert client.get(f"{API}{url}?limit=0", headers=h).status_code == 422
    assert client.get(f"{API}{url}?limit=501", headers=h).status_code == 422
    assert client.get(f"{API}{url}?offset=-1", headers=h).status_code == 422


@pytest.mark.parametrize("who,url", [("s_user", "/classes/my-classes"), ("t_user", "/classes/teacher/classes")])
def test_clases_paginadas_con_contadores_completos(client, db, world, who, url):
    seed_classes(db, world)
    h = hdr(world[who])
    full = client.get(f"{API}{url}", headers=h).json()
    assert full["total"] == N and full["upcoming"] == N and len(full["classes"]) == N
    page = client.get(f"{API}{url}?limit=2&offset=2", headers=h)
    assert page.status_code == 200
    body = page.json()
    # los contadores siguen siendo de TODAS las clases; solo la lista se recorta
    assert (body["total"], body["upcoming"]) == (N, N)
    assert [c["id"] for c in body["classes"]] == [c["id"] for c in full["classes"][2:4]]
    assert int(page.headers["X-Total-Count"]) == N


def test_default_limit_is_200(client, db, world):
    seed_payments(db, world)
    r = client.get(f"{API}/payments/my-payments", headers=hdr(world["s_user"]))
    assert r.status_code == 200 and int(r.headers["X-Total-Count"]) == N


# ─── Retencion de logs ─────────────────────────────────────────────────────────

def _log(db, days_ago, model="error"):
    ts = utc_now() - timedelta(days=days_ago)
    if model == "error":
        db.add(ErrorLog(source="backend", level="error", message="x", created_at=ts))
    else:
        db.add(EmailLog(day=ts.date(), category="welcome", outcome="sent", created_at=ts))


def test_purge_error_logs_keeps_recent_and_boundary(db):
    for d in (1, 29, 31, 90):
        _log(db, d)
    db.commit()
    assert retention.purge_error_logs(db, 30) == 2           # 31 y 90 dias
    assert db.query(ErrorLog).count() == 2


def test_purge_email_log(db):
    for d in (0, 59, 61, 200):
        _log(db, d, "email")
    db.commit()
    assert retention.purge_email_log(db, 60) == 2
    assert db.query(EmailLog).count() == 2


@pytest.mark.parametrize("days", [0, -1])
def test_purge_disabled_with_zero_or_negative(db, days):
    _log(db, 500)
    _log(db, 500, "email")
    db.commit()
    assert retention.purge_error_logs(db, days) == 0
    assert retention.purge_email_log(db, days) == 0
    assert db.query(ErrorLog).count() == 1 and db.query(EmailLog).count() == 1


def test_purge_job_runs_and_registers(db):
    from app.core import scheduler as sch
    _log(db, 400)
    db.commit()
    sch.purge_old_logs()
    db.expire_all()
    assert db.query(ErrorLog).count() == 0
