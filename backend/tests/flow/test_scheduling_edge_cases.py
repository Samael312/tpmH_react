"""
Suite: Edge cases de agendado y cancelación de clases.

Complementa el camino feliz de test_purchase_flow.py con los rechazos y
casos límite de POST /payments/book, DELETE /classes/{id} y
PATCH /classes/{id}/reschedule: antelación mínima, choques de horario,
créditos agotados, y las ventanas de 12h para cancelar/reagendar.

Igual que en test_package_change.py, el enrollment de partida se inserta
directo por ORM (ya activo y pagado) para no repetir todo el flujo de
compra en cada escenario — eso ya se prueba a fondo en
test_purchase_flow.py.
"""
import logging
from datetime import datetime, timedelta, timezone as tz

import pytest

from app.models.teacher import TeacherProfile
from app.models.student import StudentProfile
from app.models.package import Package, Enrollment, EnrollmentStatus
from app.models.class_ import Class, ClassType
from app.models.payment import Payment
from app.models.availability import TeacherAvailability
from tests.flow.conftest import auth_headers

pytestmark = pytest.mark.integration

logger = logging.getLogger("flow_tests")


@pytest.fixture
def sched_env(client, db, teacher_token, fixed_users, volatile):
    """
    Disponibilidad todo el día/toda la semana (para no pelear con huecos)
    + tracker de limpieza en el mismo espíritu que test_package_change.py:
    cada borrado con su propio commit, en orden seguro de FKs.
    """
    teacher = db.query(TeacherProfile).filter(TeacherProfile.user_id == fixed_users["teacher"].id).first()
    student = db.query(StudentProfile).filter(StudentProfile.user_id == fixed_users["student"].id).first()

    r = client.put("/api/v1/availability/me/weekly", json={
        "timezone": "UTC",
        "slots": [{"day_of_week": d, "start_time_local": "00:00", "end_time_local": "23:59"} for d in range(7)],
    }, headers=auth_headers(teacher_token))
    assert r.status_code == 200, r.text

    # get_student_booking_stage exige una prueba YA COMPLETADA con este
    # profesor antes de permitir reservas "regulares" — sin esto, la
    # primera reserva de cada test caería siempre en la rama de prueba
    # gratuita (ignorando cualquier enrollment_id), sin importar qué
    # paquete se haya armado para el test. Se inserta directo por ORM
    # (equivalente a "ya hizo la prueba hace tiempo").
    past_trial = Class(
        teacher_id=teacher.id, student_id=student.id,
        class_type=ClassType.trial, status="completed",
        start_time_utc=datetime.now(tz.utc) - timedelta(days=30),
        end_time_utc=datetime.now(tz.utc) - timedelta(days=30) + timedelta(minutes=25),
        duration=25,
    )
    db.add(past_trial)
    db.commit()

    tracked = {
        "teacher_id": teacher.id, "student_id": student.id,
        "payment_ids": [], "class_ids": [], "enrollment_ids": [], "package_ids": [],
    }

    def _cleanup():
        from app.db.base import SessionLocal
        s = SessionLocal()

        def _run(label, fn):
            try:
                fn()
                s.commit()
            except Exception:
                s.rollback()
                logger.exception("Paso de limpieza falló (%s) en test_scheduling_edge_cases", label)

        try:
            if tracked["enrollment_ids"]:
                _run("payments-por-enrollment", lambda: s.query(Payment).filter(
                    Payment.enrollment_id.in_(tracked["enrollment_ids"])
                ).delete(synchronize_session=False))
            if tracked["payment_ids"]:
                _run("payments-por-id", lambda: s.query(Payment).filter(
                    Payment.id.in_(tracked["payment_ids"])
                ).delete(synchronize_session=False))
            if tracked["class_ids"] or tracked["enrollment_ids"]:
                _run("classes", lambda: s.query(Class).filter(
                    Class.teacher_id == teacher.id, Class.student_id == student.id,
                ).delete(synchronize_session=False))
            if tracked["enrollment_ids"]:
                _run("enrollments", lambda: s.query(Enrollment).filter(
                    Enrollment.id.in_(tracked["enrollment_ids"])
                ).delete(synchronize_session=False))
            if tracked["package_ids"]:
                _run("packages", lambda: s.query(Package).filter(
                    Package.id.in_(tracked["package_ids"])
                ).delete(synchronize_session=False))
            _run("disponibilidad", lambda: s.query(TeacherAvailability).filter(
                TeacherAvailability.teacher_id == teacher.id
            ).delete(synchronize_session=False))
        finally:
            s.close()

    volatile.custom(_cleanup, label="limpieza total de test_scheduling_edge_cases")
    return tracked


