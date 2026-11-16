"""Fase 2 — PRUEBAS DE INTEGRACIÓN DE API (recorridos completos extremo a extremo)."""
from datetime import timedelta

from tests.audit.conftest import hdr, future, _mk_user
from tests.audit.helpers import (
    API, iso, book, set_status, approve, age_class, ready_student, buy_package,
    restrict_availability,
)
from app.models.class_ import Class
from app.models.package import Enrollment
from app.models.payment import Payment, TeacherWallet
from app.models.student import StudentProfile


def _second_student(db, name="alumno2"):
    u = _mk_user(db, "student", name)
    db.add(StudentProfile(user_id=u.id, user_username=name, timezone="UTC"))
    db.commit()
    return u


def test_register_and_login_are_case_insensitive(client):
    body = {"email": "Mixed.Case@Example.COM", "username": "MiUsuario", "password": "Password123",
            "name": "N", "surname": "U", "role": "student"}
    assert client.post(f"{API}/auth/register", json=body).status_code == 200
    for login in ("miusuario", "MIUSUARIO", "MiUsuario", "mixed.case@example.com", "MIXED.CASE@EXAMPLE.COM"):
        r = client.post(f"{API}/auth/login", json={"login": login, "password": "Password123"})
        assert r.status_code == 200, (login, r.status_code)
        assert r.json().get("access_token")
    # duplicados en cualquier capitalización
    assert client.post(f"{API}/auth/register", json={**body, "username": "otro"}).status_code == 400
    assert client.post(f"{API}/auth/register", json={**body, "email": "x@y.com", "username": "MIUSUARIO"}).status_code == 400
    # contraseña incorrecta sigue fallando
    assert client.post(f"{API}/auth/login", json={"login": "miusuario", "password": "mala-clave-1"}).status_code == 401


def test_naive_datetimes_rejected_on_every_entrypoint(client, world, db):
    eid, _ = ready_student(client, world)
    cid = book(client, world, future(72), enrollment_id=eid).json()["class_id"]
    naive = future(100).replace(tzinfo=None).isoformat()
    body = {"start_time_utc": naive, "end_time_utc": naive}
    r = client.post(f"{API}/payments/book", json={**body, "enrollment_id": eid, "duration_minutes": 50},
                    headers=hdr(world["s_user"]))
    assert r.status_code == 422
    for path, who in (("/classes/{id}/reschedule", "s_user"), ("/classes/teacher/{id}/reschedule", "t_user"),
                      ("/classes/admin/{id}/reschedule", "admin")):
        r = client.patch(f"{API}{path.format(id=cid)}", json=body, headers=hdr(world[who]))
        assert r.status_code == 422, (path, r.status_code)


def test_double_approval_credits_wallet_once(client, world, db):
    _, pid = ready_student(client, world)
    db.expire_all()
    wallet = db.query(TeacherWallet).filter_by(teacher_id=world["tp"].id).one()
    earned = wallet.total_earned
    again = approve(client, world, pid)
    assert again.status_code in (400, 404, 409), again.status_code
    db.expire_all()
    assert db.query(TeacherWallet).filter_by(teacher_id=world["tp"].id).one().total_earned == earned


def test_withdrawal_cannot_be_processed_twice(client, world, db):
    ready_student(client, world)
    th = hdr(world["t_user"])
    wid = client.post(f"{API}/payments/request-withdrawal", json={"amount": 50, "payment_info": "IBAN"},
                      headers=th).json()["id"]
    url = f"{API}/payments/admin/withdrawals/{wid}/process"
    assert client.post(url, json={"action": "complete", "reference": "R1"}, headers=hdr(world["admin"])).status_code == 200
    db.expire_all()
    balance = db.query(TeacherWallet).filter_by(teacher_id=world["tp"].id).one().available_balance
    second = client.post(url, json={"action": "reject"}, headers=hdr(world["admin"]))
    assert second.status_code in (400, 404, 409)
    db.expire_all()
    assert db.query(TeacherWallet).filter_by(teacher_id=world["tp"].id).one().available_balance == balance


def test_withdrawal_below_minimum_rejected_via_api(client, world, db):
    ready_student(client, world)
    for amount in (0.01, 5, 9.99):
        r = client.post(f"{API}/payments/request-withdrawal", json={"amount": amount, "payment_info": "x"},
                        headers=hdr(world["t_user"]))
        assert r.status_code == 422, (amount, r.status_code)


def test_cancel_twice_returns_credit_only_once(client, world, db):
    eid, _ = ready_student(client, world)
    a = book(client, world, future(72), enrollment_id=eid).json()["class_id"]
    book(client, world, future(96), enrollment_id=eid)
    url = f"{API}/classes/{a}"
    assert client.delete(url, headers=hdr(world["s_user"])).status_code == 200
    assert client.delete(url, headers=hdr(world["s_user"])).status_code in (400, 404)
    db.expire_all()
    assert db.get(Enrollment, eid).classes_used == 0
    # 4 créditos exactos: 1 viva + 3 nuevas OK, la 5ª no
    codes = [book(client, world, future(120 + 24 * i), enrollment_id=eid).status_code for i in range(4)]
    assert codes == [201, 201, 201, 400] or codes.count(201) == 3, codes


def test_full_student_journey_with_availability_and_conflicts(client, world, db):
    """Prueba → paquete → reservar → reagendar → competencia por el horario → completar."""
    eid, _ = ready_student(client, world)
    restrict_availability(db, world)  # 08:00-20:00 UTC
    s2 = _second_student(db)

    inside = future(96).replace(hour=10)
    outside = future(96).replace(hour=3)

    # 1. fuera de horario -> rechazado; dentro -> aceptado
    assert book(client, world, outside, enrollment_id=eid).status_code in (400, 409)
    r = book(client, world, inside, enrollment_id=eid)
    assert r.status_code == 201, r.text
    cid = r.json()["class_id"]

    # 2. otro alumno quiere su prueba justo a esa hora -> conflicto
    assert book(client, world, inside, user=s2).status_code == 409

    # 3. reagendar fuera de horario -> rechazado; dentro -> aceptado y libera el hueco
    patch = lambda t: client.patch(f"{API}/classes/{cid}/reschedule", json={
        "start_time_utc": iso(t), "end_time_utc": iso(t + timedelta(minutes=50))}, headers=hdr(world["s_user"]))
    assert patch(outside).status_code in (400, 409)
    moved = future(120).replace(hour=11)
    assert patch(moved).status_code == 200
    assert book(client, world, inside, user=s2).status_code == 201   # el hueco anterior quedó libre

    # 4. el nuevo horario está bloqueado para otros
    s3 = _second_student(db, "alumno3")
    assert book(client, world, moved, user=s3).status_code == 409

    # 5. el profesor no puede cerrar la clase antes de que ocurra, pero sí después
    assert set_status(client, world, cid, "completed").status_code == 400
    assert set_status(client, world, cid, "completed", age=True).status_code == 200
    db.expire_all()
    assert db.get(Enrollment, eid).classes_used == 1
    assert db.get(Class, cid).status in ("completed", "finalized")
