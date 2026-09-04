"""
Suite: Cambio de paquete y migraciones individual <-> grupal.

Cubre la matriz de edge cases de POST /payments/notify-payment tipo
"package_change" (regla de negocio 3.1/3.2 en payments.py) y las dos
direcciones de migración individual <-> grupal:

- individual -> individual: upgrade (instantáneo y con pago), downgrade
  Caso A/B (reembolso completo, ajuste con cargo, ajuste con devolución,
  instantáneo por mismo valor), cambio a paquete ilimitado.
- grupal -> individual: vía el mismo endpoint de package_change (ver
  comentario en cohorts.py::get_migration_quote) — cotización, aplicación
  instantánea y con pago, liberación del cupo de la cohorte.
- individual -> grupal: NO existe una "migración" dedicada — el paquete
  grupal se contrata como un enrollment nuevo y paralelo vía
  POST /cohorts/{id}/enroll (el endpoint de package_change rechaza
  explícitamente paquetes grupales como destino). Se prueba esa
  coexistencia, más los rechazos de capacidad y de reinscripción.
- grupal -> grupal: tampoco hay endpoint dedicado — es "leave + enroll"
  manual, dos llamadas separadas. Se prueba esa combinación.

Fuera de alcance a propósito (no es "cambio de paquete", es agendar
sesiones dentro de una cohorte ya confirmada — otra área de la app):
crear sesiones grupales, asistencia, o completar/cancelar una cohorte con
sesiones ya agendadas.

Para no repetir todo el flujo de compra en cada escenario (eso ya se
prueba a fondo en test_purchase_flow.py), la mayoría de estos tests
insertan directamente por ORM el Enrollment "activo y pagado" de partida,
y solo ejercen por API real la transición que están probando.
"""
from datetime import datetime, timedelta, timezone as tz
import logging

import pytest

from app.models.teacher import TeacherProfile
from app.models.student import StudentProfile
from app.models.package import Package, Enrollment, EnrollmentStatus
from app.models.class_ import Class, ClassType
from app.models.payment import Payment
from app.models.group_cohort import GroupCohort, CohortStatus
from app.core.group_cohort_logic import get_cohort_active_count
from tests.flow.conftest import auth_headers

pytestmark = pytest.mark.integration

logger = logging.getLogger("flow_tests")


# ─── Fixture compartida: trackea todo lo creado y lo limpia en orden seguro ─

@pytest.fixture
def pkg_env(db, fixed_users, volatile):
    teacher = db.query(TeacherProfile).filter(TeacherProfile.user_id == fixed_users["teacher"].id).first()
    student = db.query(StudentProfile).filter(StudentProfile.user_id == fixed_users["student"].id).first()
    tracked = {
        "teacher_id": teacher.id, "student_id": student.id,
        "payment_ids": [], "class_ids": [], "enrollment_ids": [], "package_ids": [], "cohort_ids": [],
    }

    def _cleanup():
        from app.db.base import SessionLocal
        s = SessionLocal()
        try:
            # Cada borrado con su propio commit: si uno falla (p. ej. un
            # orden de FK que se nos escapó), los anteriores ya quedaron
            # aplicados en vez de perderse todos por un rollback implícito
            # al cerrar la sesión sin commit.
            def _run(step_label, fn):
                try:
                    fn()
                    s.commit()
                except Exception:
                    s.rollback()
                    logger.exception("Paso de limpieza falló (%s) en test_package_change", step_label)

            # Red de seguridad: cualquier Payment/Class ligado a un
            # enrollment trackeado se borra también, aunque el test haya
            # fallado antes de registrar su id explícitamente.
            if tracked["enrollment_ids"]:
                _run("payments-por-enrollment", lambda: s.query(Payment).filter(
                    Payment.enrollment_id.in_(tracked["enrollment_ids"])
                ).delete(synchronize_session=False))
                _run("classes-por-enrollment", lambda: s.query(Class).filter(
                    Class.enrollment_id.in_(tracked["enrollment_ids"])
                ).delete(synchronize_session=False))
            if tracked["payment_ids"]:
                _run("payments-por-id", lambda: s.query(Payment).filter(
                    Payment.id.in_(tracked["payment_ids"])
                ).delete(synchronize_session=False))
            if tracked["class_ids"]:
                _run("classes-por-id", lambda: s.query(Class).filter(
                    Class.id.in_(tracked["class_ids"])
                ).delete(synchronize_session=False))
            if tracked["enrollment_ids"]:
                _run("enrollments", lambda: s.query(Enrollment).filter(
                    Enrollment.id.in_(tracked["enrollment_ids"])
                ).delete(synchronize_session=False))
            # GroupCohort.package_id referencia Package -> hay que borrar
            # las cohortes ANTES que los paquetes, no después.
            if tracked["cohort_ids"]:
                _run("cohortes", lambda: s.query(GroupCohort).filter(
                    GroupCohort.id.in_(tracked["cohort_ids"])
                ).delete(synchronize_session=False))
            if tracked["package_ids"]:
                _run("packages", lambda: s.query(Package).filter(
                    Package.id.in_(tracked["package_ids"])
                ).delete(synchronize_session=False))
        finally:
            s.close()

    volatile.custom(_cleanup, label="limpieza total de test_package_change (packages/enrollments/classes/payments/cohortes)")
    return tracked


def _create_package(client, teacher_token, tracked, **overrides):
    payload = {
        "name": "Flow-test package", "subject": "English",
        "price": 100.0, "classes_count": 4, "duration_minutes": 50,
    }
    payload.update(overrides)
    r = client.post("/api/v1/packages/", json=payload, headers=auth_headers(teacher_token))
    assert r.status_code == 201, r.text
    tracked["package_ids"].append(r.json()["id"])
    return r.json()


