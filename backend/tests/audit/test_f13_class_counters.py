"""Fase 13 (A5): contadores y paginacion de las clases calculados en SQL (antes se cargaban todas en memoria)."""
from datetime import timedelta

from tests.audit.conftest import hdr
from app.core.timezone import utc_now
from app.models.class_ import Class
from app.models.class_participant import ClassParticipant

API = "/api/v1"


def _cls(db, w, status, hours, **kw):
    t0 = utc_now() + timedelta(hours=hours)
    c = Class(teacher_id=w["tp"].id, student_id=kw.pop("student_id", w["sp"].id), start_time_utc=t0,
              end_time_utc=t0 + timedelta(minutes=50), duration=50, status=status, subject="English", **kw)
    db.add(c)
    db.flush()
    return c


def _seed(db, w):
    _cls(db, w, "confirmed", 24)
    _cls(db, w, "confirmed", 48)
    _cls(db, w, "pending_trial", 72)
    _cls(db, w, "completed", -30)
    _cls(db, w, "completed", -50)
    _cls(db, w, "finalized", -10)
    _cls(db, w, "cancelled", -5)
    _cls(db, w, "no_show", -80)
    db.commit()


def test_teacher_counters_use_all_rows_with_history(client, db, world):
    _seed(db, world)
    r = client.get(f"{API}/classes/teacher/classes?include_history=true&limit=3&offset=0", headers=hdr(world["t_user"]))
    b = r.json()
    assert b["total"] == 8 and int(r.headers["X-Total-Count"]) == 8
    assert b["upcoming"] == 3          # confirmed x2 + pending_trial, aun sin terminar
    assert b["completed"] == 2         # el profesor solo cuenta `completed`
    assert len(b["classes"]) == 3


def test_student_counts_finalized_as_completed(client, db, world):
    _seed(db, world)
    b = client.get(f"{API}/classes/my-classes?include_history=true", headers=hdr(world["s_user"])).json()
    assert (b["total"], b["upcoming"], b["completed"]) == (8, 3, 3)  # el alumno cuenta completed + finalized


def test_default_listing_hides_history_but_counters_follow_the_filter(client, db, world):
    _seed(db, world)
    b = client.get(f"{API}/classes/my-classes", headers=hdr(world["s_user"])).json()
    assert (b["total"], b["upcoming"], b["completed"]) == (3, 3, 0)
    assert len(b["classes"]) == 3


def test_pages_are_disjoint_ordered_and_cover_everything(client, db, world):
    _seed(db, world)
    h = hdr(world["t_user"])
    ids, starts = [], []
    for off in (0, 3, 6, 9):
        rows = client.get(f"{API}/classes/teacher/classes?include_history=true&limit=3&offset={off}", headers=h).json()["classes"]
        ids += [c["id"] for c in rows]
        starts += [c["start_time_utc"] for c in rows]
    assert len(ids) == 8 and len(set(ids)) == 8
    assert starts == sorted(starts)


def test_student_sees_group_class_through_participants(client, db, world):
    g = _cls(db, world, "confirmed", 24, student_id=None, class_type="group")
    db.add(ClassParticipant(class_id=g.id, student_id=world["sp"].id, enrollment_id=0, attendance_status="confirmed"))
    out = _cls(db, world, "confirmed", 30, student_id=None, class_type="group")  # sin este alumno: no debe verse
    db.add(ClassParticipant(class_id=out.id, student_id=world["sp"].id + 999, enrollment_id=0, attendance_status="confirmed"))
    gone = _cls(db, world, "confirmed", 36, student_id=None, class_type="group")  # el alumno salio de la sesion
    db.add(ClassParticipant(class_id=gone.id, student_id=world["sp"].id, enrollment_id=0, attendance_status="cancelled"))
    db.commit()
    b = client.get(f"{API}/classes/my-classes", headers=hdr(world["s_user"])).json()
    assert [c["id"] for c in b["classes"]] == [g.id] and b["total"] == 1