def _create_package(client, teacher_token, tracked, **overrides):
    payload = {"name": "Flow-test sched package", "subject": "English", "price": 100.0, "classes_count": 4, "duration_minutes": 50}
    payload.update(overrides)
    r = client.post("/api/v1/packages/", json=payload, headers=auth_headers(teacher_token))
    assert r.status_code == 201, r.text
    tracked["package_ids"].append(r.json()["id"])
    return r.json()


def _make_active_enrollment(db, tracked, package, unlocked_credits=None):
    enrollment = Enrollment(
        student_id=tracked["student_id"], teacher_id=tracked["teacher_id"], package_id=package["id"],
        classes_used=0, classes_total=package["classes_count"],
        unlocked_credits=unlocked_credits if unlocked_credits is not None else package["classes_count"],
        payment_status="paid", status=EnrollmentStatus.active,
    )
    db.add(enrollment)
    db.commit()
    db.refresh(enrollment)
    tracked["enrollment_ids"].append(enrollment.id)
    return enrollment.id


def _book(client, student_token, enrollment_id, start, duration=50):
    return client.post("/api/v1/payments/book", json={
        "enrollment_id": enrollment_id,
        "start_time_utc": start.isoformat(),
        "end_time_utc": (start + timedelta(minutes=duration)).isoformat(),
        "duration_minutes": duration,
    }, headers=auth_headers(student_token))


def _future(days=5, hour=10):
    return (datetime.now(tz.utc) + timedelta(days=days)).replace(hour=hour, minute=0, second=0, microsecond=0)


# ─── Antelación mínima y créditos agotados ─────────────────────────────────

def test_booking_rejects_less_than_minimum_notice(client, student_token, teacher_token, db, sched_env):
    """
    Técnico: reservar una clase regular con una hora de inicio a menos de
    MIN_BOOKING_HOURS (1h por defecto) de distancia devuelve 409 — el
    chequeo de antelación vive dentro de can_book_slot, la misma función
    que valida choques de horario, así que book_class envuelve cualquier
    falla suya (antelación o choque) como 409, no 400.
    UX: evita que un estudiante intente agendar "para ya mismo" sin darle
    al profesor ningún margen para prepararse o reorganizar su agenda.
    """
    pkg = _create_package(client, teacher_token, sched_env)
    enrollment_id = _make_active_enrollment(db, sched_env, pkg)

    too_soon = datetime.now(tz.utc) + timedelta(minutes=10)
    r = _book(client, student_token, enrollment_id, too_soon)
    assert r.status_code == 409
    assert "antelación" in r.text.lower()


def test_booking_rejects_when_no_credits_left(client, student_token, teacher_token, db, sched_env):
    """
    Técnico: un enrollment con unlocked_credits ya igualado por clases
    ocupadas (occupied_slots >= unlocked_credits) devuelve 400 al intentar
    reservar una clase regular más.
    UX: el estudiante debe ver un mensaje claro de "ya no te quedan
    créditos" en vez de que el botón de reservar falle sin explicación —
    lo guía a renovar o cambiar de paquete.
    """
    pkg = _create_package(client, teacher_token, sched_env, classes_count=1)
    # unlocked_credits=1 y ya hay un crédito "ocupado" -> 0 disponibles.
    enrollment_id = _make_active_enrollment(db, sched_env, pkg, unlocked_credits=1)
    used_class = Class(
        teacher_id=sched_env["teacher_id"], student_id=sched_env["student_id"], enrollment_id=enrollment_id,
        class_type=ClassType.regular, status="completed",
        start_time_utc=datetime.now(tz.utc) - timedelta(days=1),
        end_time_utc=datetime.now(tz.utc) - timedelta(days=1) + timedelta(minutes=50), duration=50,
    )
    db.add(used_class)
    db.commit()
    sched_env["class_ids"].append(used_class.id)

    r = _book(client, student_token, enrollment_id, _future())
    assert r.status_code == 400
    assert "créditos disponibles" in r.text.lower()


