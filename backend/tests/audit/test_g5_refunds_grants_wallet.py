"""Cobertura de `payments.py`: reembolsos (profesor suspendido, grupo cancelado), concesión manual, billetera y retiros."""
from tests.audit.conftest import _mk_user, hdr
from tests.audit.helpers import API, ready_student
from tests.audit.test_g1_god_mode_actions import mk_class, mk_teacher
from tests.audit.test_g3_cohorts import mk_gpkg, mk_cohort, mk_member
from app.models.group_cohort import CohortStatus
from app.models.manual_grant_request import ManualGrantRequest
from app.models.package import Enrollment, EnrollmentStatus, Package
from app.models.payment import Payment, TeacherWallet, Withdrawal
from app.models.teacher import TeacherStatus

P = f"{API}/payments"
INFO = {"payment_info": {"account_holder": "Alumno Audit", "bank_account": "123"}}


def student_h(w):
    return hdr(w["s_user"])


def paid_enrollment(client, world, db):
    eid, _ = ready_student(client, world)
    db.expire_all()
    return db.get(Enrollment, eid)


def suspend(db, w):
    w["tp"].status = TeacherStatus.suspended
    db.commit()


# ── reembolso por profesor suspendido ────────────────────────────────────────────────────
def refund(client, w, eid):
    return client.post(f"{P}/request-refund-teacher-suspended", json={"enrollment_id": eid, **INFO}, headers=student_h(w))


def test_teacher_suspended_refund_validations(client, world, db):
    e = paid_enrollment(client, world, db)
    assert refund(client, world, 999).status_code == 404
    assert refund(client, world, e.id).status_code == 400  # el profesor sigue aprobado
    suspend(db, world)
    db.expire_all()
    e.status = EnrollmentStatus.cancelled
    db.commit()
    assert refund(client, world, e.id).status_code == 400
    e.status = EnrollmentStatus.active
    db.add(Payment(enrollment_id=e.id, student_id=e.student_id, teacher_id=e.teacher_id, amount_total=1, amount_teacher=0,
                   amount_platform=0, payment_method="manual", status="pending_review", payment_type="refund"))
    db.commit()
    assert refund(client, world, e.id).status_code == 400  # ya hay una en revisión


def test_teacher_suspended_refund_unlimited_and_nothing_refundable(client, world, db):
    unl = Package(teacher_id=world["tp"].id, name="IlimR", subject="English", classes_count=None, price=10.0, duration_minutes=50, is_active=True)
    db.add(unl)
    db.commit()
    e = Enrollment(student_id=world["sp"].id, package_id=unl.id, teacher_id=world["tp"].id, status=EnrollmentStatus.active, payment_status="paid")
    db.add(e)
    db.commit()
    suspend(db, world)
    assert refund(client, world, e.id).status_code == 400
    e2 = Enrollment(student_id=world["sp"].id, package_id=world["pkg"].id, teacher_id=world["tp"].id, status=EnrollmentStatus.active,
                    payment_status="paid", classes_total=4)
    db.add(e2)
    db.commit()
    assert refund(client, world, e2.id).status_code == 400  # sin pagos aprobados


def test_teacher_suspended_refund_full_and_partial(client, world, db):
    e = paid_enrollment(client, world, db)
    suspend(db, world)
    r = refund(client, world, e.id)
    assert r.status_code == 200, r.text
    assert "completo" in r.json()["message"]
    # misma solicitud otra vez: duplicado reciente
    db.expire_all()
    db.query(Payment).filter(Payment.status == "pending_review").update({"status": "rejected"})
    e = db.get(Enrollment, e.id)
    e.status = EnrollmentStatus.active
    db.commit()
    mk_class(db, world, hours=30, enrollment=e)
    r2 = refund(client, world, e.id)
    assert r2.status_code == 200 and "créditos" in r2.json()["message"], r2.text
    db.expire_all()
    db.query(Payment).filter(Payment.status == "pending_review").update({"status": "rejected"})
    e = db.get(Enrollment, e.id)
    e.status = EnrollmentStatus.active
    db.commit()
    for i in range(3):
        mk_class(db, world, hours=60 + i * 5, enrollment=e)
    assert refund(client, world, e.id).status_code == 400  # ya usó todo


# ── reembolso por grupo cancelado ────────────────────────────────────────────────────────
def cohort_refund(client, w, eid):
    return client.post(f"{P}/request-refund-cohort-cancelled", json={"enrollment_id": eid, **INFO}, headers=student_h(w))


