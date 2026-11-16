"""Cálculos de dinero: comisión, cuotas, créditos y cambio de paquete (Fase 1).

Los tests verifican invariantes (la suma cuadra, nada negativo, no se regalan
créditos) y casos límite concretos con números a mano.
"""
import itertools

import pytest

from tests.audit.conftest import hdr
from tests.audit.helpers import API, approve, ready_student
from app.api.v1.endpoints.payments import (
    _apply_commission, _installment_amount, _installment_credit_amount,
)
from app.models.package import Enrollment, Package
from app.models.payment import Payment, TeacherWallet


class _T:  # profesor mínimo para _apply_commission
    def __init__(self, rate):
        self.commission_rate = rate


def _notify(client, user, **body):
    return client.post(f"{API}/payments/notify-payment", json=body, headers=hdr(user))


def _pkg(db, world, count, price, per_class=None, **kw):
    p = Package(teacher_id=world["tp"].id, name=f"P{count}-{price}", subject="English",
                classes_count=count, price=price,
                price_per_class=per_class if per_class is not None else round(price / count, 2),
                duration_minutes=50, is_active=True, **kw)
    db.add(p); db.commit()
    return p


# ─── Comisión ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("total", [0.01, 0.03, 0.07, 1.0, 9.99, 10.05, 33.33, 99.99, 100.0, 1234.56])
@pytest.mark.parametrize("rate", [0.0, 0.05, 0.15, 0.333, 0.5, 1.0])
def test_commission_split_always_sums_to_total(total, rate):
    teacher, platform = _apply_commission(total, _T(rate))
    assert round(teacher + platform, 2) == round(total, 2)
    assert teacher >= 0 and platform >= 0


def test_commission_known_values():
    assert _apply_commission(100.0, _T(0.15)) == (85.0, 15.0)
    assert _apply_commission(33.33, _T(0.15)) == (28.33, 5.0)
    assert _apply_commission(10.05, _T(0.15)) == (8.54, 1.51)
    assert _apply_commission(0.01, _T(0.15)) == (0.01, 0.0)  # céntimo: no se cobra comisión


def test_commission_per_installment_does_not_drift_from_total(client, world, db):
    """Comisión por cuota: la suma de lo acreditado al profesor no se aleja del cálculo sobre el total."""
    pkg = _pkg(db, world, 3, 100.0, 33.33)
    pkg.allow_installments, pkg.installment_count, pkg.installment_amount = True, 3, 33.33
    db.commit()
    from tests.audit.helpers import complete_trial
    complete_trial(client, world)
    from tests.audit.helpers import buy_package  # noqa: F401
    paid = 0.0
    eid = None
    for i in (1, 2, 3):
        body = dict(type="package", payment_method="bank_transfer", installment_index=i)
        body.update({"enrollment_id": eid} if eid else {"package_id": pkg.id})
        r = _notify(client, world["s_user"], **body)
        assert r.status_code == 200, (i, r.text)
        pid = r.json()["payment_id"]
        p = db.get(Payment, pid)
        eid = p.enrollment_id
        paid += p.amount_total
        assert approve(client, world, pid).status_code == 200
        from app.core.timezone import utc_now
        from datetime import timedelta
        db.query(Payment).update({Payment.created_at: utc_now() - timedelta(minutes=5)}); db.commit()
    assert round(paid, 2) == 100.0
    db.expire_all()
    wallet = db.query(TeacherWallet).first()
    assert abs(wallet.total_earned - 85.0) <= 0.03


# ─── Cuotas ─────────────────────────────────────────────────────────────────

def test_installment_credits_never_exceed_package():
    """La suma de créditos liberados por todas las cuotas == classes_count; ningún acumulado lo supera."""
    bad = []
    for classes, n in itertools.product(range(1, 31), range(2, 13)):
        acc = 0
        for i in range(1, n + 1):
            got = _installment_credit_amount(classes, n, i)
            acc += got
            if got < 0 or acc > classes:
                bad.append((classes, n, i, acc))
                break
        else:
            if acc != classes:
                bad.append((classes, n, "total", acc))
    assert not bad, f"{len(bad)} combinaciones (clases, cuotas, cuota, acumulado) regalan créditos: {bad[:8]}"


@pytest.mark.parametrize("price,n,amount", [
    (100.0, 3, None), (100.0, 3, 33.33), (99.99, 3, None), (100.0, 7, None), (0.05, 2, None),
    (100.0, 3, 40.0),   # el profesor fija una cuota que no divide exacto el total
])
def test_installment_amounts_sum_to_price_and_are_positive(price, n, amount):
    pkg = Package(classes_count=4, price=price, installment_count=n, installment_amount=amount,
                  allow_installments=True)
    amounts = [_installment_amount(pkg, i) for i in range(1, n + 1)]
    assert all(a > 0 for a in amounts), amounts
    assert round(sum(amounts), 2) == round(price, 2), amounts


