"""Cobertura del Modo Dios (`app/api/v1/endpoints/god_mode.py`): créditos, cohortes, clases.

Cada operación se prueba por su camino feliz, por sus errores (404, 400, 409) y por el alcance del `teacher_admin`
(solo puede tocar lo suyo). Las pruebas de pagos, reseñas, transferencias y búsquedas están en
`test_g2_god_mode_money_reviews.py`.
"""
from datetime import timedelta

import pytest

from tests.audit.conftest import _mk_user, hdr, future
from app.models.class_ import Class, ClassType
from app.models.class_participant import ClassParticipant
from app.models.group_cohort import GroupCohort, CohortStatus
from app.models.package import Enrollment, EnrollmentStatus, Package
from app.models.student import StudentProfile
from app.models.teacher import TeacherProfile, TeacherStatus
from app.models.god_mode_audit import GodModeAuditLog

API = "/api/v1/god-mode"
WHY = "motivo de prueba"


# ── ayudas ───────────────────────────────────────────────────────────────────────────────
def mk_teacher(db, name, role="teacher"):
    u = _mk_user(db, role, name)
    tp = TeacherProfile(user_id=u.id, user_username=name, status=TeacherStatus.approved, timezone="UTC",
                        languages=["English"], subjects=["English"], video_url="http://v")
    db.add(tp)
    db.commit()
    return u, tp


def mk_student(db, name):
    u = _mk_user(db, "student", name)
    sp = StudentProfile(user_id=u.id, user_username=name, timezone="UTC")
    db.add(sp)
    db.commit()
    return u, sp


def mk_enrollment(db, w, **kw):
    kw.setdefault("classes_used", 0)
    e = Enrollment(student_id=w["sp"].id, package_id=w["pkg"].id, teacher_id=w["tp"].id,
                   status=EnrollmentStatus.active, classes_total=4, unlocked_credits=4, **kw)
    db.add(e)
    db.commit()
    return e


def mk_class(db, w, hours=48, status="confirmed", enrollment=None, ctype=ClassType.regular, **kw):
    start = future(hours)
    c = Class(teacher_id=w["tp"].id, student_id=w["sp"].id, class_type=ctype, start_time_utc=start,
              end_time_utc=start + timedelta(minutes=50), duration=50, buffer_minutes=10, status=status,
              enrollment_id=enrollment.id if enrollment else None, **kw)
    db.add(c)
    db.commit()
    return c


def mk_group_package(db, tp, name="Grupal"):
    p = Package(teacher_id=tp.id, name=name, subject="English", classes_count=8, price=80.0, is_group=True,
                duration_minutes=50, is_active=True)
    db.add(p)
    db.commit()
    return p


def mk_cohort(db, tp, pkg, status=CohortStatus.filling, mx=3):
    c = GroupCohort(package_id=pkg.id, teacher_id=tp.id, status=status, min_students=1, max_students=mx)
    db.add(c)
    db.commit()
    return c


def admin(w):
    return hdr(w["admin"])


def audit_actions(db):
    db.expire_all()
    return [a.action for a in db.query(GodModeAuditLog).all()]


# ── auditoría ────────────────────────────────────────────────────────────────────────────
def test_audit_log_filters_and_entity_history(client, world, db):
    e = mk_enrollment(db, world)
    r = client.patch(f"{API}/enrollments/{e.id}/adjust", json={"reason": WHY, "classes_used": 1}, headers=admin(world))
    assert r.status_code == 200
    full = client.get(f"{API}/audit-log", headers=admin(world)).json()
    assert full["total"] == 1 and full["items"][0]["actor_name"]
    for q in (f"entity_type=enrollment", f"entity_id={e.id}", "action=enrollment.adjust",
              f"actor_user_id={world['admin'].id}"):
        assert client.get(f"{API}/audit-log?{q}", headers=admin(world)).json()["total"] == 1
    assert client.get(f"{API}/audit-log?entity_type=class", headers=admin(world)).json()["total"] == 0
    hist = client.get(f"{API}/audit-log/enrollment/{e.id}", headers=admin(world)).json()
    assert len(hist) == 1 and hist[0]["action"] == "enrollment.adjust"
    assert client.get(f"{API}/audit-log/enrollment/9999", headers=admin(world)).json() == []


