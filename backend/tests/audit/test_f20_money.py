"""Fase 20 - Dinero: NaN/inf, reembolsos con lo pagado, billetera atomica, solicitudes de otorgamiento manual."""
import json

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

from tests.audit.conftest import hdr, _mk_user
from tests.audit.helpers import API, approve, complete_trial, buy_package, ready_student
from app.db.base import SessionLocal
from app.models.package import Enrollment, EnrollmentStatus, Package
from app.models.payment import Payment, TeacherWallet, Withdrawal
from app.models.payment_config import PaymentConfig
from app.models.teacher import TeacherProfile, TeacherStatus
from app.api.v1.endpoints.payments import _credit_wallet


def _raw(client, method, url, body, user):
    """TestClient(json=) no serializa NaN/inf: se manda el JSON a mano (Python lo emite como NaN/Infinity)."""
    h = dict(hdr(user))
    h["Content-Type"] = "application/json"
    return client.request(method, url, content=json.dumps(body), headers=h)


def _wallet(db, tp, balance=50.0):
    w = TeacherWallet(teacher_id=tp.id, available_balance=balance, total_earned=balance, total_withdrawn=0.0)
    db.add(w)
    db.commit()
    return w


def _fresh_wallet(tp_id):
    s = SessionLocal()
    try:
        return s.query(TeacherWallet).filter(TeacherWallet.teacher_id == tp_id).one()
    finally:
        s.close()


# ─── D1: NaN / inf ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
def test_d1_withdrawal_rejects_nan_inf(client, db, world, bad):
    _wallet(db, world["tp"], 50.0)
    r = _raw(client, "POST", f"{API}/payments/request-withdrawal", {"amount": bad, "payment_info": "x"}, world["t_user"])
    assert r.status_code == 422, r.text
    assert _fresh_wallet(world["tp"].id).available_balance == 50.0


def test_d1_commission_and_config_reject_nan_and_out_of_range(client, world):
    for bad in (float("nan"), 2.0, -0.1):
        r = _raw(client, "PATCH", f"{API}/admin/teachers/{world['tp'].id}/commission", {"commission_rate": bad}, world["admin"])
        assert r.status_code in (400, 422), (bad, r.text)
        r = _raw(client, "PATCH", f"{API}/payments/config", {"default_commission_rate": bad}, world["admin"])
        assert r.status_code in (400, 422), (bad, r.text)


def test_d1_package_price_rejects_nan(client, world):
    r = _raw(client, "POST", f"{API}/packages/", {
        "name": "X", "subject": "English", "classes_count": 2, "price": float("nan"),
        "price_per_class": float("nan"), "duration_minutes": 50}, world["t_user"])
    assert r.status_code == 422, r.text


def test_d1_god_mode_amount_rejects_nan(client, db, world):
    ready_student(client, world)
    pid = db.query(Payment).first().id
    r = _raw(client, "PATCH", f"{API}/god-mode/payments/{pid}", {"amount_total": float("inf"), "reason": "prueba nan"},
             world["admin"])
    assert r.status_code == 422, r.text


def test_d1_db_check_blocks_negative_balance(db, world):
    _wallet(db, world["tp"], 5.0)
    w = db.query(TeacherWallet).one()
    w.available_balance = -1.0
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


# ─── D4: billetera atomica y Numeric ─────────────────────────────────────────

def test_d4_credit_wallet_does_not_lose_concurrent_update(db, world):
    w = _wallet(db, world["tp"], 50.0)
    db.refresh(w)  # sesion A tiene la fila cargada (saldo 50)
    s2 = SessionLocal()
    s2.query(TeacherWallet).update({TeacherWallet.available_balance: 60.0, TeacherWallet.total_earned: 60.0})
    s2.commit()
    s2.close()
    _credit_wallet(world["tp"].id, 5.0, db)
    db.commit()
    got = _fresh_wallet(world["tp"].id)
    assert got.available_balance == 65.0 and got.total_earned == 65.0


def test_d4_money_columns_are_numeric():
    for col in (TeacherWallet.available_balance, TeacherWallet.total_earned, TeacherWallet.total_withdrawn,
                Payment.amount_total, Payment.amount_teacher, Payment.amount_platform, Withdrawal.amount,
                Package.price):
        assert isinstance(col.type, sa.Numeric) and not isinstance(col.type, sa.Float), col


