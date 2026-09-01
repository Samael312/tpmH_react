"""
Suite: Cohortes grupales — alta de integrantes en vivo y migración
grupo -> individual.

Cubre dos cosas pedidas explícitamente:

1. GET /cohorts/{id}/members: el profesor debe poder ver, mientras la
   cohorte todavía está "filling", quiénes se van uniendo (no solo el
   contador current_students/max_students).

2. Regresión del bug real encontrado en `_apply_instant_switch_to_unlimited`
   (app/api/v1/endpoints/payments.py): al migrar un enrollment grupal a un
   paquete individual ILIMITADO por la vía instantánea (sin cobro
   adicional), el enrollment quedaba con `cohort_id` todavía seteado —
   el alumno seguía figurando como integrante activo del grupo
   (get_cohort_active_count) y el banner del estudiante seguía
   mostrando el panel de espera grupal en vez del individual. Un alumno
   no puede tener un paquete individual y seguir dentro de una cohorte
   al mismo tiempo.
"""
import pytest

from app.models.teacher import TeacherProfile
from app.models.student import StudentProfile
from app.models.package import Package, Enrollment
from app.models.group_cohort import GroupCohort
from app.models.payment import Payment
from tests.flow import constants as C
from tests.flow.conftest import auth_headers

pytestmark = [pytest.mark.integration, pytest.mark.destructive]


@pytest.fixture
def clean_cohort_slate(db, fixed_users, volatile):
    """
    Red de seguridad: borra cualquier Payment/Enrollment/GroupCohort/Package
    del par profesor-alumno fijo que haya quedado de este test, sin importar
    en qué punto haya fallado.
    """
    teacher = db.query(TeacherProfile).filter(TeacherProfile.user_id == fixed_users["teacher"].id).first()
    student = db.query(StudentProfile).filter(StudentProfile.user_id == fixed_users["student"].id).first()
    state = {"teacher_id": teacher.id, "student_id": student.id, "package_ids": []}

    def _cleanup():
        from app.db.base import SessionLocal
        s = SessionLocal()
        try:
            s.query(Payment).filter(Payment.student_id == state["student_id"]).delete(synchronize_session=False)
            s.query(Enrollment).filter(
                Enrollment.teacher_id == state["teacher_id"], Enrollment.student_id == state["student_id"]
            ).delete(synchronize_session=False)
            s.query(GroupCohort).filter(GroupCohort.teacher_id == state["teacher_id"]).delete(synchronize_session=False)
            if state["package_ids"]:
                s.query(Package).filter(Package.id.in_(state["package_ids"])).delete(synchronize_session=False)
            s.commit()
        finally:
            s.close()

    volatile.custom(
        _cleanup,
        label="limpieza total: payments/enrollments/cohortes/paquetes del par profesor-estudiante fijo",
    )
    return state


def _create_group_package(client, teacher_token, clean_cohort_slate, **overrides):
    payload = {
        "name": "Flow-test grupal", "subject": "English", "price": 80.0,
        "classes_count": 8, "duration_minutes": 50,
        "is_group": True, "min_students": 1, "max_students": 6,
    }
    payload.update(overrides)
    r = client.post("/api/v1/packages/", json=payload, headers=auth_headers(teacher_token))
    assert r.status_code == 201, r.text
    package_id = r.json()["id"]
    clean_cohort_slate["package_ids"].append(package_id)
    return package_id


