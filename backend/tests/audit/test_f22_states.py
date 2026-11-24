"""Fase 22 - Estados de clase y matricula (E1-E6 y menores)."""
from datetime import timedelta

import pytest

from tests.audit.conftest import hdr, future
from tests.audit.helpers import API, book, set_status, approve, age_class, ready_student, buy_package
from app.models.class_ import Class
from app.models.package import Enrollment, Package


def _notify(client, user, **body):
    return client.post(f"{API}/payments/notify-payment", json=body, headers=hdr(user))


def _old_created(db, ids, hours=5):
    """Las clases del ciclo viejo se reservaron 'hace rato' (la prueba corre en milisegundos y el inicio de
    ciclo se compara con created_at con 2 s de tolerancia)."""
    from app.core.timezone import utc_now
    for cid in ids:
        db.get(Class, cid).created_at = utc_now() - timedelta(hours=hours)
    db.commit()


def _renew(client, world, eid, pkg=None, approve_it=True):
    r = _notify(client, world["s_user"], type="renewal", enrollment_id=eid,
                package_id=(pkg or world["pkg"]).id, payment_method="bank_transfer")
    assert r.status_code == 200, r.text
    if approve_it:
        assert approve(client, world, r.json()["payment_id"]).status_code == 200
    return r.json()["payment_id"]


# ─── E1: ciclo nuevo no cuenta clases del ciclo viejo ────────────────────────

def test_e1_renew_old_cycle_classes_do_not_fill_new_counter(client, world, db):
    eid, _ = ready_student(client, world)
    old = [book(client, world, future(48 + i * 24), enrollment_id=eid).json()["class_id"] for i in range(3)]
    _old_created(db, old)
    _renew(client, world, eid)
    db.expire_all()
    e = db.get(Enrollment, eid)
    assert e.classes_used == 0 and e.status.value == "active"
    for cid in old:
        assert set_status(client, world, cid, "completed", age=True).status_code == 200
    db.expire_all()
    e = db.get(Enrollment, eid)
    assert e.classes_used == 0, "las clases del ciclo viejo no deben sumar al ciclo nuevo"
    assert e.status.value == "active"
    # sobran 1 + 4 nuevos = 5 creditos reservables
    for i in range(5):
        r = book(client, world, future(300 + i * 24), enrollment_id=eid)
        assert r.status_code == 201, r.text


def test_e1_new_cycle_classes_do_count(client, world, db):
    eid, _ = ready_student(client, world)
    cid_old = book(client, world, future(48), enrollment_id=eid).json()["class_id"]
    _old_created(db, [cid_old])
    _renew(client, world, eid)
    import time
    time.sleep(2.2)  # la clase nueva debe ser posterior al inicio del ciclo (tolerancia de 2 s)
    cid_new = book(client, world, future(72), enrollment_id=eid).json()["class_id"]
    set_status(client, world, cid_old, "completed", age=True)
    set_status(client, world, cid_new, "completed", age=True)
    db.expire_all()
    assert db.get(Enrollment, eid).classes_used == 1


def test_e1_change_package_old_classes_do_not_fill_counter(client, world, db):
    eid, _ = ready_student(client, world)
    big = Package(teacher_id=world["tp"].id, name="P8", subject="English", classes_count=8, price=180.0,
                  price_per_class=22.5, duration_minutes=50, is_active=True)
    db.add(big)
    db.commit()
    old = [book(client, world, future(48 + i * 24), enrollment_id=eid).json()["class_id"] for i in range(2)]
    _old_created(db, old)
    r = _notify(client, world["s_user"], type="package_change", enrollment_id=eid, package_id=big.id,
                payment_method="bank_transfer")
    assert r.status_code == 200, r.text
    assert approve(client, world, r.json()["payment_id"]).status_code == 200
    db.expire_all()
    assert db.get(Enrollment, eid).classes_used == 0
    for cid in old:
        set_status(client, world, cid, "completed", age=True)
    db.expire_all()
    e = db.get(Enrollment, eid)
    assert e.classes_used == 0 and e.status.value == "active"
    assert book(client, world, future(400), enrollment_id=eid).status_code == 201


