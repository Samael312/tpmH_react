"""NEG-01 / SEC-03: quién aprueba pagos y quién fija comisiones."""
from tests.audit.conftest import hdr, _mk_user
from tests.audit.helpers import API, approve, complete_trial
from app.models.payment import Payment, TeacherWallet
from app.models.teacher import TeacherProfile, TeacherStatus


def _notify_package(client, world):
    complete_trial(client, world)
    r = client.post(f"{API}/payments/notify-payment", json={
        "type": "package", "package_id": world["pkg"].id, "payment_method": "bank_transfer"},
        headers=hdr(world["s_user"]))
    assert r.status_code == 200, r.text
    return r.json()["payment_id"]


def _teacher_admin(db, name="tadmin"):
    u = _mk_user(db, "teacher_admin", name)
    tp = TeacherProfile(user_id=u.id, user_username=u.username, status=TeacherStatus.approved,
                        timezone="UTC", languages=["English"], subjects=["English"], video_url="v")
    db.add(tp); db.commit()
    return u, tp


def test_regular_teacher_cannot_approve_or_reject_even_own_students_payment(client, world, db):
    pid = _notify_package(client, world)
    t = hdr(world["t_user"])
    assert client.patch(f"{API}/payments/{pid}/validate", json={"action": "approve"}, headers=t).status_code == 403
    assert client.patch(f"{API}/payments/{pid}/validate",
                        json={"action": "reject", "rejection_reason": "x"}, headers=t).status_code == 403
    db.expire_all()
    assert db.get(Payment, pid).status == "pending_review"
    assert db.query(TeacherWallet).count() == 0  # no se acreditó nada


def test_regular_teacher_still_sees_payment_as_pending_review(client, world, db):
    pid = _notify_package(client, world)
    r = client.get(f"{API}/payments/pending-review", headers=hdr(world["t_user"]))
    assert r.status_code == 200
    assert pid in [p["payment_id"] for p in r.json()]


def test_superadmin_approves(client, world, db):
    pid = _notify_package(client, world)
    assert approve(client, world, pid).status_code == 200


def test_teacher_admin_approves_other_teachers_payment(client, world, db):
    pid = _notify_package(client, world)
    u, _ = _teacher_admin(db)
    r = client.patch(f"{API}/payments/{pid}/validate", json={"action": "approve"}, headers=hdr(u))
    assert r.status_code == 200, r.text


def test_teacher_admin_cannot_approve_or_reject_payment_of_own_classes(client, world, db):
    u, tp = _teacher_admin(db)
    pay = Payment(student_id=world["sp"].id, teacher_id=tp.id, amount_total=100.0, amount_teacher=0,
                  amount_platform=0, payment_method="bank_transfer", status="pending_review",
                  payment_type="unlimited_recharge", installment_index=1)
    db.add(pay); db.commit()
    h = hdr(u)
    assert client.patch(f"{API}/payments/{pay.id}/validate", json={"action": "approve"}, headers=h).status_code == 403
    assert client.patch(f"{API}/payments/{pay.id}/validate",
                        json={"action": "reject", "rejection_reason": "x"}, headers=h).status_code == 403
    db.expire_all()
    assert db.get(Payment, pay.id).status == "pending_review"
    assert approve(client, world, pay.id).status_code == 200  # el superadmin sí


def test_teacher_admin_cannot_change_own_commission_but_can_change_others(client, world, db):
    u, tp = _teacher_admin(db)
    own = client.patch(f"{API}/admin/teachers/{tp.id}/commission", json={"commission_rate": 0.0}, headers=hdr(u))
    assert own.status_code == 403
    other = client.patch(f"{API}/admin/teachers/{world['tp'].id}/commission", json={"commission_rate": 0.2}, headers=hdr(u))
    assert other.status_code == 200, other.text
    sup = client.patch(f"{API}/admin/teachers/{tp.id}/commission", json={"commission_rate": 0.1}, headers=hdr(world["admin"]))
    assert sup.status_code == 200, sup.text


def test_commission_update_handles_null_previous_rate(client, world, db):
    world["tp"].commission_rate = None
    db.commit()
    r = client.patch(f"{API}/admin/teachers/{world['tp'].id}/commission", json={"commission_rate": 0.3},
                     headers=hdr(world["admin"]))
    assert r.status_code == 200, r.text
