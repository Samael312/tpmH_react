"""
Suite: Regresión de los Difíciles D1-D4 (ver backlog_tpmH.md).

Estos 4 tickets salieron de pruebas manuales end-to-end (frontend real).
Al auditar el código antes de tocar nada, D1/D2/D3 resultaron estar YA
resueltos en el backend actual (ver comentarios "Fix:"/"Regla de negocio
3.1" en payments.py) — este archivo deja esa conclusión documentada con
tests concretos en vez de solo la palabra de quien audita. D4 sí tenía un
bug real y sobreviviente, pero por una causa raíz distinta a la descrita
en el ticket original (ver docstring de cada test para el detalle).

- D1: rechazar un pago de renovación no debe dejar el enrollment "activo
  como si se hubiera aprobado" — debe revertir exactamente al paquete/
  créditos que tenía ANTES de pedir la renovación.
- D2: rechazar un pago de cambio de paquete debe notificar por email al
  estudiante, igual que cualquier otro rechazo.
- D3: aprobar un upgrade de paquete debe dejar unlocked_credits en el
  total del paquete NUEVO, no en un cálculo parcial/erróneo.
- D4: causa raíz real — get_student_booking_stage() confundía un
  enrollment que NUNCA se activó (pago inicial rechazado/nunca
  notificado, luego cancelado por limpieza automática) con uno que sí se
  usó y genuinamente expiró, devolviendo "needs_renewal" en vez de
  "needs_package" en cualquier consulta posterior a la primera.
  NOTA: mi fix original filtraba por `activated_at IS NOT NULL`. Al hacer
  `git pull` del trabajo paralelo (Triviales/Fáciles/Medios) apareció un
  fix YA SUBIDO a la misma función (relacionado con M9/F3, reembolsos de
  cohorte cancelada) que resuelve lo mismo de forma más amplia:
  `Enrollment.status != EnrollmentStatus.cancelled` -- CUALQUIER
  enrollment cancelado (no solo los que nunca se activaron) se considera
  "relación reiniciada" y manda a needs_package, nunca a needs_renewal.
  Confirmado con el usuario (decisión de negocio) que ese es el
  comportamiento correcto incluso para un enrollment que sí se usó de
  verdad y luego se canceló (profesor suspendido y reembolsado, cohorte
  cancelada y reembolsada, etc.). Se descartó mi condición más
  específica por quedar subsumida en esta.
"""
from datetime import datetime, timedelta, timezone as tz

import pytest

from app.models.teacher import TeacherProfile
from app.models.student import StudentProfile
from app.models.package import Package, Enrollment, EnrollmentStatus
from app.models.class_ import Class, ClassType
from app.models.payment import Payment
from app.core.class_logic import get_student_booking_stage
import app.api.v1.endpoints.payments as payments_module
from tests.flow.conftest import auth_headers

pytestmark = pytest.mark.integration


# ─── Fixture compartida (mismo patrón que test_package_change.py) ─────────

@pytest.fixture
def diff_env(db, fixed_users, volatile):
    teacher = db.query(TeacherProfile).filter(TeacherProfile.user_id == fixed_users["teacher"].id).first()
    student = db.query(StudentProfile).filter(StudentProfile.user_id == fixed_users["student"].id).first()
    tracked = {
        "teacher_id": teacher.id, "student_id": student.id,
        "package_ids": [], "enrollment_ids": [], "payment_ids": [], "class_ids": [],
    }

    def _cleanup():
        from app.db.base import SessionLocal
        s = SessionLocal()
        try:
            def _run(fn):
                try:
                    fn()
                    s.commit()
                except Exception:
                    s.rollback()

            if tracked["enrollment_ids"]:
                _run(lambda: s.query(Payment).filter(
                    Payment.enrollment_id.in_(tracked["enrollment_ids"])
                ).delete(synchronize_session=False))
                _run(lambda: s.query(Class).filter(
                    Class.enrollment_id.in_(tracked["enrollment_ids"])
                ).delete(synchronize_session=False))
            if tracked["payment_ids"]:
                _run(lambda: s.query(Payment).filter(
                    Payment.id.in_(tracked["payment_ids"])
                ).delete(synchronize_session=False))
            if tracked["class_ids"]:
                _run(lambda: s.query(Class).filter(
                    Class.id.in_(tracked["class_ids"])
                ).delete(synchronize_session=False))
            if tracked["enrollment_ids"]:
                _run(lambda: s.query(Enrollment).filter(
                    Enrollment.id.in_(tracked["enrollment_ids"])
                ).delete(synchronize_session=False))
            if tracked["package_ids"]:
                _run(lambda: s.query(Package).filter(
                    Package.id.in_(tracked["package_ids"])
                ).delete(synchronize_session=False))
        finally:
            s.close()

    volatile.custom(_cleanup, label="limpieza total de test_difficult_bugs_regression")
    return tracked