def _make_enrollment(db, tracked, *, package_id, classes_total, unlocked_credits=None,
                      prepaid_unlimited_credits=0, payment_status="paid", status=EnrollmentStatus.active,
                      cohort_id=None, occupied_classes=0):
    """Enrollment 'activo y pagado' insertado directo por ORM (ver docstring del módulo)."""
    enrollment = Enrollment(
        student_id=tracked["student_id"], teacher_id=tracked["teacher_id"], package_id=package_id,
        classes_used=0, classes_total=classes_total,
        unlocked_credits=unlocked_credits if unlocked_credits is not None else (classes_total or 0),
        prepaid_unlimited_credits=prepaid_unlimited_credits,
        payment_status=payment_status, status=status, cohort_id=cohort_id,
    )
    db.add(enrollment)
    db.commit()
    db.refresh(enrollment)
    tracked["enrollment_ids"].append(enrollment.id)

    for i in range(occupied_classes):
        start = datetime.now(tz.utc) - timedelta(days=occupied_classes - i)
        c = Class(
            teacher_id=tracked["teacher_id"], student_id=tracked["student_id"], enrollment_id=enrollment.id,
            class_type=ClassType.regular, status="completed",
            start_time_utc=start, end_time_utc=start + timedelta(minutes=50), duration=50,
        )
        db.add(c)
    db.commit()
    if occupied_classes:
        for c in db.query(Class).filter(Class.enrollment_id == enrollment.id).all():
            tracked["class_ids"].append(c.id)

    return enrollment.id


def _request_package_change(client, student_token, enrollment_id, package_id, **extra):
    body = {"type": "package_change", "enrollment_id": enrollment_id, "package_id": package_id}
    body.update(extra)
    return client.post("/api/v1/payments/notify-payment", json=body, headers=auth_headers(student_token))


def _approve(client, superadmin_token, payment_id):
    return client.patch(
        f"/api/v1/payments/{payment_id}/validate", json={"action": "approve"},
        headers=auth_headers(superadmin_token),
    )


def _register_payment_cleanup(tracked, payment_id):
    tracked["payment_ids"].append(payment_id)


# ─── Regresión: is_group/min/max_students no se perdían al crear el paquete ─

def test_create_group_package_persists_group_fields(client, teacher_token, pkg_env):
    """
    Técnico: regresión de un bug real ya corregido — PackageCreate no
    declaraba is_group/min_students/max_students, así que Pydantic los
    descartaba en silencio y todo paquete "grupal" se guardaba como
    individual. Verifica que hoy sí persisten.
    UX: el toggle "Paquete grupal" del formulario del profesor debe
    reflejarse de verdad — si no, el paquete no aparece marcado como
    grupal en su propia lista, ni el creador de cohortes lo reconoce
    como paquete grupal disponible.
    """
    pkg = _create_package(
        client, teacher_token, pkg_env,
        name="Flow-test grupal", price=200.0, classes_count=8,
        is_group=True, min_students=3, max_students=6,
    )
    assert pkg["is_group"] is True
    assert pkg["min_students"] == 3
    assert pkg["max_students"] == 6


# ─── Validaciones / rechazos de package_change ─────────────────────────────

def test_package_change_rejects_same_package(client, student_token, teacher_token, db, pkg_env):
    """
    Técnico: pedir cambiarse a su propio package_id actual devuelve 400
    ("Ya tienes este paquete activo").
    UX: evita que el estudiante genere un pago/cambio sin sentido
    seleccionando el mismo paquete que ya tiene.
    """
    pkg = _create_package(client, teacher_token, pkg_env)
    enrollment_id = _make_enrollment(db, pkg_env, package_id=pkg["id"], classes_total=pkg["classes_count"])

    r = _request_package_change(client, student_token, enrollment_id, pkg["id"])
    assert r.status_code == 400
    assert "ya tienes este paquete" in r.text.lower()


def test_package_change_rejects_group_package_as_target(client, student_token, teacher_token, db, pkg_env):
    """
    Técnico: intentar cambiar un enrollment individual hacia un paquete
    is_group=True vía package_change devuelve 400 — esa ruta está
    reservada para POST /cohorts/{id}/enroll.
    UX: unirse a un grupo no es "cambiar de paquete" (implica coordinar
    horario con otros alumnos) — el flujo correcto es elegir una cohorte
    abierta, no un simple cambio individual.
    """
    old_pkg = _create_package(client, teacher_token, pkg_env)
    group_pkg = _create_package(
        client, teacher_token, pkg_env, name="Flow-test grupal 2",
        is_group=True, min_students=2, max_students=5, classes_count=8, price=150.0,
    )
    enrollment_id = _make_enrollment(db, pkg_env, package_id=old_pkg["id"], classes_total=old_pkg["classes_count"])

    r = _request_package_change(client, student_token, enrollment_id, group_pkg["id"])
    assert r.status_code == 400
    assert "grupal" in r.text.lower()


def test_package_change_rejects_inactive_enrollment(client, student_token, teacher_token, db, pkg_env):
    """
    Técnico: un enrollment con status != "active" (ya completado, en este
    caso) devuelve 400 al intentar un package_change sobre él.
    UX: no tiene sentido pedir cambiar de paquete un plan que ya terminó
    — primero hay que renovar o elegir uno nuevo desde cero.
    """
    old_pkg = _create_package(client, teacher_token, pkg_env)
    new_pkg = _create_package(client, teacher_token, pkg_env, name="Flow-test otro", price=120.0, classes_count=5)
    enrollment_id = _make_enrollment(
        db, pkg_env, package_id=old_pkg["id"], classes_total=old_pkg["classes_count"],
        status=EnrollmentStatus.completed,
    )

    r = _request_package_change(client, student_token, enrollment_id, new_pkg["id"])
    assert r.status_code == 400
    assert "activo" in r.text.lower()


