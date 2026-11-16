"""Flujo feliz + reglas de agendado, créditos y cancelación."""
from datetime import timedelta

from tests.audit.conftest import hdr, future, _mk_user
from tests.audit.helpers import (
    API, iso, book, set_status, ready_student, complete_trial, buy_package,
)
from app.models.package import Enrollment
from app.models.class_ import Class
from app.models.student import StudentProfile


def test_stage_progression_trial_to_ready(client, world, db):
    s = hdr(world["s_user"])
    url = f"{API}/payments/booking-status?teacher_username=profe"
    assert client.get(url, headers=s).json()["stage"] == "needs_trial"
    r = book(client, world, future(24))
    assert r.status_code == 201 and r.json()["is_trial"] is True
    assert client.get(url, headers=s).json()["stage"] == "trial_in_progress"
    cid = r.json()["class_id"]
    set_status(client, world, cid, "confirmed")
    set_status(client, world, cid, "completed")
    assert client.get(url, headers=s).json()["stage"] == "needs_package"
    buy_package(client, world)
    assert client.get(url, headers=s).json()["stage"] == "ready"


def test_unpaid_package_stage_is_pending_payment(client, world, db):
    complete_trial(client, world)
    r = client.post(f"{API}/payments/notify-payment", json={
        "type": "package", "package_id": world["pkg"].id, "payment_method": "bank_transfer"},
        headers=hdr(world["s_user"]))
    assert r.status_code == 200
    st = client.get(f"{API}/payments/booking-status?teacher_username=profe", headers=hdr(world["s_user"])).json()
    assert st["stage"] == "package_pending_payment"


def test_credits_exhausted_after_4_bookings(client, world, db):
    eid, _ = ready_student(client, world)
    for i in range(4):
        r = book(client, world, future(48 + i * 24), enrollment_id=eid)
        assert r.status_code == 201, r.text
    r = book(client, world, future(48 + 5 * 24), enrollment_id=eid)
    assert r.status_code == 400
    assert "créditos" in r.json()["detail"]


def test_booking_overlap_same_student_blocked(client, world, db):
    eid, _ = ready_student(client, world)
    t = future(72)
    assert book(client, world, t, enrollment_id=eid).status_code == 201
    r = book(client, world, t + timedelta(minutes=20), enrollment_id=eid)
    assert r.status_code == 409


def test_min_booking_notice_enforced(client, world, db):
    eid, _ = ready_student(client, world)
    r = book(client, world, future(0) + timedelta(minutes=10), enrollment_id=eid)
    assert r.status_code in (400, 409)


def test_student_cancel_far_frees_credit(client, world, db):
    eid, _ = ready_student(client, world)
    cid = book(client, world, future(72), enrollment_id=eid).json()["class_id"]
    assert client.delete(f"{API}/classes/{cid}", headers=hdr(world["s_user"])).status_code == 200
    for i in range(4):
        assert book(client, world, future(100 + i * 24), enrollment_id=eid).status_code == 201


def test_student_cannot_cancel_within_12h(client, world, db):
    eid, _ = ready_student(client, world)
    cid = book(client, world, future(2), enrollment_id=eid).json()["class_id"]
    assert client.delete(f"{API}/classes/{cid}", headers=hdr(world["s_user"])).status_code == 400


def test_teacher_cancel_late_returns_credit(client, world, db):
    eid, _ = ready_student(client, world)
    cid = book(client, world, future(2), enrollment_id=eid).json()["class_id"]
    assert client.delete(f"{API}/classes/teacher/{cid}", headers=hdr(world["t_user"])).status_code == 200
    db.expire_all()
    assert db.get(Enrollment, eid).classes_used == 0


def test_student_reschedule_rules(client, world, db):
    eid, _ = ready_student(client, world)
    cid = book(client, world, future(72), enrollment_id=eid).json()["class_id"]
    new = future(96)
    r = client.patch(f"{API}/classes/{cid}/reschedule", json={
        "start_time_utc": iso(new), "end_time_utc": iso(new + timedelta(minutes=50))},
        headers=hdr(world["s_user"]))
    assert r.status_code == 200, r.text
    cid2 = book(client, world, future(3), enrollment_id=eid).json()["class_id"]
    far = future(120)
    r = client.patch(f"{API}/classes/{cid2}/reschedule", json={
        "start_time_utc": iso(far), "end_time_utc": iso(far + timedelta(minutes=50))},
        headers=hdr(world["s_user"]))
    assert r.status_code == 400


def test_student_cannot_touch_other_students_class(client, world, db):
    eid, _ = ready_student(client, world)
    cid = book(client, world, future(72), enrollment_id=eid).json()["class_id"]
    other = _mk_user(db, "student", "otro")
    db.add(StudentProfile(user_id=other.id, user_username="otro", timezone="UTC"))
    db.commit()
    assert client.delete(f"{API}/classes/{cid}", headers=hdr(other)).status_code == 404
    assert client.delete(f"{API}/classes/teacher/{cid}", headers=hdr(other)).status_code == 403


def test_finalize_past_classes_turns_old_unresolved_class_into_no_show(client, world, db):
    """NEG-02: una clase sin marcar 72 h después de terminar pasa a no_show y consume el crédito."""
    from app.core.class_logic import finalize_past_classes
    from app.core.timezone import utc_now
    eid, _ = ready_student(client, world)
    cid = book(client, world, future(72), enrollment_id=eid).json()["class_id"]
    c = db.get(Class, cid)
    c.start_time_utc = utc_now() - timedelta(hours=100)
    c.end_time_utc = utc_now() - timedelta(hours=99)
    db.commit()
    assert finalize_past_classes(db) == 2  # confirmed -> finalized -> no_show en la misma pasada
    db.expire_all()
    assert db.get(Class, cid).status == "no_show"
    assert finalize_past_classes(db) == 0
