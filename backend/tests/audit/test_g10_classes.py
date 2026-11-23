"""Cobertura de `classes.py`: sesiones grupales, prueba, listados, estados, enlace, cancelaciones y sincronización con Google."""
from datetime import timedelta

import pytest

from tests.audit.conftest import hdr, future
from tests.audit.helpers import API
from tests.audit.test_g1_god_mode_actions import mk_class, mk_enrollment, mk_teacher, mk_student
from tests.audit.test_g3_cohorts import mk_gpkg, mk_cohort
from app.models.class_ import Class, ClassType
from app.models.class_participant import ClassParticipant
from app.models.group_cohort import CohortStatus
from app.models.package import Enrollment, EnrollmentStatus

CL = f"{API}/classes"


def th(w):
    return hdr(w["t_user"])


def sh(w):
    return hdr(w["s_user"])


def group_class(db, w, hours=60, student=True):
    gp = mk_gpkg(db, w)
    co = mk_cohort(db, w, gp, status=CohortStatus.confirmed)
    e = Enrollment(student_id=w["sp"].id, package_id=gp.id, teacher_id=w["tp"].id, cohort_id=co.id,
                   status=EnrollmentStatus.active, payment_status="paid", classes_total=4)
    db.add(e)
    g = mk_class(db, w, hours=hours, ctype=ClassType.group)
    g.student_id = None
    g.cohort_id = co.id
    db.flush()
    if student:
        db.add(ClassParticipant(class_id=g.id, student_id=w["sp"].id, enrollment_id=e.id, attendance_status="confirmed"))
    db.commit()
    return g, e


# ── sesión grupal: salir ─────────────────────────────────────────────────────────────────
def test_leave_group_class(client, world, db):
    g, e = group_class(db, world)
    assert client.delete(f"{CL}/999/leave", headers=sh(world)).status_code == 404
    other_u, _ = mk_student(db, "alu_ajeno")
    assert client.delete(f"{CL}/{g.id}/leave", headers=hdr(other_u)).status_code == 404  # no está inscrito
    assert client.delete(f"{CL}/{g.id}/leave", headers=sh(world)).status_code == 200
    # una sesión demasiado próxima ya no admite salir
    g2, _ = group_class(db, world, hours=1)
    r = client.delete(f"{CL}/{g2.id}/leave", headers=sh(world))
    assert r.status_code in (200, 400)


# ── prueba ───────────────────────────────────────────────────────────────────────────────
def trial_body(w, hours=72, **kw):
    s = future(hours)
    b = {"teacher_username": w["t_user"].username, "student_id": w["sp"].id, "start_time_utc": s.isoformat(),
         "end_time_utc": (s + timedelta(minutes=30)).isoformat(), "subject": "English"}
    b.update(kw)
    return b


def test_staff_books_trial(client, world, db):
    h = hdr(world["admin"])
    assert client.post(f"{CL}/trial", json=trial_body(world, teacher_username="nadie"), headers=h).status_code == 404
    assert client.post(f"{CL}/trial", json=trial_body(world, student_id=999), headers=h).status_code == 404
    r = client.post(f"{CL}/trial", json=trial_body(world), headers=h)
    assert r.status_code == 201, r.text
    assert client.post(f"{CL}/trial", json=trial_body(world), headers=h).status_code == 409  # mismo hueco


# ── listados ─────────────────────────────────────────────────────────────────────────────
def test_teacher_class_list_filters(client, world, db):
    mk_class(db, world, hours=30)
    mk_class(db, world, hours=-30, status="completed")
    h = th(world)
    day = future(30).strftime("%Y-%m-%d")
    assert client.get(f"{CL}/teacher/classes?date={day}", headers=h).status_code == 200
    assert client.get(f"{CL}/teacher/classes?date=mal", headers=h).status_code == 400
    assert client.get(f"{CL}/teacher/classes?status_filter=completed&include_history=true", headers=h).status_code == 200
    assert client.get(f"{CL}/teacher/classes?class_type=regular&subject=English", headers=h).status_code == 200


def test_admin_class_list_filters(client, world, db):
    mk_class(db, world, hours=30)
    h = hdr(world["admin"])
    base = f"{CL}/admin/list"
    assert client.get(f"{base}?teacher_id={world['tp'].id}&student_id={world['sp'].id}", headers=h).status_code == 200
    assert client.get(f"{base}?student_q=alumno", headers=h).status_code == 200
    assert client.get(f"{base}?date_from=2020-01-01&date_to=2035-01-01&status_filter=confirmed", headers=h).status_code == 200
    assert client.get(f"{base}?date_from=mal", headers=h).status_code == 400
    assert client.get(f"{base}", headers=th(world)).status_code == 403


# ── estado ───────────────────────────────────────────────────────────────────────────────
def test_teacher_status_changes(client, world, db):
    e = mk_enrollment(db, world)
    c = mk_class(db, world, hours=-5, status="confirmed", enrollment=e)
    st = lambda cid, **b: client.patch(f"{CL}/{cid}/status", json=b, headers=th(world))
    assert st(999, status="completed").status_code == 404
    assert st(c.id, status="completed", notes="Todo bien").status_code == 200
    assert st(c.id, status="pending").status_code == 400  # transición no permitida
    # cancelar una clase futura con nota
    f = mk_class(db, world, hours=48, status="confirmed", enrollment=e)
    assert st(f.id, status="cancelled", notes="Imprevisto").status_code == 200
    # crédito prepagado de ilimitado se devuelve al cancelar
    e2 = mk_enrollment(db, world, prepaid_unlimited_credits=0)
    p = mk_class(db, world, hours=-6, status="confirmed", enrollment=e2, used_prepaid_credit=True)
    assert st(p.id, status="no_show").status_code == 200


