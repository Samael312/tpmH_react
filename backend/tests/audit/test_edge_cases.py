"""Situaciones límite: fronteras de tiempo, entradas hostiles, paquetes ilimitados,
cuotas, cambios de paquete, idempotencia, roles cruzados."""
from datetime import timedelta

import pytest

from tests.audit.conftest import hdr, future, _mk_user
from tests.audit.helpers import (
    API, iso, book, set_status, approve, ready_student, complete_trial, buy_package,
)
from app.core.timezone import utc_now
from app.models.package import Enrollment, Package
from app.models.class_ import Class
from app.models.payment import Payment, TeacherWallet
from app.models.student import StudentProfile
from app.models.teacher import TeacherProfile, TeacherStatus


def _notify(client, user, **body):
    return client.post(f"{API}/payments/notify-payment", json=body, headers=hdr(user))


# ─── Fronteras de tiempo ────────────────────────────────────────────────────

def test_cancel_just_outside_and_inside_12h_boundary(client, world, db):
    eid, _ = ready_student(client, world)
    ok = book(client, world, future(13), enrollment_id=eid).json()["class_id"]
    no = book(client, world, future(11), enrollment_id=eid).json()["class_id"]
    assert client.delete(f"{API}/classes/{ok}", headers=hdr(world["s_user"])).status_code == 200
    assert client.delete(f"{API}/classes/{no}", headers=hdr(world["s_user"])).status_code == 400


def test_booking_in_the_past_rejected(client, world, db):
    eid, _ = ready_student(client, world)
    assert book(client, world, utc_now() - timedelta(days=1), enrollment_id=eid).status_code in (400, 409)


def test_booking_duration_extremes(client, world, db):
    eid, _ = ready_student(client, world)
    for d in (0, -5, 14, 241, 10**6):
        r = book(client, world, future(72), enrollment_id=eid, duration=d)
        assert r.status_code in (400, 422), (d, r.status_code)


def test_back_to_back_classes_respect_buffer(client, world, db):
    eid, _ = ready_student(client, world)
    t = future(72).replace(hour=10)
    assert book(client, world, t, enrollment_id=eid).status_code == 201
    # termina 10:50 + 10 min de margen -> 11:00 libre, 10:55 no
    assert book(client, world, t + timedelta(minutes=55), enrollment_id=eid).status_code == 409
    assert book(client, world, t + timedelta(minutes=60), enrollment_id=eid).status_code == 201


def test_cancelled_slot_can_be_rebooked_by_other_student(client, world, db):
    eid, _ = ready_student(client, world)
    t = future(72).replace(hour=10)
    cid = book(client, world, t, enrollment_id=eid).json()["class_id"]
    client.delete(f"{API}/classes/{cid}", headers=hdr(world["s_user"]))
    assert book(client, world, t, enrollment_id=eid).status_code == 201


def test_reschedule_to_same_time_is_allowed(client, world, db):
    eid, _ = ready_student(client, world)
    t = future(72).replace(hour=10)
    cid = book(client, world, t, enrollment_id=eid).json()["class_id"]
    r = client.patch(f"{API}/classes/{cid}/reschedule", json={
        "start_time_utc": iso(t), "end_time_utc": iso(t + timedelta(minutes=50))}, headers=hdr(world["s_user"]))
    assert r.status_code == 200


def test_double_cancel_is_safe(client, world, db):
    eid, _ = ready_student(client, world)
    cid = book(client, world, future(72), enrollment_id=eid).json()["class_id"]
    assert client.delete(f"{API}/classes/teacher/{cid}", headers=hdr(world["t_user"])).status_code == 200
    assert client.delete(f"{API}/classes/teacher/{cid}", headers=hdr(world["t_user"])).status_code == 400
    # el alumno no puede volver a cancelar una cancelada, y el crédito no se devuelve dos veces
    assert client.delete(f"{API}/classes/{cid}", headers=hdr(world["s_user"])).status_code == 400
    db.expire_all()
    assert db.get(Enrollment, eid).classes_used == 0


def test_no_show_and_completed_count_toward_package(client, world, db):
    eid, _ = ready_student(client, world)
    a = book(client, world, future(72), enrollment_id=eid).json()["class_id"]
    b = book(client, world, future(96), enrollment_id=eid).json()["class_id"]
    set_status(client, world, a, "no_show", age=True)
    set_status(client, world, b, "completed", age=True)
    db.expire_all()
    assert db.get(Enrollment, eid).classes_used == 2
    # revertir un completed baja el contador
    set_status(client, world, b, "confirmed")
    db.expire_all()
    assert db.get(Enrollment, eid).classes_used == 1