def test_e1_instant_downgrade_old_classes_do_not_complete(client, world, db):
    eid, _ = ready_student(client, world)
    small = Package(teacher_id=world["tp"].id, name="P2", subject="English", classes_count=2, price=60.0,
                    price_per_class=30.0, duration_minutes=50, is_active=True)
    db.add(small)
    db.commit()
    cid = book(client, world, future(48), enrollment_id=eid).json()["class_id"]
    _old_created(db, [cid])
    from app.api.v1.endpoints.payments import _apply_instant_package_change
    e = db.get(Enrollment, eid)
    _apply_instant_package_change(e, small, 1, db)
    set_status(client, world, cid, "completed", age=True)
    db.expire_all()
    e = db.get(Enrollment, eid)
    assert e.classes_used == 0 and e.status.value == "active"


# ─── E3: book acepta pending_renewal ─────────────────────────────────────────

def test_e3_book_with_leftover_credits_during_pending_renewal(client, world, db):
    eid, _ = ready_student(client, world)
    _renew(client, world, eid, approve_it=False)
    db.expire_all()
    assert db.get(Enrollment, eid).status.value == "pending_renewal"
    r = book(client, world, future(72), enrollment_id=eid)
    assert r.status_code == 201, r.text


def test_e3_book_completed_enrollment_has_specific_message(client, world, db):
    eid, _ = ready_student(client, world)
    e = db.get(Enrollment, eid)
    e.status = "completed"
    db.commit()
    r = book(client, world, future(72), enrollment_id=eid)
    assert r.status_code == 400
    assert "completado" in r.json()["detail"]


# ─── E5: cohorte cancelada conserva cohort_id y permite el reembolso ─────────

def _mk_cohort_with_students(db, world, paid_amounts):
    from app.models.group_cohort import CohortStatus, GroupCohort
    from app.models.payment import Payment, TeacherWallet
    from app.models.student import StudentProfile
    from app.core.timezone import utc_now
    from tests.audit.conftest import _mk_user
    gpkg = Package(teacher_id=world["tp"].id, name="G", subject="English", classes_count=10, price=60.0,
                   price_per_class=6.0, duration_minutes=50, is_active=True, is_group=True,
                   min_students=1, max_students=5)
    db.add(gpkg)
    db.flush()
    cohort = GroupCohort(package_id=gpkg.id, teacher_id=world["tp"].id, status=CohortStatus.confirmed,
                         min_students=1, max_students=5)
    db.add(cohort)
    db.add(TeacherWallet(teacher_id=world["tp"].id, available_balance=500.0, total_earned=500.0, total_withdrawn=0.0))
    db.flush()
    out = []
    for i, amount in enumerate(paid_amounts):
        u = _mk_user(db, "student", f"g{i}")
        sp = StudentProfile(user_id=u.id, user_username=u.username, timezone="UTC")
        db.add(sp)
        db.flush()
        e = Enrollment(student_id=sp.id, package_id=gpkg.id, teacher_id=world["tp"].id, cohort_id=cohort.id,
                       payment_status="paid" if amount else "unpaid", classes_total=10, unlocked_credits=10)
        db.add(e)
        db.flush()
        if amount:
            db.add(Payment(enrollment_id=e.id, student_id=sp.id, teacher_id=world["tp"].id, amount_total=amount,
                           amount_teacher=amount * 0.85, amount_platform=amount * 0.15, payment_method="manual",
                           status="approved", payment_type="group_enrollment", validated_at=utc_now()))
        out.append((u, e))
    db.commit()
    return cohort, out


def test_e5_cancelled_cohort_refund_capped_to_paid_and_unpaid_nothing(client, db, world):
    cohort, studs = _mk_cohort_with_students(db, world, [60.0, 60.0, 30.0, 0])
    r = client.post(f"{API}/cohorts/{cohort.id}/cancel", headers=hdr(world["t_user"]))
    assert r.status_code == 200, r.text
    db.expire_all()
    for u, e in studs:
        e = db.get(Enrollment, e.id)
        assert e.status.value == "cancelled" and e.cohort_id == cohort.id, "debe conservar cohort_id"
    expected = [60.0, 60.0, 30.0]
    for (u, e), amount in zip(studs[:3], expected):
        st = client.get(f"{API}/payments/booking-status?teacher_username=profe", headers=hdr(u)).json()
        assert st["stage"] == "needs_group_refund", st
        r = client.post(f"{API}/payments/request-refund-cohort-cancelled", json={
            "enrollment_id": e.id, "payment_info": {"other_notes": "x"}}, headers=hdr(u))
        assert r.status_code == 200, r.text
        from app.models.payment import Payment
        db.expire_all()
        p = db.get(Payment, r.json()["payment_id"])
        assert p.payment_type == "refund" and p.status == "pending_review" and float(p.amount_total) == amount
    u, e = studs[3]
    r = client.post(f"{API}/payments/request-refund-cohort-cancelled", json={
        "enrollment_id": e.id, "payment_info": {"other_notes": "x"}}, headers=hdr(u))
    assert r.status_code == 400
    st = client.get(f"{API}/payments/booking-status?teacher_username=profe", headers=hdr(u)).json()
    assert st["stage"] != "needs_group_refund"


