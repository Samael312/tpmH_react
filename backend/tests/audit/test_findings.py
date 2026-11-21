"""
Hallazgos de la auditoría (ver ANALISIS.md).

Cada test afirma el comportamiento CORRECTO esperado. Los que hoy fallan
están marcados con xfail(strict=True) y el ID del hallazgo: cuando se
corrija el bug el test pasará a XPASS (y strict=True lo hará fallar para
recordar que hay que quitar el marcador). Los tests sin xfail documentan
comportamiento que ya es correcto.
"""
from datetime import timedelta

import pytest

from tests.audit.conftest import hdr, future, _mk_user
from tests.audit.helpers import (
    API, iso, book, set_status, approve, ready_student, complete_trial, buy_package, restrict_availability,
)
from app.models.package import Enrollment, Package
from app.models.class_ import Class
from app.models.payment import Payment, TeacherWallet
from app.models.teacher import TeacherProfile, TeacherStatus
from app.models.student import StudentProfile
from app.models.user import User
from app.models.payment_config import PlatformConfig


# ─── Agendado ───────────────────────────────────────────────────────────────

def test_booking_outside_teacher_availability_rejected(client, world, db):
    eid, _ = ready_student(client, world)
    restrict_availability(db, world)
    t = future(72).replace(hour=3)  # disponibilidad: 08:00-20:00 UTC
    r = book(client, world, t, enrollment_id=eid)
    assert r.status_code in (400, 409, 422), f"se aceptó una clase a las 03:00 UTC ({r.status_code})"


def test_two_students_cannot_book_same_trial_slot(client, world, db):
    s2 = _mk_user(db, "student", "alumno2")
    db.add(StudentProfile(user_id=s2.id, user_username="alumno2", timezone="UTC"))
    db.commit()
    t = future(30)
    assert book(client, world, t).status_code == 201
    r = book(client, world, t, user=s2)
    assert r.status_code == 409, f"2º alumno agendó el mismo horario ({r.status_code})"


def test_renewal_after_full_cycle_gives_new_credits(client, world, db):
    eid, _ = ready_student(client, world)
    ids = []
    for i in range(4):
        r = book(client, world, future(48 + i * 24), enrollment_id=eid)
        assert r.status_code == 201, r.text
        ids.append(r.json()["class_id"])
    for cid in ids:
        assert set_status(client, world, cid, "completed", age=True).status_code == 200
    db.expire_all()
    assert db.get(Enrollment, eid).status.value == "completed"
    r = client.post(f"{API}/payments/notify-payment", json={
        "type": "renewal", "enrollment_id": eid, "package_id": world["pkg"].id,
        "payment_method": "bank_transfer"}, headers=hdr(world["s_user"]))
    assert r.status_code == 200, r.text
    assert approve(client, world, r.json()["payment_id"]).status_code == 200
    db.expire_all()
    e = db.get(Enrollment, eid)
    assert e.status.value == "active", f"tras renovar quedó '{e.status.value}'"
    assert book(client, world, future(300), enrollment_id=eid).status_code == 201


def test_cannot_complete_future_class(client, world, db):
    eid, _ = ready_student(client, world)
    cid = book(client, world, future(200), enrollment_id=eid).json()["class_id"]
    assert set_status(client, world, cid, "completed").status_code == 400


def test_teacher_status_cancel_does_not_penalize_student(client, world, db):
    eid, _ = ready_student(client, world)
    cid = book(client, world, future(3), enrollment_id=eid).json()["class_id"]
    assert set_status(client, world, cid, "cancelled").status_code == 200
    db.expire_all()
    assert db.get(Enrollment, eid).classes_used == 0


def test_student_reschedule_outside_availability_rejected(client, world, db):
    eid, _ = ready_student(client, world)
    restrict_availability(db, world)
    cid = book(client, world, future(72).replace(hour=10), enrollment_id=eid).json()["class_id"]
    new = future(96).replace(hour=3)
    r = client.patch(f"{API}/classes/{cid}/reschedule", json={
        "start_time_utc": iso(new), "end_time_utc": iso(new + timedelta(minutes=50))},
        headers=hdr(world["s_user"]))
    assert r.status_code in (400, 409)


def test_booking_duration_must_match_package(client, world, db):
    eid, _ = ready_student(client, world)  # paquete de 50 min
    r = book(client, world, future(72), enrollment_id=eid, duration=110)
    assert r.status_code == 400


