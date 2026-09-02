"""
Suite: Contador de por vida de clases completadas por estudiante
(StudentProfile.total_completed_classes).

A diferencia de Enrollment.classes_used (que vive en el enrollment y se
resetea con cada renovación o cambio de paquete), este contador vive en
el propio StudentProfile y nunca se reinicia: es la suma histórica de
todas las clases (individuales y grupales) que terminaron en 'completed'
o 'no_show' para ese alumno, sin importar de qué enrollment/paquete/
cohorte vinieron. Ver app.core.class_logic.sync_student_lifetime_class_counter.
"""
import pytest
from datetime import datetime, timedelta, timezone as tz

from app.models.teacher import TeacherProfile
from app.models.student import StudentProfile
from app.models.user import User, UserRole
from app.models.package import Package, Enrollment, EnrollmentStatus
from app.models.class_ import Class
from app.models.class_participant import ClassParticipant
from app.models.group_cohort import GroupCohort
from app.models.payment import Payment
from app.models.payment_config import PlatformConfig
from app.models.availability import TeacherAvailability
from app.auth.passwords import hash_password
from tests.flow.conftest import auth_headers

pytestmark = [pytest.mark.integration, pytest.mark.destructive]


def _resolve_teacher_for_booking(db, fixed_username: str) -> str | None:
    """Réplica de _resolve_booking_teacher (payments.py), solo para decidir
    si saltar el test — ver la nota equivalente en test_purchase_flow.py."""
    config = db.query(PlatformConfig).first()
    if not config or config.is_single_tenant:
        if config and config.featured_teacher_id:
            t = db.query(TeacherProfile).filter(TeacherProfile.id == config.featured_teacher_id).first()
            return t.user_username if t else None
        import os
        return os.getenv("FEATURED_TEACHER_USERNAME") or None
    return fixed_username  # multi-tenant: sí se respeta el teacher_username explícito


def _set_full_availability(client, teacher_token):
    r = client.put("/api/v1/availability/me/weekly", json={
        "timezone": "UTC",
        "slots": [{"day_of_week": d, "start_time_local": "06:00", "end_time_local": "22:00"} for d in range(7)],
    }, headers=auth_headers(teacher_token))
    assert r.status_code == 200, r.text


def _approve_payment(client, superadmin_token, payment_id):
    r = client.patch(f"/api/v1/payments/{payment_id}/validate", json={
        "action": "approve",
    }, headers=auth_headers(superadmin_token))
    assert r.status_code == 200, r.text
    return r.json()


def _mark_status(client, teacher_token, class_id, new_status):
    r = client.patch(f"/api/v1/classes/{class_id}/status", json={
        "status": new_status,
    }, headers=auth_headers(teacher_token))
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def clean_lifetime_slate(db, fixed_users, volatile):
    """
    Red de seguridad: borra cualquier Payment/Class/Enrollment/Package/
    disponibilidad del par profesor-alumno fijo que haya quedado de este
    test, sin importar en qué punto haya fallado.
    """
    teacher = db.query(TeacherProfile).filter(TeacherProfile.user_id == fixed_users["teacher"].id).first()
    student = db.query(StudentProfile).filter(StudentProfile.user_id == fixed_users["student"].id).first()
    state = {"teacher_id": teacher.id, "student_id": student.id, "package_ids": []}

    def _cleanup():
        from app.db.base import SessionLocal
        s = SessionLocal()
        try:
            s.query(Payment).filter(Payment.student_id == state["student_id"]).delete(synchronize_session=False)
            s.query(Class).filter(
                Class.teacher_id == state["teacher_id"], Class.student_id == state["student_id"]
            ).delete(synchronize_session=False)
            s.query(Enrollment).filter(
                Enrollment.teacher_id == state["teacher_id"], Enrollment.student_id == state["student_id"]
            ).delete(synchronize_session=False)
            if state["package_ids"]:
                s.query(Package).filter(Package.id.in_(state["package_ids"])).delete(synchronize_session=False)
            s.query(TeacherAvailability).filter(TeacherAvailability.teacher_id == state["teacher_id"]).delete(synchronize_session=False)
            s.commit()
        finally:
            s.close()

    volatile.custom(
        _cleanup,
        label="limpieza total: clases/enrollments/payments/packages/disponibilidad del par profesor-estudiante fijo",
    )
    return state