def test_package_change_rejects_unpaid_enrollment(client, student_token, teacher_token, db, pkg_env):
    """
    Técnico: un enrollment con payment_status != "paid" (regla 3.2)
    devuelve 400 — no se puede pedir un cambio de paquete mientras el
    actual sigue con saldo pendiente.
    UX: hay que terminar de pagar el paquete actual antes de poder
    cambiarlo — evita que alguien acumule deudas de varios paquetes
    superpuestos.
    """
    old_pkg = _create_package(client, teacher_token, pkg_env)
    new_pkg = _create_package(client, teacher_token, pkg_env, name="Flow-test otro 2", price=120.0, classes_count=5)
    enrollment_id = _make_enrollment(
        db, pkg_env, package_id=old_pkg["id"], classes_total=old_pkg["classes_count"],
        payment_status="partially_paid",
    )

    r = _request_package_change(client, student_token, enrollment_id, new_pkg["id"])
    assert r.status_code == 400
    assert "pago" in r.text.lower()


def test_package_change_rejects_when_pending_payment_exists(client, student_token, teacher_token, db, pkg_env):
    """
    Técnico: si ya existe un Payment pending_review sobre el enrollment
    (de cualquier tipo entre package/renewal/package_change/refund), una
    nueva solicitud de package_change devuelve 400 sin llegar a calcular
    ningún monto.
    UX: evita que el estudiante dispare varias solicitudes de cambio en
    paralelo mientras el staff todavía está revisando la anterior.
    """
    old_pkg = _create_package(client, teacher_token, pkg_env)
    new_pkg = _create_package(client, teacher_token, pkg_env, name="Flow-test otro 3", price=120.0, classes_count=5)
    enrollment_id = _make_enrollment(db, pkg_env, package_id=old_pkg["id"], classes_total=old_pkg["classes_count"])

    pending_payment = Payment(
        enrollment_id=enrollment_id, student_id=pkg_env["student_id"], teacher_id=pkg_env["teacher_id"],
        amount_total=10.0, amount_teacher=0, amount_platform=0,
        payment_method="manual", status="pending_review", payment_type="package_change",
    )
    db.add(pending_payment)
    db.commit()
    db.refresh(pending_payment)
    _register_payment_cleanup(pkg_env, pending_payment.id)

    r = _request_package_change(client, student_token, enrollment_id, new_pkg["id"])
    assert r.status_code == 400
    assert "pendiente" in r.text.lower()


# ─── Upgrade (más clases que el paquete actual) ────────────────────────────

def test_package_change_upgrade_rejects_when_deficit_negative(client, student_token, teacher_token, db, pkg_env):
    """
    Técnico: caso defensivo — si por alguna inconsistencia unlocked_credits
    ya superara el cupo del paquete nuevo (deficit < 0) en un "upgrade"
    (new_package.classes_count >= old_total), el endpoint rechaza con 400
    en vez de dejar un estado imposible de reconciliar. No es alcanzable
    con el flujo normal (unlocked_credits nunca debería superar
    classes_total en la práctica), por eso se fuerza el estado directo
    por ORM para ejercer esta guarda.
    UX: red de seguridad — nunca debería mostrarse un cambio de paquete
    que dejaría al estudiante con más créditos "fantasma" que cupo real.
    """
    old_pkg = _create_package(client, teacher_token, pkg_env, classes_count=4, price=100.0)
    target_pkg = _create_package(client, teacher_token, pkg_env, name="Flow-test target", classes_count=6, price=150.0)
    # Estado forzado a propósito: unlocked_credits(10) > classes_total(4),
    # así available_credits(10) > target_pkg.classes_count(6) -> deficit<0.
    enrollment_id = _make_enrollment(db, pkg_env, package_id=old_pkg["id"], classes_total=4, unlocked_credits=10)

    r = _request_package_change(client, student_token, enrollment_id, target_pkg["id"])
    assert r.status_code == 400
    assert "más cupo" in r.text.lower() or "créditos disponibles" in r.text.lower()


def test_package_change_upgrade_instant_when_deficit_zero(client, student_token, teacher_token, db, pkg_env):
    """
    Técnico: si los créditos disponibles ya cubren exactamente el nuevo
    paquete (deficit == 0), el cambio se aplica al instante sin generar
    ningún Payment — verificado que el enrollment queda con el
    package_id/classes_total nuevos de inmediato en la BD.
    UX: si el estudiante ya tenía justo los créditos que el nuevo paquete
    ofrece, no debería tener que pagar nada extra ni esperar aprobación.
    """
    old_pkg = _create_package(client, teacher_token, pkg_env, classes_count=4, price=100.0)
    same_size_pkg = _create_package(client, teacher_token, pkg_env, name="Flow-test lateral", classes_count=4, price=90.0)
    enrollment_id = _make_enrollment(db, pkg_env, package_id=old_pkg["id"], classes_total=4, unlocked_credits=4)

    r = _request_package_change(client, student_token, enrollment_id, same_size_pkg["id"])
    assert r.status_code == 200, r.text
    assert "sin costo adicional" in r.json()["message"].lower()

    db.expire_all()
    enrollment_db = db.query(Enrollment).filter(Enrollment.id == enrollment_id).first()
    assert enrollment_db.package_id == same_size_pkg["id"]
    assert enrollment_db.classes_total == 4
    assert enrollment_db.status == EnrollmentStatus.active

    no_payment = db.query(Payment).filter(Payment.enrollment_id == enrollment_id).first()
    assert no_payment is None, "Un cambio instantáneo no debería generar ningún Payment"