def test_audit_log_survives_a_deleted_actor(client, world, db):
    e = mk_enrollment(db, world)
    client.patch(f"{API}/enrollments/{e.id}/adjust", json={"reason": WHY, "classes_used": 1}, headers=admin(world))
    log = db.query(GodModeAuditLog).first()
    log.actor_user_id = 99999
    db.commit()
    items = client.get(f"{API}/audit-log", headers=admin(world)).json()["items"]
    assert items[0]["actor_name"] is None


# ── ajustar créditos ─────────────────────────────────────────────────────────────────────
def test_adjust_enrollment_all_fields_and_errors(client, world, db):
    e = mk_enrollment(db, world)
    body = {"reason": WHY, "unlocked_credits": 9, "classes_used": 2, "classes_total": 10, "prepaid_unlimited_credits": 3,
            "installments_paid": 2, "payment_status": "paid", "status": "completed"}
    r = client.patch(f"{API}/enrollments/{e.id}/adjust", json=body, headers=admin(world))
    assert r.status_code == 200, r.text
    assert r.json()["enrollment"]["classes_total"] == 10
    db.expire_all()
    assert db.get(Enrollment, e.id).status == EnrollmentStatus.completed
    # nada que cambiar
    assert client.patch(f"{API}/enrollments/{e.id}/adjust", json={"reason": WHY}, headers=admin(world)).status_code == 400
    assert client.patch(f"{API}/enrollments/999/adjust", json={"reason": WHY, "classes_used": 1}, headers=admin(world)).status_code == 404
    assert client.patch(f"{API}/enrollments/{e.id}/adjust", json={"reason": WHY, "payment_status": "x"}, headers=admin(world)).status_code == 422
    assert client.patch(f"{API}/enrollments/{e.id}/adjust", json={"reason": WHY, "status": "x"}, headers=admin(world)).status_code == 422
    assert "enrollment.adjust" in audit_actions(db)


def test_adjust_enrollment_unlimited_and_cohort_responses(client, world, db):
    """La respuesta calcula créditos distinto para ilimitados y para inscripciones de grupo."""
    unl = Package(teacher_id=world["tp"].id, name="Ilim", subject="English", classes_count=None, price=50.0,
                  duration_minutes=50, is_active=True)
    db.add(unl)
    db.commit()
    e = Enrollment(student_id=world["sp"].id, package_id=unl.id, teacher_id=world["tp"].id,
                   status=EnrollmentStatus.active, prepaid_unlimited_credits=2)
    db.add(e)
    db.commit()
    r = client.patch(f"{API}/enrollments/{e.id}/adjust", json={"reason": WHY, "prepaid_unlimited_credits": 5}, headers=admin(world))
    assert r.status_code == 200 and r.json()["enrollment"]["available_credits"] == 5

    gp = mk_group_package(db, world["tp"])
    co = mk_cohort(db, world["tp"], gp)
    ge = Enrollment(student_id=world["sp"].id, package_id=gp.id, teacher_id=world["tp"].id, cohort_id=co.id,
                    status=EnrollmentStatus.active, classes_total=8, unlocked_credits=8)
    db.add(ge)
    db.commit()
    r = client.patch(f"{API}/enrollments/{ge.id}/adjust", json={"reason": WHY, "classes_used": 1}, headers=admin(world))
    assert r.status_code == 200
    en = r.json()["enrollment"]
    assert en["cohort_id"] == co.id and en["cohort_status"] == "filling" and en["cohort_max_students"] == 3


