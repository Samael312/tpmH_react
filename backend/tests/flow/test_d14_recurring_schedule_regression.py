"""
Suite: Regresión de D14 (ver backlog_tpmH.md).

Decisión de negocio confirmada por el usuario: deben existir las DOS
opciones para un paquete grupal -- "manual" (agendado libre por el
profesor, comportamiento de siempre) y "fixed" (horario semanal
recurrente configurado en el paquete). Con "fixed", al cerrar el grupo
el profesor elige a partir de cuál coincidencia arrancar y el sistema
genera automáticamente TODAS las sesiones del paquete siguiendo ese
patrón.
"""
from datetime import timedelta

import pytest

from app.models.teacher import TeacherProfile
from app.models.student import StudentProfile
from app.models.package import Package, Enrollment, EnrollmentStatus
from app.models.group_cohort import GroupCohort, CohortStatus
from app.models.class_ import Class, ClassType
from app.core.timezone import utc_now
from app.api.v1.endpoints.cohorts import _generate_recurring_dates
from tests.flow.conftest import auth_headers

pytestmark = pytest.mark.integration


def test_generate_recurring_dates_follows_weekly_pattern_in_utc():
    """
    Técnico: unidad pura -- con timezone UTC (sin complicación de DST),
    un patrón de lunes y jueves a las 18:00 debe devolver exactamente
    esos días de la semana, en orden cronológico, a esa hora exacta.
    """
    start_from = utc_now()
    occurrences = _generate_recurring_dates([0, 3], "18:00", "UTC", start_from, 4)

    assert len(occurrences) == 4
    for occ in occurrences:
        assert occ.weekday() in (0, 3)
        assert occ.hour == 18 and occ.minute == 0
        assert occ >= start_from
    # Orden cronológico estrictamente creciente
    assert occurrences == sorted(occurrences)