def test_lifetime_counter_survives_renewal_and_package_change(
    client, db, teacher_token, student_token, superadmin_token, fixed_users, volatile, clean_lifetime_slate,
):
    """
    Técnico: crea un paquete, aprueba su pago, reserva y completa 2 clases
    (una 'completed' y una 'no_show') verificando que
    StudentProfile.total_completed_classes sube en cada una. Luego pide
    una RENOVACIÓN del mismo paquete y la aprueba — verifica que
    Enrollment.classes_used se resetea a 0 (comportamiento ya existente)
    pero total_completed_classes NO se mueve. Reserva y completa una
    tercera clase sobre el enrollment ya renovado (el contador sube a 3).
    Pide un CAMBIO DE PAQUETE (upgrade) y lo aprueba — vuelve a verificar
    que total_completed_classes no se ve afectado por el cambio. Reserva
    y completa una cuarta clase (sube a 4). Finalmente, revierte esa
    cuarta clase de 'completed' a 'confirmed' vía God Mode y verifica que
    el contador BAJA de nuevo a 3, probando que las reversiones también
    se reflejan correctamente.
    UX: la tarjeta de un alumno en /admin/students y /teacher/students
    muestra "clases completadas en total" — si este número se resetea o
    se pierde cada vez que un alumno renueva o cambia de paquete, el
    staff y los profesores pierden la noción real de la antigüedad y el
    compromiso histórico del alumno con la plataforma.
    """
    teacher_id = clean_lifetime_slate["teacher_id"]
    student_id = clean_lifetime_slate["student_id"]
    teacher_username = fixed_users["teacher"].username

    resolved = _resolve_teacher_for_booking(db, teacher_username)
    if resolved != teacher_username:
        pytest.skip(
            f"El profesor 'destacado' de este entorno es '{resolved}', no el profesor fijo "
            f"de pruebas ('{teacher_username}'). /payments/book siempre reserva con el "
            "destacado en modo single-tenant, así que este flujo no aplica aquí sin "
            "configurar PlatformConfig.featured_teacher_id o FEATURED_TEACHER_USERNAME."
        )

    student_profile = db.query(StudentProfile).filter(StudentProfile.id == student_id).first()
    baseline = student_profile.total_completed_classes

    _set_full_availability(client, teacher_token)

    start = (datetime.now(tz.utc) + timedelta(days=5)).replace(hour=9, minute=0, second=0, microsecond=0)

    # 0) Primera reserva con este profesor = SIEMPRE prueba gratuita (ver
    # get_student_booking_stage). Hay que completarla antes de poder
    # comprar un paquete, o /payments/book ignora enrollment_id y crea
    # otra prueba en su lugar.
    r_book_trial = client.post("/api/v1/payments/book", json={
        "teacher_username": teacher_username,
        "start_time_utc": (start - timedelta(days=1)).isoformat(),
        "end_time_utc": (start - timedelta(days=1) + timedelta(minutes=25)).isoformat(),
        "duration_minutes": 25,
    }, headers=auth_headers(student_token))
    assert r_book_trial.status_code == 201, r_book_trial.text
    trial_class_id = r_book_trial.json()["class_id"]

    r_force_trial = client.patch(
        f"/api/v1/god-mode/classes/{trial_class_id}/force-status",
        json={"status": "completed", "reason": "flow-tests: completar prueba para habilitar la compra de paquete"},
        headers=auth_headers(superadmin_token),
    )
    assert r_force_trial.status_code == 200, r_force_trial.text

    db.expire_all()
    student_profile = db.query(StudentProfile).filter(StudentProfile.id == student_id).first()
    # La prueba también es una clase 'completed': ya cuenta para el
    # contador de por vida. A partir de acá todas las comparaciones son
    # relativas a este nuevo baseline.
    baseline = student_profile.total_completed_classes

    # 1) Paquete inicial A (4 clases) — compra normal, aprobada por staff.
    r_pkg_a = client.post("/api/v1/packages/", json={
        "name": "Flow-test lifetime A", "subject": "English", "price": 100.0,
        "classes_count": 4, "duration_minutes": 50,
    }, headers=auth_headers(teacher_token))
    assert r_pkg_a.status_code == 201, r_pkg_a.text
    package_a_id = r_pkg_a.json()["id"]
    clean_lifetime_slate["package_ids"].append(package_a_id)

    r_notify_a = client.post("/api/v1/payments/notify-payment", json={
        "type": "package", "package_id": package_a_id, "transaction_reference": "flow-tests-lifetime-a",
    }, headers=auth_headers(student_token))
    assert r_notify_a.status_code == 200, r_notify_a.text
    _approve_payment(client, superadmin_token, r_notify_a.json()["payment_id"])

    r_enrollments = client.get("/api/v1/packages/my-enrollments", headers=auth_headers(student_token))
    assert r_enrollments.status_code == 200
    matches = [e for e in r_enrollments.json() if e["package_id"] == package_a_id]
    assert len(matches) == 1, r_enrollments.json()
    enrollment_id = matches[0]["id"]

    # 2) Reservar y completar 2 clases (completed + no_show) sobre este enrollment.
    r_book_1 = client.post("/api/v1/payments/book", json={
        "enrollment_id": enrollment_id,
        "start_time_utc": start.isoformat(),
        "end_time_utc": (start + timedelta(minutes=50)).isoformat(),
        "duration_minutes": 50,
    }, headers=auth_headers(student_token))
    assert r_book_1.status_code == 201, r_book_1.text
    class_1_id = r_book_1.json()["class_id"]

    _mark_status(client, teacher_token, class_1_id, "completed")
    db.expire_all()
    student_profile = db.query(StudentProfile).filter(StudentProfile.id == student_id).first()
    assert student_profile.total_completed_classes == baseline + 1, (
        "El contador debería subir en 1 tras marcar la primera clase como 'completed'"
    )

    r_book_2 = client.post("/api/v1/payments/book", json={
        "enrollment_id": enrollment_id,
        "start_time_utc": (start + timedelta(days=1)).isoformat(),
        "end_time_utc": (start + timedelta(days=1, minutes=50)).isoformat(),
        "duration_minutes": 50,
    }, headers=auth_headers(student_token))
    assert r_book_2.status_code == 201, r_book_2.text
    class_2_id = r_book_2.json()["class_id"]

    _mark_status(client, teacher_token, class_2_id, "no_show")
    db.expire_all()
    student_profile = db.query(StudentProfile).filter(StudentProfile.id == student_id).first()
    assert student_profile.total_completed_classes == baseline + 2, (
        "El contador también debe subir con 'no_show' (mismo criterio que el consumo del paquete)"
    )

    enrollment_db = db.query(Enrollment).filter(Enrollment.id == enrollment_id).first()
    assert enrollment_db.classes_used == 2

    # 3) RENOVACIÓN del mismo paquete — classes_used se resetea, el
    # contador de por vida NO debe moverse.
    r_renew = client.post("/api/v1/payments/notify-payment", json={
        "type": "renewal", "enrollment_id": enrollment_id, "package_id": package_a_id,
        "transaction_reference": "flow-tests-lifetime-renewal",
    }, headers=auth_headers(student_token))
    assert r_renew.status_code == 200, r_renew.text
    _approve_payment(client, superadmin_token, r_renew.json()["payment_id"])

    db.expire_all()
    enrollment_db = db.query(Enrollment).filter(Enrollment.id == enrollment_id).first()
    assert enrollment_db.classes_used == 0, "La renovación debe resetear classes_used (comportamiento existente)"
    assert enrollment_db.status == EnrollmentStatus.active
    student_profile = db.query(StudentProfile).filter(StudentProfile.id == student_id).first()
    assert student_profile.total_completed_classes == baseline + 2, (
        "La renovación NO debe afectar el contador de por vida del alumno"
    )

    # 4) Con el enrollment renovado, completar una tercera clase.
    r_book_3 = client.post("/api/v1/payments/book", json={
        "enrollment_id": enrollment_id,
        "start_time_utc": (start + timedelta(days=2)).isoformat(),
        "end_time_utc": (start + timedelta(days=2, minutes=50)).isoformat(),
        "duration_minutes": 50,
    }, headers=auth_headers(student_token))
    assert r_book_3.status_code == 201, r_book_3.text
    class_3_id = r_book_3.json()["class_id"]

    _mark_status(client, teacher_token, class_3_id, "completed")
    db.expire_all()
    student_profile = db.query(StudentProfile).filter(StudentProfile.id == student_id).first()
    assert student_profile.total_completed_classes == baseline + 3

    # 5) CAMBIO DE PAQUETE (upgrade a uno con más créditos) — tampoco
    # debe afectar el contador de por vida.
    r_pkg_b = client.post("/api/v1/packages/", json={
        "name": "Flow-test lifetime B (upgrade)", "subject": "English", "price": 250.0,
        "classes_count": 10, "duration_minutes": 50,
    }, headers=auth_headers(teacher_token))
    assert r_pkg_b.status_code == 201, r_pkg_b.text
    package_b_id = r_pkg_b.json()["id"]
    clean_lifetime_slate["package_ids"].append(package_b_id)

    r_change = client.post("/api/v1/payments/notify-payment", json={
        "type": "package_change", "enrollment_id": enrollment_id, "package_id": package_b_id,
        "transaction_reference": "flow-tests-lifetime-change",
    }, headers=auth_headers(student_token))
    assert r_change.status_code == 200, r_change.text
    assert "payment_id" in r_change.json(), (
        "Con un upgrade real (deficit > 0) debería generarse un Payment pendiente de aprobación, "
        f"no un cambio instantáneo: {r_change.json()}"
    )
    _approve_payment(client, superadmin_token, r_change.json()["payment_id"])

    db.expire_all()
    enrollment_db = db.query(Enrollment).filter(Enrollment.id == enrollment_id).first()
    assert enrollment_db.package_id == package_b_id
    student_profile = db.query(StudentProfile).filter(StudentProfile.id == student_id).first()
    assert student_profile.total_completed_classes == baseline + 3, (
        "El cambio de paquete NO debe afectar el contador de por vida del alumno"
    )

    # 6) Completar una cuarta clase sobre el enrollment ya con el paquete nuevo.
    r_book_4 = client.post("/api/v1/payments/book", json={
        "enrollment_id": enrollment_id,
        "start_time_utc": (start + timedelta(days=3)).isoformat(),
        "end_time_utc": (start + timedelta(days=3, minutes=50)).isoformat(),
        "duration_minutes": 50,
    }, headers=auth_headers(student_token))
    assert r_book_4.status_code == 201, r_book_4.text
    class_4_id = r_book_4.json()["class_id"]

    _mark_status(client, teacher_token, class_4_id, "completed")
    db.expire_all()
    student_profile = db.query(StudentProfile).filter(StudentProfile.id == student_id).first()
    assert student_profile.total_completed_classes == baseline + 4

    # 7) Reversión vía God Mode: 'completed' -> 'confirmed'. El contador
    # debe bajar de nuevo, probando que las correcciones retroactivas del
    # staff también se reflejan (no solo los incrementos).
    r_revert = client.patch(
        f"/api/v1/god-mode/classes/{class_4_id}/force-status",
        json={"status": "confirmed", "reason": "flow-tests: probar reversión del contador de por vida"},
        headers=auth_headers(superadmin_token),
    )
    assert r_revert.status_code == 200, r_revert.text
    assert r_revert.json()["status"] == "confirmed"

    db.expire_all()
    student_profile = db.query(StudentProfile).filter(StudentProfile.id == student_id).first()
    assert student_profile.total_completed_classes == baseline + 3, (
        "Revertir una clase de 'completed' a otro estado debe descontarla del contador de por vida"
    )


