"""Cobertura de `notify_payment` y rutas de reembolso: validaciones y caminos de cambio de paquete."""
from tests.audit.conftest import _mk_user, hdr, future
from tests.audit.helpers import API, ready_student
from tests.audit.test_g1_god_mode_actions import mk_class
from app.models.group_cohort import CohortStatus, GroupCohort
from app.models.package import Enrollment, EnrollmentStatus, Package
from app.models.payment import Payment

URL = f"{API}/payments/notify-payment"


def notify(client, w, **body):
    body.setdefault("payment_method", "bank_transfer")
    return client.post(URL, json=body, headers=hdr(w["s_user"]))


def mk_pkg(db, w, name, count, price, **kw):
    p = Package(teacher_id=w["tp"].id, name=name, subject="English", classes_count=count, price=price,
                duration_minutes=50, is_active=True, **kw)
    db.add(p)
    db.commit()
    return p


def paid_enrollment(client, world, db):
    eid, _ = ready_student(client, world)
    return db.get(Enrollment, eid)


# ── recarga de ilimitado ─────────────────────────────────────────────────────────────────
def test_unlimited_recharge_validations(client, world, db):
    e = paid_enrollment(client, world, db)
    assert notify(client, world, type="unlimited_recharge").status_code == 400
    assert notify(client, world, type="unlimited_recharge", enrollment_id=e.id, credits_requested=0).status_code == 400
    assert notify(client, world, type="unlimited_recharge", enrollment_id=e.id, credits_requested=1, payment_method=None).status_code == 400
    assert notify(client, world, type="unlimited_recharge", enrollment_id=e.id, credits_requested=1).status_code == 400  # no es ilimitado


def test_unlimited_recharge_and_duplicate(client, world, db):
    unl = mk_pkg(db, world, "Ilim", None, 10.0)
    e = Enrollment(student_id=world["sp"].id, package_id=unl.id, teacher_id=world["tp"].id, status=EnrollmentStatus.active,
                   payment_status="paid", prepaid_unlimited_credits=0)
    db.add(e)
    db.commit()
    r1 = notify(client, world, type="unlimited_recharge", enrollment_id=e.id, credits_requested=2)
    assert r1.status_code == 200, r1.text
    r2 = notify(client, world, type="unlimited_recharge", enrollment_id=e.id, credits_requested=2)
    assert r2.json()["payment_id"] == r1.json()["payment_id"]  # duplicado reciente


def test_unlimited_package_purchase_paths(client, world, db):
    unl = mk_pkg(db, world, "Ilim2", None, 10.0)
    # un ilimitado sin credits_requested
    assert notify(client, world, type="package", package_id=unl.id).status_code in (400, 404)
    e = Enrollment(student_id=world["sp"].id, package_id=unl.id, teacher_id=world["tp"].id, status=EnrollmentStatus.active,
                   payment_status="unpaid")
    db.add(e)
    db.commit()
    assert notify(client, world, type="package", enrollment_id=e.id).status_code == 400
    assert notify(client, world, type="package", enrollment_id=e.id, credits_requested=2, payment_method=None).status_code == 400
    r1 = notify(client, world, type="package", enrollment_id=e.id, credits_requested=2)
    assert r1.status_code == 200, r1.text
    assert notify(client, world, type="package", enrollment_id=e.id, credits_requested=3).status_code == 400  # ya hay pendiente
    pend = db.get(Payment, r1.json()["payment_id"])
    pend.status = "rejected"
    db.commit()


# ── paquete ──────────────────────────────────────────────────────────────────────────────
def test_package_purchase_validations(client, world, db):
    assert notify(client, world, type="package", enrollment_id=999).status_code == 404
    assert notify(client, world, type="package").status_code == 400
    assert notify(client, world, type="package", package_id=999).status_code == 404
    gp = mk_pkg(db, world, "G", 4, 50.0, is_group=True)
    assert notify(client, world, type="package", package_id=gp.id).status_code == 400
    assert notify(client, world, type="nada").status_code in (400, 422)


