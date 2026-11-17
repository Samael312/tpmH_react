"""Revisión de flujos (2026-11-17): prueba gratis repetida, reagendar clase ya dada y clase en curso oculta."""
from datetime import datetime, timedelta, timezone

from tests.audit.conftest import hdr, future
from tests.audit.helpers import API, book, set_status, ready_student, age_class, iso
from app.core.class_logic import finalize_past_classes
from app.models.class_ import Class
from app.models.package import Enrollment


def _stage(client, w):
    return client.get(f"{API}/payments/booking-status?teacher_username=profe", headers=hdr(w["s_user"])).json()["stage"]


def _confirmed_trial(client, w):
    cid = book(client, w, future(24)).json()["class_id"]
    assert set_status(client, w, cid, "confirmed").status_code == 200
    return cid


# ─── Punto 2: una prueba solo una vez ─────────────────────────────────────────

def test_finalized_trial_is_still_in_progress(client, world, db):
    cid = _confirmed_trial(client, world)
    age_class(cid)
    db.expire_all()
    finalize_past_classes(db)
    assert db.get(Class, cid).status == "finalized"
    assert _stage(client, world) == "trial_in_progress"
    assert book(client, world, future(30)).status_code == 400


def test_no_show_trial_does_not_give_another_trial(client, world, db):
    cid = _confirmed_trial(client, world)
    assert set_status(client, world, cid, "no_show", age=True).status_code == 200
    assert _stage(client, world) == "needs_package"
    assert book(client, world, future(30)).status_code == 400


def test_trial_auto_no_show_after_72h_does_not_give_another_trial(client, world, db):
    cid = _confirmed_trial(client, world)
    age_class(cid, hours_ago=80)
    db.expire_all()
    finalize_past_classes(db)
    assert db.get(Class, cid).status == "no_show"
    assert _stage(client, world) == "needs_package"


# ─── Punto 1: el alumno no reagenda una clase que ya pasó ─────────────────────

def _finalized_regular(client, world, db):
    eid, _ = ready_student(client, world)
    cid = book(client, world, future(48), enrollment_id=eid).json()["class_id"]
    age_class(cid)
    db.expire_all()
    finalize_past_classes(db)
    assert db.get(Class, cid).status == "finalized"
    return eid, cid


def _move(new):
    return {"start_time_utc": iso(new), "end_time_utc": iso(new + timedelta(minutes=50))}


def test_student_cannot_reschedule_finalized_class(client, world, db):
    eid, cid = _finalized_regular(client, world, db)
    r = client.patch(f"{API}/classes/{cid}/reschedule", json=_move(future(72)), headers=hdr(world["s_user"]))
    assert r.status_code == 400, r.text
    db.expire_all()
    assert db.get(Class, cid).status == "finalized"
    assert db.get(Enrollment, eid).classes_used == 0


def test_teacher_can_still_reschedule_finalized_class(client, world, db):
    _eid, cid = _finalized_regular(client, world, db)
    r = client.patch(f"{API}/classes/teacher/{cid}/reschedule", json=_move(future(72)), headers=hdr(world["t_user"]))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(Class, cid).status == "confirmed"


# ─── Punto 3: una clase en curso sigue en «próximas» ──────────────────────────

def _start_class_now(db, cid, minutes_ago=10):
    c = db.get(Class, cid)
    c.start_time_utc = datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
    c.end_time_utc = c.start_time_utc + timedelta(minutes=c.duration)
    db.commit()


def test_in_progress_class_is_listed_as_upcoming(client, world, db):
    eid, _ = ready_student(client, world)
    cid = book(client, world, future(48), enrollment_id=eid).json()["class_id"]
    _start_class_now(db, cid)

    mine = client.get(f"{API}/classes/my-classes", headers=hdr(world["s_user"])).json()
    assert cid in [c["id"] for c in mine["classes"]]
    assert mine["upcoming"] == 1

    theirs = client.get(f"{API}/classes/teacher/classes", headers=hdr(world["t_user"])).json()
    assert cid in [c["id"] for c in theirs["classes"]]


def test_ended_class_is_not_upcoming(client, world, db):
    eid, _ = ready_student(client, world)
    cid = book(client, world, future(48), enrollment_id=eid).json()["class_id"]
    _start_class_now(db, cid, minutes_ago=120)  # 50 min de clase: terminó hace 70 min
    mine = client.get(f"{API}/classes/my-classes", headers=hdr(world["s_user"])).json()
    assert cid not in [c["id"] for c in mine["classes"]]
