"""Sondas de la auditoria multi-tenant (SQLite, sin .env). Cada test AFIRMA el comportamiento
actual (bug) para dejar evidencia: si pasa, el hallazgo esta confirmado."""
from datetime import timedelta

from tests.audit.conftest import hdr, _mk_user, future
from tests.audit.helpers import API, approve, book, complete_trial, buy_package, iso
from app.models.payment import Payment, TeacherWallet
from app.models.teacher import TeacherProfile, TeacherStatus
from app.models.student import StudentProfile
from app.models.package import Package, Enrollment
from app.models.class_ import Class
from app.models.availability import TeacherAvailability
from app.models.student_teacher_link import StudentTeacherLink
from app.models.payment_config import PlatformConfig, PaymentConfig
from app.models.chat import ChatConversation, ChatMessage, ChatConversationType


def _teacher(db, name, role="teacher"):
    u = _mk_user(db, role, name)
    tp = TeacherProfile(user_id=u.id, user_username=u.username, status=TeacherStatus.approved,
                        timezone="UTC", languages=["English"], subjects=["English"], video_url="v")
    db.add(tp); db.flush()
    for dow in range(7):
        db.add(TeacherAvailability(teacher_id=tp.id, day_of_week=dow, is_available=True,
                                   start_time_local="00:00", end_time_local="00:00"))
    db.commit()
    return u, tp


def _suspend(db, tp_id):
    t = db.get(TeacherProfile, tp_id); t.status = TeacherStatus.suspended; db.commit()


def _wallet(db, tp_id, amount):
    w = db.query(TeacherWallet).filter(TeacherWallet.teacher_id == tp_id).first()
    if not w:
        w = TeacherWallet(teacher_id=tp_id, available_balance=0.0, total_earned=0.0, total_withdrawn=0.0)
        db.add(w)
    w.available_balance = amount; w.total_earned = amount
    db.commit()


# ── 1. teacher_admin NO se acredita dinero ni se procesa su retiro (corregido, F16) ──
def test_teacher_admin_self_payment_and_self_withdrawal(client, world, db):
    u, tp = _teacher(db, "tadmin", role="teacher_admin")
    r = client.post(f"{API}/god-mode/payments", json={
        "teacher_id": tp.id, "student_id": world["sp"].id, "amount_total": 1000.0,
        "payment_method": "bank_transfer", "status": "approved", "reason": "pago por fuera"},
        headers=hdr(u))
    assert r.status_code == 403, r.text
    db.expire_all()
    w = db.query(TeacherWallet).filter(TeacherWallet.teacher_id == tp.id).first()
    assert w is None or w.available_balance == 0.0
    _wallet(db, tp.id, 850.0)  # saldo ajeno a la sonda
    r = client.post(f"{API}/payments/request-withdrawal", json={"amount": 850.0, "payment_info": "mi IBAN"},
                    headers=hdr(u))
    assert r.status_code == 201, r.text  # puede solicitarlo...
    wid = r.json()["id"]
    r = client.post(f"{API}/payments/admin/withdrawals/{wid}/process",
                    json={"action": "complete", "reference": "ok"}, headers=hdr(u))
    assert r.status_code == 403, r.text  # ...pero ya no procesar su propio retiro (corregido, F16)
    r = client.post(f"{API}/payments/admin/withdrawals/{wid}/process",
                    json={"action": "complete", "reference": "ok"}, headers=hdr(world["admin"]))
    assert r.status_code == 200, r.text  # el superadmin si
    # control: el superadmin si puede crear el pago
    r = client.post(f"{API}/god-mode/payments", json={
        "teacher_id": tp.id, "student_id": world["sp"].id, "amount_total": 1000.0,
        "payment_method": "bank_transfer", "status": "approved", "reason": "pago por fuera"},
        headers=hdr(world["admin"]))
    assert r.status_code == 201, r.text


def test_teacher_admin_approves_own_pending_payment_via_god_mode(client, world, db):
    u, tp = _teacher(db, "tadmin", role="teacher_admin")
    pay = Payment(student_id=world["sp"].id, teacher_id=tp.id, amount_total=100.0, amount_teacher=0,
                  amount_platform=0, payment_method="bank_transfer", status="pending_review",
                  payment_type="unlimited_recharge", installment_index=1)
    db.add(pay); db.commit()
    # NEG-01: el validate normal da 403 y ahora el Modo Dios tambien (corregido, F16)
    assert client.patch(f"{API}/payments/{pay.id}/validate", json={"action": "approve"},
                        headers=hdr(u)).status_code == 403
    r = client.patch(f"{API}/god-mode/payments/{pay.id}", json={"status": "approved", "reason": "aprobar yo"},
                     headers=hdr(u))
    assert r.status_code == 403, r.text
    db.expire_all()
    w = db.query(TeacherWallet).filter(TeacherWallet.teacher_id == tp.id).first()
    assert db.get(Payment, pay.id).status == "pending_review"
    assert w is None or w.available_balance == 0.0