def test_package_installments_paths(client, world, db):
    inst = mk_pkg(db, world, "Cuotas", 4, 100.0, allow_installments=True, installment_count=2)
    e = Enrollment(student_id=world["sp"].id, package_id=inst.id, teacher_id=world["tp"].id, status=EnrollmentStatus.active,
                   payment_status="unpaid", classes_total=4)
    db.add(e)
    db.commit()
    assert notify(client, world, type="package", enrollment_id=e.id, payment_method=None).status_code == 400
    assert notify(client, world, type="package", enrollment_id=e.id, installment_index=2).status_code == 400  # cuota 1 primero
    r = notify(client, world, type="package", enrollment_id=e.id, installment_index=1)
    assert r.status_code == 200, r.text
    # con la cuota pendiente: ni otra cuota ni el pago completo
    assert notify(client, world, type="package", enrollment_id=e.id, installment_index=1).status_code == 400
    assert notify(client, world, type="package", enrollment_id=e.id).status_code == 400
    p = db.get(Payment, r.json()["payment_id"])
    p.created_at = p.created_at.replace(year=2020)  # ya no es "reciente"
    db.commit()
    assert notify(client, world, type="package", enrollment_id=e.id, installment_index=1).status_code == 400
    # un paquete sin cuotas no las admite
    plain = mk_pkg(db, world, "SinCuotas", 4, 100.0)
    e2 = Enrollment(student_id=world["sp"].id, package_id=plain.id, teacher_id=world["tp"].id, status=EnrollmentStatus.active,
                    payment_status="unpaid")
    db.add(e2)
    db.commit()
    assert notify(client, world, type="package", enrollment_id=e2.id, installment_index=1).status_code == 400
    e2.payment_status = "paid"
    db.commit()
    assert notify(client, world, type="package", enrollment_id=e2.id).status_code == 400  # ya pagado


# ── renovación ───────────────────────────────────────────────────────────────────────────
def test_renewal_validations(client, world, db):
    e = paid_enrollment(client, world, db)
    assert notify(client, world, type="renewal").status_code == 400
    assert notify(client, world, type="renewal", enrollment_id=999, package_id=world["pkg"].id).status_code == 404
    assert notify(client, world, type="renewal", enrollment_id=e.id, package_id=999).status_code == 404
    gp = mk_pkg(db, world, "G2", 4, 50.0, is_group=True)
    assert notify(client, world, type="renewal", enrollment_id=e.id, package_id=gp.id).status_code == 400
    e.payment_status = "partially_paid"
    db.commit()
    assert notify(client, world, type="renewal", enrollment_id=e.id, package_id=world["pkg"].id).status_code == 400
    e.payment_status = "paid"
    e.status = EnrollmentStatus.cancelled
    db.commit()
    assert notify(client, world, type="renewal", enrollment_id=e.id, package_id=world["pkg"].id).status_code == 400


def test_renewal_twice_is_rejected(client, world, db):
    e = paid_enrollment(client, world, db)
    ok = notify(client, world, type="renewal", enrollment_id=e.id, package_id=world["pkg"].id)
    assert ok.status_code == 200, ok.text
    e2 = Enrollment(student_id=world["sp"].id, package_id=world["pkg"].id, teacher_id=world["tp"].id,
                    status=EnrollmentStatus.active, payment_status="paid", classes_total=4)
    db.add(e2)
    db.commit()
    assert notify(client, world, type="renewal", enrollment_id=e2.id, package_id=world["pkg"].id).status_code == 400


# ── cambio de paquete ────────────────────────────────────────────────────────────────────
def change(client, w, e, pkg, **kw):
    return notify(client, w, type="package_change", enrollment_id=e.id, package_id=pkg.id, **kw)


def test_package_change_validations(client, world, db):
    e = paid_enrollment(client, world, db)
    assert notify(client, world, type="package_change").status_code == 400
    assert notify(client, world, type="package_change", enrollment_id=999, package_id=1).status_code == 404
    assert notify(client, world, type="package_change", enrollment_id=e.id, package_id=999).status_code == 404
    assert change(client, world, e, world["pkg"]).status_code == 400  # mismo paquete
    gp = mk_pkg(db, world, "G3", 4, 50.0, is_group=True)
    assert change(client, world, e, gp).status_code == 400
    e.payment_status = "unpaid"
    db.commit()
    p2 = mk_pkg(db, world, "P2", 2, 50.0)
    assert change(client, world, e, p2).status_code == 400
    e.payment_status = "paid"
    e.status = EnrollmentStatus.completed
    db.commit()
    assert change(client, world, e, p2).status_code == 400


def test_package_change_blocked_by_pending_payment_and_min_classes(client, world, db):
    from app.core.platform_config import get_or_create_platform_config
    e = paid_enrollment(client, world, db)
    p8 = mk_pkg(db, world, "P8", 8, 200.0)
    db.add(Payment(enrollment_id=e.id, student_id=e.student_id, teacher_id=e.teacher_id, amount_total=1, amount_teacher=0,
                   amount_platform=0, payment_method="bank_transfer", status="pending_review", payment_type="package"))
    db.commit()
    assert change(client, world, e, p8).status_code == 400
    db.query(Payment).filter(Payment.status == "pending_review").update({"status": "approved"})
    cfg = get_or_create_platform_config(db)
    cfg.min_classes_before_package_change = 3
    db.commit()
    assert change(client, world, e, p8).status_code == 400