def test_teacher_admin_scope_on_enrollment_class_cohort(client, world, db):
    other_u, other_tp = mk_teacher(db, "otro_ta", role="teacher_admin")
    e = mk_enrollment(db, world)
    c = mk_class(db, world, enrollment=e)
    gp = mk_group_package(db, world["tp"])
    co = mk_cohort(db, world["tp"], gp)
    h = hdr(other_u)
    assert client.patch(f"{API}/enrollments/{e.id}/adjust", json={"reason": WHY, "classes_used": 1}, headers=h).status_code == 403
    assert client.patch(f"{API}/classes/{c.id}/force-status", json={"reason": WHY, "status": "completed"}, headers=h).status_code == 403
    assert client.patch(f"{API}/cohorts/{co.id}", json={"reason": WHY, "max_students": 5}, headers=h).status_code == 403
    assert client.delete(f"{API}/classes/{c.id}?reason={WHY}", headers=h).status_code == 403
    # un teacher_admin sin perfil también se bloquea
    nop = _mk_user(db, "teacher_admin", "sinperfil")
    db.commit()
    assert client.patch(f"{API}/enrollments/{e.id}/adjust", json={"reason": WHY, "classes_used": 1}, headers=hdr(nop)).status_code in (401, 403)
    # y el propio profesor-admin sí puede sobre lo suyo
    own_u = world["t_user"]
    own_u.role = own_u.role.__class__("teacher_admin")
    db.commit()
    assert client.patch(f"{API}/enrollments/{e.id}/adjust", json={"reason": WHY, "classes_used": 1}, headers=hdr(own_u)).status_code == 200


# ── cambiar de paquete ───────────────────────────────────────────────────────────────────
def test_change_package_paths(client, world, db):
    e = mk_enrollment(db, world, classes_used=3)
    p2 = Package(teacher_id=world["tp"].id, name="P8", subject="English", classes_count=8, price=180.0,
                 duration_minutes=50, is_active=True, installment_count=2)
    db.add(p2)
    db.commit()
    r = client.post(f"{API}/enrollments/{e.id}/change-package", json={"reason": WHY, "new_package_id": p2.id, "reset_classes_used": True}, headers=admin(world))
    assert r.status_code == 200, r.text
    db.expire_all()
    e2 = db.get(Enrollment, e.id)
    assert e2.package_id == p2.id and e2.classes_total == 8 and e2.classes_used == 0 and e2.installments_paid == 2
    # sin reset conserva lo usado
    e2.classes_used = 3
    db.commit()
    assert client.post(f"{API}/enrollments/{e.id}/change-package", json={"reason": WHY, "new_package_id": world["pkg"].id}, headers=admin(world)).status_code == 200
    db.expire_all()
    assert db.get(Enrollment, e.id).classes_used == 3


def test_change_package_rejections(client, world, db):
    e = mk_enrollment(db, world)
    assert client.post(f"{API}/enrollments/999/change-package", json={"reason": WHY, "new_package_id": 1}, headers=admin(world)).status_code == 404
    assert client.post(f"{API}/enrollments/{e.id}/change-package", json={"reason": WHY, "new_package_id": 999}, headers=admin(world)).status_code == 404
    gp = mk_group_package(db, world["tp"])
    assert client.post(f"{API}/enrollments/{e.id}/change-package", json={"reason": WHY, "new_package_id": gp.id}, headers=admin(world)).status_code == 400
    _, tp2 = mk_teacher(db, "profe2")
    foreign = Package(teacher_id=tp2.id, name="X", subject="English", classes_count=4, price=10.0, duration_minutes=50, is_active=True)
    db.add(foreign)
    db.commit()
    assert client.post(f"{API}/enrollments/{e.id}/change-package", json={"reason": WHY, "new_package_id": foreign.id}, headers=admin(world)).status_code == 400
    co = mk_cohort(db, world["tp"], gp)
    e.cohort_id = co.id
    db.commit()
    assert client.post(f"{API}/enrollments/{e.id}/change-package", json={"reason": WHY, "new_package_id": world["pkg"].id}, headers=admin(world)).status_code == 400


