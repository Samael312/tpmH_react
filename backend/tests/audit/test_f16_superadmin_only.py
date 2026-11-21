"""F16: acciones de dinero, plataforma y sobre otros usuarios son solo del superadmin.

Un teacher_admin recibe 403; el superadmin sigue pudiendo."""
from datetime import timedelta

from tests.audit.conftest import hdr, future
from tests.audit.helpers import API, book, iso
from tests.audit.test_permissions_money import _teacher_admin
from app.models.chat import ChatConversation, ChatConversationType
from app.models.material import Material
from app.models.payment import Withdrawal, TeacherWallet


def _both(client, method, url, db, world, **kw):
    """Devuelve (respuesta teacher_admin, respuesta superadmin)."""
    from app.models.user import User
    ta = db.query(User).filter(User.username == "tadmin").first() or _teacher_admin(db)[0]
    r_ta = client.request(method, f"{API}{url}", headers=hdr(ta), **kw)
    r_sa = client.request(method, f"{API}{url}", headers=hdr(world["admin"]), **kw)
    return r_ta, r_sa


def _check(client, method, url, db, world, **kw):
    r_ta, r_sa = _both(client, method, url, db, world, **kw)
    assert r_ta.status_code == 403, f"{method} {url} teacher_admin -> {r_ta.status_code} {r_ta.text}"
    assert r_sa.status_code != 403, f"{method} {url} superadmin -> {r_sa.status_code} {r_sa.text}"
    assert r_sa.status_code < 500, f"{method} {url} superadmin -> {r_sa.status_code} {r_sa.text}"
    return r_sa


def test_platform_config_superadmin_only(client, world, db):
    r = _check(client, "PATCH", "/admin/platform-config", db, world, json={"platform_name": "Nombre F16"})
    assert r.status_code == 200, r.text


def test_payment_config_editable_by_teacher_admin(client, world, db):
    """Decision del dueño: los datos de pago los puede editar tambien el teacher_admin."""
    r_ta, r_sa = _both(client, "PATCH", "/payments/config", db, world, json={"whatsapp_number": "+10000000"})
    assert r_ta.status_code == 200, r_ta.text
    assert r_sa.status_code == 200, r_sa.text


def test_god_mode_create_and_edit_payment_superadmin_only(client, world, db):
    body = {"reason": "correccion F16", "teacher_id": world["tp"].id, "student_id": world["sp"].id,
            "amount_total": 50.0, "payment_method": "bank_transfer", "payment_type": "manual",
            "status": "pending_review"}
    ta, _ = _teacher_admin(db)
    assert client.post(f"{API}/god-mode/payments", json=body, headers=hdr(ta)).status_code == 403
    r = client.post(f"{API}/god-mode/payments", json=body, headers=hdr(world["admin"]))
    assert r.status_code == 201, r.text
    pid = r.json()["payment"]["id"]
    edit = {"reason": "editar F16", "transaction_id": "TX-F16"}
    assert client.patch(f"{API}/god-mode/payments/{pid}", json=edit, headers=hdr(ta)).status_code == 403
    assert client.patch(f"{API}/god-mode/payments/{pid}", json=edit, headers=hdr(world["admin"])).status_code == 200


def test_chat_admin_routes_superadmin_only(client, world, db):
    c = ChatConversation(conversation_type=ChatConversationType.direct,
                         teacher_id=world["tp"].id, student_id=world["sp"].id)
    db.add(c); db.commit()
    _check(client, "GET", "/chat/admin/conversations", db, world)
    _check(client, "GET", f"/chat/admin/conversations/{c.id}", db, world)
    r = _check(client, "GET", f"/chat/admin/conversations/{c.id}/messages?reason=revision+F16", db, world)
    assert r.status_code == 200, r.text


def test_teacher_admin_can_still_change_teacher_and_user_status(client, world, db):
    ta, _ = _teacher_admin(db)
    h = hdr(ta)
    r = client.patch(f"{API}/admin/teachers/{world['tp'].id}/status", json={"status": "approved"}, headers=h)
    assert r.status_code not in (401, 403) and r.status_code < 500, r.text
    r = client.patch(f"{API}/admin/users/{world['s_user'].id}/status", json={"is_active": True}, headers=h)
    assert r.status_code == 200, r.text