def _create_package(client, teacher_token, tracked, **overrides):
    payload = {
        "name": "Flow-test D-bugs package", "subject": "English",
        "price": 100.0, "classes_count": 4, "duration_minutes": 50,
    }
    payload.update(overrides)
    r = client.post("/api/v1/packages/", json=payload, headers=auth_headers(teacher_token))
    assert r.status_code == 201, r.text
    tracked["package_ids"].append(r.json()["id"])
    return r.json()


def _make_enrollment(db, tracked, *, package_id, classes_total, unlocked_credits=None,
                      payment_status="paid", status=EnrollmentStatus.active, activated_at="now"):
    """
    Enrollment insertado directo por ORM. `activated_at`:
    - "now"  -> se setea a utcnow() (default: enrollment "real", ya usado alguna vez)
    - None   -> se deja NULL (enrollment "fantasma": nunca tuvo un pago aprobado)
    """
    enrollment = Enrollment(
        student_id=tracked["student_id"], teacher_id=tracked["teacher_id"], package_id=package_id,
        classes_used=0, classes_total=classes_total,
        unlocked_credits=unlocked_credits if unlocked_credits is not None else (classes_total or 0),
        payment_status=payment_status, status=status,
        activated_at=(datetime.now(tz.utc) if activated_at == "now" else None),
    )
    db.add(enrollment)
    db.commit()
    db.refresh(enrollment)
    tracked["enrollment_ids"].append(enrollment.id)
    return enrollment.id


def _make_completed_trial(db, tracked):
    """
    get_student_booking_stage exige una prueba YA COMPLETADA con este
    profesor antes de evaluar needs_package/needs_renewal — se inserta
    directo por ORM para no depender de la resolución de "profesor
    destacado" de /payments/book (ver nota en test_purchase_flow.py).
    """
    start = datetime.now(tz.utc) - timedelta(days=10)
    trial = Class(
        teacher_id=tracked["teacher_id"], student_id=tracked["student_id"],
        class_type=ClassType.trial, status="completed",
        start_time_utc=start, end_time_utc=start + timedelta(minutes=25), duration=25,
    )
    db.add(trial)
    db.commit()
    db.refresh(trial)
    tracked["class_ids"].append(trial.id)
    return trial.id


def _approve(client, superadmin_token, payment_id):
    r = client.patch(
        f"/api/v1/payments/{payment_id}/validate", json={"action": "approve"},
        headers=auth_headers(superadmin_token),
    )
    assert r.status_code == 200, r.text
    return r


def _reject(client, superadmin_token, payment_id, reason="Comprobante ilegible (flow-tests)"):
    r = client.patch(
        f"/api/v1/payments/{payment_id}/validate",
        json={"action": "reject", "rejection_reason": reason},
        headers=auth_headers(superadmin_token),
    )
    assert r.status_code == 200, r.text
    return r


# ─── D1: rechazar renovación revierte al paquete/créditos previos ─────────