# ─── E2: matriz de transiciones ──────────────────────────────────────────────

def _past_class(client, world, db, status="completed", hours_ago=3):
    eid, _ = ready_student(client, world)
    cid = book(client, world, future(72), enrollment_id=eid).json()["class_id"]
    age_class(cid, hours_ago)
    assert set_status(client, world, cid, status).status_code == 200
    return eid, cid


def test_e2_cancelled_class_cannot_be_reopened_by_status(client, db, world):
    eid, _ = ready_student(client, world)
    cid = book(client, world, future(72), enrollment_id=eid).json()["class_id"]
    assert client.delete(f"{API}/classes/teacher/{cid}", headers=hdr(world["t_user"])).status_code == 200
    for st in ("confirmed", "completed", "no_show"):
        assert set_status(client, world, cid, st).status_code == 400, st
    db.expire_all()
    assert db.get(Class, cid).status == "cancelled"


def test_e2_cannot_cancel_completed_or_past_class(client, db, world):
    eid, cid = _past_class(client, world, db, "completed")
    assert set_status(client, world, cid, "cancelled").status_code == 400
    assert client.delete(f"{API}/classes/teacher/{cid}", headers=hdr(world["t_user"])).status_code == 400
    # una clase confirmada que ya paso tampoco se cancela
    cid2 = book(client, world, future(120), enrollment_id=eid).json()["class_id"]
    age_class(cid2, 5)
    assert set_status(client, world, cid2, "cancelled").status_code == 400
    assert client.delete(f"{API}/classes/teacher/{cid2}", headers=hdr(world["t_user"])).status_code == 400
    db.expire_all()
    assert db.get(Enrollment, eid).classes_used == 1


def test_e2_finished_class_cannot_reopen_to_confirmed_and_72h_applies(client, db, world):
    eid, cid = _past_class(client, world, db, "completed")
    assert set_status(client, world, cid, "confirmed").status_code == 400
    assert set_status(client, world, cid, "no_show").status_code == 200  # correccion dentro de 72 h
    age_class(cid, 100)
    assert set_status(client, world, cid, "completed").status_code == 400
    assert set_status(client, world, cid, "confirmed").status_code == 400
    assert set_status(client, world, cid, "cancelled").status_code == 400


def test_e2_group_class_cancel_via_patch_uses_normal_path(client, db, world):
    from app.models.class_participant import ClassParticipant
    from app.models.class_ import ClassType
    cohort, studs = _mk_cohort_with_students(db, world, [60.0, 60.0])
    start = future(72)
    c = Class(teacher_id=world["tp"].id, student_id=None, cohort_id=cohort.id, class_type=ClassType.group,
              subject="English", start_time_utc=start, end_time_utc=start + timedelta(minutes=50), duration=50,
              buffer_minutes=0, status="confirmed")
    db.add(c)
    db.flush()
    for u, e in studs:
        db.add(ClassParticipant(class_id=c.id, student_id=e.student_id, enrollment_id=e.id,
                                attendance_status="registered"))
    db.commit()
    sent = []
    import app.api.v1.endpoints.classes as cls_mod
    orig = cls_mod.send_class_cancelled_email
    cls_mod.send_class_cancelled_email = lambda **k: sent.append(k["to_email"])
    try:
        r = set_status(client, world, c.id, "cancelled")
    finally:
        cls_mod.send_class_cancelled_email = orig
    assert r.status_code == 200, r.text
    assert len(sent) == 2, sent