def test_installment_amount_too_big_is_rejected_when_creating_package(client, world, db):
    """installment_amount × (n-1) >= price dejaría la última cuota negativa o cero."""
    body = dict(name="X", subject="English", classes_count=4, price=100.0, price_per_class=25.0,
                duration_minutes=50, allow_installments=True, installment_count=3, installment_amount=60.0)
    r = client.post(f"{API}/packages/", json=body, headers=hdr(world["t_user"]))
    assert r.status_code == 422, r.text


# ─── Paquetes ilimitados ────────────────────────────────────────────────────

def test_unlimited_amount_is_price_times_credits_rounded(client, world, db):
    from tests.audit.helpers import complete_trial
    unl = Package(teacher_id=world["tp"].id, name="U", subject="English", classes_count=None,
                  price=3.333, duration_minutes=50, is_active=True)
    db.add(unl); db.commit()
    complete_trial(client, world)
    r = _notify(client, world["s_user"], type="package", package_id=unl.id,
                payment_method="bank_transfer", credits_requested=3)
    assert r.status_code == 200, r.text
    assert db.get(Payment, r.json()["payment_id"]).amount_total == 10.0  # round(9.999, 2)


# ─── Cambio de paquete: cálculo de la diferencia ────────────────────────────

def test_upgrade_with_zero_used_charges_new_price_per_class_for_missing(client, world, db):
    """P4 ($25/clase) -> P6 ($20/clase = 120): faltan 2 créditos, se cobran 2 × 20 = 40."""
    p6 = _pkg(db, world, 6, 120.0, 20.0)
    eid, _ = ready_student(client, world)
    r = _notify(client, world["s_user"], type="package_change", enrollment_id=eid,
                package_id=p6.id, payment_method="bank_transfer")
    assert r.status_code == 200, r.text
    assert db.get(Payment, r.json()["payment_id"]).amount_total == 40.0


def test_same_class_count_but_pricier_package_is_not_free(client, world, db):
    """P4 ($100) -> P4 premium ($160): mismo nº de clases, distinto precio. Debe cobrar la diferencia ($60)."""
    premium = _pkg(db, world, 4, 160.0, 40.0)
    eid, _ = ready_student(client, world)
    r = _notify(client, world["s_user"], type="package_change", enrollment_id=eid,
                package_id=premium.id, payment_method="bank_transfer")
    assert r.status_code == 200, r.text
    assert "payment_id" in r.json(), r.json()  # hoy: cambio instantáneo sin cobro
    assert db.get(Payment, r.json()["payment_id"]).amount_total == 60.0


def test_upgrade_after_using_classes_charges_for_credits_actually_gained(client, world, db):
    """P4 ($25), usa 2 clases (quedan 2). Cambia a P8 ($25 c/u = 200).
    Termina con 8 créditos disponibles => solo debe pagar los 6 que no tenía: 6 × 25 = 150.
    Y los créditos disponibles tras aprobar deben ser 8 (no 6)."""
    from tests.audit.helpers import book, set_status
    from tests.audit.conftest import future
    p8 = _pkg(db, world, 8, 200.0, 25.0)
    eid, _ = ready_student(client, world)
    for h in (72, 96):
        cid = book(client, world, future(h), enrollment_id=eid).json()["class_id"]
        set_status(client, world, cid, "confirmed")
    r = _notify(client, world["s_user"], type="package_change", enrollment_id=eid,
                package_id=p8.id, payment_method="bank_transfer")
    assert r.status_code == 200, r.text
    p = db.get(Payment, r.json()["payment_id"])
    amount = p.amount_total
    approve(client, world, p.id)
    db.expire_all()
    e = db.get(Enrollment, eid)
    from app.api.v1.endpoints.payments import _get_enrollment_available_credits
    available_after = _get_enrollment_available_credits(e, db)
    gained = available_after - 2  # tenía 2 disponibles
    assert amount == gained * 25.0, f"pagó {amount} por {gained} créditos nuevos (disponibles ahora: {available_after})"


def test_downgrade_with_used_classes_does_not_lose_credits(client, world, db):
    """P4 ($25), usa 1 (quedan 3 = $75 de valor). Baja a P3 ($30 c/u = 90).
    El alumno aporta $75 de valor restante + paga $15 => debe quedar con 3 créditos disponibles."""
    from tests.audit.helpers import book, set_status
    from tests.audit.conftest import future
    p3 = _pkg(db, world, 3, 90.0, 30.0)
    eid, _ = ready_student(client, world)
    cid = book(client, world, future(72), enrollment_id=eid).json()["class_id"]
    set_status(client, world, cid, "confirmed")
    r = _notify(client, world["s_user"], type="package_change", enrollment_id=eid,
                package_id=p3.id, payment_method="bank_transfer")
    assert r.status_code == 200, r.text
    p = db.get(Payment, r.json()["payment_id"])
    assert p.amount_total == 15.0
    approve(client, world, p.id)
    db.expire_all()
    e = db.get(Enrollment, eid)
    from app.api.v1.endpoints.payments import _get_enrollment_available_credits
    assert _get_enrollment_available_credits(e, db) == 3