def test_teacher_cannot_change_status_of_other_teachers_class(client, world, db):
    eid, _ = ready_student(client, world)
    cid = book(client, world, future(72), enrollment_id=eid).json()["class_id"]
    t2 = _mk_user(db, "teacher", "profe2")
    db.add(TeacherProfile(user_id=t2.id, user_username="profe2", status=TeacherStatus.approved, timezone="UTC"))
    db.commit()
    r = client.patch(f"{API}/classes/{cid}/status", json={"status": "completed"}, headers=hdr(t2))
    assert r.status_code == 404


def test_invalid_status_value_rejected(client, world, db):
    eid, _ = ready_student(client, world)
    cid = book(client, world, future(72), enrollment_id=eid).json()["class_id"]
    assert set_status(client, world, cid, "banana").status_code == 422


# ─── Entradas hostiles ──────────────────────────────────────────────────────

@pytest.mark.parametrize("login", ["' OR '1'='1", "admin'--", "%", "a" * 300])
def test_login_injection_and_oversize(client, world, login):
    r = client.post(f"{API}/auth/login", json={"login": login, "password": "x"})
    assert r.status_code in (401, 422)


def test_register_html_in_name_is_stored_verbatim_not_executed(client):
    r = client.post(f"{API}/auth/register", json={
        "email": "xss@x.com", "username": "xssuser", "password": "Password123",
        "name": "<script>alert(1)</script>", "surname": "S", "role": "student"})
    assert r.status_code == 200
    # El backend devuelve JSON (no HTML): el escape es responsabilidad de React.
    assert r.headers["content-type"].startswith("application/json")


def test_register_username_edge_lengths(client):
    base = {"email": "e@x.com", "password": "Password123", "name": "N", "surname": "S", "role": "student"}
    assert client.post(f"{API}/auth/register", json={**base, "username": "ab"}).status_code == 422
    assert client.post(f"{API}/auth/register", json={**base, "username": "a" * 51}).status_code == 422
    assert client.post(f"{API}/auth/register", json={**base, "username": "   "}).status_code == 422


def test_password_length_limits(client):
    base = {"email": "p@x.com", "username": "puser", "name": "N", "surname": "S", "role": "student"}
    assert client.post(f"{API}/auth/register", json={**base, "password": "short"}).status_code == 422
    assert client.post(f"{API}/auth/register", json={**base, "password": "x" * 129}).status_code == 422


def test_long_unicode_password_does_not_crash(client):
    # 60 caracteres de 4 bytes = 240 bytes (>72 que admite bcrypt)
    pw = "𝒜" * 60
    r = client.post(f"{API}/auth/register", json={
        "email": "u@x.com", "username": "uuser", "password": pw, "name": "N", "surname": "S", "role": "student"})
    assert r.status_code == 200, r.status_code
    assert client.post(f"{API}/auth/login", json={"login": "uuser", "password": pw}).status_code == 200


def test_malformed_bearer_headers(client):
    for h in ({"Authorization": "Bearer"}, {"Authorization": "Basic abc"}, {"Authorization": "Bearer a.b.c"}, {}):
        r = client.get(f"{API}/users/me", headers=h)
        assert r.status_code in (401, 403), h


def test_token_for_deleted_user_rejected(client, world, db):
    h = hdr(world["s_user"])
    db.delete(world["sp"]); db.delete(world["s_user"]); db.commit()
    assert client.get(f"{API}/users/me", headers=h).status_code == 401


def test_huge_json_and_wrong_types(client, world):
    r = client.post(f"{API}/auth/login", json={"login": 123, "password": ["x"]})
    assert r.status_code == 422
    r = client.post(f"{API}/auth/login", content="not json", headers={"Content-Type": "application/json"})
    assert r.status_code == 422


def test_error_response_never_leaks_traceback(client, world, db):
    eid, _ = ready_student(client, world)
    naive = future(72).replace(tzinfo=None).isoformat()
    r = client.post(f"{API}/payments/book", json={"enrollment_id": eid, "start_time_utc": naive,
                    "end_time_utc": naive, "duration_minutes": 50}, headers=hdr(world["s_user"]))
    assert "Traceback" not in r.text and "File \"" not in r.text