@pytest.fixture
def clean_group_lifetime_slate(db, fixed_users, volatile):
    """
    Igual que clean_lifetime_slate, pero además crea y limpia un segundo
    alumno ad-hoc (no uno de los 4 fijos de la suite) para poder probar
    que un participante 'cancelled' de una sesión grupal queda excluido
    del contador — necesitamos un segundo alumno real e independiente del
    fijo, que sí participa activamente en la sesión.
    """
    teacher = db.query(TeacherProfile).filter(TeacherProfile.user_id == fixed_users["teacher"].id).first()
    student = db.query(StudentProfile).filter(StudentProfile.user_id == fixed_users["student"].id).first()

    extra_user = User(
        email="flowtest.lifetime.extra.student@tpmh.internal",
        username="flowtest_lifetime_extra_student",
        name="FlowTest",
        surname="ExtraStudent",
        password_hash=hash_password("FlowTest!2024"),
        role=UserRole.student,
        is_active=True,
        is_banned=False,
        onboarding_completed=True,
        is_test_account=True,
    )
    db.add(extra_user)
    db.flush()
    extra_profile = StudentProfile(
        user_id=extra_user.id,
        user_username=extra_user.username,
        timezone="UTC",
    )
    db.add(extra_profile)
    db.commit()
    db.refresh(extra_profile)

    state = {
        "teacher_id": teacher.id,
        "student_id": student.id,
        "extra_student_id": extra_profile.id,
        "extra_user_id": extra_user.id,
        "package_ids": [],
        "cohort_ids": [],
    }

    def _cleanup():
        from app.db.base import SessionLocal
        s = SessionLocal()
        try:
            s.query(ClassParticipant).filter(
                ClassParticipant.student_id.in_([state["student_id"], state["extra_student_id"]])
            ).delete(synchronize_session=False)
            s.query(Payment).filter(
                Payment.student_id.in_([state["student_id"], state["extra_student_id"]])
            ).delete(synchronize_session=False)
            s.query(Class).filter(Class.teacher_id == state["teacher_id"]).delete(synchronize_session=False)
            s.query(Enrollment).filter(
                Enrollment.teacher_id == state["teacher_id"],
                Enrollment.student_id.in_([state["student_id"], state["extra_student_id"]]),
            ).delete(synchronize_session=False)
            if state["cohort_ids"]:
                s.query(GroupCohort).filter(GroupCohort.id.in_(state["cohort_ids"])).delete(synchronize_session=False)
            if state["package_ids"]:
                s.query(Package).filter(Package.id.in_(state["package_ids"])).delete(synchronize_session=False)
            s.query(TeacherAvailability).filter(TeacherAvailability.teacher_id == state["teacher_id"]).delete(synchronize_session=False)

            extra_profile_row = s.query(StudentProfile).filter(StudentProfile.id == state["extra_student_id"]).first()
            if extra_profile_row:
                s.delete(extra_profile_row)
            extra_user_row = s.query(User).filter(User.id == state["extra_user_id"]).first()
            if extra_user_row:
                s.delete(extra_user_row)

            s.commit()
        finally:
            s.close()

    volatile.custom(
        _cleanup,
        label="limpieza total: sesión grupal, alumno extra ad-hoc y datos del par profesor-estudiante fijo",
    )
    return state