def test_naive_datetime_does_not_crash(client, world, db):
    eid, _ = ready_student(client, world)
    naive = (future(72)).replace(tzinfo=None).isoformat()
    r = client.post(f"{API}/payments/book", json={
        "enrollment_id": eid, "start_time_utc": naive, "end_time_utc": naive,
        "duration_minutes": 50}, headers=hdr(world["s_user"]))
    assert r.status_code in (400, 422), f"status {r.status_code}"


def test_counter_update_keeps_pending_renewal_status(client, world, db):
    eid, _ = ready_student(client, world)
    cid = book(client, world, future(72), enrollment_id=eid).json()["class_id"]
    r = client.post(f"{API}/payments/notify-payment", json={
        "type": "renewal", "enrollment_id": eid, "package_id": world["pkg"].id,
        "payment_method": "bank_transfer"}, headers=hdr(world["s_user"]))
    assert r.status_code == 200
    set_status(client, world, cid, "completed", age=True)
    db.expire_all()
    assert db.get(Enrollment, eid).status.value == "pending_renewal"


def test_business_rules_accept_zero(db):
    from app.core.class_logic import get_business_rules
    db.add(PlatformConfig(min_cancel_hours=0))
    db.commit()
    assert get_business_rules(db)["min_cancel_hours"] == 0


def test_group_class_teacher_reschedule_not_blocked_by_foreign_group(db):
    """can_book_slot con student_id=None (clase grupal) no debe chocar con grupos ajenos."""
    pytest.skip("Requiere cohortes; cubierto en ANALISIS.md como AUD-18 (pendiente de reproducir con BD real)")


# ─── Pagos / comisiones / billetera ─────────────────────────────────────────

def _wallet(db, tp_id):
    db.expire_all()
    return db.query(TeacherWallet).filter(TeacherWallet.teacher_id == tp_id).first()


def test_commission_default_15_percent(client, world, db):
    _, pid = ready_student(client, world)
    p = db.get(Payment, pid)
    assert (p.amount_total, p.amount_platform, p.amount_teacher) == (100.0, 15.0, 85.0)
    w = _wallet(db, world["tp"].id)
    assert (w.available_balance, w.total_earned) == (85.0, 85.0)


def test_custom_commission_applied(client, world, db):
    world["tp"].commission_rate = 0.30
    db.commit()
    _, pid = ready_student(client, world)
    p = db.get(Payment, pid)
    assert (p.amount_platform, p.amount_teacher) == (30.0, 70.0)


def test_commission_rounding_cents():
    from app.api.v1.endpoints.payments import _apply_commission
    class T: commission_rate = 0.15
    t, pl = _apply_commission(33.33, T())
    assert round(t + pl, 2) == 33.33 and (t, pl) == (28.33, 5.0)


def test_commission_zero_and_full():
    from app.api.v1.endpoints.payments import _apply_commission
    class T0: commission_rate = 0.0
    class T1: commission_rate = 1.0
    assert _apply_commission(50, T0()) == (50.0, 0.0)
    assert _apply_commission(50, T1()) == (0.0, 50.0)


def test_commission_null_rate_falls_back_to_default():
    from app.api.v1.endpoints.payments import _apply_commission
    class TN: commission_rate = None
    assert _apply_commission(100, TN()) == (85.0, 15.0)


def test_payment_cannot_be_approved_twice(client, world, db):
    _, pid = ready_student(client, world)
    r = approve(client, world, pid)
    assert r.status_code == 404
    assert _wallet(db, world["tp"].id).available_balance == 85.0


def test_reject_requires_reason(client, world, db):
    complete_trial(client, world)
    r = client.post(f"{API}/payments/notify-payment", json={
        "type": "package", "package_id": world["pkg"].id, "payment_method": "bank_transfer"},
        headers=hdr(world["s_user"]))
    pid = r.json()["payment_id"]
    bad = client.patch(f"{API}/payments/{pid}/validate", json={"action": "reject"}, headers=hdr(world["admin"]))
    assert bad.status_code == 400
    ok = client.patch(f"{API}/payments/{pid}/validate",
                      json={"action": "reject", "rejection_reason": "monto incorrecto"},
                      headers=hdr(world["admin"]))
    assert ok.status_code == 200
    assert _wallet(db, world["tp"].id) is None