def test_error_logs_endpoint_accepts_anonymous_reports(client):
    r = client.post(f"{API}/logs/frontend", json={"message": "boom", "screen": "/x", "stack": "s" * 8_000})
    assert r.status_code == 204
    # SEC-06: por encima del tope (8000) se rechaza en vez de llenar la tabla de logs
    r = client.post(f"{API}/logs/frontend", json={"message": "boom", "screen": "/x", "stack": "s" * 200_000})
    assert r.status_code == 422


# ─── Paquetes: ilimitado, cuotas, cambios ───────────────────────────────────

def _unlimited(db, tp):
    p = Package(teacher_id=tp.id, name="Ilimitado", subject="English", classes_count=None, price=20.0,
                duration_minutes=50, is_active=True)
    db.add(p); db.commit()
    return p


def test_unlimited_package_purchase_recharge_book_and_refund_credit(client, world, db):
    unl = _unlimited(db, world["tp"])
    complete_trial(client, world)
    r = _notify(client, world["s_user"], type="package", package_id=unl.id, payment_method="bank_transfer",
                credits_requested=3)
    assert r.status_code == 200, r.text
    assert db.get(Payment, r.json()["payment_id"]).amount_total == 60.0
    assert approve(client, world, r.json()["payment_id"]).status_code == 200
    eid = db.get(Payment, r.json()["payment_id"]).enrollment_id
    db.expire_all()
    assert db.get(Enrollment, eid).prepaid_unlimited_credits == 3
    cid = book(client, world, future(72), enrollment_id=eid).json()["class_id"]
    db.expire_all()
    assert db.get(Enrollment, eid).prepaid_unlimited_credits == 2
    assert client.delete(f"{API}/classes/{cid}", headers=hdr(world["s_user"])).status_code == 200
    db.expire_all()
    assert db.get(Enrollment, eid).prepaid_unlimited_credits == 3
    # recarga
    r = _notify(client, world["s_user"], type="unlimited_recharge", enrollment_id=eid,
                credits_requested=2, payment_method="bank_transfer")
    assert r.status_code == 200
    assert approve(client, world, r.json()["payment_id"]).status_code == 200
    db.expire_all()
    assert db.get(Enrollment, eid).prepaid_unlimited_credits == 5


def test_unlimited_requires_positive_credits(client, world, db):
    unl = _unlimited(db, world["tp"])
    complete_trial(client, world)
    for c in (None, 0, -3):
        r = _notify(client, world["s_user"], type="package", package_id=unl.id,
                    payment_method="bank_transfer", credits_requested=c)
        assert r.status_code == 400, (c, r.status_code)


def test_unlimited_recharge_negative_or_zero_rejected(client, world, db):
    unl = _unlimited(db, world["tp"])
    complete_trial(client, world)
    r = _notify(client, world["s_user"], type="package", package_id=unl.id, payment_method="bank_transfer", credits_requested=1)
    approve(client, world, r.json()["payment_id"])
    eid = db.get(Payment, r.json()["payment_id"]).enrollment_id
    for c in (0, -5):
        r = _notify(client, world["s_user"], type="unlimited_recharge", enrollment_id=eid,
                    credits_requested=c, payment_method="bank_transfer")
        assert r.status_code == 400, (c, r.status_code)


def test_unlimited_without_credits_cannot_book(client, world, db):
    unl = _unlimited(db, world["tp"])
    complete_trial(client, world)
    r = _notify(client, world["s_user"], type="package", package_id=unl.id, payment_method="bank_transfer", credits_requested=1)
    approve(client, world, r.json()["payment_id"])
    eid = db.get(Payment, r.json()["payment_id"]).enrollment_id
    assert book(client, world, future(72), enrollment_id=eid).status_code == 201
    assert book(client, world, future(96), enrollment_id=eid).status_code == 400


