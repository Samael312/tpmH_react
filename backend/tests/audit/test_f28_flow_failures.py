"""Fase 28 - Fallos de la suite flow (Neon dev): reproduccion en el harness SQLite."""
from datetime import timedelta

from tests.audit.conftest import hdr, future
from tests.audit.helpers import API, set_status
from tests.audit.test_f19_cohort_overlap import _cohort, _student, _create_session
from app.models.class_ import Class
from app.models.class_participant import ClassParticipant
from app.models.student import StudentProfile


def test_group_class_completed_counts_lifetime_for_active_participants_only(client, db, world):
    """Flow test_lifetime_completed_classes (grupal): +1 al participante activo, 0 al cancelado."""
    extra = _student(db, "extra1")
    cohort, enrs = _cohort(db, world, [world["sp"]])
    r = _create_session(client, world, cohort, future(72))
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    db.add(ClassParticipant(class_id=cid, student_id=extra.id, enrollment_id=enrs[0].id, attendance_status="cancelled"))
    db.commit()
    assert db.get(StudentProfile, world["sp"].id).total_completed_classes == 0
    r = set_status(client, world, cid, "completed", age=True)
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(StudentProfile, world["sp"].id).total_completed_classes == 1
    assert db.get(StudentProfile, extra.id).total_completed_classes == 0


def test_group_session_skips_overlapping_student_so_lifetime_not_counted(client, db, world):
    """Causa probable del fallo flow #5 en Neon dev: con otra clase solapada del alumno (restos de otros
    tests), la sesion lo OMITE (Fase 19) -> no es participante -> no suma. Es el diseno, no una regresion."""
    cohort, _ = _cohort(db, world, [world["sp"]])
    start = future(72)
    from tests.audit.test_f19_cohort_overlap import _other_teacher, _class
    other = _other_teacher(db)
    _class(db, other.id, world["sp"].id, start + timedelta(minutes=10))
    r = _create_session(client, world, cohort, start)
    assert r.status_code == 201, r.text
    assert r.json()["participant_count"] == 0 and len(r.json()["skipped_participants"]) == 1
    assert set_status(client, world, r.json()["id"], "completed", age=True).status_code == 200
    db.expire_all()
    assert db.get(StudentProfile, world["sp"].id).total_completed_classes == 0


def test_trial_forced_completed_then_package_notify_ok(client, db, world):
    """Flow #6 (test_full_trial...): prueba reservada por /payments/book, completada por god-mode, y luego
    notify-payment del paquete inicial debe ser 200 (etapa needs_package)."""
    from tests.audit.helpers import book
    r = book(client, world, future(96), duration=25)
    assert r.status_code == 201 and r.json()["is_trial"] is True, r.text
    cid = r.json()["class_id"]
    r = client.patch(f"{API}/god-mode/classes/{cid}/force-status",
                     json={"status": "completed", "reason": "flow-tests: completar prueba"}, headers=hdr(world["admin"]))
    assert r.status_code == 200, r.text
    r = client.post(f"{API}/payments/notify-payment", json={
        "type": "package", "package_id": world["pkg"].id, "payment_method": "bank_transfer"}, headers=hdr(world["s_user"]))
    assert r.status_code == 200, r.text


def test_cancelled_paid_cohort_enrollment_blocks_initial_package_until_refund(client, db, world):
    """Causa probable del 400 'Ya no puedes seleccionar un paquete inicial' en dev: un enrollment PAGADO de una
    cohorte cancelada (Fase 22 E5 conserva cohort_id) deja la etapa en needs_group_refund hasta pedir el
    reembolso. Restos de un test anterior en dev producen exactamente ese 400."""
    from app.models.group_cohort import CohortStatus
    from app.models.package import EnrollmentStatus
    from tests.audit.helpers import complete_trial
    complete_trial(client, world)
    cohort, enrs = _cohort(db, world, [world["sp"]])
    cohort.status = CohortStatus.cancelled
    enrs[0].status = EnrollmentStatus.cancelled
    db.commit()
    r = client.post(f"{API}/payments/notify-payment", json={
        "type": "package", "package_id": world["pkg"].id, "payment_method": "bank_transfer"}, headers=hdr(world["s_user"]))
    assert r.status_code == 400 and "paquete inicial" in r.text


def test_unpaid_active_enrollment_is_cancelled_on_book(client, db, world):
    """Flow #7 (test_booking_rejects_unpaid_enrollment): con prueba completada, un enrollment 'unpaid' activo se
    cancela al intentar reservar y la reserva da 400 pidiendo paquete."""
    from datetime import datetime, timezone
    from app.models.class_ import ClassType
    from app.models.package import Enrollment, EnrollmentStatus
    from tests.audit.helpers import book
    now = datetime.now(timezone.utc)
    db.add(Class(teacher_id=world["tp"].id, student_id=world["sp"].id, class_type=ClassType.trial, status="completed",
                 start_time_utc=now - timedelta(days=30), end_time_utc=now - timedelta(days=30, minutes=-25), duration=25))
    e = Enrollment(student_id=world["sp"].id, teacher_id=world["tp"].id, package_id=world["pkg"].id, classes_used=0,
                   classes_total=4, unlocked_credits=4, payment_status="unpaid", status=EnrollmentStatus.active)
    db.add(e)
    db.commit()
    r = book(client, world, future(120), enrollment_id=e.id)
    assert r.status_code == 400 and "paquete" in r.text.lower(), r.text
    db.expire_all()
    assert db.get(Enrollment, e.id).status == EnrollmentStatus.cancelled