def test_disabled_payment_method_rejected(client, world, db):
    complete_trial(client, world)
    r = client.post(f"{API}/payments/notify-payment", json={
        "type": "package", "package_id": world["pkg"].id, "payment_method": "paypal"},
        headers=hdr(world["s_user"]))
    assert r.status_code == 400


def test_student_cannot_validate_payment(client, world, db):
    complete_trial(client, world)
    r = client.post(f"{API}/payments/notify-payment", json={
        "type": "package", "package_id": world["pkg"].id, "payment_method": "bank_transfer"},
        headers=hdr(world["s_user"]))
    pid = r.json()["payment_id"]
    assert client.patch(f"{API}/payments/{pid}/validate", json={"action": "approve"},
                        headers=hdr(world["s_user"])).status_code == 403


def test_withdrawal_full_cycle(client, world, db):
    _, _ = ready_student(client, world)
    th = hdr(world["t_user"])
    too_much = client.post(f"{API}/payments/request-withdrawal", json={"amount": 500, "payment_info": "x"}, headers=th)
    assert too_much.status_code == 400
    r = client.post(f"{API}/payments/request-withdrawal", json={"amount": 50, "payment_info": "IBAN"}, headers=th)
    assert r.status_code == 201, r.text
    assert _wallet(db, world["tp"].id).available_balance == 35.0
    again = client.post(f"{API}/payments/request-withdrawal", json={"amount": 10, "payment_info": "IBAN"}, headers=th)
    assert again.status_code == 400  # solo un retiro pendiente
    wid = r.json()["id"]
    done = client.post(f"{API}/payments/admin/withdrawals/{wid}/process", json={"action": "complete", "reference": "R1"},
                       headers=hdr(world["admin"]))
    assert done.status_code == 200
    w = _wallet(db, world["tp"].id)
    assert (w.available_balance, w.total_withdrawn) == (35.0, 50.0)


def test_withdrawal_reject_restores_balance(client, world, db):
    ready_student(client, world)
    th = hdr(world["t_user"])
    wid = client.post(f"{API}/payments/request-withdrawal", json={"amount": 50, "payment_info": "x"}, headers=th).json()["id"]
    r = client.post(f"{API}/payments/admin/withdrawals/{wid}/process",
                    json={"action": "reject", "rejection_reason": "datos"}, headers=hdr(world["admin"]))
    assert r.status_code == 200
    assert _wallet(db, world["tp"].id).available_balance == 85.0


def test_admin_can_list_pending_withdrawals(client, world, db):
    r = client.get(f"{API}/payments/admin/withdrawals/pending", headers=hdr(world["admin"]))
    assert r.status_code == 200


def test_withdrawal_minimum_amount(client, world, db):
    ready_student(client, world)
    r = client.post(f"{API}/payments/request-withdrawal", json={"amount": 0.5, "payment_info": "x"},
                    headers=hdr(world["t_user"]))
    assert r.status_code == 422


def test_refund_claws_back_teacher_wallet(client, world, db):
    small = Package(teacher_id=world["tp"].id, name="P2", subject="English", classes_count=2,
                    price=50.0, price_per_class=25.0, duration_minutes=50, is_active=True)
    db.add(small); db.commit()
    eid, _ = ready_student(client, world)
    r = client.post(f"{API}/payments/notify-payment", json={
        "type": "package_change", "enrollment_id": eid, "package_id": small.id,
        "change_option": "full_refund", "payment_info": {"other_notes": "contacto"}},
        headers=hdr(world["s_user"]))
    assert r.status_code == 200, r.text
    assert approve(client, world, r.json()["payment_id"]).status_code == 200
    assert _wallet(db, world["tp"].id).available_balance == 0.0, "el profesor conserva el dinero reembolsado"


def test_withdrawal_requires_teacher_role(client, world, db):
    r = client.post(f"{API}/payments/request-withdrawal", json={"amount": 20, "payment_info": "x"},
                    headers=hdr(world["s_user"]))
    assert r.status_code == 403


# ─── Roles / permisos ───────────────────────────────────────────────────────

def _teacher_admin(db):
    u = _mk_user(db, "teacher_admin", "tadmin")
    tp = TeacherProfile(user_id=u.id, user_username=u.username, status=TeacherStatus.approved,
                        timezone="UTC", languages=["English"], subjects=["English"], video_url="v")
    db.add(tp); db.commit()
    return u, tp