def test_d1_reject_renewal_reverts_to_previous_package_untouched(
    client, student_token, superadmin_token, teacher_token, db, diff_env,
):
    """
    Técnico: se pide una renovación (enrollment pasa a pending_renewal,
    SIN tocar todavía package_id/unlocked_credits/classes_used — eso solo
    pasa al aprobar). Al rechazar el pago, el enrollment debe volver a
    'active' con el package_id/unlocked_credits/classes_used EXACTAMENTE
    como estaban antes de pedir la renovación, y sin quedar apuntando al
    paquete nuevo solicitado.
    UX: si el staff rechaza el comprobante de una renovación, el
    estudiante no debería perder ni ganar nada — simplemente sigue con lo
    que ya tenía y puede reintentar el pago.
    """
    old_pkg = _create_package(client, teacher_token, diff_env, name="Flow-test D1 viejo", classes_count=4, price=100.0)
    new_pkg = _create_package(client, teacher_token, diff_env, name="Flow-test D1 nuevo", classes_count=8, price=180.0)
    enrollment_id = _make_enrollment(
        db, diff_env, package_id=old_pkg["id"], classes_total=4, unlocked_credits=2,
    )

    r_renew = client.post("/api/v1/payments/notify-payment", json={
        "type": "renewal", "enrollment_id": enrollment_id, "package_id": new_pkg["id"],
        "transaction_reference": "flow-tests-d1",
    }, headers=auth_headers(student_token))
    assert r_renew.status_code == 200, r_renew.text
    payment_id = r_renew.json()["payment_id"]
    diff_env["payment_ids"].append(payment_id)

    db.expire_all()
    enrollment_db = db.query(Enrollment).filter(Enrollment.id == enrollment_id).first()
    assert enrollment_db.status == EnrollmentStatus.pending_renewal
    assert enrollment_db.renewal_requested_package_id == new_pkg["id"]
    # Todavía no se tocó nada del paquete/créditos actuales.
    assert enrollment_db.package_id == old_pkg["id"]
    assert enrollment_db.unlocked_credits == 2

    _reject(client, superadmin_token, payment_id)

    db.expire_all()
    enrollment_db = db.query(Enrollment).filter(Enrollment.id == enrollment_id).first()
    assert enrollment_db.status == EnrollmentStatus.active, (
        "D1: tras rechazar la renovación, el enrollment debe volver a 'active'"
    )
    assert enrollment_db.renewal_requested_package_id is None
    assert enrollment_db.package_id == old_pkg["id"], (
        "D1: el paquete no debe cambiar al del rechazo -- debe seguir siendo el original"
    )
    assert enrollment_db.unlocked_credits == 2, (
        "D1: los créditos no deben resetearse ni alterarse por una renovación rechazada"
    )

    payment_db = db.query(Payment).filter(Payment.id == payment_id).first()
    assert payment_db.status == "rejected"


# ─── D2: rechazar cambio de paquete notifica al estudiante ────────────────