def test_booking_rejects_unpaid_enrollment(client, student_token, teacher_token, db, sched_env):
    """
    Técnico: al pasar un enrollment_id cuyo payment_status="unpaid",
    get_student_booking_stage lo detecta ANTES de llegar a la rama
    "ready" — lo cancela automáticamente (queda obsoleto, nadie va a
    pagarlo) y redirige a needs_package, así que book_class responde 400
    pidiendo elegir un paquete, no el mensaje literal de "unpaid" que
    vive más abajo en el código como chequeo defensivo redundante.
    UX: el estudiante ve "elegí un paquete" en vez de quedar con una
    reserva fantasma atada a un pago que nunca se confirmó ni se va a
    confirmar.
    """
    pkg = _create_package(client, teacher_token, sched_env)
    enrollment = Enrollment(
        student_id=sched_env["student_id"], teacher_id=sched_env["teacher_id"], package_id=pkg["id"],
        classes_used=0, classes_total=pkg["classes_count"], unlocked_credits=pkg["classes_count"],
        payment_status="unpaid", status=EnrollmentStatus.active,
    )
    db.add(enrollment)
    db.commit()
    db.refresh(enrollment)
    sched_env["enrollment_ids"].append(enrollment.id)

    r = _book(client, student_token, enrollment.id, _future())
    assert r.status_code == 400
    assert "paquete" in r.text.lower()

    db.expire_all()
    enrollment_db = db.query(Enrollment).filter(Enrollment.id == enrollment.id).first()
    assert enrollment_db.status == EnrollmentStatus.cancelled, (
        "El enrollment 'unpaid' obsoleto debería auto-cancelarse al detectarlo"
    )


# ─── Choques de horario (double-booking) ───────────────────────────────────

def test_booking_rejects_teacher_double_booking(client, student_token, teacher_token, db, sched_env):
    """
    Técnico: reservar dos clases del mismo profesor con horarios
    solapados (incluyendo su margen de preparación) devuelve 409, no 400
    — es un conflicto de agenda, no una validación de datos.
    UX: el profesor nunca debería terminar con dos clases pisadas en su
    calendario por una condición de carrera entre dos estudiantes
    reservando casi al mismo tiempo.
    """
    pkg = _create_package(client, teacher_token, sched_env, classes_count=4)
    enrollment_id = _make_active_enrollment(db, sched_env, pkg)

    start = _future(days=6)
    r1 = _book(client, student_token, enrollment_id, start)
    assert r1.status_code == 201, r1.text
    sched_env["class_ids"].append(r1.json()["class_id"])

    # Mismo horario exacto -> debe chocar con la clase recién creada.
    r2 = _book(client, student_token, enrollment_id, start)
    assert r2.status_code == 409
    assert "ya tiene una clase" in r2.text.lower()


def test_booking_rejects_student_double_booking_across_enrollments(
    client, student_token, teacher_token, db, sched_env,
):
    """
    Técnico: el mismo estudiante no puede reservar dos clases superpuestas
    aunque sean de dos enrollments/paquetes distintos. En este caso ambos
    paquetes son con el mismo profesor fijo, así que el choque lo detecta
    primero el chequeo del PROFESOR (mismo resultado práctico: 409); con
    dos profesores distintos sería el chequeo del estudiante el que
    dispararía, con otro mensaje — de cualquier forma, la reserva se
    rechaza.
    UX: un estudiante no puede "estar" en dos clases a la vez, sin
    importar si son con paquetes diferentes.
    """
    pkg1 = _create_package(client, teacher_token, sched_env, name="Flow-test sched pkg 1", classes_count=4)
    pkg2 = _create_package(client, teacher_token, sched_env, name="Flow-test sched pkg 2", classes_count=4)
    enrollment1 = _make_active_enrollment(db, sched_env, pkg1)
    enrollment2 = _make_active_enrollment(db, sched_env, pkg2)

    start = _future(days=7)
    r1 = _book(client, student_token, enrollment1, start)
    assert r1.status_code == 201, r1.text
    sched_env["class_ids"].append(r1.json()["class_id"])

    r2 = _book(client, student_token, enrollment2, start)
    assert r2.status_code == 409