def test_e2_no_show_reschedule_returns_counted_credit(client, db, world):
    """TE-02: reagendar un no_show (cortesia) a 'confirmed' resta el credito ya contado."""
    eid, cid = _past_class(client, world, db, "no_show")
    db.expire_all()
    assert db.get(Enrollment, eid).classes_used == 1
    new = future(200)
    r = client.patch(f"{API}/classes/teacher/{cid}/reschedule", json={
        "start_time_utc": new.isoformat(), "end_time_utc": (new + timedelta(minutes=50)).isoformat()},
        headers=hdr(world["t_user"]))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(Class, cid).status == "confirmed"
    assert db.get(Enrollment, eid).classes_used == 0
    age_class(cid, 3)
    assert set_status(client, world, cid, "completed").status_code == 200
    db.expire_all()
    assert db.get(Enrollment, eid).classes_used == 1, "no debe contarse dos veces"


def test_e2_admin_reschedule_no_show_and_cancelled(client, db, world):
    eid, cid = _past_class(client, world, db, "no_show")
    new = future(200)
    body = {"start_time_utc": new.isoformat(), "end_time_utc": (new + timedelta(minutes=50)).isoformat()}
    r = client.patch(f"{API}/classes/admin/{cid}/reschedule", json=body, headers=hdr(world["admin"]))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(Enrollment, eid).classes_used == 0
    assert client.delete(f"{API}/classes/admin/{cid}", headers=hdr(world["admin"])).status_code == 200
    r = client.patch(f"{API}/classes/admin/{cid}/reschedule", json=body, headers=hdr(world["admin"]))
    assert r.status_code == 400


def test_e2_auto_no_show_then_reschedule_does_not_double_count(client, db, world):
    from app.core.class_logic import finalize_past_classes
    from app.core.timezone import utc_now
    eid, _ = ready_student(client, world)
    cid = book(client, world, future(72), enrollment_id=eid).json()["class_id"]
    c = db.get(Class, cid)
    c.start_time_utc = utc_now() - timedelta(hours=100)
    c.end_time_utc = utc_now() - timedelta(hours=99)
    db.commit()
    finalize_past_classes(db)
    db.expire_all()
    assert db.get(Enrollment, eid).classes_used == 1
    new = future(200)
    r = client.patch(f"{API}/classes/admin/{cid}/reschedule", json={
        "start_time_utc": new.isoformat(), "end_time_utc": (new + timedelta(minutes=50)).isoformat()},
        headers=hdr(world["admin"]))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(Enrollment, eid).classes_used == 0


# ─── E4: cancelar cambio de paquete y endpoints heredados ────────────────────

def _big_pkg(db, world):
    big = Package(teacher_id=world["tp"].id, name="P8", subject="English", classes_count=8, price=180.0,
                  price_per_class=22.5, duration_minutes=50, is_active=True)
    db.add(big)
    db.commit()
    return big


def test_e4_cancel_package_change_voids_pending_payment_and_validate_rejected(client, db, world):
    from app.models.payment import Payment
    eid, _ = ready_student(client, world)
    big = _big_pkg(db, world)
    r = _notify(client, world["s_user"], type="package_change", enrollment_id=eid, package_id=big.id,
                payment_method="bank_transfer")
    assert r.status_code == 200, r.text
    pid = r.json()["payment_id"]
    r = client.post(f"{API}/packages/{eid}/cancel-package-change", headers=hdr(world["s_user"]))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(Payment, pid).status == "rejected"
    assert approve(client, world, pid).status_code == 404  # ya no esta pendiente
    assert db.get(Enrollment, eid).package_id == world["pkg"].id


def test_e4_validate_package_change_without_request_is_rejected(client, db, world):
    from app.models.payment import Payment
    eid, _ = ready_student(client, world)
    big = _big_pkg(db, world)
    r = _notify(client, world["s_user"], type="package_change", enrollment_id=eid, package_id=big.id,
                payment_method="bank_transfer")
    pid = r.json()["payment_id"]
    e = db.get(Enrollment, eid)
    e.change_requested_package_id = None  # el estado queda inconsistente
    db.commit()
    r = approve(client, world, pid)
    assert r.status_code == 409, r.text
    db.expire_all()
    assert db.get(Payment, pid).status == "pending_review"
    assert db.get(Enrollment, eid).package_id == world["pkg"].id