# ── mover de cohorte ─────────────────────────────────────────────────────────────────────
def test_move_cohort_paths(client, world, db):
    gp = mk_group_package(db, world["tp"])
    c1, c2 = mk_cohort(db, world["tp"], gp), mk_cohort(db, world["tp"], gp)
    e = mk_enrollment(db, world, cohort_id=c1.id)
    # a otra cohorte del mismo profesor
    r = client.post(f"{API}/enrollments/{e.id}/move-cohort", json={"reason": WHY, "new_cohort_id": c2.id, "reset_classes_used": True}, headers=admin(world))
    assert r.status_code == 200 and "grupo" in r.json()["message"].lower()
    db.expire_all()
    assert db.get(Enrollment, e.id).cohort_id == c2.id
    # ya está ahí
    assert client.post(f"{API}/enrollments/{e.id}/move-cohort", json={"reason": WHY, "new_cohort_id": c2.id}, headers=admin(world)).status_code == 400
    # a individual
    r = client.post(f"{API}/enrollments/{e.id}/move-cohort", json={"reason": WHY, "new_cohort_id": None}, headers=admin(world))
    assert r.status_code == 200 and "individual" in r.json()["message"]
    # inexistentes
    assert client.post(f"{API}/enrollments/999/move-cohort", json={"reason": WHY}, headers=admin(world)).status_code == 404
    assert client.post(f"{API}/enrollments/{e.id}/move-cohort", json={"reason": WHY, "new_cohort_id": 999}, headers=admin(world)).status_code == 404


def test_move_cohort_capacity_and_foreign_teacher(client, world, db):
    gp = mk_group_package(db, world["tp"])
    full = mk_cohort(db, world["tp"], gp, mx=1)
    other_u, other_sp = mk_student(db, "otro_alu")
    db.add(Enrollment(student_id=other_sp.id, package_id=gp.id, teacher_id=world["tp"].id, cohort_id=full.id,
                      status=EnrollmentStatus.active, classes_total=8))
    db.commit()
    e = mk_enrollment(db, world)
    assert client.post(f"{API}/enrollments/{e.id}/move-cohort", json={"reason": WHY, "new_cohort_id": full.id}, headers=admin(world)).status_code == 400
    assert client.post(f"{API}/enrollments/{e.id}/move-cohort", json={"reason": WHY, "new_cohort_id": full.id, "force": True}, headers=admin(world)).status_code == 200
    _, tp2 = mk_teacher(db, "profe2")
    gp2 = mk_group_package(db, tp2, "G2")
    foreign = mk_cohort(db, tp2, gp2)
    e2 = mk_enrollment(db, world)
    assert client.post(f"{API}/enrollments/{e2.id}/move-cohort", json={"reason": WHY, "new_cohort_id": foreign.id}, headers=admin(world)).status_code == 400


# ── editar y reabrir cohorte ─────────────────────────────────────────────────────────────
def test_edit_cohort_paths(client, world, db):
    gp = mk_group_package(db, world["tp"])
    co = mk_cohort(db, world["tp"], gp, mx=4)
    when = (future(200)).isoformat()
    r = client.patch(f"{API}/cohorts/{co.id}", json={"reason": WHY, "min_students": 2, "max_students": 6, "start_date": when}, headers=admin(world))
    assert r.status_code == 200, r.text
    assert r.json()["cohort"]["max_students"] == 6
    assert client.patch(f"{API}/cohorts/{co.id}", json={"reason": WHY}, headers=admin(world)).status_code == 400
    assert client.patch(f"{API}/cohorts/999", json={"reason": WHY, "max_students": 3}, headers=admin(world)).status_code == 404
    assert client.patch(f"{API}/cohorts/{co.id}", json={"reason": WHY, "max_students": 0}, headers=admin(world)).status_code == 422
    # no se puede bajar el máximo por debajo de los activos
    for i in range(3):
        _, sp = mk_student(db, f"cu{i}")
        db.add(Enrollment(student_id=sp.id, package_id=gp.id, teacher_id=world["tp"].id, cohort_id=co.id,
                          status=EnrollmentStatus.active, classes_total=8))
    db.commit()
    assert client.patch(f"{API}/cohorts/{co.id}", json={"reason": WHY, "max_students": 2}, headers=admin(world)).status_code == 400


