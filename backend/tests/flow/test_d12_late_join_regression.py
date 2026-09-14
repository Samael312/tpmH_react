"""
Suite: Regresión de D12 (ver backlog_tpmH.md), pieza de precio prorrateado
y auto-agregado a sesiones futuras.

Decisión de negocio confirmada por el usuario: un alumno que se une a una
cohorte que ya está 'confirmed'/'in_progress' (ya dictó algunas sesiones)
NO paga el precio completo del paquete -- se le resta el costo de las
clases ya dictadas del precio total, y recibe créditos solo por las
clases que le quedan por delante. Al aprobarse el pago, se lo agrega
automáticamente como participante a las sesiones futuras de esa cohorte
que todavía tengan cupo (esta segunda parte ya existía en el código antes
de este ticket, ver comentario en payments.py::validate_payment).

Este archivo no repite la edición de min/max (D12 primera mitad, ver
test manual / endpoint PATCH /cohorts/{id} en cohorts.py) -- se enfoca en
la parte de inscripción tardía + prorrateo.
"""
from datetime import timedelta

import pytest

from app.models.teacher import TeacherProfile
from app.models.student import StudentProfile
from app.models.package import Package, Enrollment
from app.models.group_cohort import GroupCohort, CohortStatus
from app.models.class_ import Class, ClassType
from app.models.class_participant import ClassParticipant
from app.models.payment import Payment
from app.core.timezone import utc_now
from tests.flow.conftest import auth_headers

pytestmark = pytest.mark.integration


