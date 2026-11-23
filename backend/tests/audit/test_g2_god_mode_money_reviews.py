"""Cobertura del Modo Dios: pagos, reseñas, transferencia de alumnos y búsquedas de apoyo.

Nota: crear y editar pagos exigen `superadmin` (`require_superadmin`), así que las ramas de `teacher_admin` dentro de
esos dos endpoints no se alcanzan por HTTP; aquí se comprueba que un `teacher_admin` recibe 403 de entrada.
"""
from datetime import timedelta

from tests.audit.conftest import _mk_user, hdr, future
from tests.audit.test_g1_god_mode_actions import (
    API, WHY, mk_teacher, mk_student, mk_enrollment, mk_class, mk_group_package, mk_cohort, admin,
)
from app.models.class_ import ClassType
from app.models.class_participant import ClassParticipant
from app.models.package import Enrollment, EnrollmentStatus, Package
from app.models.payment import Payment, TeacherWallet
from app.models.review import Review
from app.models.student_teacher_link import StudentTeacherLink
from app.models.teacher import TeacherProfile


def wallet(db, tp_id):
    db.expire_all()
    w = db.query(TeacherWallet).filter(TeacherWallet.teacher_id == tp_id).first()
    return (w.available_balance, w.total_earned) if w else (0, 0)


def pay_body(w, **over):
    b = {"reason": WHY, "teacher_id": w["tp"].id, "student_id": w["sp"].id, "amount_total": 100.0,
         "payment_method": "bank_transfer"}
    b.update(over)
    return b


# ── crear pago ───────────────────────────────────────────────────────────────────────────
def test_create_payment_credits_wallet(client, world, db):
    e = mk_enrollment(db, world)
    r = client.post(f"{API}/payments", json=pay_body(world, enrollment_id=e.id, transaction_id="T1"), headers=admin(world))
    assert r.status_code == 201, r.text
    assert r.json()["payment"]["amount_teacher"] == 85.0
    assert wallet(db, world["tp"].id)[0] == 85.0


def test_create_payment_manual_grant_and_pending_do_not_move_wallet(client, world, db):
    r = client.post(f"{API}/payments", json=pay_body(world, is_manual_grant=True), headers=admin(world))
    assert r.status_code == 201 and r.json()["payment"]["amount_teacher"] == 0
    r = client.post(f"{API}/payments", json=pay_body(world, status="pending_review"), headers=admin(world))
    assert r.status_code == 201
    assert wallet(db, world["tp"].id)[0] == 0


def test_create_payment_errors(client, world, db):
    assert client.post(f"{API}/payments", json=pay_body(world, teacher_id=999), headers=admin(world)).status_code == 404
    assert client.post(f"{API}/payments", json=pay_body(world, student_id=999), headers=admin(world)).status_code == 404
    assert client.post(f"{API}/payments", json=pay_body(world, enrollment_id=999), headers=admin(world)).status_code == 404
    _, sp2 = mk_student(db, "alu_x")
    e = mk_enrollment(db, world)
    assert client.post(f"{API}/payments", json=pay_body(world, student_id=sp2.id, enrollment_id=e.id), headers=admin(world)).status_code == 400
    assert client.post(f"{API}/payments", json=pay_body(world, amount_total=0), headers=admin(world)).status_code == 422
    assert client.post(f"{API}/payments", json=pay_body(world, status="x"), headers=admin(world)).status_code == 422
    assert client.post(f"{API}/payments", json=pay_body(world, payment_type="x"), headers=admin(world)).status_code == 422
    ta, _ = mk_teacher(db, "ta_pay", role="teacher_admin")
    assert client.post(f"{API}/payments", json=pay_body(world), headers=hdr(ta)).status_code == 403


# ── editar pago ──────────────────────────────────────────────────────────────────────────
def mk_payment(client, w, **over):
    r = client.post(f"{API}/payments", json=pay_body(w, **over), headers=admin(w))
    assert r.status_code == 201, r.text
    return r.json()["payment"]["id"]


def edit(client, w, pid, **body):
    return client.patch(f"{API}/payments/{pid}", json={"reason": WHY, **body}, headers=admin(w))


def test_edit_payment_amount_adjusts_wallet(client, world, db):
    pid = mk_payment(client, world)
    assert wallet(db, world["tp"].id)[0] == 85.0
    assert edit(client, world, pid, amount_total=200.0).status_code == 200
    assert wallet(db, world["tp"].id)[0] == 170.0
    assert edit(client, world, pid, amount_total=100.0).status_code == 200  # baja el monto: debita la diferencia
    assert wallet(db, world["tp"].id)[0] == 85.0