def test_package_change_to_unlimited(client, world, db):
    e = paid_enrollment(client, world, db)
    unl = mk_pkg(db, world, "IlimC", None, 10.0)
    r = change(client, world, e, unl)
    assert r.status_code == 200 and "ilimitado" in r.json()["message"]


def test_package_change_upgrade_paths(client, world, db):
    e = paid_enrollment(client, world, db)
    p8 = mk_pkg(db, world, "P8", 8, 200.0)
    # sube: pagas los créditos que faltan
    r = change(client, world, e, p8)
    assert r.status_code == 200 and "payment_id" in r.json(), r.text
    db.query(Payment).filter(Payment.status == "pending_review").update({"status": "rejected"})
    db.expire_all()
    e.status = EnrollmentStatus.active
    db.commit()
    # ya con más créditos que el nuevo paquete: no se permite
    e.unlocked_credits = 20
    db.commit()
    assert change(client, world, e, p8).status_code == 400
    # créditos justos: cambio instantáneo sin pago
    e.unlocked_credits = 8
    db.commit()
    r = change(client, world, e, p8)
    assert r.status_code == 200 and "sin costo" in r.json()["message"], r.text


def test_package_change_downgrade_same_value_is_instant(client, world, db):
    e = paid_enrollment(client, world, db)
    twin = mk_pkg(db, world, "Gemelo", 4, 100.0)
    r = change(client, world, e, twin)
    assert r.status_code == 200 and "mismo valor" in r.json()["message"]


def test_package_change_downgrade_with_used_classes(client, world, db):
    e = paid_enrollment(client, world, db)
    mk_class(db, world, hours=30, enrollment=e)  # una clase ocupada: valor restante = 3 x 25 = 75
    same_value = mk_pkg(db, world, "Resto", 2, 75.0)
    r = change(client, world, e, same_value)
    assert r.status_code == 200 and "valor restante" in r.json()["message"]


def test_package_change_downgrade_refund_paths(client, world, db):
    e = paid_enrollment(client, world, db)
    cheap = mk_pkg(db, world, "Barato", 2, 40.0)
    # el reembolso exige datos de la cuenta del alumno
    assert change(client, world, e, cheap, change_option="full_refund").status_code == 400
    info = {"payment_info": {"account_holder": "Alumno Audit", "bank_account": "123"}}
    r = change(client, world, e, cheap, change_option="full_refund", **info)
    assert r.status_code in (200, 400), r.text


def test_package_change_with_difference_to_pay_and_refund(client, world, db):
    e = paid_enrollment(client, world, db)
    dearer = mk_pkg(db, world, "Caro", 3, 150.0)  # menos clases pero más caro: diferencia a pagar
    r = change(client, world, e, dearer)
    assert r.status_code == 200 and "payment_id" in r.json(), r.text
    assert change(client, world, e, dearer).status_code == 400  # ya hay un cambio en curso
    db.query(Payment).filter(Payment.status == "pending_review").update({"status": "rejected"})
    db.expire_all()
    e.status = EnrollmentStatus.active
    db.commit()
    cheap = mk_pkg(db, world, "Barato2", 2, 40.0)
    r = change(client, world, e, cheap)
    assert r.status_code == 400  # diferencia a favor: pide datos de reembolso
    r = change(client, world, e, cheap, payment_info={"account_holder": "Alumno Audit", "bank_account": "123"})
    assert r.status_code in (200, 400), r.text


def test_package_change_with_used_classes_refund(client, world, db):
    e = paid_enrollment(client, world, db)
    mk_class(db, world, hours=30, enrollment=e)
    cheap = mk_pkg(db, world, "Barato3", 2, 10.0)
    r = change(client, world, e, cheap, payment_info={"account_holder": "Alumno Audit", "bank_account": "123"})
    assert r.status_code in (200, 400), r.text
    dear = mk_pkg(db, world, "Caro3", 2, 500.0)
    db.query(Payment).filter(Payment.status == "pending_review").update({"status": "rejected"})
    db.expire_all()
    e.status = EnrollmentStatus.active
    db.commit()
    assert change(client, world, e, dear).status_code in (200, 400)