def test_downgrade_unused_adjust_difference_is_refund_of_difference(client, world, db):
    """P4 ($100) sin usar -> P2 ($50): reembolso de $50 con datos de contacto."""
    p2 = _pkg(db, world, 2, 50.0, 25.0)
    eid, _ = ready_student(client, world)
    r = _notify(client, world["s_user"], type="package_change", enrollment_id=eid, package_id=p2.id,
                change_option="adjust_difference", payment_info={"other_notes": "banco X"})
    assert r.status_code == 200, r.text
    p = db.get(Payment, r.json()["payment_id"])
    assert (p.payment_type, p.amount_total) == ("refund", 50.0)


def test_downgrade_unused_full_refund_amount_is_old_price(client, world, db):
    p2 = _pkg(db, world, 2, 50.0, 25.0)
    eid, _ = ready_student(client, world)
    r = _notify(client, world["s_user"], type="package_change", enrollment_id=eid, package_id=p2.id,
                change_option="full_refund", payment_info={"other_notes": "banco X"})
    assert r.status_code == 200, r.text
    p = db.get(Payment, r.json()["payment_id"])
    assert (p.payment_type, p.amount_total) == ("refund", 100.0)


def test_package_change_to_unlimited_transfers_available_credits_free(client, world, db):
    unl = Package(teacher_id=world["tp"].id, name="U", subject="English", classes_count=None,
                  price=20.0, duration_minutes=50, is_active=True)
    db.add(unl); db.commit()
    eid, _ = ready_student(client, world)
    r = _notify(client, world["s_user"], type="package_change", enrollment_id=eid, package_id=unl.id)
    assert r.status_code == 200, r.text
    db.expire_all()
    e = db.get(Enrollment, eid)
    assert e.prepaid_unlimited_credits == 4 and e.package_id == unl.id


def test_renewal_adds_leftover_credits_to_new_package(client, world, db):
    """Decisión de negocio: los créditos sobrantes se SUMAN a los del paquete nuevo."""
    from tests.audit.helpers import book, set_status
    from tests.audit.conftest import future
    from app.api.v1.endpoints.payments import _get_enrollment_available_credits
    eid, _ = ready_student(client, world)
    cid = book(client, world, future(72), enrollment_id=eid).json()["class_id"]
    set_status(client, world, cid, "confirmed")  # ocupa 1 -> sobran 3
    r = _notify(client, world["s_user"], type="renewal", enrollment_id=eid,
                package_id=world["pkg"].id, payment_method="bank_transfer")
    assert r.status_code == 200, r.text
    assert approve(client, world, r.json()["payment_id"]).status_code == 200
    db.expire_all()
    e = db.get(Enrollment, eid)
    assert _get_enrollment_available_credits(e, db) == 3 + 4
    assert e.status.value == "active"


def test_renewal_without_leftover_gives_exactly_package_credits(client, world, db):
    from app.api.v1.endpoints.payments import _get_enrollment_available_credits
    eid, _ = ready_student(client, world)
    r = _notify(client, world["s_user"], type="renewal", enrollment_id=eid,
                package_id=world["pkg"].id, payment_method="bank_transfer")
    assert approve(client, world, r.json()["payment_id"]).status_code == 200
    db.expire_all()
    # sobraban 4 (sin usar) + 4 del paquete nuevo
    assert _get_enrollment_available_credits(db.get(Enrollment, eid), db) == 8


def test_rejected_upgrade_changes_nothing(client, world, db):
    p6 = _pkg(db, world, 6, 120.0, 20.0)
    eid, _ = ready_student(client, world)
    r = _notify(client, world["s_user"], type="package_change", enrollment_id=eid,
                package_id=p6.id, payment_method="bank_transfer")
    client.patch(f"{API}/payments/{r.json()['payment_id']}/validate",
                 json={"action": "reject", "rejection_reason": "x"}, headers=hdr(world["admin"]))
    db.expire_all()
    e = db.get(Enrollment, eid)
    assert (e.package_id, e.unlocked_credits, e.status.value) == (world["pkg"].id, 4, "active")
    assert db.query(TeacherWallet).first().total_earned == 85.0  # solo la compra inicial