def test_installments_unlock_credits_progressively(client, world, db):
    pkg = world["pkg"]
    pkg.allow_installments, pkg.installment_count, pkg.installment_amount = True, 2, 50.0
    db.commit()
    complete_trial(client, world)
    r = _notify(client, world["s_user"], type="package", package_id=pkg.id, payment_method="bank_transfer", installment_index=1)
    assert r.status_code == 200, r.text
    pid1 = r.json()["payment_id"]
    approve(client, world, pid1)
    eid = db.get(Payment, pid1).enrollment_id
    db.expire_all()
    e = db.get(Enrollment, eid)
    assert (e.unlocked_credits, e.payment_status) == (2, "partially_paid")
    # no se puede saltar a la cuota 2 si ya hay otra pendiente / orden correcto
    assert _notify(client, world["s_user"], type="package", enrollment_id=eid, payment_method="bank_transfer",
                   installment_index=1).status_code == 400
    assert book(client, world, future(72), enrollment_id=eid).status_code == 201
    assert book(client, world, future(96), enrollment_id=eid).status_code == 201
    assert book(client, world, future(120), enrollment_id=eid).status_code == 400  # cuota 2 sin pagar
    # AUD-22: la guarda anti doble-clic (15 s) compara monto/tipo sin mirar el estado: una cuota 2 de
    # igual monto notificada <15 s después de aprobar la 1 se confunde con la anterior. Se envejece el pago.
    db.query(Payment).update({Payment.created_at: utc_now() - timedelta(minutes=5)}); db.commit()
    r2 = _notify(client, world["s_user"], type="package", enrollment_id=eid, payment_method="bank_transfer", installment_index=2)
    assert r2.status_code == 200, r2.text
    approve(client, world, r2.json()["payment_id"])
    db.expire_all()
    e = db.get(Enrollment, eid)
    assert (e.unlocked_credits, e.payment_status) == (4, "paid")
    assert db.get(TeacherWallet, 1).total_earned == 85.0


def test_installments_rejected_when_package_does_not_allow(client, world, db):
    complete_trial(client, world)
    r = _notify(client, world["s_user"], type="package", package_id=world["pkg"].id,
                payment_method="bank_transfer", installment_index=1)
    assert r.status_code == 400


def test_duplicate_notify_within_window_is_idempotent(client, world, db):
    ready_student(client, world)
    # segunda notificación idéntica ya no es posible: el paquete está pagado
    r = _notify(client, world["s_user"], type="package", package_id=world["pkg"].id, payment_method="bank_transfer")
    assert r.status_code == 400


def test_double_click_notify_creates_single_payment(client, world, db):
    complete_trial(client, world)
    a = _notify(client, world["s_user"], type="package", package_id=world["pkg"].id, payment_method="bank_transfer")
    b = _notify(client, world["s_user"], type="package", package_id=world["pkg"].id, payment_method="bank_transfer")
    assert a.status_code == 200
    assert b.status_code in (200, 400)
    assert db.query(Payment).count() == 1


def test_cannot_buy_package_before_completing_trial(client, world, db):
    r = _notify(client, world["s_user"], type="package", package_id=world["pkg"].id, payment_method="bank_transfer")
    assert r.status_code == 400


def test_cannot_buy_inactive_or_foreign_package(client, world, db):
    complete_trial(client, world)
    world["pkg"].is_active = False
    db.commit()
    r = _notify(client, world["s_user"], type="package", package_id=world["pkg"].id, payment_method="bank_transfer")
    assert r.status_code == 404
    assert _notify(client, world["s_user"], type="package", package_id=99999, payment_method="bank_transfer").status_code == 404


def test_other_student_cannot_pay_for_my_enrollment(client, world, db):
    eid, _ = ready_student(client, world)
    s2 = _mk_user(db, "student", "alumno2")
    db.add(StudentProfile(user_id=s2.id, user_username="alumno2", timezone="UTC")); db.commit()
    r = _notify(client, s2, type="renewal", enrollment_id=eid, package_id=world["pkg"].id, payment_method="bank_transfer")
    assert r.status_code == 404
    assert book(client, world, future(72), enrollment_id=eid, user=s2).status_code == 404


def test_upgrade_package_change_charges_only_difference(client, world, db):
    big = Package(teacher_id=world["tp"].id, name="P8", subject="English", classes_count=8, price=200.0,
                  price_per_class=25.0, duration_minutes=50, is_active=True)
    db.add(big); db.commit()
    eid, _ = ready_student(client, world)
    r = _notify(client, world["s_user"], type="package_change", enrollment_id=eid, package_id=big.id,
                payment_method="bank_transfer")
    assert r.status_code == 200, r.text
    p = db.get(Payment, r.json()["payment_id"])
    assert p.amount_total == 100.0  # 4 créditos faltantes x 25
    approve(client, world, p.id)
    db.expire_all()
    e = db.get(Enrollment, eid)
    assert e.package_id == big.id and e.unlocked_credits == 8 and e.status.value == "active"


def test_change_to_same_package_rejected(client, world, db):
    eid, _ = ready_student(client, world)
    r = _notify(client, world["s_user"], type="package_change", enrollment_id=eid, package_id=world["pkg"].id,
                payment_method="bank_transfer")
    assert r.status_code == 400