def test_d12_late_join_prorated_price_credits_and_future_session(client, db, world):
    """Flow #4 (d12, cayo por conexion): paquete 8 clases a 160, 3 sesiones ya dictadas -> cobra 100,
    5 creditos y entra como participante de la sesion futura."""
    from app.models.class_ import ClassType
    from app.models.group_cohort import CohortStatus, GroupCohort
    from app.models.package import Enrollment, Package
    from app.models.payment import Payment
    from app.core.timezone import utc_now
    pkg = Package(teacher_id=world["tp"].id, name="D12", subject="English", price=160.0, classes_count=8,
                  duration_minutes=50, is_group=True, is_active=True, min_students=2, max_students=6)
    db.add(pkg)
    db.flush()
    cohort = GroupCohort(teacher_id=world["tp"].id, package_id=pkg.id, status=CohortStatus.in_progress,
                         min_students=2, max_students=6, start_date=utc_now() - timedelta(days=14))
    db.add(cohort)
    db.flush()
    for i in range(3):
        ps = utc_now() - timedelta(days=14 - i * 3)
        db.add(Class(teacher_id=world["tp"].id, student_id=None, cohort_id=cohort.id, class_type=ClassType.group,
                     status="completed", start_time_utc=ps, end_time_utc=ps + timedelta(minutes=50), duration=50,
                     buffer_minutes=10))
    fs = utc_now() + timedelta(days=3)
    fut = Class(teacher_id=world["tp"].id, student_id=None, cohort_id=cohort.id, class_type=ClassType.group,
                status="confirmed", start_time_utc=fs, end_time_utc=fs + timedelta(minutes=50), duration=50,
                buffer_minutes=10)
    db.add(fut)
    db.commit()
    r = client.post(f"{API}/cohorts/{cohort.id}/enroll", json={
        "cohort_id": cohort.id, "payment_method": "bank_transfer", "transaction_reference": "x"}, headers=hdr(world["s_user"]))
    assert r.status_code == 201, r.text
    assert r.json()["amount_charged"] == 100.0
    eid = r.json()["enrollment_id"]
    assert db.get(Enrollment, eid).classes_total == 5
    pay = db.query(Payment).filter(Payment.enrollment_id == eid).first()
    assert pay.amount_total == 100.0
    r = client.patch(f"{API}/payments/{pay.id}/validate", json={"action": "approve"}, headers=hdr(world["admin"]))
    assert r.status_code == 200, r.text
    db.expire_all()
    e = db.get(Enrollment, eid)
    assert e.unlocked_credits == 5 and e.payment_status == "paid"
    p = db.query(ClassParticipant).filter_by(class_id=fut.id, student_id=world["sp"].id).first()
    assert p is not None and p.attendance_status == "confirmed"


def test_staff_edits_user_data_but_only_superadmin_changes_role(client, db, world):
    """Flow #1 (stale): teacher_admin edita datos (200); cambiar rol -> 403; superadmin si cambia teacher<->teacher_admin."""
    from tests.audit.test_permissions_money import _teacher_admin
    ta, _ = _teacher_admin(db)
    h = hdr(ta)
    assert client.patch(f"{API}/admin/users/{ta.id}", json={"phone_number": None}, headers=h).status_code == 200
    assert client.patch(f"{API}/admin/users/{ta.id}", json={"role": "teacher"}, headers=h).status_code == 403
    r = client.patch(f"{API}/admin/users/{ta.id}", json={"role": "teacher"}, headers=hdr(world["admin"]))
    assert r.status_code == 200, r.text


def test_platform_config_chat_settings_superadmin_only(client, db, world):
    """Flow #2 (stale): configurar el chat via /admin/platform-config es solo superadmin."""
    from tests.audit.test_permissions_money import _teacher_admin
    ta, _ = _teacher_admin(db)
    body = {"chat_enabled": True, "chat_retention_days": 45, "chat_reactivation_hours": 12}
    assert client.patch(f"{API}/admin/platform-config", json=body, headers=hdr(ta)).status_code == 403
    assert client.patch(f"{API}/admin/platform-config", json=body, headers=hdr(world["admin"])).status_code == 200
    cfg = client.get(f"{API}/admin/platform-config").json()
    assert cfg["chat_retention_days"] == 45 and cfg["chat_reactivation_hours"] == 12


def test_cancel_cohort_keeps_cohort_id_on_enrollment_but_frees_seat(client, db, world):
    """Flow #3 (stale): enrollment cancelado conserva cohort_id (E5), el cupo se libera."""
    from app.models.package import Enrollment
    cohort, enrs = _cohort(db, world, [world["sp"]])
    eid = enrs[0].id
    r = client.post(f"{API}/cohorts/{cohort.id}/cancel", headers=hdr(world["t_user"]))
    assert r.status_code == 200 and r.json()["status"] == "cancelled", r.text
    assert client.get(f"{API}/cohorts/{cohort.id}/members", headers=hdr(world["t_user"])).json() == []
    mine = client.get(f"{API}/packages/my-enrollments", headers=hdr(world["s_user"])).json()
    e = next(x for x in mine if x["id"] == eid)
    assert e["status"] == "cancelled" and e["cohort_id"] == cohort.id
    db.expire_all()
    assert db.get(Enrollment, eid).cohort_id == cohort.id
