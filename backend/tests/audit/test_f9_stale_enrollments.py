"""Fase 9: los GET de etapa de reserva ya no escriben; un barrido diario cancela los enrollments sin pagar."""
from datetime import timedelta

import pytest

from tests.audit.conftest import hdr
from tests.audit.helpers import API, buy_package, complete_trial, set_status
from app.core.class_logic import get_student_booking_stage, release_stale_unpaid_enrollments
from app.core.timezone import utc_now
from app.models.package import Enrollment, EnrollmentStatus
from app.models.payment import Payment


def _unpaid_enrollment(db, w, hours_old=48, **kw):
    e = Enrollment(student_id=w["sp"].id, package_id=w["pkg"].id, teacher_id=w["tp"].id,
                   status=EnrollmentStatus.active, payment_status="unpaid", classes_total=4, classes_used=0, **kw)
    db.add(e)
    db.commit()
    e.created_at = utc_now() - timedelta(hours=hours_old)
    db.commit()
    return e


@pytest.fixture
def trial_done(client, world):
    complete_trial(client, world)
    return world


def test_stage_without_heal_does_not_write(db, trial_done):
    e = _unpaid_enrollment(db, trial_done)
    stage = get_student_booking_stage(trial_done["sp"].id, trial_done["tp"].id, db, heal=False)
    assert stage == "needs_package"
    db.expire_all()
    assert db.get(Enrollment, e.id).status == EnrollmentStatus.active


def test_stage_with_heal_still_cancels(db, trial_done):
    e = _unpaid_enrollment(db, trial_done)
    assert get_student_booking_stage(trial_done["sp"].id, trial_done["tp"].id, db) == "needs_package"
    db.expire_all()
    assert db.get(Enrollment, e.id).status == EnrollmentStatus.cancelled


def test_booking_status_get_does_not_mutate(client, db, trial_done):
    e = _unpaid_enrollment(db, trial_done)
    r = client.get(f"{API}/payments/booking-status?teacher_username=profe", headers=hdr(trial_done["s_user"]))
    assert r.status_code == 200 and r.json()["stage"] == "needs_package"
    db.expire_all()
    assert db.get(Enrollment, e.id).status == EnrollmentStatus.active


def test_my_teachers_get_does_not_mutate_and_hides_stale_enrollment(client, db, trial_done):
    e = _unpaid_enrollment(db, trial_done)
    r = client.get(f"{API}/users/me/teachers", headers=hdr(trial_done["s_user"]))
    assert r.status_code == 200
    mine = [t for t in r.json() if t["teacher_username"] == "profe"]
    if mine:   # en modo multi-tenant el alumno de prueba esta vinculado
        assert mine[0]["stage"] == "needs_package" and mine[0]["active_enrollment"] is None
    db.expire_all()
    assert db.get(Enrollment, e.id).status == EnrollmentStatus.active


def test_choosing_a_package_still_works_over_a_stale_one(client, db, trial_done):
    """El POST (que escribe) sigue curando: el alumno puede elegir paquete de nuevo."""
    old = _unpaid_enrollment(db, trial_done)
    buy_package(client, trial_done)
    db.expire_all()
    assert db.get(Enrollment, old.id).status == EnrollmentStatus.cancelled
    st = client.get(f"{API}/payments/booking-status?teacher_username=profe", headers=hdr(trial_done["s_user"])).json()
    assert st["stage"] == "ready"


# ─── barrido ───────────────────────────────────────────────────────────────────

def test_sweep_cancels_only_old_unpaid(db, world):
    old = _unpaid_enrollment(db, world, hours_old=48)
    fresh = _unpaid_enrollment(db, world, hours_old=2)
    assert release_stale_unpaid_enrollments(db) == 1
    db.expire_all()
    assert db.get(Enrollment, old.id).status == EnrollmentStatus.cancelled
    assert db.get(Enrollment, fresh.id).status == EnrollmentStatus.active


def test_sweep_keeps_enrollment_with_payment_in_review(db, world):
    e = _unpaid_enrollment(db, world)
    db.add(Payment(enrollment_id=e.id, student_id=world["sp"].id, teacher_id=world["tp"].id, amount_total=10,
                   amount_teacher=9, amount_platform=1, payment_method="bank_transfer",
                   payment_type="package", status="pending_review"))
    db.commit()
    assert release_stale_unpaid_enrollments(db) == 0
    db.expire_all()
    assert db.get(Enrollment, e.id).status == EnrollmentStatus.active


def test_sweep_keeps_paid_enrollments(db, world):
    paid = _unpaid_enrollment(db, world)
    paid.payment_status = "paid"
    db.commit()
    assert release_stale_unpaid_enrollments(db) == 0


def test_sweep_is_idempotent_and_custom_window(db, world):
    _unpaid_enrollment(db, world, hours_old=5)
    assert release_stale_unpaid_enrollments(db, older_than_hours=24) == 0
    assert release_stale_unpaid_enrollments(db, older_than_hours=1) == 1
    assert release_stale_unpaid_enrollments(db, older_than_hours=1) == 0


def test_sweep_job_registered_and_runs(db, world):
    from app.core import scheduler as sch
    e = _unpaid_enrollment(db, world)
    sch.release_stale_enrollments()
    db.expire_all()
    assert db.get(Enrollment, e.id).status == EnrollmentStatus.cancelled