def test_d2_reject_package_change_notifies_student_by_email(
    client, student_token, superadmin_token, teacher_token, db, diff_env, monkeypatch,
):
    """
    Técnico: al rechazar un Payment payment_type="package_change", debe
    invocarse send_payment_failed_email exactamente una vez, con el
    concepto "Cambio de paquete" y el motivo de rechazo indicado.
    (conftest.py mockea `send_*` como no-op en todos los tests para no
    mandar correos reales -- acá se sobreescribe puntualmente ESE mock
    por un espía que registra la llamada, para poder afirmar que sí se
    invocó.)
    UX: un estudiante al que se le rechaza un cambio de paquete debe
    enterarse por qué, igual que con cualquier otro pago rechazado -- no
    debería quedarse esperando en silencio una aprobación que no llegará.
    """
    calls = []

    def _spy_send_payment_failed_email(**kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(payments_module, "send_payment_failed_email", _spy_send_payment_failed_email)

    old_pkg = _create_package(client, teacher_token, diff_env, name="Flow-test D2 viejo", classes_count=4, price=100.0)
    new_pkg = _create_package(client, teacher_token, diff_env, name="Flow-test D2 nuevo", classes_count=10, price=200.0)
    enrollment_id = _make_enrollment(db, diff_env, package_id=old_pkg["id"], classes_total=4, unlocked_credits=4)

    r_change = client.post("/api/v1/payments/notify-payment", json={
        "type": "package_change", "enrollment_id": enrollment_id, "package_id": new_pkg["id"],
    }, headers=auth_headers(student_token))
    assert r_change.status_code == 200, r_change.text
    payment_id = r_change.json()["payment_id"]
    diff_env["payment_ids"].append(payment_id)

    _reject(client, superadmin_token, payment_id, reason="Monto no coincide (flow-tests D2)")

    assert len(calls) == 1, (
        "D2: rechazar un pago de cambio de paquete debe notificar por email al estudiante exactamente una vez"
    )
    assert calls[0]["concept"] == "Cambio de paquete"
    assert calls[0]["rejection_reason"] == "Monto no coincide (flow-tests D2)"


# ─── D3: upgrade con crédito previo otorga el total del paquete NUEVO ─────

def test_d3_upgrade_with_prior_credit_grants_full_new_package_total_not_partial(
    client, student_token, superadmin_token, teacher_token, db, diff_env,
):
    """
    Técnico: reproduce literalmente el escenario del ticket -- estudiante
    con 1 crédito disponible (paquete de 1 clase) paga la diferencia para
    pasar a un paquete de 6 clases. Tras aprobar, unlocked_credits debe
    quedar en 6 (el total del paquete nuevo), NUNCA en un valor parcial
    como 3.
    UX: si pagaste para tener 6 clases, tenés que quedar con 6 clases
    disponibles -- ni una menos.
    """
    tiny_pkg = _create_package(client, teacher_token, diff_env, name="Flow-test D3 chico", classes_count=1, price=30.0)
    six_pkg = _create_package(client, teacher_token, diff_env, name="Flow-test D3 seis", classes_count=6, price=150.0)
    enrollment_id = _make_enrollment(
        db, diff_env, package_id=tiny_pkg["id"], classes_total=1, unlocked_credits=1,
    )

    r_change = client.post("/api/v1/payments/notify-payment", json={
        "type": "package_change", "enrollment_id": enrollment_id, "package_id": six_pkg["id"],
    }, headers=auth_headers(student_token))
    assert r_change.status_code == 200, r_change.text
    payment_id = r_change.json()["payment_id"]
    diff_env["payment_ids"].append(payment_id)

    _approve(client, superadmin_token, payment_id)

    db.expire_all()
    enrollment_db = db.query(Enrollment).filter(Enrollment.id == enrollment_id).first()
    assert enrollment_db.package_id == six_pkg["id"]
    assert enrollment_db.classes_total == 6
    assert enrollment_db.unlocked_credits == 6, (
        f"D3: se esperaban 6 créditos (paquete nuevo completo), se obtuvieron "
        f"{enrollment_db.unlocked_credits}"
    )
    assert enrollment_db.payment_status == "paid"


# ─── D4: enrollment fantasma no debe disfrazarse de "needs_renewal" ───────

def test_d4_rejected_initial_package_stays_needs_package_on_repeat_check(
    db, diff_env,
):
    """
    Técnico: causa raíz real de D4. Un enrollment 'active'/payment_status
    'unpaid' sin ningún Payment pending_review (pago inicial nunca
    notificado, o notificado y luego rechazado) hace que
    get_student_booking_stage():
      1) en la 1ra consulta, lo cancele y devuelva 'needs_package' (esto
         ya funcionaba antes del fix);
      2) en CUALQUIER consulta posterior, como ya no hay ningún
         enrollment 'active', caía al chequeo "any_enrollment_ever" y
         encontraba ESE MISMO enrollment ya 'cancelled' -- deduciendo
         erróneamente "alguna vez tuvo un paquete que renovar" y
         devolviendo 'needs_renewal'. Ahí nacía el badge "Renovar
         paquete" sin sentido y, si el estudiante hacía clic, el backend
         rechazaba con "Solo puedes renovar un paquete activo o
         completado" porque ese enrollment nunca fue 'active'/'completed'
         de verdad (nunca tuvo un pago aprobado).
    Fix real en `master` (confirmado tras `git pull`, ver docstring del
    módulo): `any_enrollment_ever` excluye CUALQUIER enrollment
    'cancelled', no solo los que nunca se activaron -- cubre este caso y
    otros más amplios (decisión de negocio confirmada con el usuario).
    Este test verifica el escenario completo: 1ra Y 2da consulta deben
    devolver 'needs_package' por igual.
    UX: un estudiante cuyo pago inicial fue rechazado debe poder volver a
    elegir un paquete desde cero, sin importar cuántas veces recargue la
    página -- nunca debería ver un botón de "renovar" para algo que jamás
    tuvo.
    """
    pkg = Package(
        teacher_id=diff_env["teacher_id"], name="Flow-test D4 pkg", subject="English",
        price=100.0, classes_count=4, duration_minutes=50,
    )
    db.add(pkg)
    db.commit()
    db.refresh(pkg)
    diff_env["package_ids"].append(pkg.id)

    _make_completed_trial(db, diff_env)

    # Enrollment "fantasma": nunca tuvo un pago aprobado (activated_at=None).
    ghost_enrollment_id = _make_enrollment(
        db, diff_env, package_id=pkg.id, classes_total=4, unlocked_credits=0,
        payment_status="unpaid", status=EnrollmentStatus.active, activated_at=None,
    )

    # 1ra consulta: cancela el fantasma y devuelve needs_package (esto ya
    # funcionaba antes del fix).
    stage_1 = get_student_booking_stage(diff_env["student_id"], diff_env["teacher_id"], db)
    assert stage_1 == "needs_package"

    db.expire_all()
    ghost_db = db.query(Enrollment).filter(Enrollment.id == ghost_enrollment_id).first()
    assert ghost_db.status == EnrollmentStatus.cancelled
    assert ghost_db.activated_at is None, "Nunca se activó -- rechazado/jamás notificado"

    # 2da consulta (ej.: el estudiante recarga la página): ANTES del fix,
    # esto devolvía 'needs_renewal' por error. Debe seguir siendo
    # 'needs_package', porque ese enrollment jamás llegó a activarse.
    stage_2 = get_student_booking_stage(diff_env["student_id"], diff_env["teacher_id"], db)
    assert stage_2 == "needs_package", (
        "D4: un enrollment que nunca se activó no debe disparar 'needs_renewal' "
        f"en consultas posteriores a la primera (se obtuvo: {stage_2!r})"
    )


def test_d4_any_cancelled_enrollment_resets_to_needs_package_even_if_genuinely_used(
    db, diff_env,
):
    """
    Técnico: contraprueba del fix real ya en `master` (no del mío
    original, descartado por decisión de negocio -- ver docstring del
    módulo). Un enrollment que SÍ se activó alguna vez (tuvo un pago
    aprobado, `activated_at` seteado) pero terminó 'cancelled' por
    cualquier motivo (profesor suspendido y reembolsado, cohorte
    cancelada y reembolsada, etc.) debe devolver 'needs_package', NO
    'needs_renewal' -- cualquier cancelación se trata como reinicio total
    de la relación con ese profesor.
    UX confirmada con el usuario: un estudiante cuyo paquete fue
    cancelado (no agotado por uso normal) empieza de cero con ese
    profesor la próxima vez, en vez de ver un flujo de "renovación" para
    algo que ya no existe.
    """
    pkg = Package(
        teacher_id=diff_env["teacher_id"], name="Flow-test D4 pkg usado y cancelado", subject="English",
        price=100.0, classes_count=4, duration_minutes=50,
    )
    db.add(pkg)
    db.commit()
    db.refresh(pkg)
    diff_env["package_ids"].append(pkg.id)

    _make_completed_trial(db, diff_env)

    _make_enrollment(
        db, diff_env, package_id=pkg.id, classes_total=4, unlocked_credits=4,
        payment_status="paid", status=EnrollmentStatus.cancelled, activated_at="now",
    )

    stage = get_student_booking_stage(diff_env["student_id"], diff_env["teacher_id"], db)
    assert stage == "needs_package", (
        "Cualquier enrollment 'cancelled' (aunque sí se haya usado de verdad) debe "
        f"resetear a needs_package, no pedir renovación (se obtuvo: {stage!r})"
    )


def test_d4_completed_not_cancelled_enrollment_still_needs_renewal(
    db, diff_env,
):
    """
    Técnico: contraprueba positiva -- un enrollment que se agotó de
    forma NORMAL (paquete usado por completo, status 'completed', nunca
    'cancelled') sigue disparando 'needs_renewal' como corresponde. El
    fix de D4 excluye enrollments 'cancelled', no 'completed'.
    UX: un estudiante que terminó su paquete de clases con este profesor
    sí debe ver el flujo de renovación, no el de "elegir tu primer
    paquete" como si nunca hubiera tenido uno.
    """
    pkg = Package(
        teacher_id=diff_env["teacher_id"], name="Flow-test D4 pkg completado", subject="English",
        price=100.0, classes_count=4, duration_minutes=50,
    )
    db.add(pkg)
    db.commit()
    db.refresh(pkg)
    diff_env["package_ids"].append(pkg.id)

    _make_completed_trial(db, diff_env)

    _make_enrollment(
        db, diff_env, package_id=pkg.id, classes_total=4, unlocked_credits=0,
        payment_status="paid", status=EnrollmentStatus.completed, activated_at="now",
    )

    stage = get_student_booking_stage(diff_env["student_id"], diff_env["teacher_id"], db)
    assert stage == "needs_renewal", (
        f"Un paquete agotado por uso normal (completed) sí debe pedir renovación (se obtuvo: {stage!r})"
    )