def test_reopen_cohort_paths(client, world, db):
    gp = mk_group_package(db, world["tp"])
    co = mk_cohort(db, world["tp"], gp, status=CohortStatus.cancelled)
    r = client.post(f"{API}/cohorts/{co.id}/reopen", json={"reason": WHY, "new_status": "confirmed"}, headers=admin(world))
    assert r.status_code == 200 and r.json()["cohort"]["status"] == "confirmed"
    # ya abierta: solo se reabren las canceladas o completadas
    assert client.post(f"{API}/cohorts/{co.id}/reopen", json={"reason": WHY}, headers=admin(world)).status_code == 400
    co.status = CohortStatus.completed
    db.commit()
    r = client.post(f"{API}/cohorts/{co.id}/reopen", json={"reason": WHY}, headers=admin(world))
    assert r.status_code == 200 and r.json()["cohort"]["status"] == "filling"
    assert client.post(f"{API}/cohorts/999/reopen", json={"reason": WHY}, headers=admin(world)).status_code == 404
    assert client.post(f"{API}/cohorts/{co.id}/reopen", json={"reason": WHY, "new_status": "x"}, headers=admin(world)).status_code == 422
    other_u, _ = mk_teacher(db, "ta2", role="teacher_admin")
    co.status = CohortStatus.cancelled
    db.commit()
    assert client.post(f"{API}/cohorts/{co.id}/reopen", json={"reason": WHY}, headers=hdr(other_u)).status_code == 403


# ── crear clase ──────────────────────────────────────────────────────────────────────────
def class_body(w, hours=96, **over):
    b = {"reason": WHY, "teacher_id": w["tp"].id, "student_id": w["sp"].id,
         "start_time_utc": future(hours).isoformat(), "duration_minutes": 50}
    b.update(over)
    return b


def test_create_class_paths(client, world, db):
    e = mk_enrollment(db, world)
    r = client.post(f"{API}/classes", json=class_body(world, enrollment_id=e.id), headers=admin(world))
    assert r.status_code == 201, r.text
    db.expire_all()
    assert db.get(Enrollment, e.id).classes_used == 0  # confirmada y futura aún no consume
    # el staff decide expresamente consumir o no
    r = client.post(f"{API}/classes", json=class_body(world, hours=120, enrollment_id=e.id, consume_credit=False), headers=admin(world))
    assert r.status_code == 201
    r = client.post(f"{API}/classes", json=class_body(world, hours=144, enrollment_id=e.id, consume_credit=True, status="pending"), headers=admin(world))
    assert r.status_code == 201
    db.expire_all()
    assert db.get(Enrollment, e.id).classes_used == 1
    # trial sin enrollment
    assert client.post(f"{API}/classes", json=class_body(world, hours=170, class_type="trial"), headers=admin(world)).status_code == 201


def test_create_class_validations(client, world, db):
    e = mk_enrollment(db, world)
    assert client.post(f"{API}/classes", json=class_body(world, teacher_id=999), headers=admin(world)).status_code == 404
    assert client.post(f"{API}/classes", json=class_body(world, student_id=999), headers=admin(world)).status_code == 404
    assert client.post(f"{API}/classes", json=class_body(world, enrollment_id=999), headers=admin(world)).status_code == 404
    _, sp2 = mk_student(db, "alu2")
    assert client.post(f"{API}/classes", json=class_body(world, student_id=sp2.id, enrollment_id=e.id), headers=admin(world)).status_code == 400
    assert client.post(f"{API}/classes", json=class_body(world, class_type="group"), headers=admin(world)).status_code == 422
    assert client.post(f"{API}/classes", json=class_body(world, duration_minutes=5), headers=admin(world)).status_code == 422
    assert client.post(f"{API}/classes", json=class_body(world, status="otro"), headers=admin(world)).status_code == 422


def test_create_class_conflict_and_skip(client, world, db):
    assert client.post(f"{API}/classes", json=class_body(world), headers=admin(world)).status_code == 201
    assert client.post(f"{API}/classes", json=class_body(world), headers=admin(world)).status_code == 409
    assert client.post(f"{API}/classes", json=class_body(world, skip_conflict_check=True), headers=admin(world)).status_code == 201


def test_create_class_teacher_admin_only_for_self(client, world, db):
    other_u, other_tp = mk_teacher(db, "ta3", role="teacher_admin")
    assert client.post(f"{API}/classes", json=class_body(world), headers=hdr(other_u)).status_code == 403
    nop = _mk_user(db, "teacher_admin", "sin_perfil2")
    db.commit()
    assert client.post(f"{API}/classes", json=class_body(world), headers=hdr(nop)).status_code in (401, 403)
    assert client.post(f"{API}/classes", json=class_body(world, teacher_id=other_tp.id), headers=hdr(other_u)).status_code == 201


