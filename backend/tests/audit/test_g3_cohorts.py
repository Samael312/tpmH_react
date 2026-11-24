"""Cobertura de `app/api/v1/endpoints/cohorts.py`: ciclo de vida del grupo, sesiones, asistencia, inscripción y migración."""
from datetime import timedelta

from tests.audit.conftest import _mk_user, hdr, future
from tests.audit.helpers import API
from app.models.class_ import Class, ClassType
from app.models.class_participant import ClassParticipant
from app.models.group_cohort import CohortStatus, GroupCohort
from app.models.package import Enrollment, EnrollmentStatus, Package
from app.models.student import StudentProfile
from app.models.teacher import TeacherProfile, TeacherStatus

C = f"{API}/cohorts"


def teacher_h(w):
    return hdr(w["t_user"])


def mk_gpkg(db, w, mode="manual", classes=4, **kw):
    p = Package(teacher_id=w["tp"].id, name="Grupo", subject="English", classes_count=classes, price=80.0,
                price_per_class=20.0, duration_minutes=50, is_active=True, is_group=True, min_students=1,
                max_students=3, group_schedule_mode=mode, **kw)
    db.add(p)
    db.commit()
    return p


def mk_cohort(db, w, pkg, status=CohortStatus.filling, mx=3, mn=1):
    c = GroupCohort(package_id=pkg.id, teacher_id=w["tp"].id, status=status, min_students=mn, max_students=mx)
    db.add(c)
    db.commit()
    return c


def mk_member(db, w, cohort, pkg, name, paid=True):
    u = _mk_user(db, "student", name)
    sp = StudentProfile(user_id=u.id, user_username=name, timezone="UTC")
    db.add(sp)
    db.flush()
    e = Enrollment(student_id=sp.id, package_id=pkg.id, teacher_id=w["tp"].id, cohort_id=cohort.id,
                   payment_status="paid" if paid else "unpaid", classes_total=pkg.classes_count,
                   status=EnrollmentStatus.active)
    db.add(e)
    db.commit()
    return u, sp, e


# ── crear, editar, listar ────────────────────────────────────────────────────────────────
def test_create_edit_list_cohort(client, world, db):
    gp = mk_gpkg(db, world)
    h = teacher_h(world)
    r = client.post(f"{C}/", json={"package_id": gp.id, "min_students": 1, "max_students": 3}, headers=h)
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    assert client.post(f"{C}/", json={"package_id": 999, "min_students": 1, "max_students": 3}, headers=h).status_code == 404
    assert client.post(f"{C}/", json={"package_id": world["pkg"].id, "min_students": 1, "max_students": 3}, headers=h).status_code == 400
    assert client.patch(f"{C}/{cid}", json={"min_students": 2, "max_students": 4}, headers=h).status_code == 200
    assert client.patch(f"{C}/{cid}", json={}, headers=h).status_code == 400
    assert client.patch(f"{C}/{cid}", json={"min_students": 9}, headers=h).status_code == 400
    assert client.patch(f"{C}/999", json={"min_students": 1}, headers=h).status_code == 404
    mk_member(db, world, db.get(GroupCohort, cid), gp, "m1")
    mk_member(db, world, db.get(GroupCohort, cid), gp, "m2")
    assert client.patch(f"{C}/{cid}", json={"max_students": 1}, headers=h).status_code == 400
    mine = client.get(f"{C}/teacher", headers=h).json()
    assert [c["id"] for c in mine] == [cid]
    db.get(GroupCohort, cid).status = CohortStatus.cancelled
    db.commit()
    assert client.patch(f"{C}/{cid}", json={"max_students": 5}, headers=h).status_code == 400


def test_members_and_effective_price(client, world, db):
    gp = mk_gpkg(db, world)
    co = mk_cohort(db, world, gp)
    mk_member(db, world, co, gp, "mm1")
    h = teacher_h(world)
    m = client.get(f"{C}/{co.id}/members", headers=h).json()
    assert len(m) == 1 and m[0]["student_name"]
    assert client.get(f"{C}/999/members", headers=h).status_code == 404
    # con una sesión completada el precio de entrada baja
    db.add(Class(teacher_id=world["tp"].id, cohort_id=co.id, class_type=ClassType.group, start_time_utc=future(-30),
                 end_time_utc=future(-29), duration=50, buffer_minutes=10, status="completed"))
    db.commit()
    c = client.get(f"{C}/teacher", headers=h).json()[0]
    assert c["completed_sessions"] == 1 and c["effective_price"] == 60.0