def test_package_change_upgrade_requires_payment_then_approval_sets_new_total(
    client, student_token, superadmin_token, teacher_token, db, pkg_env,
):
    """
    Técnico: upgrade real (deficit > 0) crea un Payment pending_review por
    el monto proporcional a los créditos faltantes; tras aprobarlo, el
    enrollment queda con el package_id/classes_total del nuevo paquete y
    payment_status="paid" — verificado contra la BD, no solo la respuesta.
    UX: es el caso normal de "quiero más clases de las que me quedan" —
    el estudiante paga la diferencia y, una vez que el staff lo confirma,
    su cupo de clases se actualiza.
    """
    old_pkg = _create_package(client, teacher_token, pkg_env, classes_count=4, price=100.0)
    bigger_pkg = _create_package(client, teacher_token, pkg_env, name="Flow-test grande", classes_count=10, price=200.0)
    enrollment_id = _make_enrollment(db, pkg_env, package_id=old_pkg["id"], classes_total=4, unlocked_credits=4)

    r = _request_package_change(client, student_token, enrollment_id, bigger_pkg["id"])
    assert r.status_code == 200, r.text
    payment_id = r.json()["payment_id"]
    _register_payment_cleanup(pkg_env, payment_id)

    db.expire_all()
    enrollment_db = db.query(Enrollment).filter(Enrollment.id == enrollment_id).first()
    assert enrollment_db.status == EnrollmentStatus.pending_package_change
    assert enrollment_db.change_requested_package_id == bigger_pkg["id"]

    payment_db = db.query(Payment).filter(Payment.id == payment_id).first()
    expected_amount = round((200.0 / 10) * (10 - 4), 2)  # precio_por_clase * créditos faltantes
    assert payment_db.amount_total == expected_amount
    assert payment_db.payment_type == "package_change"

    r_approve = _approve(client, superadmin_token, payment_id)
    assert r_approve.status_code == 200, r_approve.text

    db.expire_all()
    enrollment_db = db.query(Enrollment).filter(Enrollment.id == enrollment_id).first()
    assert enrollment_db.package_id == bigger_pkg["id"]
    assert enrollment_db.classes_total == 10
    assert enrollment_db.status == EnrollmentStatus.active
    assert enrollment_db.payment_status == "paid"
    assert enrollment_db.change_requested_package_id is None


def test_package_change_rejected_payment_reverts_enrollment_to_active(
    client, student_token, superadmin_token, teacher_token, db, pkg_env,
):
    """
    Técnico: regresión de un bug real ya corregido — si el staff RECHAZA
    un pago de package_change, el enrollment ya no debía quedar atascado
    para siempre en pending_package_change; debe volver a "active" con el
    package_id original intacto.
    UX: si el comprobante de pago del cambio de paquete resulta inválido,
    el estudiante debe poder seguir usando su paquete actual con
    normalidad y volver a intentar el cambio más tarde.
    """
    old_pkg = _create_package(client, teacher_token, pkg_env, classes_count=4, price=100.0)
    bigger_pkg = _create_package(client, teacher_token, pkg_env, name="Flow-test grande 2", classes_count=10, price=200.0)
    enrollment_id = _make_enrollment(db, pkg_env, package_id=old_pkg["id"], classes_total=4, unlocked_credits=4)

    r = _request_package_change(client, student_token, enrollment_id, bigger_pkg["id"])
    payment_id = r.json()["payment_id"]
    _register_payment_cleanup(pkg_env, payment_id)

    r_reject = client.patch(
        f"/api/v1/payments/{payment_id}/validate",
        json={"action": "reject", "rejection_reason": "Comprobante ilegible (flow-tests)"},
        headers=auth_headers(superadmin_token),
    )
    assert r_reject.status_code == 200, r_reject.text

    db.expire_all()
    enrollment_db = db.query(Enrollment).filter(Enrollment.id == enrollment_id).first()
    assert enrollment_db.status == EnrollmentStatus.active
    assert enrollment_db.package_id == old_pkg["id"], "El paquete original no debería tocarse si el cambio se rechaza"
    assert enrollment_db.change_requested_package_id is None


# ─── Downgrade Caso A: ningún crédito usado todavía ────────────────────────

def test_package_change_downgrade_case_a_instant_when_same_value(client, student_token, teacher_token, db, pkg_env):
    """
    Técnico: downgrade (menos clases) con el mismo precio total que el
    paquete actual (diff == 0) se aplica al instante, sin Payment.
    UX: si el estudiante "downgradea" a un paquete de igual valor (menos
    clases pero al mismo precio total, por ejemplo clases más caras
    individualmente), no debería pagar ni esperar nada.
    """
    old_pkg = _create_package(client, teacher_token, pkg_env, classes_count=10, price=200.0)
    smaller_same_value = _create_package(client, teacher_token, pkg_env, name="Flow-test chico mismo valor", classes_count=5, price=200.0)
    enrollment_id = _make_enrollment(db, pkg_env, package_id=old_pkg["id"], classes_total=10, unlocked_credits=10)

    r = _request_package_change(client, student_token, enrollment_id, smaller_same_value["id"])
    assert r.status_code == 200, r.text
    assert "sin costo adicional" in r.json()["message"].lower()

    db.expire_all()
    enrollment_db = db.query(Enrollment).filter(Enrollment.id == enrollment_id).first()
    assert enrollment_db.package_id == smaller_same_value["id"]
    assert enrollment_db.classes_total == 5