# ── reagendar, forzar estado y borrar ────────────────────────────────────────────────────
def test_reschedule_class_paths(client, world, db):
    c = mk_class(db, world, hours=48)
    r = client.patch(f"{API}/classes/{c.id}/reschedule", json={"reason": WHY, "start_time_utc": future(100).isoformat(), "duration_minutes": 30}, headers=admin(world))
    assert r.status_code == 200, r.text
    assert r.json()["duration_minutes"] == 30
    assert client.patch(f"{API}/classes/999/reschedule", json={"reason": WHY, "start_time_utc": future(100).isoformat()}, headers=admin(world)).status_code == 404
    other = mk_class(db, world, hours=200)
    clash = {"reason": WHY, "start_time_utc": future(200).isoformat()}
    assert client.patch(f"{API}/classes/{c.id}/reschedule", json=clash, headers=admin(world)).status_code == 409
    assert client.patch(f"{API}/classes/{c.id}/reschedule", json={**clash, "skip_conflict_check": True}, headers=admin(world)).status_code == 200
    other_u, _ = mk_teacher(db, "ta4", role="teacher_admin")
    assert client.patch(f"{API}/classes/{other.id}/reschedule", json=clash, headers=hdr(other_u)).status_code == 403


def test_force_status_adjusts_credits(client, world, db):
    e = mk_enrollment(db, world)
    c = mk_class(db, world, hours=-5, status="confirmed", enrollment=e)
    # confirmada pasada no consumía; completarla sí
    r = client.patch(f"{API}/classes/{c.id}/force-status", json={"reason": WHY, "status": "completed", "notes": "ok"}, headers=admin(world))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(Enrollment, e.id).classes_used == 1
    assert db.get(Class, c.id).notes == "ok"
    # y devolverla a pendiente libera el crédito
    assert client.patch(f"{API}/classes/{c.id}/force-status", json={"reason": WHY, "status": "pending"}, headers=admin(world)).status_code == 200
    db.expire_all()
    assert db.get(Enrollment, e.id).classes_used == 0
    assert client.patch(f"{API}/classes/999/force-status", json={"reason": WHY, "status": "completed"}, headers=admin(world)).status_code == 404
    assert client.patch(f"{API}/classes/{c.id}/force-status", json={"reason": WHY, "status": "raro"}, headers=admin(world)).status_code == 422


def test_force_cancel_returns_prepaid_unlimited_credit(client, world, db):
    e = mk_enrollment(db, world, prepaid_unlimited_credits=0)
    c = mk_class(db, world, hours=30, status="confirmed", enrollment=e, used_prepaid_credit=True)
    r = client.patch(f"{API}/classes/{c.id}/force-status", json={"reason": WHY, "status": "cancelled"}, headers=admin(world))
    assert r.status_code == 200
    db.expire_all()
    assert db.get(Enrollment, e.id).prepaid_unlimited_credits == 1
    assert db.get(Class, c.id).used_prepaid_credit is False


def test_hard_delete_class_paths(client, world, db):
    e = mk_enrollment(db, world, classes_used=1)
    c = mk_class(db, world, enrollment=e)
    cid = c.id
    r = client.delete(f"{API}/classes/{cid}?reason={WHY}&refund_credit=true", headers=admin(world))
    assert r.status_code == 200 and "crédito" in r.json()["message"]
    db.expire_all()
    assert db.get(Enrollment, e.id).classes_used == 0 and db.get(Class, cid) is None
    c2 = mk_class(db, world, hours=60)
    assert client.delete(f"{API}/classes/{c2.id}?reason={WHY}", headers=admin(world)).status_code == 200
    assert client.delete(f"{API}/classes/999?reason={WHY}", headers=admin(world)).status_code == 404
    g = mk_class(db, world, hours=80, ctype=ClassType.group)
    assert client.delete(f"{API}/classes/{g.id}?reason={WHY}", headers=admin(world)).status_code == 400
    assert client.delete(f"{API}/classes/{c2.id}?reason=x", headers=admin(world)).status_code == 422