# ── horario recurrente ───────────────────────────────────────────────────────────────────
def fixed_pkg(db, w):
    return mk_gpkg(db, w, mode="fixed", classes=3, group_recurring_days_of_week=list(range(7)),
                   group_recurring_time_local="10:00")


def test_recurring_candidates(client, world, db):
    h = teacher_h(world)
    gp = fixed_pkg(db, world)
    co = mk_cohort(db, world, gp)
    r = client.get(f"{C}/{co.id}/recurring-candidates?count=3", headers=h)
    assert r.status_code == 200 and len(r.json()) == 3
    assert all("available" in x for x in r.json())
    assert client.get(f"{C}/999/recurring-candidates", headers=h).status_code == 404
    manual = mk_cohort(db, world, mk_gpkg(db, world))
    assert client.get(f"{C}/{manual.id}/recurring-candidates", headers=h).status_code == 400
    broken = mk_gpkg(db, world, mode="fixed")
    bc = mk_cohort(db, world, broken)
    assert client.get(f"{C}/{bc.id}/recurring-candidates", headers=h).status_code == 400


def test_recurring_candidates_report_conflicts(client, world, db):
    h = teacher_h(world)
    gp = fixed_pkg(db, world)
    co = mk_cohort(db, world, gp)
    first = client.get(f"{C}/{co.id}/recurring-candidates?count=2", headers=h).json()
    from datetime import datetime
    s0 = datetime.fromisoformat(first[0]["start_time_utc"])
    s1 = datetime.fromisoformat(first[1]["start_time_utc"])
    # una individual en la primera y otra grupal en la segunda
    db.add(Class(teacher_id=world["tp"].id, class_type=ClassType.regular, start_time_utc=s0, end_time_utc=s0 + timedelta(minutes=50),
                 duration=50, buffer_minutes=10, status="confirmed"))
    other = mk_cohort(db, world, mk_gpkg(db, world))
    db.add(Class(teacher_id=world["tp"].id, cohort_id=other.id, class_type=ClassType.group, start_time_utc=s1,
                 end_time_utc=s1 + timedelta(minutes=50), duration=50, buffer_minutes=10, status="confirmed"))
    db.commit()
    res = client.get(f"{C}/{co.id}/recurring-candidates?count=2", headers=h).json()
    assert res[0]["available"] is False and "individual" in res[0]["reason"]
    assert res[1]["available"] is False and "grupal" in res[1]["reason"]


def test_recurring_candidates_outside_availability(client, world, db):
    from tests.audit.helpers import restrict_availability
    restrict_availability(db, world, "01:00", "02:00")
    gp = fixed_pkg(db, world)
    co = mk_cohort(db, world, gp)
    res = client.get(f"{C}/{co.id}/recurring-candidates?count=2", headers=teacher_h(world)).json()
    assert all(x["available"] is False for x in res)