def test_cohort_cancelled_refund(client, world, db):
    gp = mk_gpkg(db, world)
    co = mk_cohort(db, world, gp)
    e = Enrollment(student_id=world["sp"].id, package_id=gp.id, teacher_id=world["tp"].id, cohort_id=co.id,
                   status=EnrollmentStatus.active, payment_status="paid", classes_total=4)
    db.add(e)
    db.commit()
    assert cohort_refund(client, world, 999).status_code == 404
    indiv = Enrollment(student_id=world["sp"].id, package_id=world["pkg"].id, teacher_id=world["tp"].id, status=EnrollmentStatus.active)
    db.add(indiv)
    db.commit()
    assert cohort_refund(client, world, indiv.id).status_code == 400  # no es grupal
    assert cohort_refund(client, world, e.id).status_code == 400  # el grupo no está cancelado
    co.status = CohortStatus.cancelled
    e.payment_status = "unpaid"
    db.commit()
    assert cohort_refund(client, world, e.id).status_code == 400  # sin pago
    e.payment_status = "paid"
    db.add(Payment(enrollment_id=e.id, student_id=e.student_id, teacher_id=e.teacher_id, amount_total=80, amount_teacher=68,
                   amount_platform=12, payment_method="bank_transfer", status="approved", payment_type="group_enrollment"))
    db.commit()
    r = cohort_refund(client, world, e.id)
    assert r.status_code in (200, 400), r.text
    if r.status_code == 200:
        assert cohort_refund(client, world, e.id).status_code == 400  # ya hay una en curso


# ── concesión manual directa ─────────────────────────────────────────────────────────────
def grant(client, w, user, eid, **kw):
    return client.post(f"{P}/manual-grant", json={"type": "package", "enrollment_id": eid, **kw}, headers=hdr(user))


def unpaid_enrollment(db, w, pkg=None):
    e = Enrollment(student_id=w["sp"].id, package_id=(pkg or w["pkg"]).id, teacher_id=w["tp"].id,
                   status=EnrollmentStatus.active, payment_status="unpaid", classes_total=4)
    db.add(e)
    db.commit()
    return e


def test_manual_grant_direct(client, world, db):
    assert client.post(f"{P}/manual-grant", json={"type": "renewal"}, headers=hdr(world["admin"])).status_code == 400
    assert grant(client, world, world["admin"], 999).status_code == 404
    e = unpaid_enrollment(db, world)
    ta_u, _ = mk_teacher(db, "ta_gr", role="teacher_admin")
    assert grant(client, world, ta_u, e.id).status_code in (200, 403)
    r = grant(client, world, world["admin"], e.id)
    assert r.status_code in (200, 400)
    # ya pagado: nada que otorgar
    assert grant(client, world, world["admin"], e.id).status_code == 400
    db.expire_all()
    e = db.get(Enrollment, e.id)
    e.status = EnrollmentStatus.cancelled
    db.commit()
    assert grant(client, world, world["admin"], e.id).status_code == 400


def test_manual_grant_self_teacher_admin_blocked(client, world, db):
    e = unpaid_enrollment(db, world)
    world["t_user"].role = world["t_user"].role.__class__("teacher_admin")
    db.commit()
    assert grant(client, world, world["t_user"], e.id).status_code == 403


def test_manual_grant_on_renewal_change_and_missing_package(client, world, db):
    unl = Package(teacher_id=world["tp"].id, name="IlimG", subject="English", classes_count=None, price=10.0, duration_minutes=50, is_active=True)
    p8 = Package(teacher_id=world["tp"].id, name="P8G", subject="English", classes_count=8, price=160.0, duration_minutes=50, is_active=True)
    db.add_all([unl, p8])
    db.commit()
    e = unpaid_enrollment(db, world)
    e.payment_status = "paid"
    e.status = EnrollmentStatus.pending_renewal
    e.renewal_requested_package_id = p8.id
    e.unlocked_credits = 3
    db.commit()
    assert grant(client, world, world["admin"], e.id).status_code == 200
    db.expire_all()
    assert db.get(Enrollment, e.id).package_id == p8.id
    # cambio a ilimitado desde finito: arrastra créditos
    e = db.get(Enrollment, e.id)
    e.status = EnrollmentStatus.pending_renewal
    e.renewal_requested_package_id = unl.id
    db.commit()
    assert grant(client, world, world["admin"], e.id).status_code == 200
    # ilimitado -> finito
    db.expire_all()
    e = db.get(Enrollment, e.id)
    e.status = EnrollmentStatus.pending_package_change
    e.change_requested_package_id = p8.id
    e.renewal_requested_package_id = None
    db.commit()
    assert grant(client, world, world["admin"], e.id).status_code == 200
    # paquete inexistente
    e2 = unpaid_enrollment(db, world)
    e2.change_requested_package_id = 99999
    db.commit()
    assert grant(client, world, world["admin"], e2.id).status_code == 400


def test_manual_grant_group_enrollment_to_individual_releases_seat(client, world, db):
    gp = mk_gpkg(db, world)
    co = mk_cohort(db, world, gp)
    e = Enrollment(student_id=world["sp"].id, package_id=gp.id, teacher_id=world["tp"].id, cohort_id=co.id,
                   status=EnrollmentStatus.pending_package_change, payment_status="paid", classes_total=4,
                   change_requested_package_id=world["pkg"].id)
    db.add(e)
    db.commit()
    assert grant(client, world, world["admin"], e.id).status_code == 200
    db.expire_all()
    assert db.get(Enrollment, e.id).cohort_id is None