# ── 2. datos de pago: decision del dueño, el teacher_admin SI puede editarlos ──
def test_teacher_admin_changes_platform_payment_destination(client, world, db):
    u, _ = _teacher(db, "tadmin", role="teacher_admin")
    r = client.patch(f"{API}/payments/config", json={"paypal_enabled": True, "paypal_email": "yo@ejemplo.com"},
                     headers=hdr(u))
    assert r.status_code == 200
    assert client.get(f"{API}/payments/config").json()["paypal_email"] == "yo@ejemplo.com"


def test_teacher_admin_cannot_switch_platform_to_single_with_himself_featured(client, world, db):
    u, tp = _teacher(db, "tadmin", role="teacher_admin")
    r = client.patch(f"{API}/admin/platform-config",
                     json={"is_single_tenant": True, "featured_teacher_username": "tadmin"}, headers=hdr(u))
    assert r.status_code == 403, r.text
    db.expire_all()
    cfg = db.query(PlatformConfig).first()
    assert cfg is None or not (cfg.is_single_tenant or cfg.featured_teacher_id == tp.id)
    # control: el superadmin si
    r = client.patch(f"{API}/admin/platform-config",
                     json={"is_single_tenant": True, "featured_teacher_username": "tadmin"},
                     headers=hdr(world["admin"]))
    assert r.status_code == 200, r.text


# ── 3. teacher_admin NO lee chats de otro profesor (corregido, F16) ──
def test_teacher_admin_reads_other_teacher_chat(client, world, db):
    u, _ = _teacher(db, "tadmin", role="teacher_admin")
    convo = ChatConversation(conversation_type=ChatConversationType.direct,
                             student_id=world["sp"].id, teacher_id=world["tp"].id)
    db.add(convo); db.flush()
    db.add(ChatMessage(conversation_id=convo.id, sender_id=world["s_user"].id, content="secreto"))
    db.commit()
    r = client.get(f"{API}/chat/admin/conversations/{convo.id}/messages", params={"reason": "curiosidad"},
                   headers=hdr(u))
    assert r.status_code == 403, r.text
    # control: el superadmin si
    r = client.get(f"{API}/chat/admin/conversations/{convo.id}/messages", params={"reason": "revision"},
                   headers=hdr(world["admin"]))
    assert r.status_code == 200 and r.json()[0]["content"] == "secreto"


def test_chat_admin_list_with_both_filters_crashes(client, world, db):
    r = client.get(f"{API}/chat/admin/conversations",
                   params={"teacher_username": "profe", "student_username": "alumno"}, headers=hdr(world["admin"]))
    print("both-filters status", r.status_code, r.text[:200])
    assert r.status_code == 500


# ── 4. profesor desactivado (is_active=False) sigue en el marketplace y recibe reservas ──
def test_deactivated_teacher_still_listed_and_bookable(client, world, db):
    r = client.patch(f"{API}/admin/users/{world['t_user'].id}/status", json={"is_active": False},
                     headers=hdr(world["admin"]))
    assert r.status_code == 200
    names = [t["user_username"] for t in client.get(f"{API}/teachers/").json()]
    assert "profe" in names
    assert client.get(f"{API}/teachers/profe").status_code == 200
    r = book(client, world, future(30))
    assert r.status_code == 201, r.text  # prueba reservada con un profesor que no puede entrar


# ── 5. editar el paquete entre la notificacion y la aprobacion cambia lo que recibe el alumno ──
def test_package_edit_between_notify_and_approve(client, world, db):
    complete_trial(client, world)
    r = client.post(f"{API}/payments/notify-payment", json={
        "type": "package", "package_id": world["pkg"].id, "payment_method": "bank_transfer"},
        headers=hdr(world["s_user"]))
    pid = r.json()["payment_id"]
    r = client.patch(f"{API}/packages/{world['pkg'].id}", json={
        "name": "P4", "subject": "English", "classes_count": 10, "price": 250.0, "price_per_class": 25.0,
        "duration_minutes": 50}, headers=hdr(world["t_user"]))
    assert r.status_code == 200, r.text
    assert approve(client, world, pid).status_code == 200
    db.expire_all()
    p = db.get(Payment, pid)
    e = db.get(Enrollment, p.enrollment_id)
    print("amount", p.amount_total, "unlocked", e.unlocked_credits, "total", e.classes_total)
    assert p.amount_total == 100.0 and e.unlocked_credits == 10 and e.classes_total == 4