def test_cohort_members_endpoint_shows_students_while_filling(
    client, teacher_token, student_token, fixed_users, clean_cohort_slate,
):
    """
    Técnico: GET /cohorts/{id}/members antes de que exista ningún estudiante
    inscrito devuelve []; tras un POST /cohorts/{id}/enroll del alumno,
    el mismo endpoint devuelve ese alumno de inmediato (nombre y
    payment_status="unpaid"), sin que exista ninguna sesión/Class
    agendada todavía (la cohorte sigue en status "filling"). También
    verifica que GET /cohorts/teacher refleja el current_students
    actualizado.
    UX: pantalla "Mis grupos" del profesor. Antes solo se veía un
    contador (2/6); ahora, mientras el grupo se va llenando, el
    profesor puede abrir la cohorte y ver en vivo quiénes se fueron
    uniendo, sin esperar a que el grupo se complete.
    """
    package_id = _create_group_package(client, teacher_token, clean_cohort_slate)

    r_cohort = client.post("/api/v1/cohorts/", json={
        "package_id": package_id, "min_students": 1, "max_students": 6,
    }, headers=auth_headers(teacher_token))
    assert r_cohort.status_code == 201, r_cohort.text
    cohort = r_cohort.json()
    assert cohort["status"] == "filling"
    assert cohort["current_students"] == 0
    cohort_id = cohort["id"]

    # Antes de que nadie se inscriba, la lista de integrantes está vacía.
    r_members_empty = client.get(f"/api/v1/cohorts/{cohort_id}/members", headers=auth_headers(teacher_token))
    assert r_members_empty.status_code == 200, r_members_empty.text
    assert r_members_empty.json() == []

    r_enroll = client.post(f"/api/v1/cohorts/{cohort_id}/enroll", json={
        "cohort_id": cohort_id, "transaction_reference": "flow-tests-cohort-ref",
    }, headers=auth_headers(student_token))
    assert r_enroll.status_code == 201, r_enroll.text

    # El profesor debe ver al alumno de inmediato, con pago pendiente,
    # SIN que exista todavía ninguna sesión/Class agendada.
    r_members = client.get(f"/api/v1/cohorts/{cohort_id}/members", headers=auth_headers(teacher_token))
    assert r_members.status_code == 200, r_members.text
    members = r_members.json()
    assert len(members) == 1
    assert members[0]["student_name"] == f"{C.STUDENT['name']} {C.STUDENT['surname']}"
    assert members[0]["payment_status"] == "unpaid"

    # El contador de la cohorte también refleja al integrante ya inscrito.
    r_cohorts_list = client.get("/api/v1/cohorts/teacher", headers=auth_headers(teacher_token))
    assert r_cohorts_list.status_code == 200
    refreshed = next(c for c in r_cohorts_list.json() if c["id"] == cohort_id)
    assert refreshed["current_students"] == 1


