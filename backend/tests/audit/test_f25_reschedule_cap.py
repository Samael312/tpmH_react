"""Fase 25 (m2) - Tope de reagendados por alumno y clase."""
from datetime import timedelta

from tests.audit.conftest import hdr, future
from tests.audit.helpers import API, iso, book, set_status, ready_student
from app.models.class_ import Class, MAX_STUDENT_RESCHEDULES


def _body(dt):
    return {"start_time_utc": iso(dt), "end_time_utc": iso(dt + timedelta(minutes=50))}


def _student_resched(client, world, cid, hours):
    return client.patch(f"{API}/classes/{cid}/reschedule", json=_body(future(hours)), headers=hdr(world["s_user"]))


def _setup(client, world):
    eid, _ = ready_student(client, world)
    return eid, book(client, world, future(72), enrollment_id=eid).json()["class_id"]


def test_cap_constant_is_two():
    assert MAX_STUDENT_RESCHEDULES == 2


def test_student_two_ok_third_rejected(client, world, db):
    _, cid = _setup(client, world)
    r = _student_resched(client, world, cid, 96)
    assert r.status_code == 200, r.text
    assert r.json()["student_reschedule_count"] == 1 and r.json()["reschedules_remaining"] == 1
    r = _student_resched(client, world, cid, 120)
    assert r.status_code == 200, r.text
    assert r.json()["student_reschedule_count"] == 2 and r.json()["reschedules_remaining"] == 0
    assert r.json()["reschedule_limit"] == 2
    r = _student_resched(client, world, cid, 144)
    assert r.status_code == 400
    assert "profesor" in r.json()["detail"]
    db.expire_all()
    c = db.get(Class, cid)
    assert c.student_reschedule_count == 2, "el contador sobrevive y no sube con el rechazo"


def test_teacher_and_admin_reschedule_do_not_count(client, world, db):
    _, cid = _setup(client, world)
    assert client.patch(f"{API}/classes/teacher/{cid}/reschedule", json=_body(future(96)),
                        headers=hdr(world["t_user"])).status_code == 200
    assert client.patch(f"{API}/classes/admin/{cid}/reschedule", json=_body(future(120)),
                        headers=hdr(world["admin"])).status_code == 200
    db.expire_all()
    assert db.get(Class, cid).student_reschedule_count == 0
    assert _student_resched(client, world, cid, 144).status_code == 200
    # el profesor puede seguir moviendo aunque el alumno agoto su tope
    assert _student_resched(client, world, cid, 168).status_code == 200
    assert _student_resched(client, world, cid, 190).status_code == 400
    assert client.patch(f"{API}/classes/teacher/{cid}/reschedule", json=_body(future(200)),
                        headers=hdr(world["t_user"])).status_code == 200


def test_cancelled_rules_unchanged_and_12h_rule(client, world, db):
    eid, cid = _setup(client, world)
    assert set_status(client, world, cid, "cancelled").status_code == 200
    r = _student_resched(client, world, cid, 96)
    assert r.status_code == 400 and "cancelada" in r.json()["detail"].lower() or "cancelled" in r.json()["detail"]
    db.expire_all()
    assert db.get(Class, cid).student_reschedule_count == 0
    cid2 = book(client, world, future(3), enrollment_id=eid).json()["class_id"]
    r = _student_resched(client, world, cid2, 120)
    assert r.status_code == 400 and "antelaci" in r.json()["detail"]
    db.expire_all()
    assert db.get(Class, cid2).student_reschedule_count == 0


def test_failed_conflict_does_not_count(client, world, db):
    eid, cid = _setup(client, world)
    book(client, world, future(96), enrollment_id=eid)
    assert _student_resched(client, world, cid, 96).status_code == 409
    db.expire_all()
    assert db.get(Class, cid).student_reschedule_count == 0