def test_edit_payment_amount_blocked_when_balance_spent(client, world, db):
    pid = mk_payment(client, world)
    w = db.query(TeacherWallet).filter(TeacherWallet.teacher_id == world["tp"].id).first()
    w.available_balance = 0
    db.commit()
    assert edit(client, world, pid, amount_total=10.0).status_code == 409


def test_edit_payment_amount_on_unapproved_uses_commission(client, world, db):
    pid = mk_payment(client, world, status="pending_review")
    r = edit(client, world, pid, amount_total=300.0)
    assert r.status_code == 200 and r.json()["payment"]["amount_teacher"] == 255.0
    assert wallet(db, world["tp"].id)[0] == 0


def test_edit_payment_status_transitions(client, world, db):
    pid = mk_payment(client, world, status="pending_review")
    assert edit(client, world, pid, status="rejected").status_code == 400  # falta el motivo
    assert edit(client, world, pid, status="rejected", rejection_reason="no llegó").status_code == 200
    assert edit(client, world, pid, status="approved").status_code == 200
    assert wallet(db, world["tp"].id)[0] == 85.0
    assert edit(client, world, pid, status="rejected", rejection_reason="error").status_code == 200  # revierte
    assert wallet(db, world["tp"].id)[0] == 0
    # un pago aprobado cuyo dinero ya se gastó no se puede revertir
    pid2 = mk_payment(client, world)
    w = db.query(TeacherWallet).filter(TeacherWallet.teacher_id == world["tp"].id).first()
    w.available_balance = 0
    db.commit()
    assert edit(client, world, pid2, status="under_review").status_code == 409


def test_edit_payment_manual_grant_and_misc(client, world, db):
    pid = mk_payment(client, world, is_manual_grant=True, status="pending_review")
    r = edit(client, world, pid, status="approved")
    assert r.status_code == 200 and r.json()["payment"]["amount_teacher"] == 0
    assert edit(client, world, pid, transaction_id="ZZ").status_code == 200
    assert edit(client, world, pid).status_code == 400  # nada que cambiar
    assert edit(client, world, 999, transaction_id="a").status_code == 404
    assert edit(client, world, pid, amount_total=-1).status_code == 422
    assert edit(client, world, pid, status="x").status_code == 422
    ta, _ = mk_teacher(db, "ta_pay2", role="teacher_admin")
    assert client.patch(f"{API}/payments/{pid}", json={"reason": WHY, "transaction_id": "q"}, headers=hdr(ta)).status_code == 403


def test_edit_refund_only_transaction_id(client, world, db):
    pid = mk_payment(client, world, payment_type="manual")
    p = db.get(Payment, pid)
    p.payment_type = "refund"
    db.commit()
    assert edit(client, world, pid, amount_total=5.0).status_code == 409
    assert edit(client, world, pid, status="rejected").status_code == 409
    assert edit(client, world, pid, transaction_id="REF").status_code == 200


# ── reseñas ──────────────────────────────────────────────────────────────────────────────
def test_create_review_with_account_and_legacy(client, world, db):
    body = {"reason": WHY, "teacher_id": world["tp"].id, "rating": 4.6, "comment": "Muy bien",
            "student_id": world["sp"].id, "review_date": "2024-01-02T10:00:00Z", "total_completed_classes": 12}
    r = client.post(f"{API}/reviews", json=body, headers=admin(world))
    assert r.status_code == 201, r.text
    assert r.json()["review"]["rating"] == 4.5
    # el mismo alumno no puede tener dos
    assert client.post(f"{API}/reviews", json=body, headers=admin(world)).status_code == 400
    legacy = {"reason": WHY, "teacher_id": world["tp"].id, "rating": 5, "legacy_student_name": "María Antigua"}
    assert client.post(f"{API}/reviews", json=legacy, headers=admin(world)).status_code == 201


def test_create_review_errors(client, world, db):
    base = {"reason": WHY, "teacher_id": world["tp"].id, "rating": 5, "legacy_student_name": "Ana Vieja"}
    assert client.post(f"{API}/reviews", json={**base, "teacher_id": 999}, headers=admin(world)).status_code == 404
    assert client.post(f"{API}/reviews", json={"reason": WHY, "teacher_id": world["tp"].id, "rating": 5, "student_id": 999}, headers=admin(world)).status_code == 404
    assert client.post(f"{API}/reviews", json={**base, "rating": 9}, headers=admin(world)).status_code == 422
    assert client.post(f"{API}/reviews", json={"reason": WHY, "teacher_id": world["tp"].id, "rating": 5}, headers=admin(world)).status_code == 422
    assert client.post(f"{API}/reviews", json={**base, "student_id": world["sp"].id}, headers=admin(world)).status_code == 422
    ta, _ = mk_teacher(db, "ta_rev", role="teacher_admin")
    assert client.post(f"{API}/reviews", json=base, headers=hdr(ta)).status_code == 403


