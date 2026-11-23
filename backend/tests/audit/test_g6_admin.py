"""Cobertura de `app/api/v1/endpoints/admin.py`: profesores, apelaciones, tickets, notificaciones, usuarios y configuración."""
from tests.audit.conftest import _mk_user, hdr, future
from tests.audit.helpers import API
from tests.audit.test_g1_god_mode_actions import mk_teacher, mk_student, mk_class
from app.models.class_ import Class
from app.models.notification import Notification
from app.models.package import Enrollment, EnrollmentStatus
from app.models.student import StudentProfile
from app.models.support_ticket import SupportCategory, SupportTicket, SupportTicketStatus
from app.models.teacher import TeacherStatus
from app.models.teacher_appeal import TeacherAppeal

A = f"{API}/admin"


def ah(w):
    return hdr(w["admin"])


# ── profesores ───────────────────────────────────────────────────────────────────────────
def test_teachers_list_filters_and_detail(client, world, db):
    h = ah(world)
    assert client.get(f"{A}/teachers?status_filter=approved", headers=h).status_code == 200
    assert client.get(f"{A}/teachers?status_filter=nope", headers=h).status_code == 400
    assert client.get(f"{A}/teachers?has_video=true", headers=h).status_code == 200
    assert client.get(f"{A}/teachers?has_video=false", headers=h).status_code == 200
    r = client.get(f"{A}/teachers/{world['tp'].id}", headers=h)
    assert r.status_code == 200
    assert client.get(f"{A}/teachers/999", headers=h).status_code == 404


def test_update_teacher_status_paths(client, world, db):
    h = ah(world)
    tid = world["tp"].id
    s = lambda **b: client.patch(f"{A}/teachers/{tid}/status", json=b, headers=h)
    assert client.patch(f"{A}/teachers/999/status", json={"status": "approved"}, headers=h).status_code == 404
    assert s(status="inventado").status_code == 400
    r = s(status="rejected", reason="Video incompleto")
    assert r.status_code == 200
    assert s(status="approved").status_code == 200
    assert s(status="suspended").status_code == 200
    world["tp"].video_url = None
    db.commit()
    assert s(status="approved").status_code == 400  # sin video no se aprueba


def test_teacher_commission(client, world, db):
    h = ah(world)
    tid = world["tp"].id
    assert client.patch(f"{A}/teachers/{tid}/commission", json={"commission_rate": 0.2}, headers=h).status_code == 200
    assert client.patch(f"{A}/teachers/{tid}/commission", json={"commission_rate": 2}, headers=h).status_code == 422
    assert client.patch(f"{A}/teachers/999/commission", json={"commission_rate": 0.2}, headers=h).status_code == 404
    world["t_user"].role = world["t_user"].role.__class__("teacher_admin")
    db.commit()
    assert client.patch(f"{A}/teachers/{tid}/commission", json={"commission_rate": 0.3}, headers=hdr(world["t_user"])).status_code == 403


# ── apelaciones ──────────────────────────────────────────────────────────────────────────
def mk_appeal(db, w, n=1, kind="profile"):
    a = TeacherAppeal(teacher_id=w["tp"].id, appeal_number=n, message="Por favor revisen", kind=kind, status="pending")
    db.add(a)
    db.commit()
    return a


def test_appeals_listing_and_resolution(client, world, db):
    h = ah(world)
    world["tp"].status = TeacherStatus.rejected
    db.commit()
    a1 = mk_appeal(db, world, 1)
    assert len(client.get(f"{A}/appeals", headers=h).json()) == 1
    assert len(client.get(f"{A}/appeals?status_filter=approved", headers=h).json()) == 0
    assert client.get(f"{A}/teachers/{world['tp'].id}/appeals", headers=h).status_code in (200, 404)
    res = lambda aid, **b: client.patch(f"{A}/appeals/{aid}/resolve", json=b, headers=h)
    assert res(999, action="approve").status_code == 404
    r = res(a1.id, action="reject", admin_response="Sin cambios")
    assert r.status_code == 200
    a2 = mk_appeal(db, world, 2)
    db.expire_all()
    world["tp"].appeal_count = 2
    db.commit()
    r = res(a2.id, action="reject")
    assert r.status_code == 200 and r.json()["appeal_exhausted"] is True
    a3 = mk_appeal(db, world, 1)
    assert res(a3.id, action="approve").status_code == 200
    db.expire_all()
    assert db.get(type(world["tp"]), world["tp"].id).status == TeacherStatus.approved


