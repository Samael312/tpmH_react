"""Fase 19: solapes de cohortes (multi-tenant).

- Crear una sesión de cohorte no agrega a un alumno que ya tiene otra clase a esa hora (con cualquier profesor)
  y lo informa en `skipped_participants`.
- El lado del alumno no cuenta el margen de preparación del otro profesor.
- Las consultas de choque del profesor incluyen pending_trial.
"""
from datetime import timedelta

from app.core.class_logic import can_book_slot
from app.core.student_overlap import student_has_overlap
from app.models.availability import TeacherAvailability
from app.models.class_ import Class, ClassType
from app.models.class_participant import ClassParticipant
from app.models.group_cohort import CohortStatus, GroupCohort
from app.models.package import Enrollment, Package
from app.models.student import StudentProfile
from app.models.teacher import TeacherProfile, TeacherStatus
from tests.audit.conftest import _mk_user, future, hdr
from tests.audit.helpers import API


def _other_teacher(db, username="profe2"):
    t_user = _mk_user(db, "teacher", username)
    tp = TeacherProfile(user_id=t_user.id, user_username=t_user.username, status=TeacherStatus.approved,
                        timezone="UTC", languages=["English"], subjects=["English"], video_url="http://v")
    db.add(tp)
    db.flush()
    for dow in range(7):
        db.add(TeacherAvailability(teacher_id=tp.id, day_of_week=dow, is_available=True,
                                   start_time_local="00:00", end_time_local="00:00"))
    db.commit()
    return tp


def _student(db, username):
    u = _mk_user(db, "student", username)
    sp = StudentProfile(user_id=u.id, user_username=u.username, timezone="UTC")
    db.add(sp)
    db.commit()
    return sp


def _cohort(db, w, students):
    gpkg = Package(teacher_id=w["tp"].id, name="G", subject="English", classes_count=10, price=60.0,
                   price_per_class=6.0, duration_minutes=50, is_active=True, is_group=True,
                   min_students=1, max_students=5)
    db.add(gpkg)
    db.flush()
    cohort = GroupCohort(package_id=gpkg.id, teacher_id=w["tp"].id, status=CohortStatus.confirmed,
                         min_students=1, max_students=5)
    db.add(cohort)
    db.flush()
    enrollments = []
    for sp in students:
        e = Enrollment(student_id=sp.id, package_id=gpkg.id, teacher_id=w["tp"].id, cohort_id=cohort.id,
                       payment_status="paid", classes_total=10)
        db.add(e)
        enrollments.append(e)
    db.commit()
    return cohort, enrollments


def _class(db, teacher_id, student_id, start, minutes=50, buffer=0, status="confirmed"):
    c = Class(teacher_id=teacher_id, student_id=student_id, class_type=ClassType.regular, subject="English",
              start_time_utc=start, end_time_utc=start + timedelta(minutes=minutes), duration=minutes,
              buffer_minutes=buffer, status=status)
    db.add(c)
    db.commit()
    return c


def _create_session(client, w, cohort, start):
    return client.post(f"{API}/cohorts/{cohort.id}/sessions",
                       json={"start_time_utc": start.isoformat(), "duration_minutes": 50},
                       headers=hdr(w["t_user"]))


def test_session_skips_student_with_other_teacher_class(client, db, world):
    other = _other_teacher(db)
    s2 = _student(db, "alumno2")
    cohort, _ = _cohort(db, world, [world["sp"], s2])
    start = future(72)
    _class(db, other.id, s2.id, start + timedelta(minutes=10))  # s2 ocupado con otro profesor
    r = _create_session(client, world, cohort, start)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["participant_count"] == 1
    assert [s["student_id"] for s in body["skipped_participants"]] == [s2.id]
    ids = {p.student_id for p in db.query(ClassParticipant).filter_by(class_id=body["id"]).all()}
    assert ids == {world["sp"].id}


def test_session_skips_student_with_pending_trial_and_other_group_session(client, db, world):
    other = _other_teacher(db)
    s2 = _student(db, "alumno2")
    s3 = _student(db, "alumno3")
    cohort, enrs = _cohort(db, world, [world["sp"], s2, s3])
    start = future(96)
    _class(db, other.id, s2.id, start, status="pending_trial")
    g = Class(teacher_id=other.id, student_id=None, class_type=ClassType.group, start_time_utc=start,
              end_time_utc=start + timedelta(minutes=50), duration=50, buffer_minutes=0, status="confirmed")
    db.add(g)
    db.flush()
    db.add(ClassParticipant(class_id=g.id, student_id=s3.id, enrollment_id=enrs[2].id,
                            attendance_status="confirmed"))
    db.commit()
    r = _create_session(client, world, cohort, start)
    assert r.status_code == 201, r.text
    assert {s["student_id"] for s in r.json()["skipped_participants"]} == {s2.id, s3.id}
    assert r.json()["participant_count"] == 1


def test_session_without_conflicts_has_no_skipped(client, db, world):
    cohort, _ = _cohort(db, world, [world["sp"]])
    r = _create_session(client, world, cohort, future(120))
    assert r.status_code == 201, r.text
    assert r.json()["skipped_participants"] == []
    assert r.json()["participant_count"] == 1


def test_student_side_ignores_other_teacher_buffer(client, db, world):
    other = _other_teacher(db)
    sp = world["sp"]
    start = future(72)
    _class(db, other.id, sp.id, start, buffer=10)  # termina start+50, margen 10 (del OTRO profesor)
    # 5 min despues del fin real: no hay solape para el alumno
    assert not student_has_overlap(db, sp.id, start + timedelta(minutes=55), start + timedelta(minutes=105))
    # solape real
    assert student_has_overlap(db, sp.id, start + timedelta(minutes=45), start + timedelta(minutes=95))
    # exclude
    c = db.query(Class).filter_by(student_id=sp.id).first()
    assert not student_has_overlap(db, sp.id, start, start + timedelta(minutes=50), exclude_class_id=c.id)
    # can_book_slot con el mismo criterio
    ok, msg = can_book_slot(start + timedelta(minutes=55), world["tp"].id, sp.id,
                            start + timedelta(minutes=105), db, enforce_min_notice=False)
    assert ok, msg


def test_helper_ignores_cancelled_and_cancelled_participation(db, world):
    other = _other_teacher(db)
    sp = world["sp"]
    _, enrs = _cohort(db, world, [sp])
    start = future(72)
    _class(db, other.id, sp.id, start, status="cancelled")
    g = Class(teacher_id=other.id, student_id=None, class_type=ClassType.group, start_time_utc=start,
              end_time_utc=start + timedelta(minutes=50), duration=50, buffer_minutes=0, status="confirmed")
    db.add(g)
    db.flush()
    db.add(ClassParticipant(class_id=g.id, student_id=sp.id, enrollment_id=enrs[0].id,
                            attendance_status="cancelled"))
    db.commit()
    assert not student_has_overlap(db, sp.id, start, start + timedelta(minutes=50))
    p = db.query(ClassParticipant).filter_by(class_id=g.id).first()
    p.attendance_status = "confirmed"
    db.commit()
    assert student_has_overlap(db, sp.id, start, start + timedelta(minutes=50))


def test_teacher_pending_trial_blocks_cohort_session(client, db, world):
    s2 = _student(db, "alumno2")
    cohort, _ = _cohort(db, world, [world["sp"]])
    start = future(72)
    _class(db, world["tp"].id, s2.id, start, status="pending_trial")
    r = _create_session(client, world, cohort, start)
    assert r.status_code == 409, r.text