def test_package_change_downgrade_case_a_full_refund_cancels_enrollment(
    client, student_token, superadmin_token, teacher_token, db, pkg_env,
):
    """
    Técnico: downgrade sin créditos usados con change_option="full_refund"
    genera un Payment tipo "refund" por el precio TOTAL del paquete
    actual; al aprobarlo, el enrollment queda "cancelled" (no se le asigna
    ningún paquete nuevo — el estudiante elige después).
    UX: es la opción "mejor devuélveme todo mi dinero" cuando el
    estudiante se arrepiente antes de haber tomado una sola clase — queda
    sin paquete activo, libre de elegir cualquier otro desde cero.
    """
    old_pkg = _create_package(client, teacher_token, pkg_env, classes_count=10, price=300.0)
    smaller_pkg = _create_package(client, teacher_token, pkg_env, name="Flow-test chico refund", classes_count=3, price=90.0)
    enrollment_id = _make_enrollment(db, pkg_env, package_id=old_pkg["id"], classes_total=10, unlocked_credits=10)

    r = _request_package_change(
        client, student_token, enrollment_id, smaller_pkg["id"], change_option="full_refund",
    )
    assert r.status_code == 200, r.text
    payment_id = r.json()["payment_id"]
    _register_payment_cleanup(pkg_env, payment_id)

    payment_db = db.query(Payment).filter(Payment.id == payment_id).first()
    assert payment_db.payment_type == "refund"
    assert payment_db.amount_total == 300.0

    r_approve = _approve(client, superadmin_token, payment_id)
    assert r_approve.status_code == 200, r_approve.text

    db.expire_all()
    enrollment_db = db.query(Enrollment).filter(Enrollment.id == enrollment_id).first()
    assert enrollment_db.status == EnrollmentStatus.cancelled
    assert enrollment_db.package_id == old_pkg["id"], "Un reembolso total no reasigna ningún paquete nuevo"


def test_package_change_downgrade_case_a_adjust_difference_charge(
    client, student_token, superadmin_token, teacher_token, db, pkg_env,
):
    """
    Técnico: downgrade sin créditos usados con change_option (por
    defecto) "adjust_difference", cuando el nuevo paquete es MÁS caro que
    el valor restante del actual (diff > 0): genera un Payment tipo
    "package_change" por esa diferencia; al aprobarlo, el enrollment pasa
    al nuevo paquete.
    UX: el estudiante cambia de opinión hacia un paquete distinto (aunque
    tenga menos clases, puede costar más en total) y paga solo la
    diferencia, no el precio completo del paquete nuevo.
    """
    old_pkg = _create_package(client, teacher_token, pkg_env, classes_count=10, price=100.0)
    pricier_smaller_pkg = _create_package(client, teacher_token, pkg_env, name="Flow-test chico caro", classes_count=3, price=150.0)
    enrollment_id = _make_enrollment(db, pkg_env, package_id=old_pkg["id"], classes_total=10, unlocked_credits=10)

    r = _request_package_change(client, student_token, enrollment_id, pricier_smaller_pkg["id"])
    assert r.status_code == 200, r.text
    payment_id = r.json()["payment_id"]
    _register_payment_cleanup(pkg_env, payment_id)

    payment_db = db.query(Payment).filter(Payment.id == payment_id).first()
    assert payment_db.payment_type == "package_change"
    assert payment_db.amount_total == 50.0  # 150 - 100

    r_approve = _approve(client, superadmin_token, payment_id)
    assert r_approve.status_code == 200, r_approve.text

    db.expire_all()
    enrollment_db = db.query(Enrollment).filter(Enrollment.id == enrollment_id).first()
    assert enrollment_db.package_id == pricier_smaller_pkg["id"]
    assert enrollment_db.classes_total == 3
    assert enrollment_db.status == EnrollmentStatus.active


def test_package_change_downgrade_case_a_adjust_difference_refund(
    client, student_token, superadmin_token, teacher_token, db, pkg_env,
):
    """
    Técnico: mismo escenario que el anterior pero el nuevo paquete es MÁS
    BARATO que el actual (diff < 0): genera un Payment tipo "refund" por
    el valor absoluto de la diferencia a favor del estudiante.
    UX: el estudiante baja a un paquete más económico sin haber usado
    ninguna clase — se le genera una nota de devolución por la diferencia
    en vez de cobrarle nada.
    """
    old_pkg = _create_package(client, teacher_token, pkg_env, classes_count=10, price=200.0)
    cheaper_pkg = _create_package(client, teacher_token, pkg_env, name="Flow-test barato", classes_count=3, price=60.0)
    enrollment_id = _make_enrollment(db, pkg_env, package_id=old_pkg["id"], classes_total=10, unlocked_credits=10)

    r = _request_package_change(client, student_token, enrollment_id, cheaper_pkg["id"])
    assert r.status_code == 200, r.text
    payment_id = r.json()["payment_id"]
    _register_payment_cleanup(pkg_env, payment_id)

    payment_db = db.query(Payment).filter(Payment.id == payment_id).first()
    assert payment_db.payment_type == "refund"
    assert payment_db.amount_total == 140.0  # |60 - 200|


# ─── Downgrade Caso B: ya se usaron créditos del paquete actual ────────────