def test_d4_withdrawal_and_process_roundtrip_keeps_json_numbers(client, db, world):
    _wallet(db, world["tp"], 50.0)
    r = client.post(f"{API}/payments/request-withdrawal", json={"amount": 20.5, "payment_info": "iban"},
                    headers=hdr(world["t_user"]))
    assert r.status_code == 201, r.text
    assert isinstance(r.json()["amount"], float) and r.json()["amount"] == 20.5
    w = client.get(f"{API}/payments/my-wallet", headers=hdr(world["t_user"])).json()
    assert w["available_balance"] == 29.5
    wid = r.json()["id"]
    r = client.post(f"{API}/payments/admin/withdrawals/{wid}/process",
                    json={"action": "reject", "rejection_reason": "datos mal"}, headers=hdr(world["admin"]))
    assert r.status_code == 200, r.text
    assert _fresh_wallet(world["tp"].id).available_balance == 50.0


# ─── M13: WithdrawalResponse ─────────────────────────────────────────────────

def test_m13_withdrawal_response_exposes_details(client, db, world):
    _wallet(db, world["tp"], 50.0)
    wid = client.post(f"{API}/payments/request-withdrawal", json={"amount": 20, "payment_info": "iban ES00"},
                      headers=hdr(world["t_user"])).json()["id"]
    client.post(f"{API}/payments/admin/withdrawals/{wid}/process",
                json={"action": "complete", "reference": "REF-9"}, headers=hdr(world["admin"]))
    (item,) = client.get(f"{API}/payments/my-withdrawals", headers=hdr(world["t_user"])).json()
    assert item["destination_details"] == "iban ES00"
    assert item["reference"] == "REF-9"
    assert item["processed_at"] is not None
    assert "rejection_reason" in item


# ─── D2 / D3: reembolsos con lo realmente pagado ─────────────────────────────

def _set_price(db, pkg, price):
    db.query(Package).filter(Package.id == pkg.id).update({Package.price: price, Package.price_per_class: price / 4})
    db.commit()


def _suspend_teacher(db, tp):
    db.query(TeacherProfile).filter(TeacherProfile.id == tp.id).update({TeacherProfile.status: TeacherStatus.suspended})
    db.commit()


def _refund_body(eid):
    return {"enrollment_id": eid, "payment_info": {"other_notes": "contactar"}}


def test_d2_suspended_refund_uses_paid_amount_not_current_price(client, db, world):
    eid, _ = ready_student(client, world)       # pago aprobado: $100
    _set_price(db, world["pkg"], 500.0)         # el precio sube despues
    _suspend_teacher(db, world["tp"])
    r = client.post(f"{API}/payments/request-refund-teacher-suspended", json=_refund_body(eid),
                    headers=hdr(world["s_user"]))
    assert r.status_code == 200, r.text
    refund = db.query(Payment).filter(Payment.payment_type == "refund").one()
    assert refund.amount_total == 100.0


def test_d2_full_refund_on_downgrade_uses_paid_amount(client, db, world):
    eid, _ = ready_student(client, world)
    small = Package(teacher_id=world["tp"].id, name="P2", subject="English", classes_count=2, price=40.0,
                    price_per_class=20.0, duration_minutes=50, is_active=True)
    db.add(small)
    db.commit()
    _set_price(db, world["pkg"], 500.0)
    r = client.post(f"{API}/payments/notify-payment", json={
        "type": "package_change", "enrollment_id": eid, "package_id": small.id, "change_option": "full_refund",
        "payment_info": {"other_notes": "x"}}, headers=hdr(world["s_user"]))
    assert r.status_code == 200, r.text
    refund = db.query(Payment).filter(Payment.payment_type == "refund").one()
    assert refund.amount_total == 100.0


def test_d2_refund_total_never_exceeds_paid(client, db, world):
    eid, _ = ready_student(client, world)
    _suspend_teacher(db, world["tp"])
    r = client.post(f"{API}/payments/request-refund-teacher-suspended", json=_refund_body(eid),
                    headers=hdr(world["s_user"]))
    assert r.status_code == 200, r.text
    # un reembolso ya aprobado agota lo reembolsable: ya no se puede pedir otro
    assert approve(client, world, r.json()["payment_id"]).status_code == 200
    db.expire_all()
    db.query(Enrollment).filter(Enrollment.id == eid).update({Enrollment.status: EnrollmentStatus.active})
    db.commit()
    r2 = client.post(f"{API}/payments/request-refund-teacher-suspended", json=_refund_body(eid),
                     headers=hdr(world["s_user"]))
    assert r2.status_code == 400, r2.text


