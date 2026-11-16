"""NEG-02: `finalized` pasa a `no_show` a las 72 h + ticket de corrección que resuelve el superadmin."""
from datetime import timedelta

from tests.audit.conftest import hdr, _mk_user, future
from tests.audit.helpers import API, book, set_status, ready_student
from app.core.class_logic import finalize_past_classes
from app.core.timezone import utc_now
from app.models.class_ import Class
from app.models.package import Enrollment
from app.models.teacher import TeacherProfile, TeacherStatus


def _confirmed_class(client, world, db, hours_ago_end):
    """Clase regular confirmada cuyo fin fue hace `hours_ago_end` horas. Devuelve (class_id, enrollment_id)."""
    eid, _ = ready_student(client, world)
    cid = book(client, world, future(72), enrollment_id=eid).json()["class_id"]
    assert set_status(client, world, cid, "confirmed").status_code == 200
    c = db.get(Class, cid)
    end = utc_now() - timedelta(hours=hours_ago_end)
    c.end_time_utc = end
    c.start_time_utc = end - timedelta(minutes=50)
    db.commit()
    return cid, eid


def _classes_used(db, eid):
    db.expire_all()
    return db.get(Enrollment, eid).classes_used


def _no_show_old(client, world, db, hours_ago_end=100):
    cid, eid = _confirmed_class(client, world, db, hours_ago_end)
    finalize_past_classes(db)
    db.expire_all()
    assert db.get(Class, cid).status == "no_show"
    return cid, eid


# ─── Auto no_show a las 72 h ────────────────────────────────────────────────

def test_confirmed_class_ended_71h_ago_is_finalized_not_no_show(client, world, db):
    cid, eid = _confirmed_class(client, world, db, hours_ago_end=71)
    finalize_past_classes(db)
    db.expire_all()
    assert db.get(Class, cid).status == "finalized"
    assert _classes_used(db, eid) == 0


def test_confirmed_class_ended_73h_ago_becomes_no_show_and_consumes_credit(client, world, db):
    cid, eid = _confirmed_class(client, world, db, hours_ago_end=73)
    finalize_past_classes(db)  # confirmed -> finalized -> no_show en la misma pasada
    db.expire_all()
    assert db.get(Class, cid).status == "no_show"
    assert _classes_used(db, eid) == 1


def test_finalized_class_becomes_no_show_only_once(client, world, db):
    cid, eid = _confirmed_class(client, world, db, hours_ago_end=100)
    finalize_past_classes(db)
    finalize_past_classes(db)
    assert _classes_used(db, eid) == 1


def test_teacher_can_still_mark_completed_inside_window(client, world, db):
    cid, eid = _confirmed_class(client, world, db, hours_ago_end=60)
    finalize_past_classes(db)  # finalized
    assert set_status(client, world, cid, "completed").status_code == 200
    assert _classes_used(db, eid) == 1


def test_teacher_cannot_mark_after_window(client, world, db):
    cid, eid = _no_show_old(client, world, db)
    r = set_status(client, world, cid, "completed")
    assert r.status_code == 400 and "72" in r.text


# ─── Crear el ticket ────────────────────────────────────────────────────────

def _ticket(client, user, cid, status="completed", reason="El alumno sí asistió, tengo captura"):
    return client.post(f"{API}/support/class-corrections",
                       json={"class_id": cid, "requested_status": status, "reason": reason}, headers=hdr(user))


def test_teacher_creates_correction_ticket_for_old_no_show(client, world, db):
    cid, _ = _no_show_old(client, world, db)
    r = _ticket(client, world["t_user"], cid)
    assert r.status_code == 201, r.text
    body = r.json()
    assert (body["category"], body["class_id"], body["requested_status"], body["status"]) == \
        ("class_correction", cid, "completed", "pending")


def test_ticket_rejected_inside_72h_window(client, world, db):
    cid, _ = _confirmed_class(client, world, db, hours_ago_end=10)
    assert set_status(client, world, cid, "no_show").status_code == 200
    r = _ticket(client, world["t_user"], cid)
    assert r.status_code == 400 and "72" in r.text


def test_ticket_rejected_if_class_is_not_no_show(client, world, db):
    cid, _ = _confirmed_class(client, world, db, hours_ago_end=60)
    assert set_status(client, world, cid, "completed").status_code == 200
    assert _ticket(client, world["t_user"], cid).status_code == 400