def test_package_change_downgrade_case_b_uses_remaining_value_not_full_price(
    client, student_token, superadmin_token, teacher_token, db, pkg_env,
):
    """
    Técnico: con créditos ya usados (occupied_slots > 0), el ajuste se
    calcula sobre el VALOR RESTANTE del paquete actual
    (precio_por_clase * clases_restantes), no sobre su precio de lista
    completo — regla de negocio 3.1 Caso B.
    UX: si el estudiante ya tomó clases de su paquete actual, el cambio
    de paquete debe reconocer ese consumo — no se le cobra ni se le
    devuelve como si nunca hubiera usado nada.
    """
    old_pkg = _create_package(client, teacher_token, pkg_env, classes_count=10, price=200.0)  # $20/clase
    new_pkg = _create_package(client, teacher_token, pkg_env, name="Flow-test caso B", classes_count=3, price=100.0)
    # 2 clases ya completadas -> quedan 8 de las 10 -> valor restante = 8*20 = 160
    enrollment_id = _make_enrollment(
        db, pkg_env, package_id=old_pkg["id"], classes_total=10, unlocked_credits=10, occupied_classes=2,
    )

    r = _request_package_change(client, student_token, enrollment_id, new_pkg["id"])
    assert r.status_code == 200, r.text
    payment_id = r.json()["payment_id"]
    _register_payment_cleanup(pkg_env, payment_id)

    payment_db = db.query(Payment).filter(Payment.id == payment_id).first()
    assert payment_db.payment_type == "refund"
    assert payment_db.amount_total == 60.0  # |100 - 160|, no |100 - 200|


# ─── Cambio a paquete ilimitado ─────────────────────────────────────────────

def test_package_change_switch_to_unlimited_transfers_credits_instantly(
    client, student_token, teacher_token, db, pkg_env,
):
    """
    Técnico: cambiar a un paquete con classes_count=None (ilimitado) es
    siempre instantáneo y sin costo — los créditos disponibles del
    paquete anterior se transfieren tal cual a prepaid_unlimited_credits.
    UX: el estudiante "sube" a un plan ilimitado y no pierde las clases
    que ya tenía pagadas y sin usar de su paquete anterior.
    """
    old_pkg = _create_package(client, teacher_token, pkg_env, classes_count=6, price=120.0)
    unlimited_pkg = _create_package(client, teacher_token, pkg_env, name="Flow-test ilimitado", classes_count=None, price=250.0)
    enrollment_id = _make_enrollment(
        db, pkg_env, package_id=old_pkg["id"], classes_total=6, unlocked_credits=6, occupied_classes=2,
    )

    r = _request_package_change(client, student_token, enrollment_id, unlimited_pkg["id"])
    assert r.status_code == 200, r.text
    assert "ilimitado" in r.json()["message"].lower()

    db.expire_all()
    enrollment_db = db.query(Enrollment).filter(Enrollment.id == enrollment_id).first()
    assert enrollment_db.package_id == unlimited_pkg["id"]
    assert enrollment_db.classes_total is None
    # unlocked_credits(6) - occupied(2) = 4 créditos disponibles transferidos
    assert enrollment_db.prepaid_unlimited_credits == 4

    no_payment = db.query(Payment).filter(Payment.enrollment_id == enrollment_id).first()
    assert no_payment is None


# ─── Individual -> grupal: no es migración, es un enrollment nuevo ─────────

@pytest.fixture
def group_setup(client, teacher_token, db, pkg_env):
    """Paquete grupal + cohorte abierta ('filling') con cupo para 2."""
    group_pkg = _create_package(
        client, teacher_token, pkg_env, name="Flow-test grupal cohortes",
        is_group=True, min_students=1, max_students=2, classes_count=6, price=180.0,
    )
    r = client.post("/api/v1/cohorts/", json={
        "package_id": group_pkg["id"], "min_students": 1, "max_students": 2,
    }, headers=auth_headers(teacher_token))
    assert r.status_code == 201, r.text
    cohort = r.json()
    pkg_env["cohort_ids"].append(cohort["id"])
    return {"package": group_pkg, "cohort": cohort}


def test_individual_enrollment_coexists_with_new_group_enrollment(
    client, student_token, superadmin_token, teacher_token, db, pkg_env, group_setup,
):
    """
    Técnico: un estudiante con un enrollment individual activo puede
    además inscribirse en una cohorte grupal — se crea un SEGUNDO
    Enrollment independiente (con su propio Payment), sin tocar el
    individual. No existe una ruta de "migración" individual->grupal:
    unirse a un grupo siempre es un enrollment nuevo y paralelo.
    UX: un estudiante puede estar tomando clases individuales de un tema
    y sumarse a la vez a un curso grupal de otro — ambos planes conviven
    sin pisarse.
    """
    old_pkg = _create_package(client, teacher_token, pkg_env, classes_count=4, price=100.0)
    individual_enrollment_id = _make_enrollment(db, pkg_env, package_id=old_pkg["id"], classes_total=4, unlocked_credits=4)

    r_enroll = client.post(
        f"/api/v1/cohorts/{group_setup['cohort']['id']}/enroll",
        json={"cohort_id": group_setup["cohort"]["id"], "transaction_reference": "flow-tests-group"},
        headers=auth_headers(student_token),
    )
    assert r_enroll.status_code == 201, r_enroll.text
    group_enrollment_id = r_enroll.json()["enrollment_id"]
    pkg_env["enrollment_ids"].append(group_enrollment_id)

    group_payment = db.query(Payment).filter(Payment.enrollment_id == group_enrollment_id).first()
    assert group_payment is not None
    assert group_payment.payment_type == "group_enrollment"
    pkg_env["payment_ids"].append(group_payment.id)

    r_approve = _approve(client, superadmin_token, group_payment.id)
    assert r_approve.status_code == 200, r_approve.text

    db.expire_all()
    individual_db = db.query(Enrollment).filter(Enrollment.id == individual_enrollment_id).first()
    group_db = db.query(Enrollment).filter(Enrollment.id == group_enrollment_id).first()
    assert individual_db.status == EnrollmentStatus.active
    assert individual_db.cohort_id is None
    assert group_db.status == EnrollmentStatus.active
    assert group_db.cohort_id == group_setup["cohort"]["id"]
    assert group_db.payment_status == "paid"