def test_d3_suspended_refund_requires_approved_payment(client, db, world):
    complete_trial(client, world)
    e = Enrollment(student_id=world["sp"].id, package_id=world["pkg"].id, teacher_id=world["tp"].id,
                   status=EnrollmentStatus.active, classes_total=4, unlocked_credits=4, payment_status="paid")
    db.add(e)
    db.commit()
    _suspend_teacher(db, world["tp"])
    _wallet(db, world["tp"], 1000.0)   # saldo de sobra: lo unico que debe frenar es no haber pago aprobado
    r = client.post(f"{API}/payments/request-refund-teacher-suspended", json=_refund_body(e.id),
                    headers=hdr(world["s_user"]))
    assert r.status_code == 400, r.text
    assert db.query(Payment).filter(Payment.payment_type == "refund").count() == 0


def test_d2_update_package_blocked_while_active_enrollment(client, db, world):
    ready_student(client, world)
    body = {"name": "P4", "subject": "English", "classes_count": 4, "price": 200.0, "price_per_class": 50.0,
            "duration_minutes": 50}
    r = client.patch(f"{API}/packages/{world['pkg'].id}", json=body, headers=hdr(world["t_user"]))
    assert r.status_code == 409, r.text
    # campos no sensibles si se pueden cambiar (mismo precio)
    body.update(price=100.0, price_per_class=25.0, name="Nuevo nombre")
    r = client.patch(f"{API}/packages/{world['pkg'].id}", json=body, headers=hdr(world["t_user"]))
    assert r.status_code == 200, r.text


def test_d2_update_package_free_without_enrollments(client, world):
    body = {"name": "P4", "subject": "English", "classes_count": 4, "price": 200.0, "price_per_class": 50.0,
            "duration_minutes": 50}
    r = client.patch(f"{API}/packages/{world['pkg'].id}", json=body, headers=hdr(world["t_user"]))
    assert r.status_code == 200, r.text


# ─── M8 / M9: Modo Dios ──────────────────────────────────────────────────────

def _approved_payment_id(client, db, world):
    ready_student(client, world)
    return db.query(Payment).filter(Payment.payment_type == "package").one().id


def test_m8_god_mode_revert_blocked_when_wallet_would_go_negative(client, db, world):
    pid = _approved_payment_id(client, db, world)
    db.query(TeacherWallet).update({TeacherWallet.available_balance: 10.0})   # el profesor ya retiro casi todo
    db.commit()
    r = client.patch(f"{API}/god-mode/payments/{pid}",
                     json={"status": "rejected", "rejection_reason": "x", "reason": "prueba revert"},
                     headers=hdr(world["admin"]))
    assert r.status_code == 409, r.text
    assert _fresh_wallet(world["tp"].id).available_balance == 10.0
    db.expire_all()
    assert db.get(Payment, pid).status == "approved"


def test_m8_god_mode_amount_decrease_blocked_when_wallet_would_go_negative(client, db, world):
    pid = _approved_payment_id(client, db, world)
    db.query(TeacherWallet).update({TeacherWallet.available_balance: 5.0})
    db.commit()
    r = client.patch(f"{API}/god-mode/payments/{pid}", json={"amount_total": 20.0, "reason": "prueba monto"},
                     headers=hdr(world["admin"]))
    assert r.status_code == 409, r.text


def test_m9_god_mode_edit_uses_frozen_rate(client, db, world):
    pid = _approved_payment_id(client, db, world)             # 100 al 15 % -> 85 / 15
    db.query(TeacherProfile).filter(TeacherProfile.id == world["tp"].id).update({TeacherProfile.commission_rate: 0.5})
    db.commit()
    r = client.patch(f"{API}/god-mode/payments/{pid}", json={"amount_total": 200.0, "reason": "prueba tasa"},
                     headers=hdr(world["admin"]))
    assert r.status_code == 200, r.text
    db.expire_all()
    p = db.get(Payment, pid)
    assert p.amount_teacher == 170.0 and p.amount_platform == 30.0
    assert _fresh_wallet(world["tp"].id).available_balance == 170.0


def test_m9_god_mode_cannot_edit_refund(client, db, world):
    eid, _ = ready_student(client, world)
    _suspend_teacher(db, world["tp"])
    rid = client.post(f"{API}/payments/request-refund-teacher-suspended", json=_refund_body(eid),
                      headers=hdr(world["s_user"])).json()["payment_id"]
    assert approve(client, world, rid).status_code == 200
    r = client.patch(f"{API}/god-mode/payments/{rid}",
                     json={"status": "rejected", "rejection_reason": "x", "reason": "prueba refund"},
                     headers=hdr(world["admin"]))
    assert r.status_code in (400, 409), r.text


# ─── M10 ─────────────────────────────────────────────────────────────────────