def test_e4_legacy_endpoints_removed(client, db, world):
    eid, _ = ready_student(client, world)
    h = hdr(world["s_user"])
    body = {"current_enrollment_id": eid, "new_package_id": world["pkg"].id}
    assert client.post(f"{API}/packages/request-renewal", json=body, headers=h).status_code in (404, 405, 422)
    assert client.post(f"{API}/packages/request-package-change", json=body, headers=h).status_code in (404, 405, 422)


# ─── E6: prueba sin confirmar ────────────────────────────────────────────────

def test_e6_unconfirmed_trial_goes_finalized_with_72h_grace_and_teacher_notice(client, db, world):
    from app.core.class_logic import finalize_past_classes, get_student_booking_stage
    from app.core.timezone import utc_now
    from app.models.notification import Notification
    from app.models.student import StudentProfile
    r = book(client, world, future(24))
    cid = r.json()["class_id"]
    c = db.get(Class, cid)
    c.start_time_utc = utc_now() - timedelta(hours=3)
    c.end_time_utc = utc_now() - timedelta(hours=2)
    db.commit()
    assert finalize_past_classes(db) == 1
    db.expire_all()
    assert db.get(Class, cid).status == "finalized"  # antes pasaba directo a no_show
    assert db.get(StudentProfile, world["sp"].id).total_completed_classes in (0, None)
    assert db.query(Notification).filter(Notification.type == "trial_unconfirmed").count() == 1
    assert finalize_past_classes(db) == 0  # idempotente: no vuelve a avisar
    assert db.query(Notification).filter(Notification.type == "trial_unconfirmed").count() == 1
    assert get_student_booking_stage(world["sp"].id, world["tp"].id, db) == "trial_in_progress"
    # el profesor la marca dentro de la ventana: completada, sin gastar nada raro
    assert set_status(client, world, cid, "completed").status_code == 200
    db.expire_all()
    assert db.get(Class, cid).status == "completed"


def test_e6_unmarked_trial_after_72h_is_no_show_and_counts_as_used(client, db, world):
    """Decisión del dueño (confirmada 2026-11-24): sin marcar a las 72 h -> no_show y prueba usada; se corrige por soporte."""
    from app.core.class_logic import finalize_past_classes, get_student_booking_stage
    from app.core.timezone import utc_now
    cid = book(client, world, future(24)).json()["class_id"]
    c = db.get(Class, cid)
    c.start_time_utc = utc_now() - timedelta(hours=75)
    c.end_time_utc = utc_now() - timedelta(hours=74)
    db.commit()
    assert finalize_past_classes(db) >= 1
    db.expire_all()
    assert db.get(Class, cid).status == "no_show"
    assert get_student_booking_stage(world["sp"].id, world["tp"].id, db) == "needs_package"  # la prueba ya se usó
    assert finalize_past_classes(db) == 0


# ─── m3: calificar tareas ────────────────────────────────────────────────────

def _homework(db, world, status="pending", active=True):
    from app.models.homework import Homework, HomeworkAssignment
    from app.core.timezone import utc_now
    hw = Homework(teacher_id=world["tp"].id, title="T", description="D", due_date_utc=utc_now() + timedelta(days=3),
                  is_active=active)
    db.add(hw)
    db.flush()
    a = HomeworkAssignment(homework_id=hw.id, student_id=world["sp"].id, status=status)
    db.add(a)
    db.commit()
    return hw, a


def test_m3_grade_requires_submission_score_and_active_homework(client, db, world):
    h = hdr(world["t_user"])
    hw, a = _homework(db, world, "pending")
    url = lambda hw, a: f"{API}/homework/{hw.id}/submissions/{a.id}/grade"
    assert client.patch(url(hw, a), json={"score": 8}, headers=h).status_code == 400  # sin entrega
    assert client.patch(url(hw, a), json={}, headers=h).status_code == 422  # sin nota
    a.status = "submitted"
    db.commit()
    assert client.patch(url(hw, a), json={"score": 8, "feedback": "ok"}, headers=h).status_code == 200
    db.expire_all()
    assert db.get(type(a), a.id).status == "graded"
    hw2, a2 = _homework(db, world, "submitted", active=False)
    assert client.patch(url(hw2, a2), json={"score": 5}, headers=h).status_code == 400