def test_cohort_enrollment_rejects_when_full_and_when_already_enrolled(
    client, student_token, superadmin_token, teacher_token, db, pkg_env, group_setup,
):
    """
    Técnico: dos rechazos de POST /cohorts/{id}/enroll — (1) inscribirse
    dos veces en la misma cohorte da 400 "Ya estás inscrito"; (2) una vez
    llena (max_students alcanzado), un tercer estudiante recibe 400 "ya no
    tiene cupo disponible". Para (2) se llena el único cupo restante
    insertando directo un segundo enrollment activo (no hace falta un 3er
    usuario fijo para probar el límite de capacidad).
    UX: el estudiante ve un mensaje claro tanto si ya está anotado como si
    el grupo ya se llenó, en vez de que el botón "unirme" falle en
    silencio o duplique su inscripción.
    """
    cohort_id = group_setup["cohort"]["id"]

    r1 = client.post(
        f"/api/v1/cohorts/{cohort_id}/enroll",
        json={"cohort_id": cohort_id, "transaction_reference": "flow-tests-dup"},
        headers=auth_headers(student_token),
    )
    assert r1.status_code == 201, r1.text
    enrollment_id = r1.json()["enrollment_id"]
    pkg_env["enrollment_ids"].append(enrollment_id)
    payment = db.query(Payment).filter(Payment.enrollment_id == enrollment_id).first()
    pkg_env["payment_ids"].append(payment.id)

    r_dup = client.post(
        f"/api/v1/cohorts/{cohort_id}/enroll",
        json={"cohort_id": cohort_id, "transaction_reference": "flow-tests-dup-2"},
        headers=auth_headers(student_token),
    )
    assert r_dup.status_code == 400
    assert "ya estás inscrito" in r_dup.text.lower()

    # Llena el cupo restante (max_students=2, ya hay 1) con un segundo
    # enrollment activo directo por ORM, y confirma que un tercer intento
    # (con el mismo estudiante fijo, alcanza para probar el rechazo de
    # capacidad) da 400 de cupo lleno.
    filler_id = _make_enrollment(
        db, pkg_env, package_id=group_setup["package"]["id"], classes_total=group_setup["package"]["classes_count"],
        cohort_id=cohort_id,
    )
    assert get_cohort_active_count(cohort_id, db) == 2

    r_full = client.post(
        f"/api/v1/cohorts/{cohort_id}/enroll",
        json={"cohort_id": cohort_id, "transaction_reference": "flow-tests-full"},
        headers=auth_headers(student_token),
    )
    assert r_full.status_code == 400
    assert "cupo" in r_full.text.lower()


def test_leave_cohort_frees_enrollment_and_seat(
    client, student_token, superadmin_token, teacher_token, db, pkg_env, group_setup,
):
    """
    Técnico: POST /cohorts/{id}/leave cancela el Enrollment del
    estudiante (status="cancelled") y libera el cupo — verificado que
    get_cohort_active_count baja después de salir.
    UX: es el botón "abandonar el grupo" — el estudiante queda libre de
    elegir un paquete individual o unirse a otra cohorte, y el cupo que
    dejó queda disponible para alguien más.
    """
    cohort_id = group_setup["cohort"]["id"]
    r_enroll = client.post(
        f"/api/v1/cohorts/{cohort_id}/enroll",
        json={"cohort_id": cohort_id, "transaction_reference": "flow-tests-leave"},
        headers=auth_headers(student_token),
    )
    enrollment_id = r_enroll.json()["enrollment_id"]
    pkg_env["enrollment_ids"].append(enrollment_id)
    payment = db.query(Payment).filter(Payment.enrollment_id == enrollment_id).first()
    pkg_env["payment_ids"].append(payment.id)

    assert get_cohort_active_count(cohort_id, db) == 1

    r_leave = client.post(f"/api/v1/cohorts/{cohort_id}/leave", headers=auth_headers(student_token))
    assert r_leave.status_code == 200, r_leave.text

    db.expire_all()
    enrollment_db = db.query(Enrollment).filter(Enrollment.id == enrollment_id).first()
    assert enrollment_db.status == EnrollmentStatus.cancelled
    assert get_cohort_active_count(cohort_id, db) == 0


# ─── Grupal -> individual: migración vía el mismo package_change ──────────

def test_group_to_individual_migration_quote_matches_instant_apply(
    client, student_token, teacher_token, db, pkg_env, group_setup,
):
    """
    Técnico: GET /cohorts/migration-quote calcula la misma fórmula que la
    aplicación real — se verifica pidiendo la cotización para un paquete
    individual de igual valor al restante del grupal (diff=0, is_instant
    True), y confirmando que el package_change real efectivamente aplica
    instantáneo y libera enrollment.cohort_id.
    UX: el modal de "vista previa" que ve el estudiante antes de migrar de
    grupal a individual debe mostrar exactamente lo que después va a
    pasar de verdad — ni una sorpresa de precio distinto al confirmar.
    """
    # Enrollment grupal directo (sin pasar por /enroll) — precio del
    # paquete grupal $180 por 6 clases = $30/clase, ninguna usada.
    group_enrollment_id = _make_enrollment(
        db, pkg_env, package_id=group_setup["package"]["id"],
        classes_total=group_setup["package"]["classes_count"], cohort_id=group_setup["cohort"]["id"],
    )
    same_value_individual = _create_package(
        client, teacher_token, pkg_env, name="Flow-test individual mismo valor", classes_count=3, price=180.0,
    )

    r_quote = client.get(
        f"/api/v1/cohorts/migration-quote?current_enrollment_id={group_enrollment_id}&new_package_id={same_value_individual['id']}",
        headers=auth_headers(student_token),
    )
    assert r_quote.status_code == 200, r_quote.text
    quote = r_quote.json()
    assert quote["is_instant"] is True
    assert quote["difference_usd"] == 0.0

    r_change = _request_package_change(client, student_token, group_enrollment_id, same_value_individual["id"])
    assert r_change.status_code == 200, r_change.text
    assert "sin costo adicional" in r_change.json()["message"].lower()

    db.expire_all()
    enrollment_db = db.query(Enrollment).filter(Enrollment.id == group_enrollment_id).first()
    assert enrollment_db.package_id == same_value_individual["id"]
    assert enrollment_db.cohort_id is None, "La migración a individual debe liberar cohort_id"