def test_m10_total_revenue_excludes_refunds_and_manual_grants(client, db, world):
    sp, tp = world["sp"], world["tp"]
    db.add_all([
        Payment(student_id=sp.id, teacher_id=tp.id, amount_total=100, amount_teacher=85, amount_platform=15,
                payment_method="bank_transfer", payment_type="package", status="approved"),
        Payment(student_id=sp.id, teacher_id=tp.id, amount_total=30, amount_teacher=-25, amount_platform=-5,
                payment_method="manual", payment_type="refund", status="approved"),
        Payment(student_id=sp.id, teacher_id=tp.id, amount_total=50, amount_teacher=0, amount_platform=0,
                payment_method="manual_grant", payment_type="package", status="approved", is_manual_grant=True),
    ])
    db.commit()
    r = client.get(f"{API}/admin/stats", headers=hdr(world["admin"]))
    assert r.status_code == 200, r.text
    assert r.json()["total_revenue"] == 100.0


# ─── S5: /payments/config ────────────────────────────────────────────────────

def test_s5_config_requires_auth_and_hides_commission_from_non_staff(client, db, world):
    assert client.get(f"{API}/payments/config").status_code == 401
    r = client.get(f"{API}/payments/config", headers=hdr(world["s_user"]))
    assert r.status_code == 200, r.text
    assert r.json().get("default_commission_rate") is None
    r = client.get(f"{API}/payments/config", headers=hdr(world["t_user"]))
    assert r.status_code == 200 and r.json().get("default_commission_rate") is None
    r = client.get(f"{API}/payments/config", headers=hdr(world["admin"]))
    assert r.status_code == 200 and r.json()["default_commission_rate"] is not None


def test_s5_get_config_does_not_create_row(client, db, world):
    db.query(PaymentConfig).delete()
    db.commit()
    r = client.get(f"{API}/payments/config", headers=hdr(world["s_user"]))
    assert r.status_code == 200, r.text
    assert db.query(PaymentConfig).count() == 0


# ─── D5: solicitud de otorgamiento manual ────────────────────────────────────

def _enroll_unpaid(db, world, status=EnrollmentStatus.active):
    e = Enrollment(student_id=world["sp"].id, package_id=world["pkg"].id, teacher_id=world["tp"].id,
                   status=status, classes_total=4, unlocked_credits=0, payment_status="unpaid")
    db.add(e)
    db.commit()
    return e


def test_d5_teacher_cannot_grant_directly(client, db, world):
    e = _enroll_unpaid(db, world)
    r = client.post(f"{API}/payments/manual-grant", json={"type": "package", "enrollment_id": e.id},
                    headers=hdr(world["t_user"]))
    assert r.status_code == 403, r.text
    db.expire_all()
    assert db.get(Enrollment, e.id).payment_status == "unpaid"


def _request_grant(client, world, eid, reason="beca acordada con el alumno"):
    return client.post(f"{API}/payments/manual-grant-requests", json={"enrollment_id": eid, "reason": reason},
                       headers=hdr(world["t_user"]))


def test_d5_request_validations(client, db, world):
    e = _enroll_unpaid(db, world)
    assert _request_grant(client, world, e.id).status_code == 201
    assert _request_grant(client, world, e.id).status_code == 400            # duplicado pendiente
    other_t = _mk_user(db, "teacher", "otro")
    tp2 = TeacherProfile(user_id=other_t.id, user_username=other_t.username, status=TeacherStatus.approved,
                         timezone="UTC", languages=["English"], subjects=["English"], video_url="v")
    db.add(tp2)
    db.commit()
    r = client.post(f"{API}/payments/manual-grant-requests", json={"enrollment_id": e.id, "reason": "intruso aqui"},
                    headers=hdr(other_t))
    assert r.status_code in (403, 404)
    c = _enroll_unpaid(db, world, status=EnrollmentStatus.cancelled)
    assert _request_grant(client, world, c.id).status_code == 400
    assert client.post(f"{API}/payments/manual-grant-requests", json={"enrollment_id": e.id, "reason": "ab"},
                       headers=hdr(world["t_user"])).status_code == 422