@pytest.fixture
def d14_env(db, fixed_users, volatile):
    teacher = db.query(TeacherProfile).filter(TeacherProfile.user_id == fixed_users["teacher"].id).first()
    student = db.query(StudentProfile).filter(StudentProfile.user_id == fixed_users["student"].id).first()
    original_tz = teacher.timezone
    teacher.timezone = "UTC"  # simplifica: local == UTC, sin DST de por medio
    db.commit()

    tracked = {"teacher_id": teacher.id, "student_id": student.id, "package_ids": [], "cohort_ids": [], "enrollment_ids": []}

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

            t = s.query(TeacherProfile).filter(TeacherProfile.id == tracked["teacher_id"]).first()
            if t:
                t.timezone = original_tz
                s.commit()

            if tracked["cohort_ids"]:
                _run(lambda: s.query(Class).filter(
                    Class.cohort_id.in_(tracked["cohort_ids"])
                ).delete(synchronize_session=False))
            if tracked["enrollment_ids"]:
                _run(lambda: s.query(Enrollment).filter(
                    Enrollment.id.in_(tracked["enrollment_ids"])
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

    volatile.custom(_cleanup, label="limpieza de test_d14_recurring_schedule_regression")
    return tracked


def test_d14_close_cohort_with_fixed_schedule_generates_all_sessions(
    client, teacher_token, db, d14_env,
):
    """
    Técnico + UX (decisión de negocio confirmada): paquete grupal de 3
    clases con horario fijo (todos los días a las 03:00 UTC, para no
    depender del día de la semana en que corra el test). Al cerrar la
    cohorte eligiendo la primera ocurrencia futura, deben crearse las 3
    sesiones automáticamente, una por día consecutivo, sin que el
    profesor tenga que agendar cada una a mano.
    """
    pkg = Package(
        teacher_id=d14_env["teacher_id"], name="Flow-test D14 fijo", subject="English",
        price=150.0, classes_count=3, duration_minutes=50, is_group=True,
        min_students=1, max_students=6,
        group_schedule_mode="fixed",
        group_recurring_days_of_week=[0, 1, 2, 3, 4, 5, 6],  # todos los días
        group_recurring_time_local="03:00",
    )
    db.add(pkg)
    db.commit()
    db.refresh(pkg)
    d14_env["package_ids"].append(pkg.id)

    cohort = GroupCohort(
        teacher_id=d14_env["teacher_id"], package_id=pkg.id,
        status=CohortStatus.filling, min_students=1, max_students=6,
    )
    db.add(cohort)
    db.commit()
    db.refresh(cohort)
    d14_env["cohort_ids"].append(cohort.id)

    enrollment = Enrollment(
        student_id=d14_env["student_id"], teacher_id=d14_env["teacher_id"], package_id=pkg.id,
        cohort_id=cohort.id, classes_used=0, classes_total=3, unlocked_credits=0,
        payment_status="paid", status=EnrollmentStatus.active,
    )
    db.add(enrollment)
    db.commit()
    db.refresh(enrollment)
    d14_env["enrollment_ids"].append(enrollment.id)

    # +2 días de margen para no chocar con la antelación mínima de agendado.
    start_from = utc_now() + timedelta(days=2)
    occurrences = _generate_recurring_dates([0, 1, 2, 3, 4, 5, 6], "03:00", "UTC", start_from, 3)
    first_occurrence = occurrences[0]

    r = client.post(f"/api/v1/cohorts/{cohort.id}/close", json={
        "start_date": first_occurrence.isoformat(),
        "duration_minutes": 50,
    }, headers=auth_headers(teacher_token))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "confirmed"

    sessions = db.query(Class).filter(
        Class.cohort_id == cohort.id, Class.class_type == ClassType.group,
    ).order_by(Class.start_time_utc.asc()).all()

    assert len(sessions) == 3, (
        f"D14: se esperaban 3 sesiones auto-generadas (classes_count del paquete), se crearon {len(sessions)}"
    )
    for i, session in enumerate(sessions):
        assert session.start_time_utc.replace(microsecond=0) == occurrences[i].replace(microsecond=0), (
            f"Sesión {i} no coincide con la ocurrencia esperada del patrón recurrente"
        )
    # Consecutivas: un día exacto de diferencia entre cada una (patrón diario).
    for i in range(1, len(sessions)):
        assert sessions[i].start_time_utc - sessions[i - 1].start_time_utc == timedelta(days=1)


def test_d14_close_cohort_rejects_date_not_matching_pattern(
    client, teacher_token, db, d14_env,
):
    """
    Técnico: si el profesor manda una fecha que NO coincide con el patrón
    configurado (ej. paquete configurado solo para lunes, pero se manda
    un martes), el cierre debe rechazarse con un error claro, en vez de
    generar sesiones en fechas que no siguen el horario declarado del
    paquete.
    """
    pkg = Package(
        teacher_id=d14_env["teacher_id"], name="Flow-test D14 mismatch", subject="English",
        price=150.0, classes_count=2, duration_minutes=50, is_group=True,
        min_students=1, max_students=6,
        group_schedule_mode="fixed",
        group_recurring_days_of_week=[0],  # solo lunes
        group_recurring_time_local="03:00",
    )
    db.add(pkg)
    db.commit()
    db.refresh(pkg)
    d14_env["package_ids"].append(pkg.id)

    cohort = GroupCohort(
        teacher_id=d14_env["teacher_id"], package_id=pkg.id,
        status=CohortStatus.filling, min_students=1, max_students=6,
    )
    db.add(cohort)
    db.commit()
    db.refresh(cohort)
    d14_env["cohort_ids"].append(cohort.id)

    enrollment = Enrollment(
        student_id=d14_env["student_id"], teacher_id=d14_env["teacher_id"], package_id=pkg.id,
        cohort_id=cohort.id, classes_used=0, classes_total=2, unlocked_credits=0,
        payment_status="paid", status=EnrollmentStatus.active,
    )
    db.add(enrollment)
    db.commit()
    db.refresh(enrollment)
    d14_env["enrollment_ids"].append(enrollment.id)

    # Un martes a propósito, para que NO coincida con el patrón (solo lunes).
    mismatched = utc_now() + timedelta(days=2)
    while mismatched.weekday() == 0:
        mismatched += timedelta(days=1)
    mismatched = mismatched.replace(hour=3, minute=0, second=0, microsecond=0)

    r = client.post(f"/api/v1/cohorts/{cohort.id}/close", json={
        "start_date": mismatched.isoformat(),
        "duration_minutes": 50,
    }, headers=auth_headers(teacher_token))
    assert r.status_code == 400, r.text
    assert "no coincide" in r.json()["detail"].lower()