def test_package_edit_mid_enrollment_changes_duration_and_refund_basis(client, world, db):
    eid, _ = buy_package_after_trial(client, world)
    r = client.patch(f"{API}/packages/{world['pkg'].id}", json={
        "name": "P4", "subject": "English", "classes_count": 4, "price": 400.0, "price_per_class": 100.0,
        "duration_minutes": 80}, headers=hdr(world["t_user"]))
    assert r.status_code == 200
    # el alumno ya no puede reservar con la duracion que compro (50)
    r = book(client, world, future(50), enrollment_id=eid, duration=50)
    assert r.status_code == 400 and "80" in r.text


def buy_package_after_trial(client, world):
    complete_trial(client, world)
    return buy_package(client, world)


# ── 6. reembolso por profesor suspendido sobre un paquete NO pagado o pagado a medias ──
def test_suspended_refund_on_partially_paid_installments_refunds_full_price(client, world, db):
    pkg = Package(teacher_id=world["tp"].id, name="P4c", subject="English", classes_count=4, price=100.0,
                  price_per_class=25.0, duration_minutes=50, is_active=True, allow_installments=True,
                  installment_count=2, installment_amount=50.0)
    db.add(pkg); db.commit()
    complete_trial(client, world)
    r = client.post(f"{API}/payments/notify-payment", json={
        "type": "package", "package_id": pkg.id, "payment_method": "bank_transfer", "installment_index": 1},
        headers=hdr(world["s_user"]))
    assert r.status_code == 200, r.text
    pid = r.json()["payment_id"]
    assert approve(client, world, pid).status_code == 200
    db.expire_all()
    eid = db.get(Payment, pid).enrollment_id
    _wallet(db, world["tp"].id, 500.0)  # el profesor tiene saldo de otros alumnos
    _suspend(db, world["tp"].id)
    r = client.post(f"{API}/payments/request-refund-teacher-suspended",
                    json={"enrollment_id": eid, "payment_info": {"bank_name": "X"}}, headers=hdr(world["s_user"]))
    assert r.status_code == 200, r.text
    db.expire_all()
    ref = db.query(Payment).filter(Payment.payment_type == "refund").first()
    print("pagado 50, reembolso", ref.amount_total)
    assert ref.amount_total == 100.0


def test_suspended_refund_on_never_paid_enrollment(client, world, db):
    complete_trial(client, world)
    r = client.post(f"{API}/payments/notify-payment", json={
        "type": "package", "package_id": world["pkg"].id, "payment_method": "bank_transfer"},
        headers=hdr(world["s_user"]))
    pid = r.json()["payment_id"]
    assert client.patch(f"{API}/payments/{pid}/validate", json={"action": "reject", "rejection_reason": "no llego"},
                        headers=hdr(world["admin"])).status_code == 200
    db.expire_all()
    eid = db.get(Payment, pid).enrollment_id
    _wallet(db, world["tp"].id, 500.0)
    _suspend(db, world["tp"].id)
    r = client.post(f"{API}/payments/request-refund-teacher-suspended",
                    json={"enrollment_id": eid, "payment_info": {"bank_name": "X"}}, headers=hdr(world["s_user"]))
    print("refund never-paid", r.status_code, r.text[:200])
    assert r.status_code == 200
    rid = r.json()["payment_id"]
    assert approve(client, world, rid).status_code == 200
    db.expire_all()
    print("wallet after", db.query(TeacherWallet).filter(TeacherWallet.teacher_id == world["tp"].id).first().available_balance)


def test_buy_package_from_suspended_teacher_after_trial(client, world, db):
    complete_trial(client, world)
    _suspend(db, world["tp"].id)
    r = client.post(f"{API}/payments/notify-payment", json={
        "type": "package", "package_id": world["pkg"].id, "payment_method": "bank_transfer"},
        headers=hdr(world["s_user"]))
    assert r.status_code == 200, r.text  # paga a un profesor que ya no puede dar clases