def test_review_edit_delete_and_scope(client, world, db):
    r = client.post(f"{API}/reviews", json={"reason": WHY, "teacher_id": world["tp"].id, "rating": 5, "legacy_student_name": "Ana Vieja"}, headers=admin(world))
    rid = r.json()["review"]["id"]
    p = lambda **b: client.patch(f"{API}/reviews/{rid}", json={"reason": WHY, **b}, headers=admin(world))
    ok = p(rating=3.0, comment="regular", legacy_student_name="Ana Nueva", review_date="2023-05-05T00:00:00Z", total_completed_classes=7)
    assert ok.status_code == 200, ok.text
    assert p().status_code == 400
    assert client.patch(f"{API}/reviews/999", json={"reason": WHY, "rating": 3}, headers=admin(world)).status_code == 404
    # una reseña ligada a cuenta no cambia el nombre legacy
    real = Review(teacher_id=world["tp"].id, student_id=world["sp"].id, rating=4.0, is_legacy=False)
    db.add(real)
    db.commit()
    assert client.patch(f"{API}/reviews/{real.id}", json={"reason": WHY, "legacy_student_name": "Otro Nombre"}, headers=admin(world)).status_code == 400
    ta, _ = mk_teacher(db, "ta_rev2", role="teacher_admin")
    assert client.patch(f"{API}/reviews/{rid}", json={"reason": WHY, "rating": 2}, headers=hdr(ta)).status_code == 403
    assert client.delete(f"{API}/reviews/{rid}?reason={WHY}", headers=hdr(ta)).status_code == 403
    assert client.delete(f"{API}/reviews/{rid}?reason={WHY}", headers=admin(world)).status_code == 200
    assert client.delete(f"{API}/reviews/{rid}?reason={WHY}", headers=admin(world)).status_code == 404


# ── transferir alumno ────────────────────────────────────────────────────────────────────
def test_transfer_student(client, world, db):
    _, tp2 = mk_teacher(db, "profe_nuevo")
    db.add(StudentTeacherLink(student_id=world["sp"].id, teacher_id=world["tp"].id))
    db.commit()
    e = mk_enrollment(db, world)
    c = mk_class(db, world, hours=30, enrollment=e)
    done = mk_class(db, world, hours=-40, status="completed")
    r = client.post(f"{API}/students/{world['sp'].id}/transfer-teacher",
                    json={"reason": WHY, "from_teacher_id": world["tp"].id, "to_teacher_id": tp2.id, "remove_old_link": True}, headers=admin(world))
    assert r.status_code == 200, r.text
    assert r.json()["enrollments_transferred"] == 1 and r.json()["future_classes_transferred"] == 1
    db.expire_all()
    assert db.get(Enrollment, e.id).teacher_id == tp2.id
    # repetir con vínculo ya existente y sin borrar el viejo no rompe
    r2 = client.post(f"{API}/students/{world['sp'].id}/transfer-teacher",
                     json={"reason": WHY, "from_teacher_id": world["tp"].id, "to_teacher_id": tp2.id}, headers=admin(world))
    assert r2.status_code == 200 and r2.json()["enrollments_transferred"] == 0


def test_transfer_student_errors(client, world, db):
    _, tp2 = mk_teacher(db, "profe_n2")
    b = {"reason": WHY, "from_teacher_id": world["tp"].id, "to_teacher_id": tp2.id}
    u = f"{API}/students/{world['sp'].id}/transfer-teacher"
    assert client.post(f"{API}/students/999/transfer-teacher", json=b, headers=admin(world)).status_code == 404
    assert client.post(u, json={**b, "to_teacher_id": 999}, headers=admin(world)).status_code == 404
    assert client.post(u, json={**b, "to_teacher_id": world["tp"].id}, headers=admin(world)).status_code == 400
    ta, _ = mk_teacher(db, "ta_tr", role="teacher_admin")
    assert client.post(u, json=b, headers=hdr(ta)).status_code == 403