def test_teacher_admin_cannot_change_own_commission(client, world, db):
    u, tp = _teacher_admin(db)
    r = client.patch(f"{API}/admin/teachers/{tp.id}/commission", json={"commission_rate": 0.0}, headers=hdr(u))
    assert r.status_code == 403


def test_commission_bounds(client, world, db):
    r = client.patch(f"{API}/admin/teachers/{world['tp'].id}/commission", json={"commission_rate": 1.5},
                     headers=hdr(world["admin"]))
    assert r.status_code == 422  # Fase 20: el rango 0-1 ahora lo valida el schema (antes 400 desde el endpoint)


def test_student_cannot_access_admin_or_teacher_routes(client, world, db):
    s = hdr(world["s_user"])
    assert client.get(f"{API}/payments/pending-review", headers=s).status_code == 403
    assert client.patch(f"{API}/admin/teachers/1/commission", json={"commission_rate": 0.1}, headers=s).status_code == 403
    assert client.get(f"{API}/classes/teacher/classes", headers=s).status_code == 403


def test_teacher_cannot_validate_other_teachers_payment(client, world, db):
    complete_trial(client, world)
    r = client.post(f"{API}/payments/notify-payment", json={
        "type": "package", "package_id": world["pkg"].id, "payment_method": "bank_transfer"},
        headers=hdr(world["s_user"]))
    pid = r.json()["payment_id"]
    t2 = _mk_user(db, "teacher", "profe2")
    db.add(TeacherProfile(user_id=t2.id, user_username="profe2", status=TeacherStatus.approved, timezone="UTC"))
    db.commit()
    assert client.patch(f"{API}/payments/{pid}/validate", json={"action": "approve"}, headers=hdr(t2)).status_code == 403


def test_requests_without_token_are_rejected(client, world):
    for path in ("/classes/my-classes", "/payments/my-wallet", "/users/me", "/admin/users"):
        assert client.get(f"{API}{path}").status_code in (401, 403, 404, 405), path


# ─── Autenticación ──────────────────────────────────────────────────────────

def test_register_cannot_choose_privileged_role(client):
    r = client.post(f"{API}/auth/register", json={
        "email": "x@x.com", "username": "hacker", "password": "Password123",
        "name": "H", "surname": "K", "role": "superadmin"})
    assert r.status_code == 422


def test_register_login_roundtrip(client):
    r = client.post(f"{API}/auth/register", json={
        "email": "nuevo@x.com", "username": "nuevo", "password": "Password123",
        "name": "N", "surname": "U", "role": "student"})
    assert r.status_code == 200, r.text
    assert client.post(f"{API}/auth/login", json={"login": "nuevo@x.com", "password": "Password123"}).status_code == 200
    assert client.post(f"{API}/auth/login", json={"login": "nuevo", "password": "mala"}).status_code == 401


def test_login_username_case_insensitive(client):
    client.post(f"{API}/auth/register", json={
        "email": "c@x.com", "username": "MiUser", "password": "Password123",
        "name": "N", "surname": "U", "role": "student"})
    r = client.post(f"{API}/auth/login", json={"login": "MiUser", "password": "Password123"})
    assert r.status_code == 200


def test_email_case_duplicates_rejected(client):
    base = {"username": "user1", "password": "Password123", "name": "N", "surname": "U", "role": "student"}
    assert client.post(f"{API}/auth/register", json={**base, "email": "Dup@x.com"}).status_code == 200
    r = client.post(f"{API}/auth/register", json={**base, "username": "user2", "email": "dup@x.com"})
    assert r.status_code == 400


def test_password_login_on_google_only_account_is_401(client, db):
    db.add(User(email="g@x.com", username="guser", name="G", surname="U", password_hash=None))
    db.commit()
    r = client.post(f"{API}/auth/login", json={"login": "guser", "password": "whatever1"})
    assert r.status_code == 401


def test_forgot_password_does_not_enumerate(client, world):
    a = client.post(f"{API}/auth/forgot-password", json={"email": "alumno@audit-tpm.com"})
    b = client.post(f"{API}/auth/forgot-password", json={"email": "noexiste@audit-tpm.com"})
    assert a.status_code == b.status_code == 200 and a.json() == b.json()