# ── 7. desvincular con prueba pendiente ──
def test_unlink_keeps_pending_trial_and_breaks_teacher_access(client, world, db):
    r = book(client, world, future(30))
    assert r.status_code == 201
    cid = r.json()["class_id"]
    r = client.delete(f"{API}/users/me/teachers/profe", headers=hdr(world["s_user"]))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(Class, cid).status == "pending_trial"  # la prueba sigue viva
    # el profesor ya no puede escribirle ni asignarle material, pero tiene la clase
    r = client.get(f"{API}/chat/conversations/direct/alumno", headers=hdr(world["t_user"]))
    assert r.status_code == 403
    # el alumno no ve al profesor en "Tus profesores" pero tiene la clase
    assert client.get(f"{API}/users/me/teachers", headers=hdr(world["s_user"])).json() == []


# ── 8. prueba creada por staff no vincula ──
def test_staff_trial_does_not_link_student(client, world, db):
    u2, tp2 = _teacher(db, "profe2")
    r = client.post(f"{API}/classes/trial", json={
        "teacher_username": "profe2", "student_id": world["sp"].id, "start_time_utc": iso(future(30)),
        "end_time_utc": iso(future(30) + timedelta(minutes=25)), "duration_minutes": 25, "subject": "English"},
        headers=hdr(world["admin"]))
    assert r.status_code == 201, r.text
    assert client.get(f"{API}/users/me/teachers", headers=hdr(world["s_user"])).json() == []
    assert client.get(f"{API}/chat/conversations/direct/alumno", headers=hdr(u2)).status_code == 403
    assert client.get(f"{API}/teachers/me/students", headers=hdr(u2)).json() == []


def test_staff_trial_allowed_for_suspended_teacher(client, world, db):
    _suspend(db, world["tp"].id)
    r = client.post(f"{API}/classes/trial", json={
        "teacher_username": "profe", "student_id": world["sp"].id, "start_time_utc": iso(future(30)),
        "end_time_utc": iso(future(30) + timedelta(minutes=25)), "duration_minutes": 25, "subject": "English"},
        headers=hdr(world["admin"]))
    assert r.status_code == 201, r.text


# ── 9. transferencia del Modo Dios sin quitar el vinculo viejo deja datos inconsistentes ──
def test_transfer_keep_old_link_desyncs_students_list(client, world, db):
    u2, tp2 = _teacher(db, "profe2")
    eid, _ = buy_package_after_trial(client, world)
    r = client.post(f"{API}/god-mode/students/{world['sp'].id}/transfer-teacher", json={
        "from_teacher_id": world["tp"].id, "to_teacher_id": tp2.id, "remove_old_link": False,
        "reason": "cambio de profe"}, headers=hdr(world["admin"]))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.query(StudentTeacherLink).filter_by(student_id=world["sp"].id, teacher_id=world["tp"].id).first()
    assert world["sp"].id not in (db.get(TeacherProfile, world["tp"].id).students or [])
    mine = [t["teacher_username"] for t in client.get(f"{API}/users/me/teachers", headers=hdr(world["s_user"])).json()]
    assert "profe" in mine
    assert client.get(f"{API}/chat/conversations/direct/alumno", headers=hdr(world["t_user"])).status_code == 403


def test_transfer_then_refund_hits_new_teacher_wallet(client, world, db):
    u2, tp2 = _teacher(db, "profe2")
    eid, _ = buy_package_after_trial(client, world)  # profe cobra 85
    _wallet(db, tp2.id, 200.0)
    r = client.post(f"{API}/god-mode/students/{world['sp'].id}/transfer-teacher", json={
        "from_teacher_id": world["tp"].id, "to_teacher_id": tp2.id, "remove_old_link": True,
        "reason": "cambio de profe"}, headers=hdr(world["admin"]))
    assert r.status_code == 200
    _suspend(db, tp2.id)
    r = client.post(f"{API}/payments/request-refund-teacher-suspended",
                    json={"enrollment_id": eid, "payment_info": {"bank_name": "X"}}, headers=hdr(world["s_user"]))
    assert r.status_code == 200, r.text
    assert approve(client, world, r.json()["payment_id"]).status_code == 200
    db.expire_all()
    w1 = db.query(TeacherWallet).filter_by(teacher_id=world["tp"].id).first().available_balance
    w2 = db.query(TeacherWallet).filter_by(teacher_id=tp2.id).first().available_balance
    print("A (cobro)", w1, "B (no cobro)", w2)
    assert w1 == 85.0 and w2 == 115.0  # B paga el reembolso de lo que cobro A


