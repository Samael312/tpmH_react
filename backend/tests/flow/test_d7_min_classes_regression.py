"""
Suite: Regresión de D7 (ver backlog_tpmH.md).

Decisión de negocio confirmada por el usuario: la regla de mínimo de
clases completadas antes de poder cambiar de paquete aplica a AMBOS
sentidos (upgrade y downgrade), y el mínimo es configurable por el admin
en Settings (PlatformConfig.min_classes_before_package_change, expuesto
vía GET/PATCH /system-catalogs/business-rules).

PlatformConfig es una fila única global -- estos tests la modifican y la
restauran a su valor original en el cleanup, para no afectar otros tests
que corran en paralelo o después.
"""
from datetime import timedelta

import pytest

from app.models.teacher import TeacherProfile
from app.models.student import StudentProfile
from app.models.package import Package, Enrollment, EnrollmentStatus
from app.core.platform_config import get_or_create_platform_config
from tests.flow.conftest import auth_headers

pytestmark = pytest.mark.integration


@pytest.fixture
def d7_env(db, fixed_users, volatile):
    teacher = db.query(TeacherProfile).filter(TeacherProfile.user_id == fixed_users["teacher"].id).first()
    student = db.query(StudentProfile).filter(StudentProfile.user_id == fixed_users["student"].id).first()
    tracked = {"teacher_id": teacher.id, "student_id": student.id, "package_ids": [], "enrollment_ids": []}

    config = get_or_create_platform_config(db)
    original_min = config.min_classes_before_package_change

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

            cfg = get_or_create_platform_config(s)
            cfg.min_classes_before_package_change = original_min
            s.commit()

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

    volatile.custom(_cleanup, label="limpieza de test_d7_min_classes_regression")
    return tracked


def _set_min_classes(db, value):
    config = get_or_create_platform_config(db)
    config.min_classes_before_package_change = value
    db.commit()


def _make_enrollment(db, tracked, *, package_id, classes_total, classes_used, unlocked_credits):
    enrollment = Enrollment(
        student_id=tracked["student_id"], teacher_id=tracked["teacher_id"], package_id=package_id,
        classes_used=classes_used, classes_total=classes_total, unlocked_credits=unlocked_credits,
        payment_status="paid", status=EnrollmentStatus.active,
    )
    db.add(enrollment)
    db.commit()
    db.refresh(enrollment)
    tracked["enrollment_ids"].append(enrollment.id)
    return enrollment.id


def _create_package(client, teacher_token, tracked, **overrides):
    payload = {
        "name": "Flow-test D7 package", "subject": "English",
        "price": 100.0, "classes_count": 4, "duration_minutes": 50,
    }
    payload.update(overrides)
    r = client.post("/api/v1/packages/", json=payload, headers=auth_headers(teacher_token))
    assert r.status_code == 201, r.text
    tracked["package_ids"].append(r.json()["id"])
    return r.json()


@pytest.mark.parametrize("direction,new_classes_count", [("upgrade", 8), ("downgrade", 2)])
def test_d7_blocks_package_change_below_minimum_both_directions(
    client, student_token, teacher_token, db, d7_env, direction, new_classes_count,
):
    """
    Técnico + UX (decisión de negocio confirmada): con el mínimo
    configurado en 3 clases, un estudiante con solo 1 clase completada NO
    puede pedir NINGÚN cambio de paquete -- ni upgrade ni downgrade.
    """
    _set_min_classes(db, 3)

    old_pkg = _create_package(client, teacher_token, d7_env, name="Flow-test D7 viejo", classes_count=4, price=100.0)
    new_pkg = _create_package(client, teacher_token, d7_env, name=f"Flow-test D7 {direction}", classes_count=new_classes_count, price=100.0)
    enrollment_id = _make_enrollment(
        db, d7_env, package_id=old_pkg["id"], classes_total=4, classes_used=1, unlocked_credits=3,
    )

    r = client.post("/api/v1/payments/notify-payment", json={
        "type": "package_change", "enrollment_id": enrollment_id, "package_id": new_pkg["id"],
    }, headers=auth_headers(student_token))

    assert r.status_code == 400, r.text
    assert "3 clase" in r.json()["detail"]


@pytest.mark.parametrize("direction,new_classes_count", [("upgrade", 8), ("downgrade", 2)])
def test_d7_allows_package_change_at_or_above_minimum_both_directions(
    client, student_token, teacher_token, db, d7_env, direction, new_classes_count,
):
    """
    Contraprueba: con el mismo mínimo de 3, un estudiante que YA completó
    3 clases sí puede pedir el cambio (upgrade o downgrade).
    """
    _set_min_classes(db, 3)

    old_pkg = _create_package(client, teacher_token, d7_env, name="Flow-test D7 viejo ok", classes_count=4, price=100.0)
    new_pkg = _create_package(client, teacher_token, d7_env, name=f"Flow-test D7 {direction} ok", classes_count=new_classes_count, price=100.0)
    enrollment_id = _make_enrollment(
        db, d7_env, package_id=old_pkg["id"], classes_total=4, classes_used=3, unlocked_credits=1,
    )

    r = client.post("/api/v1/payments/notify-payment", json={
        "type": "package_change", "enrollment_id": enrollment_id, "package_id": new_pkg["id"],
    }, headers=auth_headers(student_token))

    assert r.status_code == 200, r.text


def test_d7_zero_minimum_means_no_restriction(client, student_token, teacher_token, db, d7_env):
    """
    Contraprueba: con el mínimo en 0 (default / "sin restricción"), un
    estudiante con 0 clases completadas puede pedir el cambio igual que
    siempre -- D7 no debe romper el comportamiento default de la
    plataforma para quien no configuró nada.
    """
    _set_min_classes(db, 0)

    old_pkg = _create_package(client, teacher_token, d7_env, name="Flow-test D7 sin restriccion", classes_count=4, price=100.0)
    new_pkg = _create_package(client, teacher_token, d7_env, name="Flow-test D7 sin restriccion nuevo", classes_count=8, price=100.0)
    enrollment_id = _make_enrollment(
        db, d7_env, package_id=old_pkg["id"], classes_total=4, classes_used=0, unlocked_credits=4,
    )

    r = client.post("/api/v1/payments/notify-payment", json={
        "type": "package_change", "enrollment_id": enrollment_id, "package_id": new_pkg["id"],
    }, headers=auth_headers(student_token))

    assert r.status_code == 200, r.text