def test_group_to_individual_unlimited_migration_releases_cohort_seat(
    client, db, teacher_token, student_token, superadmin_token, fixed_users, clean_cohort_slate,
):
    """
    Técnico: BUG real encontrado en `_apply_instant_switch_to_unlimited`
    (app/api/v1/endpoints/payments.py) — era la única rama de cambio
    instantáneo de paquete que no liberaba el cupo de la cohorte. Un
    alumno inscrito en un grupo (cohort_id seteado) migra vía
    POST /payments/notify-payment {type: "package_change"} a un
    paquete individual ILIMITADO del mismo profesor, de forma
    instantánea (sin cobro adicional). Verifica que tras la migración:
    (1) el enrollment queda con cohort_id=None y prepaid_unlimited_credits
    igual a los créditos que le quedaban sin usar, (2) GET
    /cohorts/{id}/members ya no lo lista, y (3) GET /cohorts/teacher
    refleja current_students en 0. Antes del fix, las tres seguían
    contando al alumno como parte del grupo.
    UX: un alumno no puede tener un paquete individual y seguir figurando
    dentro de un grupo al mismo tiempo. Antes del fix, el banner del
    estudiante seguía mostrando el panel de espera grupal (en vez del de
    paquete individual) y el profesor seguía viendo a ese alumno como
    integrante activo del grupo, ocupando un cupo que ya no le
    correspondía.
    """
    group_package_id = _create_group_package(client, teacher_token, clean_cohort_slate)

    r_cohort = client.post("/api/v1/cohorts/", json={
        "package_id": group_package_id, "min_students": 1, "max_students": 6,
    }, headers=auth_headers(teacher_token))
    assert r_cohort.status_code == 201, r_cohort.text
    cohort_id = r_cohort.json()["id"]

    r_enroll = client.post(f"/api/v1/cohorts/{cohort_id}/enroll", json={
        "cohort_id": cohort_id, "transaction_reference": "flow-tests-cohort-ref-2",
    }, headers=auth_headers(student_token))
    assert r_enroll.status_code == 201, r_enroll.text
    enrollment_id = r_enroll.json()["enrollment_id"]

    # Staff aprueba el pago de inscripción a la cohorte -> queda "paid".
    r_pending = client.get("/api/v1/payments/pending-review", headers=auth_headers(superadmin_token))
    assert r_pending.status_code == 200
    student_username = fixed_users["student"].username
    pending = [
        p for p in r_pending.json()
        if p["payment_type"] == "group_enrollment" and p["student_username"] == student_username
    ]
    assert len(pending) == 1, f"Se esperaba 1 pago pendiente de group_enrollment: {r_pending.json()}"
    payment_id = pending[0]["payment_id"]

    r_validate = client.patch(f"/api/v1/payments/{payment_id}/validate", json={
        "action": "approve",
    }, headers=auth_headers(superadmin_token))
    assert r_validate.status_code == 200, r_validate.text

    # Paquete individual ilimitado del mismo profesor, destino de la migración.
    unlimited_package_id = _create_group_package(
        client, teacher_token, clean_cohort_slate,
        name="Flow-test individual ilimitado", is_group=False,
        min_students=None, max_students=None, classes_count=None,
        price=100.0,
    )

    # Confirma el estado ANTES de migrar: 1 integrante activo en la cohorte.
    r_members_before = client.get(f"/api/v1/cohorts/{cohort_id}/members", headers=auth_headers(teacher_token))
    assert len(r_members_before.json()) == 1

    # Migración instantánea grupo -> individual ilimitado (sin costo
    # adicional porque no se usó ningún crédito todavía).
    r_migrate = client.post("/api/v1/payments/notify-payment", json={
        "type": "package_change",
        "enrollment_id": enrollment_id,
        "package_id": unlimited_package_id,
    }, headers=auth_headers(student_token))
    assert r_migrate.status_code == 200, r_migrate.text
    assert "ilimitado" in r_migrate.json()["message"].lower()

    # 1) El enrollment del alumno ya no está linkeado a la cohorte.
    r_my_enrollments = client.get("/api/v1/packages/my-enrollments", headers=auth_headers(student_token))
    assert r_my_enrollments.status_code == 200
    updated = next(e for e in r_my_enrollments.json() if e["id"] == enrollment_id)
    assert updated["package_id"] == unlimited_package_id
    assert updated["cohort_id"] is None, (
        "BUG: el enrollment sigue linkeado a la cohorte tras migrar a un paquete individual"
    )
    assert updated["prepaid_unlimited_credits"] == 8

    # 2) El profesor ya NO ve a este alumno como integrante del grupo.
    r_members_after = client.get(f"/api/v1/cohorts/{cohort_id}/members", headers=auth_headers(teacher_token))
    assert r_members_after.status_code == 200
    assert r_members_after.json() == [], (
        "BUG: el alumno sigue apareciendo como integrante de la cohorte después de migrar a individual"
    )

    r_cohorts_list = client.get("/api/v1/cohorts/teacher", headers=auth_headers(teacher_token))
    refreshed = next(c for c in r_cohorts_list.json() if c["id"] == cohort_id)
    assert refreshed["current_students"] == 0, (
        "BUG: el contador de la cohorte sigue contando al alumno que ya migró a individual"
    )