def test_lifetime_counter_counts_group_classes_and_excludes_cancelled_participants(
    client, db, teacher_token, student_token, superadmin_token, fixed_users, volatile, clean_group_lifetime_slate,
):
    """
    Técnico: crea un paquete grupal, una cohorte, inscribe al alumno fijo
    (paga vía staff), cierra la cohorte y agenda una sesión real
    (POST /cohorts/{id}/sessions, que auto-inscribe a los alumnos activos
    como ClassParticipant). Agrega además un segundo participante ad-hoc
    con attendance_status='cancelled' directamente en BD, simulando un
    alumno que salió del grupo antes de esta sesión puntual. Marca la
    sesión como 'completed' vía el endpoint normal de status
    (PATCH /classes/{id}/status) y verifica que
    StudentProfile.total_completed_classes solo sube para el participante
    ACTIVO, no para el cancelado.
    UX: un alumno que toma clases grupales debe ver su total de clases
    completadas reflejar esas sesiones igual que las individuales; un
    alumno que se salió de una sesión puntual antes de que ocurriera no
    debe aparecer como si la hubiera tomado.
    """
    teacher_id = clean_group_lifetime_slate["teacher_id"]
    student_id = clean_group_lifetime_slate["student_id"]
    extra_student_id = clean_group_lifetime_slate["extra_student_id"]

    student_profile = db.query(StudentProfile).filter(StudentProfile.id == student_id).first()
    baseline = student_profile.total_completed_classes
    extra_profile = db.query(StudentProfile).filter(StudentProfile.id == extra_student_id).first()
    extra_baseline = extra_profile.total_completed_classes

    _set_full_availability(client, teacher_token)

    # 1) Paquete grupal + cohorte.
    r_pkg = client.post("/api/v1/packages/", json={
        "name": "Flow-test lifetime grupal", "subject": "English", "price": 80.0,
        "classes_count": 8, "duration_minutes": 50,
        "is_group": True, "min_students": 1, "max_students": 6,
    }, headers=auth_headers(teacher_token))
    assert r_pkg.status_code == 201, r_pkg.text
    package_id = r_pkg.json()["id"]
    clean_group_lifetime_slate["package_ids"].append(package_id)

    r_cohort = client.post("/api/v1/cohorts/", json={
        "package_id": package_id, "min_students": 1, "max_students": 6,
    }, headers=auth_headers(teacher_token))
    assert r_cohort.status_code == 201, r_cohort.text
    cohort_id = r_cohort.json()["id"]
    clean_group_lifetime_slate["cohort_ids"].append(cohort_id)

    # 2) El alumno fijo se inscribe y su pago se aprueba.
    r_enroll = client.post(f"/api/v1/cohorts/{cohort_id}/enroll", json={
        "cohort_id": cohort_id, "transaction_reference": "flow-tests-lifetime-group",
    }, headers=auth_headers(student_token))
    assert r_enroll.status_code == 201, r_enroll.text
    enrollment_id = r_enroll.json()["enrollment_id"]

    group_payment = db.query(Payment).filter(
        Payment.enrollment_id == enrollment_id,
        Payment.payment_type == "group_enrollment",
        Payment.status == "pending_review",
    ).first()
    assert group_payment is not None, "Debería existir un Payment pendiente para la inscripción grupal"
    _approve_payment(client, superadmin_token, group_payment.id)

    # 3) Cerrar la cohorte y agendar una sesión real.
    start = (datetime.now(tz.utc) + timedelta(days=6)).replace(hour=11, minute=0, second=0, microsecond=0)
    r_close = client.post(f"/api/v1/cohorts/{cohort_id}/close", json={
        "start_date": start.isoformat(),
    }, headers=auth_headers(teacher_token))
    assert r_close.status_code == 200, r_close.text

    r_session = client.post(f"/api/v1/cohorts/{cohort_id}/sessions", json={
        "start_time_utc": start.isoformat(), "duration_minutes": 50,
    }, headers=auth_headers(teacher_token))
    assert r_session.status_code == 201, r_session.text
    session_class_id = r_session.json()["id"]

    # 4) Segundo participante ad-hoc, con una participación ya CANCELADA
    # en esta misma sesión (simula un alumno que se salió del grupo antes
    # de esta clase puntual). Necesita su propio enrollment mínimo válido
    # para satisfacer la FK de ClassParticipant.
    extra_enrollment = Enrollment(
        student_id=extra_student_id,
        package_id=package_id,
        teacher_id=teacher_id,
        cohort_id=cohort_id,
        classes_used=0,
        classes_total=8,
        unlocked_credits=8,
        payment_status="paid",
        status=EnrollmentStatus.active,
    )
    db.add(extra_enrollment)
    db.flush()
    db.add(ClassParticipant(
        class_id=session_class_id,
        student_id=extra_student_id,
        enrollment_id=extra_enrollment.id,
        attendance_status="cancelled",
    ))
    db.commit()

    # 5) Marcar la sesión como completada por el flujo normal del profesor.
    _mark_status(client, teacher_token, session_class_id, "completed")

    db.expire_all()
    student_profile = db.query(StudentProfile).filter(StudentProfile.id == student_id).first()
    extra_profile = db.query(StudentProfile).filter(StudentProfile.id == extra_student_id).first()

    assert student_profile.total_completed_classes == baseline + 1, (
        "El participante activo de la sesión grupal debería sumar 1 clase completada"
    )
    assert extra_profile.total_completed_classes == extra_baseline, (
        "El participante 'cancelled' NO debe sumar la sesión al contador de por vida"
    )

    session_db = db.query(Class).filter(Class.id == session_class_id).first()
    assert session_db.status == "completed"