def test_teacher_admin_can_still_ban_and_unban_students(client, world, db):
    ta, _ = _teacher_admin(db)
    uid = world["s_user"].id
    assert client.post(f"{API}/admin/students/{uid}/ban", json={"reason": "spam"}, headers=hdr(ta)).status_code == 200
    assert client.post(f"{API}/admin/students/{uid}/unban", headers=hdr(ta)).status_code == 200


def test_only_superadmin_changes_roles(client, world, db):
    ta, _ = _teacher_admin(db)
    uid = world["t_user"].id
    url = f"{API}/admin/users/{uid}"
    assert client.patch(url, json={"role": "teacher_admin"}, headers=hdr(ta)).status_code == 403
    db.expire_all()
    assert world["t_user"].role.value == "teacher"
    # teacher_admin si edita otros datos
    assert client.patch(url, json={"phone_number": "+1555000"}, headers=hdr(ta)).status_code == 200
    # superadmin si cambia el rol
    assert client.patch(url, json={"role": "teacher_admin"}, headers=hdr(world["admin"])).status_code == 200
    db.expire_all()
    assert world["t_user"].role.value == "teacher_admin"


def test_class_admin_reschedule_and_delete_superadmin_only(client, world, db):
    r = book(client, world, future(24))
    assert r.status_code == 201, r.text
    cid = r.json()["class_id"]
    ta, _ = _teacher_admin(db)
    new_start = future(72)
    body = {"start_time_utc": iso(new_start), "end_time_utc": iso(new_start + timedelta(minutes=50))}
    assert client.patch(f"{API}/classes/admin/{cid}/reschedule", json=body, headers=hdr(ta)).status_code == 403
    assert client.delete(f"{API}/classes/admin/{cid}", headers=hdr(ta)).status_code == 403
    r = client.patch(f"{API}/classes/admin/{cid}/reschedule", json=body, headers=hdr(world["admin"]))
    assert r.status_code not in (403, 500), r.text
    r = client.delete(f"{API}/classes/admin/{cid}", headers=hdr(world["admin"]))
    assert r.status_code == 200, r.text


def test_material_stream_of_others_superadmin_only(client, world, db):
    m = Material(teacher_id=world["tp"].id, title="M", category="other", file_url="http://x/f.pdf")
    db.add(m); db.commit()
    ta, _ = _teacher_admin(db)
    assert client.get(f"{API}/materials/{m.id}/stream", headers=hdr(ta), follow_redirects=False).status_code == 403
    r = client.get(f"{API}/materials/{m.id}/stream", headers=hdr(world["admin"]), follow_redirects=False)
    assert r.status_code in (302, 307), r.text
    # el dueño sigue accediendo
    r = client.get(f"{API}/materials/{m.id}/stream", headers=hdr(world["t_user"]), follow_redirects=False)
    assert r.status_code in (302, 307), r.text


def _withdrawal(db, teacher_id):
    db.add(TeacherWallet(teacher_id=teacher_id, available_balance=0.0, total_earned=50.0, total_withdrawn=0.0))
    w = Withdrawal(teacher_id=teacher_id, amount=50.0, status="pending",
                   destination_method="paypal", destination_details="x@y.com")
    db.add(w); db.commit()
    return w.id


def test_teacher_admin_cannot_process_own_withdrawal(client, world, db):
    ta, tp = _teacher_admin(db)
    wid = _withdrawal(db, tp.id)
    body = {"action": "complete", "reference": "REF-1"}
    url = f"{API}/payments/admin/withdrawals/{wid}/process"
    assert client.post(url, json=body, headers=hdr(ta)).status_code == 403
    db.expire_all()
    assert db.get(Withdrawal, wid).status == "pending"
    assert client.post(url, json=body, headers=hdr(world["admin"])).status_code == 200
    db.expire_all()
    assert db.get(Withdrawal, wid).status == "completed"


def test_teacher_admin_processes_someone_elses_withdrawal(client, world, db):
    ta, _ = _teacher_admin(db)
    wid = _withdrawal(db, world["tp"].id)
    r = client.post(f"{API}/payments/admin/withdrawals/{wid}/process",
                    json={"action": "complete", "reference": "REF-2"}, headers=hdr(ta))
    assert r.status_code == 200, r.text