# ── 10. landing ignora el interruptor de WhatsApp ──
def test_landing_ignores_whatsapp_switch(client, world, db):
    tp = db.get(TeacherProfile, world["tp"].id)
    tp.social_links = {"whatsapp": "+34600000000"}; tp.profile_photo_url = "http://p"
    cfg = db.query(PlatformConfig).first(); cfg.show_teacher_whatsapp = False
    db.commit()
    assert "whatsapp" not in (client.get(f"{API}/teachers/profe").json()["social_links"] or {})
    land = client.get(f"{API}/public/landing").json()
    assert land["teachers"][0]["social_links"].get("whatsapp") == "+34600000000"


# ── 11. ban de un alumno (por cualquier staff) cancela paquetes con TODOS sus profesores ──
def test_teacher_admin_ban_cancels_enrollments_of_other_teachers(client, world, db):
    u, _ = _teacher(db, "tadmin", role="teacher_admin")
    eid, _ = buy_package_after_trial(client, world)
    r = client.post(f"{API}/admin/students/{world['s_user'].id}/ban", json={"reason": "competencia"},
                    headers=hdr(u))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(Enrollment, eid).status == "cancelled"


# ── 12. alumno con dos profesores: booking-status sin username ──
def test_two_teachers_booking_status_needs_username(client, world, db):
    _teacher(db, "profe2")
    for t in ("profe", "profe2"):
        assert client.post(f"{API}/users/me/teachers/{t}", headers=hdr(world["s_user"])).status_code == 200
    r = client.get(f"{API}/payments/booking-status", headers=hdr(world["s_user"]))
    assert r.status_code == 400


def test_enrollment_of_teacher_a_cannot_book_with_teacher_b(client, world, db):
    u2, tp2 = _teacher(db, "profe2")
    eid, _ = buy_package_after_trial(client, world)
    body = {"teacher_username": "profe2", "enrollment_id": eid, "start_time_utc": iso(future(60)),
            "end_time_utc": iso(future(60) + timedelta(minutes=50)), "duration_minutes": 50}
    r = client.post(f"{API}/payments/book", json=body, headers=hdr(world["s_user"]))
    assert r.status_code == 201
    db.expire_all()
    assert db.get(Class, r.json()["class_id"]).teacher_id == world["tp"].id  # ignora teacher_username, usa el del enrollment


def test_link_self_exposes_contact_to_teacher(client, world, db):
    u2, _ = _teacher(db, "profe2")
    assert client.post(f"{API}/users/me/teachers/profe2", headers=hdr(world["s_user"])).status_code == 200
    full = client.get(f"{API}/teachers/me/students-full", headers=hdr(u2)).json()
    assert full and full[0]["email"] == "alumno@audit-tpm.com"


def test_material_access_survives_unlink(client, world, db):
    from app.models.material import Material, MaterialAssignment
    assert client.post(f"{API}/users/me/teachers/profe", headers=hdr(world["s_user"])).status_code == 200
    m = Material(teacher_id=world["tp"].id, title="m", category="pdf", file_url="http://f", is_active=True)
    db.add(m); db.flush()
    db.add(MaterialAssignment(material_id=m.id, student_id=world["sp"].id)); db.commit()
    assert client.delete(f"{API}/users/me/teachers/profe", headers=hdr(world["s_user"])).status_code == 200
    r = client.get(f"{API}/materials/{m.id}/stream", headers=hdr(world["s_user"]), follow_redirects=False)
    assert r.status_code in (302, 307)


def test_teacher_admin_streams_other_teacher_material(client, world, db):
    from app.models.material import Material
    u, _ = _teacher(db, "tadmin", role="teacher_admin")
    m = Material(teacher_id=world["tp"].id, title="m", category="pdf", file_url="http://f", is_active=True)
    db.add(m); db.commit()
    r = client.get(f"{API}/materials/{m.id}/stream", headers=hdr(u), follow_redirects=False)
    assert r.status_code == 403, r.text  # corregido F16: solo superadmin
    r = client.get(f"{API}/materials/{m.id}/stream", headers=hdr(world["admin"]), follow_redirects=False)
    assert r.status_code in (302, 307)


def test_cohort_enroll_with_suspended_teacher_code_path(client, world, db):
    """Solo verifica que enroll_in_cohort no consulta TeacherStatus (lectura de codigo)."""
    import inspect
    from app.api.v1.endpoints import cohorts
    src = inspect.getsource(cohorts.enroll_in_cohort)
    assert "TeacherStatus" not in src and "approved" not in src