# ─── Cancelación: ventana de 12h y devolución de crédito ───────────────────

def test_cancel_with_enough_notice_returns_credit(client, student_token, teacher_token, db, sched_env):
    """
    Técnico: cancelar una clase con más de MIN_CANCEL_HOURS (12h) de
    antelación devuelve 200 y libera el crédito — verificado reservando
    de nuevo con el mismo enrollment justo después (si el crédito no se
    hubiera devuelto, la segunda reserva fallaría por "sin créditos").
    UX: cancelar con tiempo de sobra no debería costarle al estudiante
    una clase de su paquete — puede volver a agendar esa clase para otro
    momento.
    """
    pkg = _create_package(client, teacher_token, sched_env, classes_count=1)
    enrollment_id = _make_active_enrollment(db, sched_env, pkg, unlocked_credits=1)

    start = _future(days=8)
    r_book = _book(client, student_token, enrollment_id, start)
    assert r_book.status_code == 201, r_book.text
    class_id = r_book.json()["class_id"]
    sched_env["class_ids"].append(class_id)

    r_cancel = client.delete(f"/api/v1/classes/{class_id}", headers=auth_headers(student_token))
    assert r_cancel.status_code == 200, r_cancel.text

    db.expire_all()
    class_db = db.query(Class).filter(Class.id == class_id).first()
    assert class_db.status == "cancelled"

    # El crédito debería estar libre de nuevo -> esta segunda reserva
    # (otro horario) tiene que poder crearse sin "sin créditos disponibles".
    r_rebook = _book(client, student_token, enrollment_id, _future(days=9))
    assert r_rebook.status_code == 201, r_rebook.text
    sched_env["class_ids"].append(r_rebook.json()["class_id"])


def test_cancel_rejects_less_than_minimum_notice(client, student_token, teacher_token, db, sched_env):
    """
    Técnico: cancelar una clase a menos de MIN_CANCEL_HOURS (12h) de su
    inicio devuelve 400 — se crea la clase directo por ORM en un horario
    cercano para forzar el escenario (agendarla por API ya requeriría
    sortear la antelación mínima de reserva, que es más corta).
    UX: cancelaciones de último momento no se pueden hacer solas desde la
    app — el estudiante debe contactar al profesor directamente, como
    indica el mensaje de error.
    """
    pkg = _create_package(client, teacher_token, sched_env, classes_count=2)
    enrollment_id = _make_active_enrollment(db, sched_env, pkg)

    soon_start = datetime.now(tz.utc) + timedelta(hours=3)
    class_obj = Class(
        teacher_id=sched_env["teacher_id"], student_id=sched_env["student_id"], enrollment_id=enrollment_id,
        class_type=ClassType.regular, status="confirmed",
        start_time_utc=soon_start, end_time_utc=soon_start + timedelta(minutes=50), duration=50,
    )
    db.add(class_obj)
    db.commit()
    sched_env["class_ids"].append(class_obj.id)

    r_cancel = client.delete(f"/api/v1/classes/{class_obj.id}", headers=auth_headers(student_token))
    assert r_cancel.status_code == 400
    assert "antelación" in r_cancel.text.lower()


def test_cancel_rejects_already_cancelled_class(client, student_token, teacher_token, db, sched_env):
    """
    Técnico: cancelar una clase que ya está "cancelled" devuelve 400, no
    un 200 idempotente ni un 404 — el mensaje aclara que ese estado no es
    cancelable.
    UX: evita doble-clic accidental generando un error confuso; dos
    intentos de cancelar la misma clase dan un mensaje consistente.
    """
    pkg = _create_package(client, teacher_token, sched_env, classes_count=2)
    enrollment_id = _make_active_enrollment(db, sched_env, pkg)

    start = _future(days=10)
    r_book = _book(client, student_token, enrollment_id, start)
    class_id = r_book.json()["class_id"]
    sched_env["class_ids"].append(class_id)

    r_first = client.delete(f"/api/v1/classes/{class_id}", headers=auth_headers(student_token))
    assert r_first.status_code == 200

    r_second = client.delete(f"/api/v1/classes/{class_id}", headers=auth_headers(student_token))
    assert r_second.status_code == 400


# ─── Reagendado: ventana de 12h y choques de horario ───────────────────────