@pytest.fixture
def cohort_env(db, fixed_users, volatile):
    teacher = db.query(TeacherProfile).filter(TeacherProfile.user_id == fixed_users["teacher"].id).first()
    student = db.query(StudentProfile).filter(StudentProfile.user_id == fixed_users["student"].id).first()
    tracked = {
        "teacher_id": teacher.id, "student_id": student.id,
        "package_ids": [], "cohort_ids": [], "class_ids": [],
        "enrollment_ids": [], "participant_ids": [], "payment_ids": [],
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

            if tracked["participant_ids"]:
                _run(lambda: s.query(ClassParticipant).filter(
                    ClassParticipant.id.in_(tracked["participant_ids"])
                ).delete(synchronize_session=False))
            if tracked["payment_ids"]:
                _run(lambda: s.query(Payment).filter(
                    Payment.id.in_(tracked["payment_ids"])
                ).delete(synchronize_session=False))
            if tracked["enrollment_ids"]:
                _run(lambda: s.query(Payment).filter(
                    Payment.enrollment_id.in_(tracked["enrollment_ids"])
                ).delete(synchronize_session=False))
                _run(lambda: s.query(ClassParticipant).filter(
                    ClassParticipant.enrollment_id.in_(tracked["enrollment_ids"])
                ).delete(synchronize_session=False))
                _run(lambda: s.query(Enrollment).filter(
                    Enrollment.id.in_(tracked["enrollment_ids"])
                ).delete(synchronize_session=False))
            if tracked["class_ids"]:
                _run(lambda: s.query(Class).filter(
                    Class.id.in_(tracked["class_ids"])
                ).delete(synchronize_session=False))
            if tracked["cohort_ids"]:
                _run(lambda: s.query(GroupCohort).filter(
                    GroupCohort.id.in_(tracked["cohort_ids"])
                ).delete(synchronize_session=False))
            if tracked["package_ids"]:
                _run(lambda: s.query(Package).filter(
                    Package.id.in_(tracked["package_ids"])
                ).delete(synchronize_session=False))
        finally:
            s.close()

    volatile.custom(_cleanup, label="limpieza de test_d12_late_join_regression")
    return tracked


def _make_in_progress_cohort_with_sessions(db, tracked, *, classes_count=8, price=160.0,
                                            completed_sessions=3, max_students=6):
    pkg = Package(
        teacher_id=tracked["teacher_id"], name="Flow-test D12 grupal", subject="English",
        price=price, classes_count=classes_count, duration_minutes=50, is_group=True,
    )
    db.add(pkg)
    db.commit()
    db.refresh(pkg)
    tracked["package_ids"].append(pkg.id)

    cohort = GroupCohort(
        teacher_id=tracked["teacher_id"], package_id=pkg.id,
        status=CohortStatus.in_progress, min_students=2, max_students=max_students,
        start_date=utc_now() - timedelta(days=14),
    )
    db.add(cohort)
    db.commit()
    db.refresh(cohort)
    tracked["cohort_ids"].append(cohort.id)

    for i in range(completed_sessions):
        past_start = utc_now() - timedelta(days=14 - i * 3)
        c = Class(
            teacher_id=tracked["teacher_id"], student_id=None, cohort_id=cohort.id,
            class_type=ClassType.group, status="completed",
            start_time_utc=past_start, end_time_utc=past_start + timedelta(minutes=50),
            duration=50, buffer_minutes=10,
        )
        db.add(c)
        db.commit()
        db.refresh(c)
        tracked["class_ids"].append(c.id)

    future_start = utc_now() + timedelta(days=3)
    future_session = Class(
        teacher_id=tracked["teacher_id"], student_id=None, cohort_id=cohort.id,
        class_type=ClassType.group, status="confirmed",
        start_time_utc=future_start, end_time_utc=future_start + timedelta(minutes=50),
        duration=50, buffer_minutes=10,
    )
    db.add(future_session)
    db.commit()
    db.refresh(future_session)
    tracked["class_ids"].append(future_session.id)

    return pkg, cohort, future_session


def test_d12_late_join_gets_prorated_price_and_reduced_credits(
    client, student_token, superadmin_token, db, cohort_env,
):
    """
    Técnico + UX (decisión de negocio confirmada): paquete de 8 clases a
    $160 ($20/clase). La cohorte ya dictó 3 sesiones. Un alumno que se
    une ahora debe:
      1) ver/pagar $100 (160 - 3*20), no los $160 completos;
      2) al aprobarse el pago, recibir 5 créditos (8-3), no 8;
      3) quedar agregado automáticamente como participante de la sesión
         FUTURA de esa cohorte (esto último ya funcionaba antes de D12
         para el caso normal -- acá se confirma que también funciona
         para el que se suma tarde).
    """
    pkg, cohort, future_session = _make_in_progress_cohort_with_sessions(
        db, cohort_env, classes_count=8, price=160.0, completed_sessions=3,
    )

    r_enroll = client.post(f"/api/v1/cohorts/{cohort.id}/enroll", json={
        "cohort_id": cohort.id, "transaction_reference": "flow-tests-d12-late-join",
    }, headers=auth_headers(student_token))
    assert r_enroll.status_code == 201, r_enroll.text
    body = r_enroll.json()
    enrollment_id = body["enrollment_id"]
    cohort_env["enrollment_ids"].append(enrollment_id)
    assert body["amount_charged"] == pytest.approx(100.0), (
        f"D12: se esperaba pagar $100 (160 - 3 clases ya dictadas a $20 c/u), se cobró {body['amount_charged']}"
    )

    db.expire_all()
    enrollment_db = db.query(Enrollment).filter(Enrollment.id == enrollment_id).first()
    assert enrollment_db.classes_total == 5, (
        f"D12: classes_total debería quedar en 5 (8 - 3 ya dictadas), se obtuvo {enrollment_db.classes_total}"
    )

    payment_db = db.query(Payment).filter(Payment.enrollment_id == enrollment_id).first()
    cohort_env["payment_ids"].append(payment_db.id)
    assert payment_db.amount_total == pytest.approx(100.0)

    r_approve = client.patch(
        f"/api/v1/payments/{payment_db.id}/validate", json={"action": "approve"},
        headers=auth_headers(superadmin_token),
    )
    assert r_approve.status_code == 200, r_approve.text

    db.expire_all()
    enrollment_db = db.query(Enrollment).filter(Enrollment.id == enrollment_id).first()
    assert enrollment_db.unlocked_credits == 5, (
        f"D12: se esperaban 5 créditos (classes_total ya prorrateado), se obtuvieron {enrollment_db.unlocked_credits}"
    )
    assert enrollment_db.payment_status == "paid"

    participant = db.query(ClassParticipant).filter(
        ClassParticipant.class_id == future_session.id,
        ClassParticipant.student_id == cohort_env["student_id"],
    ).first()
    assert participant is not None, (
        "D12: el alumno que se sumó tarde debe quedar agregado automáticamente a la sesión futura ya agendada"
    )
    if participant:
        cohort_env["participant_ids"].append(participant.id)
    assert participant.attendance_status == "confirmed"


def test_d12_cohort_fully_completed_rejects_new_enrollments(db, cohort_env, client, student_token):
    """
    Técnico: contraprueba -- si una cohorte ya dictó TODAS sus clases
    (completed_sessions >= classes_count), no debe admitir nuevas
    inscripciones (no hay nada que prorratear, quedaría cobrando por
    clases inexistentes o con classes_total <= 0).
    """
    pkg, cohort, _future = _make_in_progress_cohort_with_sessions(
        db, cohort_env, classes_count=3, price=90.0, completed_sessions=3,
    )

    r_enroll = client.post(f"/api/v1/cohorts/{cohort.id}/enroll", json={
        "cohort_id": cohort.id,
    }, headers=auth_headers(student_token))
    assert r_enroll.status_code == 400, r_enroll.text