def test_cohort_close_and_cancel(
    client, teacher_token, student_token, clean_cohort_slate,
):
    """
    Técnico: dos ciclos de vida distintos de una cohorte "filling":
    (a) POST /cohorts/{id}/close sin ningún integrante -> 400 (hay que
    cancelarla, no cerrarla); con 1 integrante -> 200, status pasa a
    "confirmed" con closed_at seteado, y un segundo close sobre la misma
    cohorte -> 400 (ya no está "filling"). El/la integrante sigue
    apareciendo en /cohorts/{id}/members (cerrar no cancela a nadie).
    (b) En una cohorte distinta, POST /cohorts/{id}/cancel con 1
    integrante -> 200, status pasa a "cancelled", y ese integrante
    desaparece de /cohorts/{id}/members y de current_students porque
    cancel_cohort cancela también su Enrollment (status="cancelled",
    cohort_id=None vía release_cohort_seat) — a diferencia de close, que
    preserva los enrollments intactos.
    UX: en "Mis grupos" el profesor puede cerrar un grupo con los
    alumnos que ya tiene (sin esperar el mínimo) para arrancarlo, o
    cancelarlo si no prosperó — dejando a cada alumno libre de elegir
    otro paquete en cualquiera de los dos casos.
    """
    # ── (a) Cerrar ──
    package_id = _create_group_package(client, teacher_token, clean_cohort_slate)

    r_cohort_a = client.post("/api/v1/cohorts/", json={
        "package_id": package_id, "min_students": 2, "max_students": 6,
    }, headers=auth_headers(teacher_token))
    assert r_cohort_a.status_code == 201, r_cohort_a.text
    cohort_a_id = r_cohort_a.json()["id"]

    r_close_empty = client.post(f"/api/v1/cohorts/{cohort_a_id}/close", json={
        "start_date": "2026-01-15T15:00:00Z",
    }, headers=auth_headers(teacher_token))
    assert r_close_empty.status_code == 400, r_close_empty.text

    r_enroll_a = client.post(f"/api/v1/cohorts/{cohort_a_id}/enroll", json={
        "cohort_id": cohort_a_id, "transaction_reference": "flow-tests-close-ref",
    }, headers=auth_headers(student_token))
    assert r_enroll_a.status_code == 201, r_enroll_a.text

    r_close = client.post(f"/api/v1/cohorts/{cohort_a_id}/close", json={
        "start_date": "2026-01-15T15:00:00Z",
    }, headers=auth_headers(teacher_token))
    assert r_close.status_code == 200, r_close.text
    closed = r_close.json()
    assert closed["status"] == "confirmed"
    assert closed["closed_at"] is not None

    # No se puede volver a cerrar una cohorte que ya no está "filling".
    r_close_again = client.post(f"/api/v1/cohorts/{cohort_a_id}/close", json={
        "start_date": "2026-01-15T15:00:00Z",
    }, headers=auth_headers(teacher_token))
    assert r_close_again.status_code == 400, r_close_again.text

    # Cerrar NO cancela al alumno: sigue siendo integrante activo.
    r_members_a = client.get(f"/api/v1/cohorts/{cohort_a_id}/members", headers=auth_headers(teacher_token))
    assert len(r_members_a.json()) == 1

    # Libero el enrollment del alumno para poder reutilizarlo en la parte (b).
    r_leave = client.post(f"/api/v1/cohorts/{cohort_a_id}/leave", headers=auth_headers(student_token))
    assert r_leave.status_code == 200, r_leave.text

    # ── (b) Cancelar ──
    r_cohort_b = client.post("/api/v1/cohorts/", json={
        "package_id": package_id, "min_students": 2, "max_students": 6,
    }, headers=auth_headers(teacher_token))
    assert r_cohort_b.status_code == 201, r_cohort_b.text
    cohort_b_id = r_cohort_b.json()["id"]

    r_enroll_b = client.post(f"/api/v1/cohorts/{cohort_b_id}/enroll", json={
        "cohort_id": cohort_b_id, "transaction_reference": "flow-tests-cancel-ref",
    }, headers=auth_headers(student_token))
    assert r_enroll_b.status_code == 201, r_enroll_b.text
    enrollment_b_id = r_enroll_b.json()["enrollment_id"]

    r_members_b_before = client.get(f"/api/v1/cohorts/{cohort_b_id}/members", headers=auth_headers(teacher_token))
    assert len(r_members_b_before.json()) == 1

    r_cancel = client.post(f"/api/v1/cohorts/{cohort_b_id}/cancel", headers=auth_headers(teacher_token))
    assert r_cancel.status_code == 200, r_cancel.text
    assert r_cancel.json()["status"] == "cancelled"

    # El alumno desaparece como integrante activo...
    r_members_b_after = client.get(f"/api/v1/cohorts/{cohort_b_id}/members", headers=auth_headers(teacher_token))
    assert r_members_b_after.json() == []

    r_cohorts_list = client.get("/api/v1/cohorts/teacher", headers=auth_headers(teacher_token))
    refreshed_b = next(c for c in r_cohorts_list.json() if c["id"] == cohort_b_id)
    assert refreshed_b["current_students"] == 0

    # ...porque cancel_cohort cancela también su Enrollment por completo
    # (no solo lo saca del grupo): queda libre para elegir un paquete nuevo.
    r_my_enrollments = client.get("/api/v1/packages/my-enrollments", headers=auth_headers(student_token))
    cancelled_enrollment = next(e for e in r_my_enrollments.json() if e["id"] == enrollment_b_id)
    assert cancelled_enrollment["status"] == "cancelled"
    assert cancelled_enrollment["cohort_id"] is None


