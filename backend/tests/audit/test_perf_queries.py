"""Fase 5 (N+1): el numero de consultas SQL de los listados no debe crecer con el numero de filas.

Se siembran K alumnos (con vinculo, matricula, clase y pagos) y se cuenta cuantas sentencias SQL
ejecuta cada listado con K=2 y K=8. Si crece, hay un N+1 (carga perezosa dentro de un bucle).
"""
from datetime import timedelta

import pytest
from sqlalchemy import event

from tests.audit.conftest import _mk_user, hdr, future
from app.db.base import engine, SessionLocal
from app.models.student import StudentProfile
from app.models.student_teacher_link import StudentTeacherLink
from app.models.package import Enrollment, EnrollmentStatus
from app.models.class_ import Class
from app.models.payment import Payment
from app.models.support_ticket import SupportTicket
from app.models.teacher import TeacherProfile, TeacherStatus
from app.models.package import Package

API = "/api/v1"


def _seed(db, w, start, k):
    for i in range(start, start + k):
        u = _mk_user(db, "student", f"extra{i}")
        sp = StudentProfile(user_id=u.id, user_username=u.username, timezone="UTC")
        db.add(sp)
        db.flush()
        db.add(StudentTeacherLink(student_id=sp.id, teacher_id=w["tp"].id))
        en = Enrollment(student_id=sp.id, package_id=w["pkg"].id, teacher_id=w["tp"].id,
                        status=EnrollmentStatus.active, classes_total=4, classes_used=0,
                        payment_status="paid")
        db.add(en)
        db.flush()
        t0 = future(24 + i)
        db.add(Class(teacher_id=w["tp"].id, student_id=sp.id, enrollment_id=en.id,
                     start_time_utc=t0, end_time_utc=t0 + timedelta(minutes=50), duration=50,
                     status="confirmed", subject="English"))
        db.add(Payment(student_id=sp.id, teacher_id=w["tp"].id, enrollment_id=en.id,
                       amount_total=100, amount_teacher=90, amount_platform=10,
                       payment_method="bank_transfer", payment_type="package",
                       status="pending_review"))
        db.add(Payment(student_id=sp.id, teacher_id=w["tp"].id, enrollment_id=en.id,
                       amount_total=100, amount_teacher=90, amount_platform=10,
                       payment_method="bank_transfer", payment_type="package",
                       status="approved"))
        db.add(SupportTicket(user_id=u.id, subject="s", message="m"))
    db.commit()


def _seed_teachers(db, start, k):
    for i in range(start, start + k):
        u = _mk_user(db, "teacher", f"xprofe{i}")
        tp = TeacherProfile(user_id=u.id, user_username=u.username, status=TeacherStatus.approved,
                            timezone="UTC", languages=["English"], subjects=["English"], video_url="http://v")
        db.add(tp)
        db.flush()
        db.add(Package(teacher_id=tp.id, name="P", subject="English", classes_count=4, price=10.0,
                       price_per_class=2.5, duration_minutes=50, is_active=True))
    db.commit()


def _count(client, url, headers):
    n = []

    def hook(conn, cursor, statement, params, context, executemany):
        n.append(statement)

    event.listen(engine, "before_cursor_execute", hook)
    try:
        r = client.get(f"{API}{url}", headers=headers)
    finally:
        event.remove(engine, "before_cursor_execute", hook)
    assert r.status_code == 200, f"{url}: {r.status_code} {r.text[:200]}"
    return len(n)


ENDPOINTS = [
    ("teacher", "/classes/teacher/classes"),
    ("teacher", "/teachers/me/students"),
    ("teacher", "/teachers/me/students-full"),
    ("teacher", "/packages/teacher/enrollments"),
    ("teacher", "/payments/pending-review"),
    ("teacher", "/payments/history"),
    ("teacher", "/chat/conversations"),
    ("admin", "/admin/teachers"),
    ("admin", "/admin/users"),
    ("admin", "/admin/support-tickets"),
    ("admin", "/payments/pending-review"),
    ("admin", "/payments/history"),
    ("admin", "/payments/admin/withdrawals/pending"),
    ("admin", "/chat/admin/conversations"),
    ("public", "/teachers/"),
]


def _headers(w, who):
    return {"teacher": hdr(w["t_user"]), "admin": hdr(w["admin"]), "public": {}}[who]


@pytest.mark.parametrize("who,url", ENDPOINTS)
def test_listado_sin_n_mas_uno(client, db, world, who, url):
    _seed(db, world, 0, 2)
    small = _count(client, url, _headers(world, who))
    _seed(db, world, 100, 6)
    big = _count(client, url, _headers(world, who))
    assert big <= small + 1, f"{who} GET {url}: {small} consultas con 2 filas, {big} con 8 (N+1)"


TEACHER_LISTINGS = [
    ("admin", "/admin/teachers"),
    ("public", "/teachers/"),
    ("admin", "/admin/users"),
]


@pytest.mark.parametrize("who,url", TEACHER_LISTINGS)
def test_listado_profesores_sin_n_mas_uno(client, db, world, who, url):
    _seed_teachers(db, 0, 2)
    small = _count(client, url, _headers(world, who))
    _seed_teachers(db, 100, 6)
    big = _count(client, url, _headers(world, who))
    assert big <= small + 1, f"{who} GET {url}: {small} consultas con 2 profesores, {big} con 8 (N+1)"


# ─── Paginacion de listados ────────────────────────────────────────────────────

PAGED = [
    ("admin", "/payments/history"),
    ("admin", "/admin/support-tickets"),
    ("admin", "/admin/teachers"),
    ("teacher", "/packages/teacher/enrollments"),
]


@pytest.mark.parametrize("who,url", PAGED)
def test_listado_paginado(client, db, world, who, url):
    _seed(db, world, 0, 5)
    _seed_teachers(db, 0, 5)
    h = _headers(world, who)
    full = client.get(f"{API}{url}", headers=h)
    assert full.status_code == 200
    total = int(full.headers["X-Total-Count"])
    assert total == len(full.json()) and total >= 5
    page = client.get(f"{API}{url}?limit=2&offset=1", headers=h)
    assert page.status_code == 200
    assert len(page.json()) == 2
    assert int(page.headers["X-Total-Count"]) == total  # el total no depende de la pagina
    assert page.json() == full.json()[1:3]              # mismo orden, sin saltos ni repetidos
    assert client.get(f"{API}{url}?limit=0", headers=h).status_code == 422
    assert client.get(f"{API}{url}?limit=501", headers=h).status_code == 422