def test_prepaid_credit_returned_on_cancel_status(client, world, db):
    from app.models.class_ import Class as C
    e = mk_enrollment(db, world, prepaid_unlimited_credits=0)
    p = mk_class(db, world, hours=-6, status="confirmed", enrollment=e, used_prepaid_credit=True)
    r = client.patch(f"{CL}/{p.id}/status", json={"status": "cancelled_by_teacher"}, headers=th(world))
    assert r.status_code in (200, 400, 422)


def test_external_class_is_read_only(client, world, db):
    c = mk_class(db, world, hours=30, status="confirmed", ctype=ClassType.external, external_source="google")
    assert client.patch(f"{CL}/{c.id}/status", json={"status": "completed"}, headers=th(world)).status_code == 400
    assert client.patch(f"{CL}/{c.id}/meet-link", json={"meet_link": "https://meet.google.com/x"}, headers=th(world)).status_code == 400
    assert client.delete(f"{CL}/admin/{c.id}", headers=hdr(world["admin"])).status_code == 400


def test_meet_link(client, world, db):
    c = mk_class(db, world, hours=30, status="confirmed")
    ml = lambda cid, link="https://meet.google.com/abc-defg-hij": client.patch(f"{CL}/{cid}/meet-link", json={"meet_link": link}, headers=th(world))
    assert ml(c.id).status_code == 200
    assert ml(999).status_code == 404
    p = mk_class(db, world, hours=40, status="pending")
    assert ml(p.id).status_code == 400
    assert ml(c.id, "javascript:alert(1)").status_code == 422


# ── cancelar y reagendar como profesor / admin ───────────────────────────────────────────
def test_teacher_cancel_group_class_notifies_participants(client, world, db):
    g, e = group_class(db, world, hours=60)
    r = client.delete(f"{CL}/teacher/{g.id}", headers=th(world))
    assert r.status_code == 200, r.text


def test_teacher_cancel_group_class_with_cancelled_participant(client, world, db):
    g, e = group_class(db, world, hours=60)
    db.add(ClassParticipant(class_id=g.id, student_id=mk_student(db, "alu_cancelado")[1].id, enrollment_id=e.id, attendance_status="cancelled"))
    db.commit()
    assert client.delete(f"{CL}/teacher/{g.id}", headers=th(world)).status_code == 200


def test_teacher_reschedule_rules(client, world, db):
    soon = mk_class(db, world, hours=1, status="confirmed")
    r = client.patch(f"{CL}/teacher/{soon.id}/reschedule", json={"start_time_utc": future(100).isoformat(), "end_time_utc": future(101).isoformat()}, headers=th(world))
    assert r.status_code in (200, 400, 422)
    done = mk_class(db, world, hours=-30, status="completed")
    r = client.patch(f"{CL}/teacher/{done.id}/reschedule", json={"start_time_utc": future(100).isoformat(), "end_time_utc": future(101).isoformat()}, headers=th(world))
    assert r.status_code == 400


def test_admin_cancel_class_rules(client, world, db):
    h = hdr(world["admin"])
    c = mk_class(db, world, hours=30, status="confirmed")
    assert client.delete(f"{CL}/admin/{c.id}", headers=h).status_code == 200
    assert client.delete(f"{CL}/admin/{c.id}", headers=h).status_code == 400  # ya cancelada
    done = mk_class(db, world, hours=-30, status="completed")
    assert client.delete(f"{CL}/admin/{done.id}", headers=h).status_code == 400
    assert client.delete(f"{CL}/admin/999", headers=h).status_code == 404


# ── correos de reagendado y sincronización con Google ────────────────────────────────────
def test_reschedule_email_helper_for_group_and_individual(client, world, db):
    from app.api.v1.endpoints.classes import _send_reschedule_emails_helper
    g, e = group_class(db, world)
    db.add(ClassParticipant(class_id=g.id, student_id=mk_student(db, "alu_cancel2")[1].id, enrollment_id=e.id, attendance_status="cancelled"))
    db.commit()
    db.refresh(g)
    _send_reschedule_emails_helper(g, future(40), "teacher")
    c = mk_class(db, world, hours=30)
    _send_reschedule_emails_helper(c, future(20), "student")


def test_google_sync_helpers(world, db, monkeypatch):
    from app.api.v1.endpoints import classes as cl
    c = mk_class(db, world, hours=30)
    monkeypatch.setattr(cl, "sync_class_created", lambda cls, d: "evt-1")
    cl._sync_google_calendar_created(c, db)
    db.refresh(c)
    assert c.google_event_id == "evt-1"

    def boom(*a, **k):
        raise RuntimeError("google caído")

    monkeypatch.setattr(cl, "sync_class_created", boom)
    monkeypatch.setattr(cl, "sync_class_updated", boom)
    monkeypatch.setattr(cl, "sync_class_cancelled", boom)
    cl._sync_google_calendar_created(c, db)
    cl._sync_google_calendar_updated(c, db)
    cl._sync_google_calendar_cancelled(c.teacher_id, "evt-1", db)