def test_duplicate_and_invalid_ticket_inputs(client, world, db):
    cid, _ = _no_show_old(client, world, db, hours_ago_end=200)
    assert _ticket(client, world["t_user"], cid).status_code == 201
    assert _ticket(client, world["t_user"], cid).status_code == 400            # ya hay una pendiente
    assert _ticket(client, world["t_user"], cid, status="confirmed").status_code == 422
    assert _ticket(client, world["t_user"], cid, reason="corto").status_code == 422
    assert _ticket(client, world["t_user"], 999999).status_code == 404


def test_other_teacher_and_student_cannot_create_ticket(client, world, db):
    cid, _ = _no_show_old(client, world, db)
    t2 = _mk_user(db, "teacher", "profe2")
    db.add(TeacherProfile(user_id=t2.id, user_username="profe2", status=TeacherStatus.approved, timezone="UTC"))
    db.commit()
    assert _ticket(client, t2, cid).status_code == 404
    assert _ticket(client, world["s_user"], cid).status_code == 403


# ─── Resolver el ticket (solo superadmin) ───────────────────────────────────

def _resolve(client, user, tid, decision="approved", text="Revisado con las capturas"):
    body = {"admin_response": text}
    if decision:
        body["decision"] = decision
    return client.patch(f"{API}/admin/support-tickets/{tid}/resolve", json=body, headers=hdr(user))


def _open_ticket(client, world, db, status="completed"):
    cid, eid = _no_show_old(client, world, db)
    r = _ticket(client, world["t_user"], cid, status=status)
    assert r.status_code == 201, r.text
    return cid, eid, r.json()["id"]


def test_approve_completed_keeps_credit_consumed(client, world, db):
    cid, eid, tid = _open_ticket(client, world, db, "completed")
    assert _classes_used(db, eid) == 1
    r = _resolve(client, world["admin"], tid, "approved")
    assert r.status_code == 200, r.text
    assert (r.json()["status"], r.json()["decision"]) == ("answered", "approved")
    db.expire_all()
    assert db.get(Class, cid).status == "completed"
    assert _classes_used(db, eid) == 1            # no cambia el crédito


def test_approve_cancelled_returns_credit(client, world, db):
    cid, eid, tid = _open_ticket(client, world, db, "cancelled")
    assert _classes_used(db, eid) == 1
    assert _resolve(client, world["admin"], tid, "approved").status_code == 200
    db.expire_all()
    assert db.get(Class, cid).status == "cancelled"
    assert _classes_used(db, eid) == 0            # crédito devuelto


def test_reject_leaves_class_untouched(client, world, db):
    cid, eid, tid = _open_ticket(client, world, db, "cancelled")
    r = _resolve(client, world["admin"], tid, "rejected", "Sin evidencia suficiente")
    assert r.status_code == 200 and r.json()["decision"] == "rejected"
    db.expire_all()
    assert db.get(Class, cid).status == "no_show"
    assert _classes_used(db, eid) == 1


def test_only_superadmin_resolves_and_decision_is_required(client, world, db):
    cid, eid, tid = _open_ticket(client, world, db)
    ta = _mk_user(db, "teacher_admin", "tadmin")
    db.add(TeacherProfile(user_id=ta.id, user_username=ta.username, status=TeacherStatus.approved, timezone="UTC"))
    db.commit()
    assert _resolve(client, ta, tid, "approved").status_code == 403
    assert _resolve(client, world["t_user"], tid, "approved").status_code == 403
    assert _resolve(client, world["admin"], tid, None).status_code == 400
    db.expire_all()
    assert db.get(Class, cid).status == "no_show"     # nada se aplicó


def test_cannot_approve_if_class_no_longer_no_show(client, world, db):
    cid, eid, tid = _open_ticket(client, world, db)
    c = db.get(Class, cid); c.status = "cancelled"; db.commit()
    assert _resolve(client, world["admin"], tid, "approved").status_code == 400
    assert _resolve(client, world["admin"], tid, "rejected").status_code == 200  # sí se puede rechazar


def test_decision_not_allowed_on_ordinary_tickets(client, world, db):
    r = client.post(f"{API}/support/tickets", json={"category": "question", "subject": "hola", "message": "duda"},
                    headers=hdr(world["s_user"]))
    assert r.status_code == 201, r.text
    assert _resolve(client, world["admin"], r.json()["id"], "approved").status_code == 400
    assert _resolve(client, world["admin"], r.json()["id"], None).status_code == 200  # el flujo normal sigue igual