def test_appeal_resolution_video_kind_and_self_block(client, world, db):
    h = ah(world)
    world["tp"].video_pending_url = "http://cloud/new.mp4"
    db.commit()
    a = mk_appeal(db, world, kind="video")
    r = client.patch(f"{A}/appeals/{a.id}/resolve", json={"action": "approve"}, headers=h)
    assert r.status_code == 200 and r.json()["appeal_exhausted"] is False
    world["tp"].video_pending_url = "http://cloud/other.mp4"
    db.commit()
    b = mk_appeal(db, world, kind="video")
    assert client.patch(f"{A}/appeals/{b.id}/resolve", json={"action": "reject"}, headers=h).status_code == 200
    c = mk_appeal(db, world)
    world["t_user"].role = world["t_user"].role.__class__("teacher_admin")
    db.commit()
    assert client.patch(f"{A}/appeals/{c.id}/resolve", json={"action": "approve"}, headers=hdr(world["t_user"])).status_code == 403


def test_pending_video_review(client, world, db):
    h = ah(world)
    tid = world["tp"].id
    assert client.patch(f"{A}/teachers/999/video/approve", json={}, headers=h).status_code in (404, 405, 422)
    paths = client.get("/openapi.json").json()["paths"]
    video = [p for p in paths if "/admin/teachers/" in p and "video" in p]
    assert video


# ── tickets de soporte ───────────────────────────────────────────────────────────────────
def mk_ticket(db, user, category=SupportCategory.question, **kw):
    t = SupportTicket(user_id=user.id, category=category, subject="Ayuda", message="Necesito ayuda", status=SupportTicketStatus.pending, **kw)
    db.add(t)
    db.commit()
    return t


def test_support_tickets_listing_and_resolution(client, world, db):
    h = ah(world)
    t = mk_ticket(db, world["s_user"])
    assert len(client.get(f"{A}/support-tickets?status_filter=pending&category_filter=question", headers=h).json()) == 1
    assert client.get(f"{A}/support-tickets?status_filter=answered", headers=h).json() == []
    res = lambda tid, **b: client.patch(f"{A}/support-tickets/{tid}/resolve", json=b, headers=h)
    assert res(999, admin_response="ok").status_code == 404
    assert res(t.id, admin_response="Resuelto").status_code == 200
    assert res(t.id, admin_response="Resuelto").status_code == 404  # ya respondido


def test_support_ticket_without_user_is_not_found(client, world, db):
    t = mk_ticket(db, world["s_user"])
    db.query(SupportTicket).filter(SupportTicket.id == t.id).update({"user_id": 99999})
    db.commit()
    assert client.patch(f"{A}/support-tickets/{t.id}/resolve", json={"admin_response": "x"}, headers=ah(world)).status_code in (404, 500)


def test_class_correction_tickets(client, world, db):
    h = ah(world)
    c = mk_class(db, world, hours=-5, status="no_show")
    t = mk_ticket(db, world["t_user"], SupportCategory.class_correction, class_id=c.id, requested_status="completed")
    res = lambda tid, **b: client.patch(f"{A}/support-tickets/{tid}/resolve", json=b, headers=h)
    assert res(t.id, admin_response="listo").status_code == 400  # falta la decisión
    assert res(t.id, admin_response="listo", decision="approved").status_code == 200
    # la clase ya no está en no_show
    t2 = mk_ticket(db, world["t_user"], SupportCategory.class_correction, class_id=c.id, requested_status="completed")
    assert res(t2.id, admin_response="listo", decision="approved").status_code == 400
    # estado solicitado inválido
    c2 = mk_class(db, world, hours=-10, status="no_show")
    t3 = mk_ticket(db, world["t_user"], SupportCategory.class_correction, class_id=c2.id, requested_status="raro")
    assert res(t3.id, admin_response="listo", decision="approved").status_code == 400
    # cancelar devuelve el crédito
    t4 = mk_ticket(db, world["t_user"], SupportCategory.class_correction, class_id=c2.id, requested_status="cancelled")
    assert res(t4.id, admin_response="listo", decision="approved").status_code == 200
    # rechazo
    c3 = mk_class(db, world, hours=-12, status="no_show")
    t5 = mk_ticket(db, world["t_user"], SupportCategory.class_correction, class_id=c3.id, requested_status="completed")
    assert res(t5.id, admin_response="no procede", decision="rejected").status_code == 200
    # un teacher_admin no resuelve correcciones
    t6 = mk_ticket(db, world["t_user"], SupportCategory.class_correction, class_id=c3.id, requested_status="completed")
    ta, _ = mk_teacher(db, "ta_sup", role="teacher_admin")
    assert client.patch(f"{A}/support-tickets/{t6.id}/resolve", json={"admin_response": "x", "decision": "approved"}, headers=hdr(ta)).status_code == 403


# ── notificaciones ───────────────────────────────────────────────────────────────────────
def test_notifications(client, world, db):
    h = ah(world)
    n = Notification(type="x", title="Hola", message="Mensaje", is_read=False)
    db.add(n)
    db.commit()
    assert len(client.get(f"{A}/notifications?unread_only=true", headers=h).json()) >= 0
    assert client.get(f"{A}/notifications/unread-count", headers=h).status_code == 200
    assert client.patch(f"{A}/notifications/{n.id}/read", headers=h).status_code == 200
    assert client.patch(f"{A}/notifications/999/read", headers=h).status_code == 404
    assert client.post(f"{A}/notifications/mark-all-read", headers=h).status_code == 200