def test_wallet_gets_commission_adjusted_amount_on_upgrade(client, world, db):
    """La billetera del profesor recibe 85 % de la diferencia cobrada, no del paquete completo."""
    p6 = _pkg(db, world, 6, 120.0, 20.0)
    eid, _ = ready_student(client, world)
    before = db.query(TeacherWallet).first().total_earned  # 85.0 de la compra inicial
    r = _notify(client, world["s_user"], type="package_change", enrollment_id=eid,
                package_id=p6.id, payment_method="bank_transfer")
    approve(client, world, r.json()["payment_id"])
    db.expire_all()
    assert round(db.query(TeacherWallet).first().total_earned - before, 2) == 34.0  # 40 × 0.85


# ─── Reembolsos: descuento a la billetera, plazo de 7 días, saldo insuficiente ──

def _setup_refund(client, world, db):
    p2 = _pkg(db, world, 2, 50.0, 25.0)
    eid, _ = ready_student(client, world)
    return p2, eid


def _refund_req(client, w, eid, pkg, option="full_refund"):
    return _notify(client, w["s_user"], type="package_change", enrollment_id=eid, package_id=pkg.id,
                   change_option=option, payment_info={"other_notes": "banco X"})


def test_full_refund_claws_back_only_teacher_share(client, world, db):
    """Pagó 100 -> profesor 85, plataforma 15. Reembolso de 100: se descuentan 85 al profesor."""
    p2, eid = _setup_refund(client, world, db)
    r = _refund_req(client, world, eid, p2)
    assert r.status_code == 200, r.text
    assert approve(client, world, r.json()["payment_id"]).status_code == 200
    db.expire_all()
    w = db.query(TeacherWallet).first()
    assert (w.available_balance, w.total_earned) == (0.0, 0.0)
    p = db.get(Payment, r.json()["payment_id"])
    assert (p.amount_total, p.amount_teacher, p.amount_platform) == (100.0, -85.0, -15.0)


def test_partial_refund_claws_back_proportional_share(client, world, db):
    """Bajar P4($100) -> P2($50) sin usar, ajuste de diferencia: reembolso 50 -> profesor devuelve 42.50."""
    p2, eid = _setup_refund(client, world, db)
    r = _refund_req(client, world, eid, p2, option="adjust_difference")
    assert r.status_code == 200, r.text
    assert approve(client, world, r.json()["payment_id"]).status_code == 200
    db.expire_all()
    assert db.query(TeacherWallet).first().available_balance == 42.5


def test_refund_blocked_when_teacher_already_withdrew(client, world, db):
    p2, eid = _setup_refund(client, world, db)
    w = client.post(f"{API}/payments/request-withdrawal", json={"amount": 85.0, "payment_info": "x"},
                    headers=hdr(world["t_user"]))
    assert w.status_code == 201, w.text
    r = _refund_req(client, world, eid, p2)
    assert r.status_code == 400 and "soporte" in r.text.lower(), r.text
    db.expire_all()
    assert db.get(Enrollment, eid).status.value == "active"  # no quedó atascado en pending_package_change


def test_refund_approval_blocked_if_teacher_withdraws_after_request(client, world, db):
    p2, eid = _setup_refund(client, world, db)
    r = _refund_req(client, world, eid, p2)
    assert r.status_code == 200, r.text
    client.post(f"{API}/payments/request-withdrawal", json={"amount": 85.0, "payment_info": "x"},
                headers=hdr(world["t_user"]))  # el profesor retira ANTES de que el staff apruebe
    a = approve(client, world, r.json()["payment_id"])
    assert a.status_code == 400, a.text
    db.expire_all()
    assert db.get(Payment, r.json()["payment_id"]).status == "pending_review"


def test_refund_window_is_7_days_from_payment_approval(client, world, db):
    from datetime import timedelta
    from app.core.timezone import utc_now
    p2, eid = _setup_refund(client, world, db)
    db.query(Payment).update({Payment.validated_at: utc_now() - timedelta(days=7, hours=1)}); db.commit()
    r = _refund_req(client, world, eid, p2)
    assert r.status_code == 400 and "7" in r.text, r.text
    db.query(Payment).update({Payment.validated_at: utc_now() - timedelta(days=6, hours=23)}); db.commit()
    assert _refund_req(client, world, eid, p2).status_code == 200


def test_commission_zero_refund_claws_back_everything(client, world, db):
    world["tp"].commission_rate = 0.0
    db.commit()
    p2, eid = _setup_refund(client, world, db)
    assert db.query(TeacherWallet).first().available_balance == 100.0
    r = _refund_req(client, world, eid, p2)
    assert approve(client, world, r.json()["payment_id"]).status_code == 200
    db.expire_all()
    assert db.query(TeacherWallet).first().available_balance == 0.0