# ── cerrar (manual y fijo), reabrir, cancelar, completar ─────────────────────────────────
def test_close_manual_creates_first_session(client, world, db):
    h = teacher_h(world)
    gp = mk_gpkg(db, world)
    co = mk_cohort(db, world, gp)
    body = {"start_date": future(72).isoformat(), "duration_minutes": 50}
    assert client.post(f"{C}/{co.id}/close", json=body, headers=h).status_code == 400  # sin alumnos
    mk_member(db, world, co, gp, "c1")
    assert client.post(f"{C}/999/close", json=body, headers=h).status_code == 404
    r = client.post(f"{C}/{co.id}/close", json=body, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "confirmed"
    assert client.post(f"{C}/{co.id}/close", json=body, headers=h).status_code == 400  # ya cerrado
    assert client.post(f"{C}/{co.id}/reopen", headers=h).status_code == 200
    assert client.post(f"{C}/{co.id}/reopen", headers=h).status_code == 400
    assert client.post(f"{C}/999/reopen", headers=h).status_code == 404


def test_close_fixed_schedule_creates_series_and_rejects_bad_date(client, world, db):
    h = teacher_h(world)
    gp = fixed_pkg(db, world)
    co = mk_cohort(db, world, gp)
    mk_member(db, world, co, gp, "f1")
    cands = client.get(f"{C}/{co.id}/recurring-candidates?count=1", headers=h).json()
    good = cands[0]["start_time_utc"]
    from datetime import datetime
    off = (datetime.fromisoformat(good) + timedelta(hours=3)).isoformat()
    assert client.post(f"{C}/{co.id}/close", json={"start_date": off, "duration_minutes": 50}, headers=h).status_code == 400
    r = client.post(f"{C}/{co.id}/close", json={"start_date": good, "duration_minutes": 50}, headers=h)
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.query(Class).filter(Class.cohort_id == co.id, Class.class_type == ClassType.group).count() == 3


def test_close_fixed_conflict_aborts(client, world, db):
    h = teacher_h(world)
    gp = fixed_pkg(db, world)
    co = mk_cohort(db, world, gp)
    mk_member(db, world, co, gp, "f2")
    good = client.get(f"{C}/{co.id}/recurring-candidates?count=1", headers=h).json()[0]["start_time_utc"]
    from datetime import datetime
    s = datetime.fromisoformat(good)
    db.add(Class(teacher_id=world["tp"].id, class_type=ClassType.regular, start_time_utc=s, end_time_utc=s + timedelta(minutes=50),
                 duration=50, buffer_minutes=10, status="confirmed"))
    db.commit()
    assert client.post(f"{C}/{co.id}/close", json={"start_date": good, "duration_minutes": 50}, headers=h).status_code == 400


def test_close_fixed_without_valid_schedule(client, world, db):
    h = teacher_h(world)
    gp = mk_gpkg(db, world, mode="fixed")
    co = mk_cohort(db, world, gp)
    mk_member(db, world, co, gp, "f3")
    assert client.post(f"{C}/{co.id}/close", json={"start_date": future(48).isoformat(), "duration_minutes": 50}, headers=h).status_code == 400


def test_cancel_cohort_notifies_and_cancels_sessions(client, world, db):
    h = teacher_h(world)
    gp = mk_gpkg(db, world)
    co = mk_cohort(db, world, gp)
    mk_member(db, world, co, gp, "x1")
    client.post(f"{C}/{co.id}/close", json={"start_date": future(72).isoformat(), "duration_minutes": 50}, headers=h)
    assert client.post(f"{C}/{co.id}/cancel", headers=h).status_code == 200
    assert client.post(f"{C}/{co.id}/cancel", headers=h).status_code == 400
    assert client.post(f"{C}/999/cancel", headers=h).status_code == 404
    db.expire_all()
    assert db.query(Class).filter(Class.cohort_id == co.id, Class.status != "cancelled").count() == 0


def test_complete_cohort(client, world, db):
    h = teacher_h(world)
    gp = mk_gpkg(db, world)
    co = mk_cohort(db, world, gp, status=CohortStatus.confirmed, mn=3)
    mk_member(db, world, co, gp, "y1")  # por debajo del mínimo: se cancelan inscripciones
    assert client.post(f"{C}/999/complete", headers=h).status_code == 404
    r = client.post(f"{C}/{co.id}/complete", headers=h)
    assert r.status_code == 200 and r.json()["status"] == "completed"
    assert client.post(f"{C}/{co.id}/complete", headers=h).status_code == 400
    ok = mk_cohort(db, world, gp, status=CohortStatus.in_progress, mn=1)
    mk_member(db, world, ok, gp, "y2")
    assert client.post(f"{C}/{ok.id}/complete", headers=h).status_code == 200


# ── sesiones y asistencia ────────────────────────────────────────────────────────────────
def session_body(hours=72, minutes=50):
    return {"start_time_utc": future(hours).isoformat(), "duration_minutes": minutes}


def test_group_session_validations(client, world, db):
    h = teacher_h(world)
    gp = mk_gpkg(db, world, classes=1)
    co = mk_cohort(db, world, gp, status=CohortStatus.confirmed)
    assert client.post(f"{C}/999/sessions", json=session_body(), headers=h).status_code == 404
    filling = mk_cohort(db, world, gp)
    assert client.post(f"{C}/{filling.id}/sessions", json=session_body(), headers=h).status_code == 400
    assert client.post(f"{C}/{co.id}/sessions", json=session_body(), headers=h).status_code == 400  # sin pagos
    mk_member(db, world, co, gp, "s1")
    assert client.post(f"{C}/{co.id}/sessions", json=session_body(minutes=5), headers=h).status_code == 400  # duración
    ok = client.post(f"{C}/{co.id}/sessions", json=session_body(), headers=h)
    assert ok.status_code == 201, ok.text
    # el paquete solo incluye 1 sesión
    assert client.post(f"{C}/{co.id}/sessions", json=session_body(96), headers=h).status_code == 400


def test_group_session_conflicts_and_availability(client, world, db):
    from tests.audit.helpers import restrict_availability
    h = teacher_h(world)
    gp = mk_gpkg(db, world, classes=6)
    co = mk_cohort(db, world, gp, status=CohortStatus.confirmed)
    mk_member(db, world, co, gp, "s2")
    start = future(72)
    db.add(Class(teacher_id=world["tp"].id, class_type=ClassType.regular, start_time_utc=start, end_time_utc=start + timedelta(minutes=50),
                 duration=50, buffer_minutes=10, status="confirmed"))
    db.commit()
    assert client.post(f"{C}/{co.id}/sessions", json={"start_time_utc": start.isoformat(), "duration_minutes": 50}, headers=h).status_code == 409
    other = mk_cohort(db, world, mk_gpkg(db, world), status=CohortStatus.confirmed)
    s2 = future(120)
    db.add(Class(teacher_id=world["tp"].id, cohort_id=other.id, class_type=ClassType.group, start_time_utc=s2,
                 end_time_utc=s2 + timedelta(minutes=50), duration=50, buffer_minutes=10, status="confirmed"))
    db.commit()
    assert client.post(f"{C}/{co.id}/sessions", json={"start_time_utc": s2.isoformat(), "duration_minutes": 50}, headers=h).status_code == 409
    restrict_availability(db, world, "01:00", "02:00")
    # Hora fija (12:00 UTC; el profesor de prueba está en UTC): con `session_body(200)` la hora dependía de cuándo
    # corriera la prueba y, a ciertas horas del día, caía dentro de la ventana 01:00-02:00 y se aceptaba (201).
    outside = future(200).replace(hour=12)
    assert client.post(f"{C}/{co.id}/sessions", json={"start_time_utc": outside.isoformat(), "duration_minutes": 50},
                       headers=h).status_code == 400


def test_sessions_listing_access_attendance(client, world, db):
    h = teacher_h(world)
    gp = mk_gpkg(db, world, classes=6)
    co = mk_cohort(db, world, gp, status=CohortStatus.confirmed)
    su, sp, e = mk_member(db, world, co, gp, "a1")
    sid = client.post(f"{C}/{co.id}/sessions", json=session_body(), headers=h).json()["id"]
    # una sesión pasada con participante para el resumen
    past = Class(teacher_id=world["tp"].id, cohort_id=co.id, class_type=ClassType.group, start_time_utc=future(-30),
                 end_time_utc=future(-29), duration=50, buffer_minutes=10, status="completed")
    db.add(past)
    db.flush()
    db.add(ClassParticipant(class_id=past.id, student_id=sp.id, enrollment_id=e.id, attendance_status="no_show"))
    db.add(ClassParticipant(class_id=past.id, student_id=world["sp"].id, enrollment_id=e.id, attendance_status="cancelled"))
    db.commit()
    # el alumno inscrito, el profesor y el admin ven las sesiones; otro alumno no
    for user in (su, world["t_user"], world["admin"]):
        assert client.get(f"{C}/{co.id}/sessions", headers=hdr(user)).status_code == 200
    assert client.get(f"{C}/{co.id}/sessions", headers=hdr(world["s_user"])).status_code == 403
    assert client.get(f"{C}/999/sessions", headers=h).status_code == 404
    # participantes y asistencia
    assert len(client.get(f"{C}/sessions/{sid}/participants", headers=h).json()) == 1
    assert client.get(f"{C}/sessions/999/participants", headers=h).status_code == 404
    att = f"{C}/sessions/{sid}/participants/{sp.id}/attendance"
    assert client.patch(att, json={"attendance_status": "no_show"}, headers=h).status_code == 200
    assert client.patch(att, json={"attendance_status": "x"}, headers=h).status_code == 400
    assert client.patch(f"{C}/sessions/999/participants/{sp.id}/attendance", json={"attendance_status": "confirmed"}, headers=h).status_code == 404
    assert client.patch(f"{C}/sessions/{sid}/participants/999/attendance", json={"attendance_status": "confirmed"}, headers=h).status_code == 404
    summary = client.get(f"{C}/{co.id}/attendance-summary", headers=h).json()
    assert summary[0]["sessions_no_show"] == 1 and summary[0]["sessions_total"] == 1
    assert client.get(f"{C}/999/attendance-summary", headers=h).status_code == 404


# ── alumno: ver, inscribirse, salir, migrar ──────────────────────────────────────────────
def enroll(client, world, cid, **kw):
    body = {"cohort_id": cid, "payment_method": "bank_transfer", "transaction_reference": "R1", **kw}
    return client.post(f"{C}/{cid}/enroll", json=body, headers=hdr(world["s_user"]))


def test_available_and_enroll_and_leave(client, world, db):
    gp = mk_gpkg(db, world)
    co = mk_cohort(db, world, gp, mx=1)
    av = client.get(f"{C}/available?package_id={gp.id}", headers=hdr(world["s_user"])).json()
    assert [c["id"] for c in av] == [co.id]
    r = enroll(client, world, co.id)
    assert r.status_code == 201, r.text
    assert enroll(client, world, co.id).status_code == 400  # ya inscrito (o sin cupo)
    # el grupo ya no aparece (lleno)
    assert client.get(f"{C}/available?package_id={gp.id}", headers=hdr(world["s_user"])).json() == []
    assert enroll(client, world, 999).status_code == 404
    assert client.post(f"{C}/{co.id}/leave", headers=hdr(world["s_user"])).status_code == 200
    assert client.post(f"{C}/{co.id}/leave", headers=hdr(world["s_user"])).status_code == 404


def test_enroll_full_and_already_enrolled_separately(client, world, db):
    gp = mk_gpkg(db, world)
    full = mk_cohort(db, world, gp, mx=1)
    mk_member(db, world, full, gp, "ocupa")
    assert enroll(client, world, full.id).status_code == 400
    co = mk_cohort(db, world, gp, mx=3)
    assert enroll(client, world, co.id).status_code == 201
    assert enroll(client, world, co.id).status_code == 400


def test_enroll_when_all_classes_given(client, world, db):
    gp = mk_gpkg(db, world, classes=1)
    co = mk_cohort(db, world, gp, status=CohortStatus.in_progress)
    db.add(Class(teacher_id=world["tp"].id, cohort_id=co.id, class_type=ClassType.group, start_time_utc=future(-30),
                 end_time_utc=future(-29), duration=50, buffer_minutes=10, status="completed"))
    db.commit()
    assert enroll(client, world, co.id).status_code == 400


def test_late_join_pays_remaining_classes(client, world, db):
    gp = mk_gpkg(db, world, classes=4)
    co = mk_cohort(db, world, gp, status=CohortStatus.in_progress)
    db.add(Class(teacher_id=world["tp"].id, cohort_id=co.id, class_type=ClassType.group, start_time_utc=future(-30),
                 end_time_utc=future(-29), duration=50, buffer_minutes=10, status="completed"))
    db.commit()
    r = enroll(client, world, co.id)
    assert r.status_code == 201 and r.json()["amount_charged"] == 60.0


def test_migration_quote(client, world, db):
    h = hdr(world["s_user"])
    gp = mk_gpkg(db, world)
    co = mk_cohort(db, world, gp)
    eid = enroll(client, world, co.id).json()["enrollment_id"]
    q = f"{C}/migration-quote?current_enrollment_id={eid}&new_package_id={world['pkg'].id}"
    r = client.get(q, headers=h)
    assert r.status_code == 200, r.text
    assert "difference_usd" in r.json()
    assert client.get(f"{C}/migration-quote?current_enrollment_id=999&new_package_id=1", headers=h).status_code == 404
    assert client.get(f"{C}/migration-quote?current_enrollment_id={eid}&new_package_id=999", headers=h).status_code == 404
    indiv = Enrollment(student_id=world["sp"].id, package_id=world["pkg"].id, teacher_id=world["tp"].id,
                       status=EnrollmentStatus.active, classes_total=4)
    db.add(indiv)
    db.commit()
    assert client.get(f"{C}/migration-quote?current_enrollment_id={indiv.id}&new_package_id={world['pkg'].id}", headers=h).status_code == 400
    # con una sesión ya ocupada el cálculo usa el valor restante
    e = db.get(Enrollment, eid)
    c = Class(teacher_id=world["tp"].id, cohort_id=co.id, class_type=ClassType.group, start_time_utc=future(-30),
              end_time_utc=future(-29), duration=50, buffer_minutes=10, status="completed")
    db.add(c)
    db.flush()
    db.add(ClassParticipant(class_id=c.id, student_id=world["sp"].id, enrollment_id=eid, attendance_status="confirmed"))
    db.commit()
    assert client.get(q, headers=h).status_code == 200