def test_reschedule_with_enough_notice_succeeds(client, student_token, teacher_token, db, sched_env):
    """
    Técnico: reagendar una clase confirmada a un horario distinto (con
    antelación suficiente y sin choques) devuelve 200 con el nuevo
    start_time_utc reflejado — y el status se conserva (no vuelve a
    "pending").
    UX: el estudiante puede mover una clase a otro horario libre sin
    perder el crédito ni el estado de "confirmada" (con Meet link, si ya
    tenía uno).
    """
    pkg = _create_package(client, teacher_token, sched_env, classes_count=2)
    enrollment_id = _make_active_enrollment(db, sched_env, pkg)

    start = _future(days=11)
    r_book = _book(client, student_token, enrollment_id, start)
    class_id = r_book.json()["class_id"]
    sched_env["class_ids"].append(class_id)

    new_start = _future(days=12)
    r_resched = client.patch(f"/api/v1/classes/{class_id}/reschedule", json={
        "start_time_utc": new_start.isoformat(),
        "end_time_utc": (new_start + timedelta(minutes=50)).isoformat(),
    }, headers=auth_headers(student_token))
    assert r_resched.status_code == 200, r_resched.text
    assert r_resched.json()["status"] == "confirmed"

    db.expire_all()
    class_db = db.query(Class).filter(Class.id == class_id).first()
    assert class_db.start_time_utc.replace(tzinfo=tz.utc) == new_start


def test_reschedule_rejects_less_than_minimum_notice(client, student_token, teacher_token, db, sched_env):
    """
    Técnico: reagendar una clase a menos de MIN_RESCHEDULE_HOURS_STUDENT
    (12h) de su inicio original devuelve 400 para el rol student (se crea
    la clase directo por ORM en un horario cercano para forzar el caso).
    UX: mover una clase de último momento tampoco se puede hacer solo
    desde la app — mismo criterio que cancelar tarde.
    """
    pkg = _create_package(client, teacher_token, sched_env, classes_count=2)
    enrollment_id = _make_active_enrollment(db, sched_env, pkg)

    soon_start = datetime.now(tz.utc) + timedelta(hours=2)
    class_obj = Class(
        teacher_id=sched_env["teacher_id"], student_id=sched_env["student_id"], enrollment_id=enrollment_id,
        class_type=ClassType.regular, status="confirmed",
        start_time_utc=soon_start, end_time_utc=soon_start + timedelta(minutes=50), duration=50,
    )
    db.add(class_obj)
    db.commit()
    sched_env["class_ids"].append(class_obj.id)

    new_start = _future(days=13)
    r_resched = client.patch(f"/api/v1/classes/{class_obj.id}/reschedule", json={
        "start_time_utc": new_start.isoformat(),
        "end_time_utc": (new_start + timedelta(minutes=50)).isoformat(),
    }, headers=auth_headers(student_token))
    assert r_resched.status_code == 400
    assert "antelación" in r_resched.text.lower()


def test_reschedule_rejects_conflicting_slot(client, student_token, teacher_token, db, sched_env):
    """
    Técnico: reagendar una clase hacia un horario donde el mismo
    profesor ya tiene otra clase confirmada devuelve 409 (can_book_slot
    reutilizado con exclude_class_id para no chocar consigo misma).
    UX: reagendar no debería poder crear un choque de agenda — si el
    horario elegido ya está ocupado, se avisa antes de mover la clase.
    """
    pkg = _create_package(client, teacher_token, sched_env, classes_count=4)
    enrollment_id = _make_active_enrollment(db, sched_env, pkg)

    fixed_start = _future(days=14)
    r_fixed = _book(client, student_token, enrollment_id, fixed_start)
    sched_env["class_ids"].append(r_fixed.json()["class_id"])

    movable_start = _future(days=15)
    r_movable = _book(client, student_token, enrollment_id, movable_start)
    movable_id = r_movable.json()["class_id"]
    sched_env["class_ids"].append(movable_id)

    r_resched = client.patch(f"/api/v1/classes/{movable_id}/reschedule", json={
        "start_time_utc": fixed_start.isoformat(),
        "end_time_utc": (fixed_start + timedelta(minutes=50)).isoformat(),
    }, headers=auth_headers(student_token))
    assert r_resched.status_code == 409