# ── búsquedas de apoyo ───────────────────────────────────────────────────────────────────
def test_lookups_as_superadmin(client, world, db):
    tp, sp = world["tp"], world["sp"]
    db.add(StudentTeacherLink(student_id=sp.id, teacher_id=tp.id))
    db.commit()
    e = mk_enrollment(db, world)
    mk_class(db, world, hours=30, enrollment=e)
    mk_payment(client, world)
    db.add(Review(teacher_id=tp.id, student_id=sp.id, rating=5.0, comment="x", is_legacy=False))
    db.add(Review(teacher_id=tp.id, student_id=None, rating=4.0, is_legacy=True, legacy_student_name=None, total_completed_classes=3))
    gp = mk_group_package(db, tp)
    co = mk_cohort(db, tp, gp)
    # una sesión grupal con participante, para la lista de alumnos reseñables
    g = mk_class(db, world, hours=60, ctype=ClassType.group)
    _, sp2 = mk_student(db, "alu_grupo")
    db.add(ClassParticipant(class_id=g.id, student_id=sp2.id, enrollment_id=e.id))
    db.commit()
    h = admin(world)
    assert len(client.get(f"{API}/lookup/teachers", headers=h).json()) >= 1
    assert client.get(f"{API}/lookup/teachers/{tp.id}/students", headers=h).json()[0]["id"] == sp.id
    assert client.get(f"{API}/lookup/teachers/999/students", headers=h).status_code == 404
    pk = client.get(f"{API}/lookup/teachers/{tp.id}/packages", headers=h).json()
    assert pk and pk[0]["is_unlimited"] is False
    assert client.get(f"{API}/lookup/teachers/999/packages", headers=h).status_code == 404
    en = client.get(f"{API}/lookup/students/{sp.id}/enrollments?teacher_id={tp.id}", headers=h).json()
    assert en and en[0]["package_name"]
    assert client.get(f"{API}/lookup/students/999/enrollments", headers=h).status_code == 404
    assert "allowed_class_durations" in client.get(f"{API}/lookup/class-durations", headers=h).json()
    assert client.get(f"{API}/lookup/teachers/{tp.id}/students/{sp.id}/classes", headers=h).json()
    assert client.get(f"{API}/lookup/teachers/{tp.id}/cohorts", headers=h).json()[0]["id"] == co.id
    assert client.get(f"{API}/lookup/teachers/{tp.id}/students/{sp.id}/payments", headers=h).json()
    rv = client.get(f"{API}/lookup/teachers/{tp.id}/students/reviewable", headers=h).json()
    assert {s["id"] for s in rv} >= {sp.id, sp2.id}
    assert client.get(f"{API}/lookup/teachers/999/students/reviewable", headers=h).status_code == 404
    names = {x["student_name"] for x in client.get(f"{API}/lookup/teachers/{tp.id}/reviews", headers=h).json()}
    assert "Sin nombre" in names


def test_reviewable_students_empty_for_teacher_without_history(client, world, db):
    _, tp2 = mk_teacher(db, "profe_vacio")
    assert client.get(f"{API}/lookup/teachers/{tp2.id}/students/reviewable", headers=admin(world)).json() == []


def test_lookups_for_teacher_admin_are_limited_to_self(client, world, db):
    ta_u, ta_tp = mk_teacher(db, "ta_look", role="teacher_admin")
    h = hdr(ta_u)
    tp = world["tp"]
    assert [t["id"] for t in client.get(f"{API}/lookup/teachers", headers=h).json()] == [ta_tp.id]
    mine = [f"{API}/lookup/teachers/{ta_tp.id}/students", f"{API}/lookup/teachers/{ta_tp.id}/packages",
            f"{API}/lookup/teachers/{ta_tp.id}/cohorts", f"{API}/lookup/teachers/{ta_tp.id}/reviews",
            f"{API}/lookup/teachers/{ta_tp.id}/students/reviewable",
            f"{API}/lookup/teachers/{ta_tp.id}/students/{world['sp'].id}/classes",
            f"{API}/lookup/teachers/{ta_tp.id}/students/{world['sp'].id}/payments"]
    for u in mine:
        assert client.get(u, headers=h).status_code == 200, u
    theirs = [f"{API}/lookup/teachers/{tp.id}/students", f"{API}/lookup/teachers/{tp.id}/packages",
              f"{API}/lookup/teachers/{tp.id}/cohorts", f"{API}/lookup/teachers/{tp.id}/reviews",
              f"{API}/lookup/teachers/{tp.id}/students/reviewable",
              f"{API}/lookup/teachers/{tp.id}/students/{world['sp'].id}/classes",
              f"{API}/lookup/teachers/{tp.id}/students/{world['sp'].id}/payments"]
    for u in theirs:
        assert client.get(u, headers=h).status_code == 403, u
    # inscripciones del alumno: solo ve las suyas
    mk_enrollment(db, world)
    assert client.get(f"{API}/lookup/students/{world['sp'].id}/enrollments", headers=h).json() == []