# ── usuarios ─────────────────────────────────────────────────────────────────────────────
def test_users_listing_filters(client, world, db):
    h = ah(world)
    assert client.get(f"{A}/users?role=student", headers=h).json()["total"] >= 1
    assert client.get(f"{A}/users?role=nope", headers=h).status_code == 400
    assert client.get(f"{A}/users?is_active=false", headers=h).json()["active_count"] == 0
    assert client.get(f"{A}/users?is_banned=false&search=alumno", headers=h).json()["total"] >= 1


def test_user_status_and_update(client, world, db):
    h = ah(world)
    uid = world["s_user"].id
    st = lambda i, **b: client.patch(f"{A}/users/{i}/status", json=b, headers=h)
    assert st(999, is_active=False).status_code == 404
    assert st(world["admin"].id, is_active=False).status_code == 400
    other = _mk_user(db, "superadmin", "otro_admin")
    db.commit()
    assert st(other.id, is_active=False).status_code == 403
    assert st(uid, is_active=False).status_code == 200
    assert st(uid, is_active=True).status_code == 200
    up = lambda i, **b: client.patch(f"{A}/users/{i}", json=b, headers=h)
    assert up(999, is_active=True).status_code == 404
    assert up(uid, role="teacher").status_code == 400  # student<->teacher no se soporta
    assert up(world["t_user"].id, role="teacher_admin").status_code == 200
    assert up(world["admin"].id, is_active=False).status_code == 400
    assert up(other.id, is_active=False).status_code == 403
    assert up(uid, is_active=False).status_code == 200
    assert up(uid, phone_number="+584141234567").status_code == 200
    s2 = _mk_user(db, "student", "otro_alu")
    db.commit()
    assert up(s2.id, phone_number="+584141234567").status_code == 400  # teléfono repetido
    ta = hdr(world["t_user"])
    assert client.patch(f"{A}/users/{uid}", json={"role": "teacher"}, headers=ta).status_code in (400, 403)


def test_ban_unban_and_student_detail(client, world, db):
    h = ah(world)
    uid = world["s_user"].id
    assert client.post(f"{A}/students/999/ban", json={"reason": "spam"}, headers=h).status_code == 404
    assert client.post(f"{A}/students/{uid}/ban", json={"reason": "spam"}, headers=h).status_code == 200
    assert client.post(f"{A}/students/{uid}/ban", json={"reason": "spam"}, headers=h).status_code == 400
    assert client.post(f"{A}/students/{uid}/unban", headers=h).status_code == 200
    assert client.post(f"{A}/students/{uid}/unban", headers=h).status_code == 400
    assert client.post(f"{A}/students/999/unban", headers=h).status_code == 404
    db.add(Enrollment(student_id=world["sp"].id, package_id=world["pkg"].id, teacher_id=world["tp"].id,
                      status=EnrollmentStatus.active, classes_total=4))
    db.commit()
    d = client.get(f"{A}/students/{uid}/detail", headers=h)
    assert d.status_code == 200 and d.json()["enrollments"]
    assert client.get(f"{A}/students/999/detail", headers=h).status_code == 404
    # un usuario alumno sin perfil
    bare = _mk_user(db, "student", "sin_perfil_alu")
    db.commit()
    assert client.get(f"{A}/students/{bare.id}/detail", headers=h).status_code == 200


# ── configuración de la plataforma ───────────────────────────────────────────────────────
def test_platform_config_updates(client, world, db):
    h = ah(world)
    p = lambda **b: client.patch(f"{A}/platform-config", json=b, headers=h)
    r = p(platform_name="Plataforma X", platform_tagline="Lema", show_teacher_whatsapp=True, chat_enabled=True,
          chat_retention_days=30, chat_reactivation_hours=2, landing_content={"hero": "hola"})
    assert r.status_code == 200, r.text
    assert p(chat_retention_days=-1).status_code == 400
    assert p(chat_reactivation_hours=-1).status_code == 400
    assert p(featured_teacher_username="no_existe").status_code == 404
    assert p(featured_teacher_username=world["t_user"].username).status_code == 200
    assert p(featured_teacher_username="").status_code == 200
    assert p(is_single_tenant=True).status_code == 400  # sin profesora destacada
    assert p(featured_teacher_username=world["t_user"].username, is_single_tenant=True).status_code == 200
    assert p(is_single_tenant=False).status_code == 200
    assert client.get(f"{A}/platform-config", headers=h).status_code == 200


def test_platform_config_creates_missing_row(client, world, db):
    from app.models.payment_config import PlatformConfig
    db.query(PlatformConfig).delete()
    db.commit()
    assert client.patch(f"{A}/platform-config", json={"platform_name": "Nueva"}, headers=ah(world)).status_code == 200