def test_d5_approve_applies_grant_and_notifies(client, db, world):
    e = _enroll_unpaid(db, world)
    rid = _request_grant(client, world, e.id).json()["id"]
    # student/teacher no resuelven
    for who in ("t_user", "s_user"):
        assert client.patch(f"{API}/payments/manual-grant-requests/{rid}/resolve", json={"action": "approve"},
                            headers=hdr(world[who])).status_code == 403
    pend = client.get(f"{API}/payments/manual-grant-requests?status=pending", headers=hdr(world["admin"])).json()
    assert [p["id"] for p in pend] == [rid]
    r = client.patch(f"{API}/payments/manual-grant-requests/{rid}/resolve", json={"action": "approve"},
                     headers=hdr(world["admin"]))
    assert r.status_code == 200, r.text
    db.expire_all()
    e = db.get(Enrollment, e.id)
    assert e.payment_status == "paid" and e.unlocked_credits == 4 and e.activated_at is not None
    grant = db.query(Payment).filter(Payment.is_manual_grant.is_(True)).one()
    assert grant.amount_total == 0 and db.query(TeacherWallet).count() == 0
    from app.models.god_mode_audit import GodModeAuditLog
    assert db.query(GodModeAuditLog).filter(GodModeAuditLog.action == "manual_grant.approve").count() == 1
    from app.models.notification import Notification
    assert db.query(Notification).filter(Notification.recipient_user_id == world["t_user"].id).count() == 1
    # ya resuelta
    assert client.patch(f"{API}/payments/manual-grant-requests/{rid}/resolve", json={"action": "approve"},
                        headers=hdr(world["admin"])).status_code == 404


def test_d5_reject_requires_reason_and_leaves_enrollment(client, db, world):
    e = _enroll_unpaid(db, world)
    rid = _request_grant(client, world, e.id).json()["id"]
    url = f"{API}/payments/manual-grant-requests/{rid}/resolve"
    assert client.patch(url, json={"action": "reject"}, headers=hdr(world["admin"])).status_code == 400
    assert client.patch(url, json={"action": "reject", "rejection_reason": "no corresponde"},
                        headers=hdr(world["admin"])).status_code == 200
    db.expire_all()
    assert db.get(Enrollment, e.id).payment_status == "unpaid"
    (mine,) = client.get(f"{API}/payments/my-manual-grant-requests", headers=hdr(world["t_user"])).json()
    assert mine["status"] == "rejected" and mine["rejection_reason"] == "no corresponde"


def test_d5_approve_blocked_if_enrollment_cancelled_meanwhile(client, db, world):
    e = _enroll_unpaid(db, world)
    rid = _request_grant(client, world, e.id).json()["id"]
    db.query(Enrollment).filter(Enrollment.id == e.id).update({Enrollment.status: EnrollmentStatus.cancelled})
    db.commit()
    r = client.patch(f"{API}/payments/manual-grant-requests/{rid}/resolve", json={"action": "approve"},
                     headers=hdr(world["admin"]))
    assert r.status_code == 400, r.text
    db.expire_all()
    assert db.get(Enrollment, e.id).status == EnrollmentStatus.cancelled


def test_d5_grant_renewal_keeps_leftover_credits(client, db, world):
    e = _enroll_unpaid(db, world, status=EnrollmentStatus.pending_renewal)
    e.unlocked_credits = 3
    e.payment_status = "paid"
    e.renewal_requested_package_id = world["pkg"].id
    db.commit()
    rid = _request_grant(client, world, e.id).json()["id"]
    assert client.patch(f"{API}/payments/manual-grant-requests/{rid}/resolve", json={"action": "approve"},
                        headers=hdr(world["admin"])).status_code == 200
    db.expire_all()
    e = db.get(Enrollment, e.id)
    # 3 sobrantes (0 ocupadas) + 4 del paquete nuevo
    assert e.unlocked_credits == 7 and e.status == EnrollmentStatus.active


def test_d5_teacher_admin_cannot_approve_own_grant(client, db, world):
    u = _mk_user(db, "teacher_admin", "tadm")
    tp = TeacherProfile(user_id=u.id, user_username=u.username, status=TeacherStatus.approved, timezone="UTC",
                        languages=["English"], subjects=["English"], video_url="v")
    db.add(tp)
    db.flush()
    pkg = Package(teacher_id=tp.id, name="Mine", subject="English", classes_count=4, price=100.0,
                  price_per_class=25.0, duration_minutes=50, is_active=True)
    db.add(pkg)
    db.flush()
    e = Enrollment(student_id=world["sp"].id, package_id=pkg.id, teacher_id=tp.id, status=EnrollmentStatus.active,
                   classes_total=4, unlocked_credits=0, payment_status="unpaid")
    db.add(e)
    db.commit()
    rid = client.post(f"{API}/payments/manual-grant-requests", json={"enrollment_id": e.id, "reason": "mi propio alumno"},
                      headers=hdr(u)).json()["id"]
    url = f"{API}/payments/manual-grant-requests/{rid}/resolve"
    assert client.patch(url, json={"action": "approve"}, headers=hdr(u)).status_code == 403
    assert client.patch(url, json={"action": "approve"}, headers=hdr(world["admin"])).status_code == 200