def test_pending_group_enrollment_payment_rejection(
    client, teacher_token, student_token, fixed_users, clean_cohort_slate,
):
    """
    Técnico: PATCH /payments/{id}/validate {action: "reject"} sin
    rejection_reason -> 400; con rejection_reason -> 200, el pago pasa a
    status="rejected" y deja de listarse en GET /payments/pending-review.
    El profesor (no solo staff/superadmin) puede rechazar el pago de su
    propio alumno vía get_current_staff_or_teacher. A diferencia del
    rechazo de una renovación/cambio de paquete (que sí revierte el
    enrollment a "active" automáticamente, ver fix de payments.py), un
    group_enrollment rechazado NO tiene ese revert: el enrollment queda
    activo con payment_status="unpaid" y el alumno sigue figurando en
    /cohorts/{id}/members — documentado acá tal cual se comporta hoy.
    UX: el profesor rechaza una inscripción a su grupo (ej. comprobante
    de pago inválido) indicando el motivo; el alumno recibe el email de
    pago rechazado con ese motivo y puede volver a enviar el comprobante
    correcto sin perder su lugar en el grupo.
    """
    package_id = _create_group_package(client, teacher_token, clean_cohort_slate)

    r_cohort = client.post("/api/v1/cohorts/", json={
        "package_id": package_id, "min_students": 1, "max_students": 6,
    }, headers=auth_headers(teacher_token))
    assert r_cohort.status_code == 201, r_cohort.text
    cohort_id = r_cohort.json()["id"]

    r_enroll = client.post(f"/api/v1/cohorts/{cohort_id}/enroll", json={
        "cohort_id": cohort_id, "transaction_reference": "flow-tests-reject-ref",
    }, headers=auth_headers(student_token))
    assert r_enroll.status_code == 201, r_enroll.text
    enrollment_id = r_enroll.json()["enrollment_id"]

    r_pending = client.get("/api/v1/payments/pending-review", headers=auth_headers(teacher_token))
    student_username = fixed_users["student"].username
    pending = [
        p for p in r_pending.json()
        if p["payment_type"] == "group_enrollment" and p["student_username"] == student_username
    ]
    assert len(pending) == 1, f"Se esperaba 1 pago pendiente de group_enrollment: {r_pending.json()}"
    payment_id = pending[0]["payment_id"]

    # Rechazar sin motivo -> 400.
    r_reject_no_reason = client.patch(f"/api/v1/payments/{payment_id}/validate", json={
        "action": "reject",
    }, headers=auth_headers(teacher_token))
    assert r_reject_no_reason.status_code == 400, r_reject_no_reason.text

    # Rechazar con motivo -> 200. El profesor de ese alumno puede rechazar
    # directamente (no hace falta ser superadmin/teacher_admin).
    r_reject = client.patch(f"/api/v1/payments/{payment_id}/validate", json={
        "action": "reject", "rejection_reason": "Comprobante de transferencia ilegible",
    }, headers=auth_headers(teacher_token))
    assert r_reject.status_code == 200, r_reject.text
    assert r_reject.json()["message"] == "Pago rechazado"

    # Ya no aparece como pendiente de revisión.
    r_pending_after = client.get("/api/v1/payments/pending-review", headers=auth_headers(teacher_token))
    still_pending = [p for p in r_pending_after.json() if p["payment_id"] == payment_id]
    assert still_pending == []

    # No se puede rechazar dos veces el mismo pago (ya no está pending_review).
    r_reject_again = client.patch(f"/api/v1/payments/{payment_id}/validate", json={
        "action": "reject", "rejection_reason": "Intento repetido",
    }, headers=auth_headers(teacher_token))
    assert r_reject_again.status_code == 404, r_reject_again.text

    # El enrollment sigue activo (no se cancela automáticamente para
    # group_enrollment) y el alumno sigue viéndose como integrante del
    # grupo, ahora con el pago marcado como no pagado.
    r_members = client.get(f"/api/v1/cohorts/{cohort_id}/members", headers=auth_headers(teacher_token))
    members = r_members.json()
    assert len(members) == 1
    assert members[0]["enrollment_id"] == enrollment_id
    assert members[0]["payment_status"] == "unpaid"