def test_refund_request_requires_contact_info(client, world, db):
    small = Package(teacher_id=world["tp"].id, name="P2", subject="English", classes_count=2, price=50.0,
                    price_per_class=25.0, duration_minutes=50, is_active=True)
    db.add(small); db.commit()
    eid, _ = ready_student(client, world)
    r = _notify(client, world["s_user"], type="package_change", enrollment_id=eid, package_id=small.id,
                change_option="full_refund")
    assert r.status_code == 400
    r = _notify(client, world["s_user"], type="package_change", enrollment_id=eid, package_id=small.id,
                change_option="full_refund", payment_info={"other_notes": "  "})
    assert r.status_code == 422


def test_rejected_payment_lets_student_retry(client, world, db):
    complete_trial(client, world)
    r = _notify(client, world["s_user"], type="package", package_id=world["pkg"].id, payment_method="bank_transfer")
    client.patch(f"{API}/payments/{r.json()['payment_id']}/validate",
                 json={"action": "reject", "rejection_reason": "sin comprobante"}, headers=hdr(world["admin"]))
    st = client.get(f"{API}/payments/booking-status?teacher_username=profe", headers=hdr(world["s_user"])).json()
    assert st["stage"] == "needs_package"
    assert st["last_rejected_payment"]["rejection_reason"] == "sin comprobante"
    r2 = _notify(client, world["s_user"], type="package", package_id=world["pkg"].id, payment_method="bank_transfer")
    assert r2.status_code == 200
    assert approve(client, world, r2.json()["payment_id"]).status_code == 200


# ─── Profesores / aprobación / baneo ────────────────────────────────────────

def test_unapproved_teacher_cannot_receive_bookings(client, world, db):
    world["tp"].status = TeacherStatus.pending
    db.commit()
    r = book(client, world, future(24))
    assert r.status_code == 400


def test_suspended_teacher_freezes_existing_enrollment(client, world, db):
    eid, _ = ready_student(client, world)
    world["tp"].status = TeacherStatus.suspended
    db.commit()
    r = book(client, world, future(72), enrollment_id=eid)
    assert r.status_code == 400 and "congelados" in r.json()["detail"]


def test_banned_user_cannot_use_existing_token(client, world, db):
    h = hdr(world["s_user"])
    world["s_user"].is_active = False
    world["s_user"].is_banned = True
    db.commit()
    assert client.get(f"{API}/users/me", headers=h).status_code == 403
    assert client.post(f"{API}/auth/login", json={"login": "alumno", "password": "Password123"}).status_code == 403


def test_withdrawal_exact_balance_and_float_dust(client, world, db):
    ready_student(client, world)
    th = hdr(world["t_user"])
    assert client.post(f"{API}/payments/request-withdrawal", json={"amount": 85.01, "payment_info": "x"}, headers=th).status_code == 400
    assert client.post(f"{API}/payments/request-withdrawal", json={"amount": 85.0, "payment_info": "x"}, headers=th).status_code == 201
    assert db.get(TeacherWallet, 1).available_balance == 0.0


def test_withdrawal_negative_and_zero_rejected(client, world, db):
    ready_student(client, world)
    for a in (0, -10):
        assert client.post(f"{API}/payments/request-withdrawal", json={"amount": a, "payment_info": "x"},
                           headers=hdr(world["t_user"])).status_code == 422


def test_process_withdrawal_twice_is_rejected(client, world, db):
    ready_student(client, world)
    wid = client.post(f"{API}/payments/request-withdrawal", json={"amount": 20, "payment_info": "x"},
                      headers=hdr(world["t_user"])).json()["id"]
    body = {"action": "complete", "reference": "R"}
    assert client.post(f"{API}/payments/admin/withdrawals/{wid}/process", json=body, headers=hdr(world["admin"])).status_code == 200
    assert client.post(f"{API}/payments/admin/withdrawals/{wid}/process", json=body, headers=hdr(world["admin"])).status_code == 404
    assert db.get(TeacherWallet, 1).total_withdrawn == 20.0


def test_commission_changed_after_purchase_does_not_alter_past_payment(client, world, db):
    _, pid = ready_student(client, world)
    client.patch(f"{API}/admin/teachers/{world['tp'].id}/commission", json={"commission_rate": 0.5},
                 headers=hdr(world["admin"]))
    db.expire_all()
    p = db.get(Payment, pid)
    assert (p.amount_teacher, p.amount_platform) == (85.0, 15.0)