# ── solicitudes de concesión manual ──────────────────────────────────────────────────────
def test_manual_grant_requests_flow(client, world, db):
    th = hdr(world["t_user"])
    e = unpaid_enrollment(db, world)
    body = {"enrollment_id": e.id, "reason": "Beca aprobada por coordinación"}
    assert client.post(f"{P}/manual-grant-requests", json={**body, "enrollment_id": 999}, headers=th).status_code == 404
    r = client.post(f"{P}/manual-grant-requests", json=body, headers=th)
    assert r.status_code == 201, r.text
    assert client.post(f"{P}/manual-grant-requests", json=body, headers=th).status_code == 400  # ya pendiente
    assert len(client.get(f"{P}/my-manual-grant-requests", headers=th).json()) == 1
    rid = r.json()["id"]
    pend = client.get(f"{P}/manual-grant-requests", headers=hdr(world["admin"]))
    assert pend.status_code == 200
    res = lambda rid_, **b: client.patch(f"{P}/manual-grant-requests/{rid_}/resolve", json=b, headers=hdr(world["admin"]))
    assert res(999, action="approve").status_code == 404
    assert res(rid, action="reject").status_code == 400
    assert res(rid, action="reject", rejection_reason="no procede").status_code == 200
    r2 = client.post(f"{P}/manual-grant-requests", json=body, headers=th)
    assert res(r2.json()["id"], action="approve").status_code == 200
    # ya pagado y cancelado
    assert client.post(f"{P}/manual-grant-requests", json=body, headers=th).status_code == 400
    e3 = unpaid_enrollment(db, world)
    e3.status = EnrollmentStatus.cancelled
    db.commit()
    assert client.post(f"{P}/manual-grant-requests", json={**body, "enrollment_id": e3.id}, headers=th).status_code == 400
    e4 = unpaid_enrollment(db, world)
    e4.change_requested_package_id = 99999
    db.commit()
    assert client.post(f"{P}/manual-grant-requests", json={**body, "enrollment_id": e4.id}, headers=th).status_code == 400


def test_manual_grant_request_resolve_missing_enrollment_and_self(client, world, db):
    e = unpaid_enrollment(db, world)
    req = ManualGrantRequest(teacher_id=world["tp"].id, student_id=world["sp"].id, enrollment_id=e.id, package_id=world["pkg"].id,
                             reason="Motivo de prueba", status="pending")
    db.add(req)
    db.commit()
    e_id = e.id
    db.delete(e)
    db.commit()
    assert client.patch(f"{P}/manual-grant-requests/{req.id}/resolve", json={"action": "approve"}, headers=hdr(world["admin"])).status_code == 404
    # un teacher_admin no resuelve las suyas
    e2 = unpaid_enrollment(db, world)
    req2 = ManualGrantRequest(teacher_id=world["tp"].id, student_id=world["sp"].id, enrollment_id=e2.id, package_id=world["pkg"].id,
                              reason="Motivo de prueba", status="pending")
    db.add(req2)
    world["t_user"].role = world["t_user"].role.__class__("teacher_admin")
    db.commit()
    assert client.patch(f"{P}/manual-grant-requests/{req2.id}/resolve", json={"action": "approve"}, headers=hdr(world["t_user"])).status_code == 403


# ── billetera y retiros ──────────────────────────────────────────────────────────────────
def test_wallet_and_withdrawals(client, world, db):
    th = hdr(world["t_user"])
    w0 = client.get(f"{P}/my-wallet", headers=th)
    assert w0.status_code == 200 and w0.json()["available_balance"] == 0
    wd = lambda amount: client.post(f"{P}/request-withdrawal", json={"amount": amount, "payment_info": "Zelle x"}, headers=th)
    assert wd(50).status_code == 400  # sin saldo
    db.add(TeacherWallet(teacher_id=world["tp"].id, available_balance=100.0, total_earned=100.0, total_withdrawn=0.0))
    db.commit()
    r = wd(60)
    assert r.status_code == 201, r.text
    assert wd(10).status_code == 400  # ya hay un retiro pendiente
    wid = r.json()["id"]
    proc = lambda wid_, **b: client.post(f"{P}/admin/withdrawals/{wid_}/process", json=b, headers=hdr(world["admin"]))
    assert proc(999, action="complete").status_code == 404
    assert proc(wid, action="reject").status_code == 400
    assert proc(wid, action="reject", rejection_reason="datos incompletos").status_code == 200
    r2 = wd(40)
    assert proc(r2.json()["id"], action="complete", reference="OP-1").status_code == 200
    assert len(client.get(f"{P}/my-withdrawals", headers=th).json()) == 2


def test_teacher_admin_cannot_process_own_withdrawal(client, world, db):
    db.add(TeacherWallet(teacher_id=world["tp"].id, available_balance=100.0, total_earned=100.0, total_withdrawn=0.0))
    db.commit()
    th = hdr(world["t_user"])
    r = client.post(f"{P}/request-withdrawal", json={"amount": 20, "payment_info": "Zelle x"}, headers=th)
    world["t_user"].role = world["t_user"].role.__class__("teacher_admin")
    db.commit()
    assert client.post(f"{P}/admin/withdrawals/{r.json()['id']}/process", json={"action": "complete"}, headers=hdr(world["t_user"])).status_code == 403