def test_group_to_individual_migration_with_payment_releases_seat_on_approval(
    client, student_token, superadmin_token, teacher_token, db, pkg_env, group_setup,
):
    """
    Técnico: migración grupal->individual con diferencia de precio
    distinta de cero genera Payment (igual que cualquier package_change);
    el cupo de la cohorte (enrollment.cohort_id) solo se libera al
    APROBAR el pago, no antes — verificado consultando get_cohort_active_count
    antes y después de la aprobación.
    UX: mientras el pago de la migración sigue en revisión, el estudiante
    conserva su cupo en el grupo (por si el cambio no se confirma); recién
    se libera cuando el staff aprueba el cambio de verdad.
    """
    group_enrollment_id = _make_enrollment(
        db, pkg_env, package_id=group_setup["package"]["id"],
        classes_total=group_setup["package"]["classes_count"], cohort_id=group_setup["cohort"]["id"],
    )
    pricier_individual = _create_package(
        client, teacher_token, pkg_env, name="Flow-test individual caro", classes_count=3, price=300.0,
    )
    cohort_id = group_setup["cohort"]["id"]
    assert get_cohort_active_count(cohort_id, db) == 1

    r_change = _request_package_change(client, student_token, group_enrollment_id, pricier_individual["id"])
    assert r_change.status_code == 200, r_change.text
    payment_id = r_change.json()["payment_id"]
    _register_payment_cleanup(pkg_env, payment_id)

    # Todavía en revisión: sigue contando como cupo ocupado de la cohorte.
    assert get_cohort_active_count(cohort_id, db) == 1

    r_approve = _approve(client, superadmin_token, payment_id)
    assert r_approve.status_code == 200, r_approve.text

    db.expire_all()
    enrollment_db = db.query(Enrollment).filter(Enrollment.id == group_enrollment_id).first()
    assert enrollment_db.package_id == pricier_individual["id"]
    assert enrollment_db.cohort_id is None
    assert get_cohort_active_count(cohort_id, db) == 0, "Aprobar la migración debe liberar el cupo de la cohorte"


# ─── Grupal -> grupal: sin endpoint dedicado, es "leave" + "enroll" ────────

def test_group_to_group_migration_is_manual_leave_then_enroll(
    client, student_token, superadmin_token, teacher_token, db, pkg_env, group_setup,
):
    """
    Técnico: no existe un endpoint de "cambiar de cohorte" — se confirma
    que la única vía es POST /cohorts/{old}/leave seguido de
    POST /cohorts/{new}/enroll, y que ambas cohortes terminan con el
    conteo de cupo correcto tras la secuencia completa.
    UX: un estudiante que quiere pasarse de un grupo a otro (distinto
    horario/nivel) primero sale del grupo actual y después se anota al
    nuevo — dos pasos explícitos, no un botón mágico de "cambiar de
    grupo" que podría ocultar que también cambia de precio/profesor.
    """
    old_cohort_id = group_setup["cohort"]["id"]
    r_join_old = client.post(
        f"/api/v1/cohorts/{old_cohort_id}/enroll",
        json={"cohort_id": old_cohort_id, "transaction_reference": "flow-tests-g2g-old"},
        headers=auth_headers(student_token),
    )
    old_enrollment_id = r_join_old.json()["enrollment_id"]
    pkg_env["enrollment_ids"].append(old_enrollment_id)
    pkg_env["payment_ids"].append(db.query(Payment).filter(Payment.enrollment_id == old_enrollment_id).first().id)

    new_group_pkg = _create_package(
        client, teacher_token, pkg_env, name="Flow-test grupal 2 (destino)",
        is_group=True, min_students=1, max_students=3, classes_count=6, price=180.0,
    )
    r_new_cohort = client.post("/api/v1/cohorts/", json={
        "package_id": new_group_pkg["id"], "min_students": 1, "max_students": 3,
    }, headers=auth_headers(teacher_token))
    new_cohort_id = r_new_cohort.json()["id"]
    pkg_env["cohort_ids"].append(new_cohort_id)

    r_leave = client.post(f"/api/v1/cohorts/{old_cohort_id}/leave", headers=auth_headers(student_token))
    assert r_leave.status_code == 200, r_leave.text

    r_join_new = client.post(
        f"/api/v1/cohorts/{new_cohort_id}/enroll",
        json={"cohort_id": new_cohort_id, "transaction_reference": "flow-tests-g2g-new"},
        headers=auth_headers(student_token),
    )
    assert r_join_new.status_code == 201, r_join_new.text
    new_enrollment_id = r_join_new.json()["enrollment_id"]
    pkg_env["enrollment_ids"].append(new_enrollment_id)
    pkg_env["payment_ids"].append(db.query(Payment).filter(Payment.enrollment_id == new_enrollment_id).first().id)

    assert get_cohort_active_count(old_cohort_id, db) == 0
    assert get_cohort_active_count(new_cohort_id, db) == 1