def test_reset_password_token_single_use(client, world, db):
    from app.models.password_reset import PasswordResetToken
    from app.core.timezone import utc_now
    db.add(PasswordResetToken(user_id=world["s_user"].id, token="tok123", expires_at=utc_now() + timedelta(hours=1)))
    db.commit()
    assert client.post(f"{API}/auth/reset-password", json={"token": "tok123", "new_password": "NuevaClave99"}).status_code == 200
    assert client.post(f"{API}/auth/reset-password", json={"token": "tok123", "new_password": "OtraClave99"}).status_code == 400
    assert client.post(f"{API}/auth/login", json={"login": "alumno", "password": "NuevaClave99"}).status_code == 200


def test_expired_reset_token_rejected(client, world, db):
    from app.models.password_reset import PasswordResetToken
    from app.core.timezone import utc_now
    db.add(PasswordResetToken(user_id=world["s_user"].id, token="old", expires_at=utc_now() - timedelta(minutes=1)))
    db.commit()
    assert client.post(f"{API}/auth/reset-password", json={"token": "old", "new_password": "NuevaClave99"}).status_code == 400


def test_deactivated_user_token_rejected(client, world, db):
    h = hdr(world["s_user"])
    world["s_user"].is_active = False
    db.commit()
    assert client.get(f"{API}/classes/my-classes", headers=h).status_code == 403


def test_tampered_token_rejected(client, world):
    h = hdr(world["s_user"])
    bad = {"Authorization": h["Authorization"][:-3] + "abc"}
    assert client.get(f"{API}/classes/my-classes", headers=bad).status_code == 401


def test_public_platform_config_has_no_secrets(client, world):
    r = client.get(f"{API}/admin/platform-config")
    assert r.status_code == 200
    blob = str(r.json()).lower()
    for secret in ("password", "secret", "token", "api_key"):
        assert secret not in blob


# ─── Disponibilidad / slots / zonas horarias ───────────────────────────────

def test_featured_teacher_slots_work_for_students(client, world, db):
    cfg = db.query(PlatformConfig).first()
    cfg.featured_teacher_id = world["tp"].id
    db.commit()
    date = future(72).strftime("%Y-%m-%d")
    r = client.get(f"{API}/availability/featured-teacher/slots?date={date}&duration=50", headers=hdr(world["s_user"]))
    assert r.status_code == 200, r.text


def test_slots_endpoint_returns_free_slots_and_marks_busy(client, world, db):
    eid, _ = ready_student(client, world)
    restrict_availability(db, world)
    start = future(72).replace(hour=10)
    assert book(client, world, start, enrollment_id=eid).status_code == 201
    date = start.strftime("%Y-%m-%d")
    r = client.get(f"{API}/availability/profe/slots?date={date}&duration=50", headers=hdr(world["s_user"]))
    assert r.status_code == 200, r.text
    by_start = {s["start_time_utc"][:16]: s for s in r.json()}
    assert by_start[start.strftime("%Y-%m-%dT%H:%M")]["is_available"] is False
    free = [s for s in r.json() if s["is_available"] and not s["too_soon"] and not s["is_past"]]
    assert free, "debería haber slots libres ese día"
    # nada se ofrece fuera de 08:00-20:00 UTC
    assert all("08:00" <= s["start_time_utc"][11:16] <= "20:00" for s in r.json())


def test_local_to_utc_conversion_day_shift():
    from app.core.timezone import convert_local_time_to_utc
    assert convert_local_time_to_utc("09:00", "America/Caracas", 0) == ("13:00", 0)
    hhmm, dow = convert_local_time_to_utc("06:00", "Australia/Sydney", 0)
    assert dow == 6  # el lunes local de Sídney cae en domingo UTC


def test_slot_overlap_math():
    from datetime import datetime, timezone
    from app.core.timezone import get_all_slots_utc
    u = lambda h, m=0: datetime(2030, 1, 1, h, m, tzinfo=timezone.utc)
    slots = dict(get_all_slots_utc([(u(9), u(12))], [(u(10), u(11))], duration_minutes=60))
    assert slots[u(9)] is False and slots[u(10)] is True and slots[u(11)] is False
    assert u(9, 30) in slots and slots[u(9, 30)] is True  # solapa con la clase de las 10
    assert u(11, 30) not in slots  # no cabe en la disponibilidad
