"""Fase 21 — Seguridad y comunicacion (S1, S3, S4, S6 y menores).

Cada prueba se escribio PRIMERO contra el codigo anterior para confirmar el fallo (ver CORRECCIONES.md, Fase 21).
Sin red: Resend/Cloudinary/OpenAI/Google se sustituyen con monkeypatch.
"""
import inspect
import io
import re

import pytest

from tests.audit.conftest import hdr, _mk_user
from tests.audit.helpers import API
from app.core.timezone import utc_now
from app.models.user import User

XSS = '<script>alert(1)</script><img src=x onerror=alert(2)>'


@pytest.fixture
def sent(monkeypatch):
    """Captura los correos que saldrian por Resend."""
    box = []
    import resend
    monkeypatch.setattr(resend.Emails, "send", lambda payload, *a, **k: box.append(payload) or {"id": "x"})
    return box


def _token_from(sent_msgs, to):
    for m in reversed(sent_msgs):
        if m["to"] == to:
            found = re.search(r"verify-email\?token=([\w\-]+)", m["html"])
            if found:
                return found.group(1)
    return None


# ═══ S1: cambio de email ════════════════════════════════════════════════════

def test_s1_email_change_lowercases_unverifies_and_sends_verification(client, world, db, sent):
    u = world["s_user"]
    r = client.patch(f"{API}/users/me", json={"email": "Nuevo.Correo@Audit-TPM.com"}, headers=hdr(u))
    assert r.status_code == 200, r.text
    db.expire_all()
    u = db.get(User, u.id)
    assert u.email == "nuevo.correo@audit-tpm.com"
    assert u.is_verified is False
    assert _token_from(sent, "nuevo.correo@audit-tpm.com"), "debe llegar un correo de verificacion al email nuevo"


def test_s1_email_change_is_case_insensitive_unique(client, world, db):
    r = client.patch(f"{API}/users/me", json={"email": "PROFE@audit-tpm.com"}, headers=hdr(world["s_user"]))
    assert r.status_code == 400, r.text


def test_s1_email_same_with_different_case_is_not_a_change(client, world, db, sent):
    r = client.patch(f"{API}/users/me", json={"email": "ALUMNO@audit-tpm.com"}, headers=hdr(world["s_user"]))
    assert r.status_code == 200
    db.expire_all()
    assert db.get(User, world["s_user"].id).is_verified is True
    assert not sent


def test_s1_email_change_revokes_other_sessions_keeps_current(client, world, db, sent):
    from fastapi.testclient import TestClient
    from app.main import app
    attacker = TestClient(app, raise_server_exceptions=False)
    assert attacker.post(f"{API}/auth/login", json={"login": "alumno", "password": "Password123"}).status_code == 200
    assert attacker.post(f"{API}/auth/refresh").status_code == 200  # la sesion robada vale

    me = TestClient(app, raise_server_exceptions=False)
    assert me.post(f"{API}/auth/login", json={"login": "alumno", "password": "Password123"}).status_code == 200
    r = me.patch(f"{API}/users/me", json={"email": "otro@audit-tpm.com"})
    assert r.status_code == 200, r.text
    assert attacker.post(f"{API}/auth/refresh").status_code == 401, "la otra sesion debe quedar cerrada"
    assert me.post(f"{API}/auth/refresh").status_code == 200, "la sesion actual se conserva"


def test_s1_google_login_does_not_link_after_email_change(client, world, db, monkeypatch):
    """Un atacante cambia su email al de la victima: Google de la victima NO debe entrar en esa cuenta."""
    async def fake_google(token):
        return {"google_id": "g-victim", "email": "victima@gmail.com", "name": "V", "surname": "X",
                "avatar": None, "is_verified": True}
    monkeypatch.setattr("app.api.v1.endpoints.auth.verify_google_token", fake_google)
    client.patch(f"{API}/users/me", json={"email": "Victima@Gmail.com"}, headers=hdr(world["s_user"]))
    r = client.post(f"{API}/auth/google", json={"id_token": "t"})
    assert r.status_code == 403, r.text
    db.expire_all()
    assert db.get(User, world["s_user"].id).google_id is None


def test_s12_verify_email_revokes_earlier_sessions(client, db, sent):
    from fastapi.testclient import TestClient
    from app.main import app
    attacker = TestClient(app, raise_server_exceptions=False)
    r = attacker.post(f"{API}/auth/register", json={
        "email": "victima2@gmail.com", "username": "preseed", "password": "Password123",
        "name": "A", "surname": "B", "role": "student"})
    assert r.status_code == 200, r.text
    assert attacker.post(f"{API}/auth/refresh").status_code == 200
    token = _token_from(sent, "victima2@gmail.com")
    assert token
    assert client.post(f"{API}/auth/verify-email", json={"token": token}).status_code == 200
    assert attacker.post(f"{API}/auth/refresh").status_code == 401


# ═══ S3: HTML en correos ════════════════════════════════════════════════════

_SKIP_PARAMS = {"to_email", "conversation_url", "portal_path", "verify_token", "reset_token"}


def _args_for(fn):
    args = {}
    for name, p in inspect.signature(fn).parameters.items():
        if name in _SKIP_PARAMS:
            args[name] = {"conversation_url": "https://x.test/c", "portal_path": "/p",
                          "verify_token": "tok", "reset_token": "tok"}.get(name, "a@b.test")
        elif p.annotation in (float, "float"):
            args[name] = 7.5
        elif p.annotation in (int, "int"):
            args[name] = 3
        elif "list[tuple" in str(p.annotation):
            args[name] = [(XSS, 2, XSS)] if "int" in str(p.annotation) else [(XSS, XSS, XSS)]
        elif "list" in str(p.annotation):
            args[name] = [XSS]
        elif p.default is not inspect.Parameter.empty and p.default in (None, False, 0):
            args[name] = XSS if p.default is None else p.default
        elif name in ("changed_by", "cancelled_by", "role", "new_status", "status", "reason") and False:
            args[name] = XSS
        else:
            args[name] = XSS
    return args


def _email_functions():
    import app.core.email as em
    return [(n, f) for n, f in inspect.getmembers(em, inspect.isfunction) if n.startswith("send_")]


@pytest.mark.parametrize("name", [n for n, _ in _email_functions()])
def test_s3_every_email_escapes_user_values(name, sent):
    import app.core.email as em
    fn = getattr(em, name)
    sent.clear()
    fn(**_args_for(fn))
    assert sent, f"{name} no envio nada"
    html = sent[-1]["html"]
    assert "<script" not in html, f"{name}: <script> sin escapar"
    assert "<img src=x" not in html, f"{name}: <img> inyectado"
    assert "\n" not in sent[-1]["subject"] and "\r" not in sent[-1]["subject"]  # asunto = texto plano, sin saltos


def test_s3_newlines_preserved_with_pre_wrap_and_subject_has_no_header_injection(sent):
    import app.core.email as em
    em.send_support_ticket_response_email("a@b.test", "Ana", "Asunto\r\nBcc: x@y.z", "linea1\nlinea2", "/p")
    m = sent[-1]
    assert "\r" not in m["subject"] and "\n" not in m["subject"]
    assert "white-space:pre-wrap" in m["html"] and "linea1\nlinea2" in m["html"]


def test_s3_legit_text_is_not_double_escaped(sent):
    import app.core.email as em
    em.send_new_chat_message_teacher_email("a@b.test", "Ana", "Pedro", "5 < 6 & 7", "https://x.test/c")
    assert "5 &lt; 6 &amp; 7" in sent[-1]["html"]
    assert "&amp;lt;" not in sent[-1]["html"]
    em.send_class_reminders_teacher_digest_email("a@b.test", "Ana", [("A&B", "Mat", "hoy")])
    assert "A&amp;B" in sent[-1]["html"] and "&amp;amp;" not in sent[-1]["html"]


@pytest.mark.parametrize("bad", ["<script>x</script>", "Ana<b>", "Ana 123", "A" * 61, "Ana;DROP"])
def test_s3_register_rejects_bad_names(client, bad):
    r = client.post(f"{API}/auth/register", json={
        "email": "n@audit-tpm.com", "username": "nombreok", "password": "Password123",
        "name": bad, "surname": "Perez", "role": "student"})
    assert r.status_code == 422, r.text


@pytest.mark.parametrize("good", ["María José", "O'Connor", "Jean-Luc", "Ñandú", "Zoë"])
def test_s3_register_accepts_real_names(client, good):
    r = client.post(f"{API}/auth/register", json={
        "email": "n2@audit-tpm.com", "username": "nombreok2", "password": "Password123",
        "name": good, "surname": "Perez", "role": "student"})
    assert r.status_code == 200, r.text


def test_s3_patch_me_rejects_html_name(client, world):
    r = client.patch(f"{API}/users/me", json={"name": "<b>x</b>"}, headers=hdr(world["s_user"]))
    assert r.status_code == 422


# ═══ S4: Flow Tester ════════════════════════════════════════════════════════

def test_s4_flow_tester_requires_superadmin(client, world, db):
    from tests.audit.test_permissions_money import _teacher_admin
    ta, _ = _teacher_admin(db)
    assert client.get(f"{API}/flow-tests/manifest", headers=hdr(ta)).status_code == 403
    assert client.post(f"{API}/flow-tests/run", json={}, headers=hdr(ta)).status_code == 403
    assert client.get(f"{API}/flow-tests/abc", headers=hdr(ta)).status_code == 403


def test_s4_flow_tester_disabled_by_default(client, world, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "FLOW_TESTS_ENABLED", False, raising=False)
    r = client.post(f"{API}/flow-tests/run", json={}, headers=hdr(world["admin"]))
    assert r.status_code == 403
    assert client.get(f"{API}/flow-tests/manifest", headers=hdr(world["admin"])).status_code == 403


@pytest.mark.parametrize("node", ["--help", "-p no:cacheprovider", "tests/audit/test_f3_security.py", "tests/flow/../../x.py",
                                  "tests/flow/x.py -s", " tests/flow/x.py", "/etc/passwd", "tests/flow/\nx", "tests\\flow\\x.py"])
def test_s4_flow_tester_rejects_bad_node_ids(client, world, monkeypatch, node):
    from app.core.config import settings
    from app.api.v1.endpoints import flow_tests
    monkeypatch.setattr(settings, "FLOW_TESTS_ENABLED", True, raising=False)
    started = []
    monkeypatch.setattr(flow_tests, "_run_pytest_in_background", lambda state: started.append(state))
    r = client.post(f"{API}/flow-tests/run", json={"node_ids": [node]}, headers=hdr(world["admin"]))
    assert r.status_code == 422, r.text
    assert not started


def test_s4_flow_tester_accepts_flow_node_ids(client, world, monkeypatch):
    from app.core.config import settings
    from app.api.v1.endpoints import flow_tests
    monkeypatch.setattr(settings, "FLOW_TESTS_ENABLED", True, raising=False)
    monkeypatch.setattr(flow_tests, "_run_pytest_in_background", lambda state: None)
    r = client.post(f"{API}/flow-tests/run", json={"node_ids": ["tests/flow/test_a.py::test_x[1]"]},
                    headers=hdr(world["admin"]))
    assert r.status_code == 202, r.text


def test_s4_flow_tester_still_blocked_in_production(client, world, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "FLOW_TESTS_ENABLED", True, raising=False)
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    assert client.post(f"{API}/flow-tests/run", json={}, headers=hdr(world["admin"])).status_code == 403


# ═══ S6: borrar cuenta de profesor ══════════════════════════════════════════

def _teacher_with_stuff(db, world):
    from app.models.google_calendar import GoogleCalendarToken
    from app.models.payment import Withdrawal, Payment
    from app.models.package import Package
    tu, tp = world["t_user"], world["tp"]
    tp.bio = "bio"
    tp.video_url = "http://v"
    tp.video_public_id = "vid1"
    db.add(GoogleCalendarToken(user_id=tu.id, teacher_id=tp.id, access_token="a", refresh_token="r"))
    w = Withdrawal(teacher_id=tp.id, amount=10, status="completed", destination_method="paypal",
                   destination_details="mi@paypal.com")
    db.add(w)
    p = Payment(student_id=world["sp"].id, teacher_id=tp.id, amount_total=10, amount_teacher=8, amount_platform=2,
                payment_method="paypal", payment_type="refund", status="approved",
                refund_payment_info={"email": "alumno@paypal.com"})
    db.add(p)
    db.commit()
    return w.id, p.id


def test_s6_teacher_delete_hides_profile_and_cleans_resources(client, world, db, monkeypatch):
    from app.models.google_calendar import GoogleCalendarToken
    from app.models.package import Package
    from app.models.payment import Withdrawal
    from app.models.teacher import TeacherProfile, TeacherStatus
    deleted = []
    monkeypatch.setattr("app.api.v1.endpoints.users.delete_file", lambda pid, resource_type="image": deleted.append((pid, resource_type)))
    monkeypatch.setattr("app.api.v1.endpoints.users.revoke_google_token_safely", lambda *a, **k: None, raising=False)
    wid, _ = _teacher_with_stuff(db, world)
    tu = world["t_user"]
    r = client.request("DELETE", f"{API}/users/me", headers=hdr(tu), json={"password": "Password123", "confirm_username": tu.username})
    assert r.status_code == 200, r.text
    db.expire_all()
    tp = db.get(TeacherProfile, world["tp"].id)
    assert tp.status == TeacherStatus.suspended
    assert tp.video_url is None and tp.video_public_id is None
    assert ("vid1", "video") in deleted
    assert db.query(GoogleCalendarToken).filter_by(teacher_id=tp.id).count() == 0
    assert db.query(Package).filter_by(teacher_id=tp.id, is_active=True).count() == 0
    assert db.get(Withdrawal, wid).destination_details is None
    assert client.get(f"{API}/teachers/{tu.username}").status_code == 404


def test_s6_delete_anonymizes_refund_info_of_student(client, world, db, monkeypatch):
    from app.models.payment import Payment
    monkeypatch.setattr("app.api.v1.endpoints.users.delete_file", lambda *a, **k: None)
    _, pid = _teacher_with_stuff(db, world)
    su = world["s_user"]
    r = client.request("DELETE", f"{API}/users/me", headers=hdr(su), json={"password": "Password123", "confirm_username": su.username})
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(Payment, pid).refund_payment_info is None


def test_s6_delete_does_not_cancel_classes_or_calendar_events(client, world, db, monkeypatch):
    """Regla del dueño: nada se cancela en la plataforma ni en Google al borrar la cuenta."""
    import app.core.google_calendar as gc
    called = []
    for fn in ("delete_calendar_event", "cancel_future_external_classes"):
        monkeypatch.setattr(gc, fn, lambda *a, **k: called.append(fn), raising=False)
    monkeypatch.setattr("app.api.v1.endpoints.users.delete_file", lambda *a, **k: None)
    _teacher_with_stuff(db, world)
    tu = world["t_user"]
    client.request("DELETE", f"{API}/users/me", headers=hdr(tu), json={"password": "Password123", "confirm_username": tu.username})
    assert not called


def test_s6_inactive_users_not_in_public_listings(client, world, db):
    tu = world["t_user"]
    assert client.get(f"{API}/teachers/").json(), "sanity: el profesor sale listado"
    tu.is_active = False
    db.commit()
    assert [t["user_username"] for t in client.get(f"{API}/teachers/").json()] == []
    assert client.get(f"{API}/teachers/{tu.username}").status_code == 404
    day = (utc_now()).strftime("%Y-%m-%d")
    r = client.get(f"{API}/availability/{tu.username}/slots", params={"date": day, "duration": 50}, headers=hdr(world["s_user"]))
    assert r.status_code == 404, r.text


# ═══ Menores 1: username ════════════════════════════════════════════════════

@pytest.mark.parametrize("bad", ["admin", "Soporte", "root", "api", "ab", "a" * 31, "con espacio", "ñandú", "x@y", "support"])
def test_m1_register_rejects_bad_usernames(client, bad):
    r = client.post(f"{API}/auth/register", json={
        "email": "u@audit-tpm.com", "username": bad, "password": "Password123",
        "name": "Ana", "surname": "Perez", "role": "student"})
    assert r.status_code == 422, (bad, r.text)


def test_m1_register_lowercases_and_accepts_valid_username(client):
    r = client.post(f"{API}/auth/register", json={
        "email": "u3@audit-tpm.com", "username": "Ana.Perez_9", "password": "Password123",
        "name": "Ana", "surname": "Perez", "role": "student"})
    assert r.status_code == 200 and r.json()["username"] == "ana.perez_9"


def test_m1_patch_me_username_validated_and_case_insensitive_unique(client, world, db):
    h = hdr(world["s_user"])
    assert client.patch(f"{API}/users/me", json={"username": "ADMIN"}, headers=h).status_code == 422
    assert client.patch(f"{API}/users/me", json={"username": "bad name"}, headers=h).status_code == 422
    assert client.patch(f"{API}/users/me", json={"username": "PROFE"}, headers=h).status_code == 400
    r = client.patch(f"{API}/users/me", json={"username": "Alumno.Nuevo"}, headers=h)
    assert r.status_code == 200 and r.json()["username"] == "alumno.nuevo"
    db.expire_all()
    assert world["sp"].user_username == "alumno.nuevo"


def test_m1_google_register_username_validated(client, monkeypatch):
    async def fake_google(token):
        return {"google_id": "g1", "email": "nuevo@gmail.com", "name": "N", "surname": "G", "avatar": None, "is_verified": True}
    monkeypatch.setattr("app.api.v1.endpoints.auth.verify_google_token", fake_google)
    r = client.post(f"{API}/auth/google/register", json={"id_token": "t", "username": "Admin", "role": "student"})
    assert r.status_code == 422, r.text
    r = client.post(f"{API}/auth/google/register", json={"id_token": "t", "username": "nuevo_g", "role": "student"})
    assert r.status_code == 200, r.text


# ═══ Menores 2: forgot-password / forgot-username ═══════════════════════════

def test_m2_forgot_password_email_case_insensitive(client, world, sent):
    r = client.post(f"{API}/auth/forgot-password", json={"email": "ALUMNO@Audit-TPM.com"})
    assert r.status_code == 200
    assert any(m["to"] == "alumno@audit-tpm.com" and "Restablecer" in m["subject"] for m in sent)


def test_m2_forgot_username_email_case_insensitive(client, world, sent):
    r = client.post(f"{API}/auth/forgot-username", json={"email": "ALUMNO@Audit-TPM.com"})
    assert r.status_code == 200
    assert any(m["to"] == "alumno@audit-tpm.com" for m in sent)


def test_m2_forgot_same_response_and_email_sent_in_background(client, world, monkeypatch):
    """La peticion no envia el correo: lo hace una tarea en segundo plano (tiempo constante)."""
    from fastapi import BackgroundTasks
    queued = []
    orig = BackgroundTasks.add_task
    monkeypatch.setattr(BackgroundTasks, "add_task", lambda self, fn, *a, **k: queued.append(fn.__name__) or orig(self, fn, *a, **k))
    a = client.post(f"{API}/auth/forgot-password", json={"email": "alumno@audit-tpm.com"})
    b = client.post(f"{API}/auth/forgot-password", json={"email": "nadie@audit-tpm.com"})
    assert a.status_code == b.status_code == 200 and a.json() == b.json()
    assert queued, "el envio debe ir a una tarea en segundo plano"


# ═══ Menores 5: notificaciones ══════════════════════════════════════════════

def test_m5_mark_notification_read_only_staff_ones(client, world, db):
    from app.models.notification import Notification
    n_user = Notification(type="x", title="t", message="m", recipient_user_id=world["t_user"].id)
    n_staff = Notification(type="x", title="t", message="m", recipient_role="staff")
    db.add_all([n_user, n_staff])
    db.commit()
    h = hdr(world["admin"])
    assert client.patch(f"{API}/admin/notifications/{n_user.id}/read", headers=h).status_code == 404
    assert client.patch(f"{API}/admin/notifications/{n_staff.id}/read", headers=h).status_code == 200
    db.expire_all()
    assert db.get(Notification, n_user.id).is_read in (False, None)


# ═══ Menores 6: soporte ═════════════════════════════════════════════════════

def test_m6_support_ticket_rate_limited_per_user(client, world):
    h = hdr(world["s_user"])
    body = {"category": "bug", "subject": "Hola", "message": "Algo falla"}
    codes = [client.post(f"{API}/support/tickets", json=body, headers=h).status_code for _ in range(7)]
    assert codes[:5] == [201] * 5 and codes[5] == 429, codes
    # otro usuario no comparte cupo
    assert client.post(f"{API}/support/tickets", json=body, headers=hdr(world["t_user"])).status_code == 201


def test_m6_teacher_admin_can_use_own_tickets(client, world, db):
    from tests.audit.test_permissions_money import _teacher_admin
    ta, _ = _teacher_admin(db)
    h = hdr(ta)
    assert client.get(f"{API}/support/tickets/me", headers=h).status_code == 200
    assert client.get(f"{API}/support/tickets/me/unread-count", headers=h).status_code == 200


# ═══ Menores 3: subidas ═════════════════════════════════════════════════════

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
MP4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64


@pytest.fixture
def cloud(monkeypatch):
    """Cloudinary falso: anota cada subida y cada borrado."""
    import cloudinary.uploader as up
    box = {"uploads": [], "deleted": []}

    def fake_upload(data, **kw):
        box["uploads"].append(kw)
        return {"secure_url": "https://res.cloudinary.com/x/" + kw["filename"], "public_id": "pid" + str(len(box["uploads"])),
                "resource_type": kw["resource_type"], "bytes": 1}

    monkeypatch.setattr(up, "upload", fake_upload)
    monkeypatch.setattr(up, "upload_large", fake_upload)
    monkeypatch.setattr(up, "destroy", lambda pid, **kw: box["deleted"].append((pid, kw.get("resource_type"))) or {"result": "ok"})
    return box


def _file(content, ctype, name="f.bin"):
    return {"file": (name, io.BytesIO(content), ctype)}


@pytest.mark.parametrize("ctype, body", [("video/mp4", MP4), ("text/html", b"<script>1</script>"), ("application/pdf", b"%PDF-1.4 x")])
def test_m3_avatar_rejects_non_images(client, world, cloud, ctype, body):
    r = client.post(f"{API}/users/me/avatar", files=_file(body, ctype), headers=hdr(world["s_user"]))
    assert r.status_code == 400, r.text
    assert not cloud["uploads"]


def test_m3_avatar_size_limit_and_extension_from_type(client, world, cloud):
    h = hdr(world["s_user"])
    big = PNG + b"\x00" * (5 * 1024 * 1024)
    assert client.post(f"{API}/users/me/avatar", files=_file(big, "image/png", "a.png"), headers=h).status_code == 400
    r = client.post(f"{API}/users/me/avatar", files=_file(PNG, "image/png", "evil.html"), headers=h)
    assert r.status_code == 200, r.text
    assert cloud["uploads"][-1]["filename"].endswith(".png")


def test_m3_upload_rate_limited_per_user(client, world, cloud):
    h = hdr(world["t_user"])
    codes = [client.post(f"{API}/teachers/me/video", files=_file(b"x", "text/plain"), headers=h).status_code for _ in range(12)]
    assert codes[:10] == [400] * 10 and codes[10] == 429, codes
    assert client.post(f"{API}/teachers/me/video", files=_file(b"x", "text/plain"), headers=hdr(world["s_user"])).status_code != 429


def test_m3_teacher_video_only_video_types(client, world, cloud):
    r = client.post(f"{API}/teachers/me/video", files=_file(PNG, "image/png"), headers=hdr(world["t_user"]))
    assert r.status_code == 400 and not cloud["uploads"]


def test_m3_approved_teacher_new_video_stays_pending_old_stays_public(client, world, db, cloud, sent):
    """Fase 23 (reemplaza el comportamiento de Fase 21): el aprobado no pierde el perfil; ver test_f23_video_ban."""
    from app.models.teacher import TeacherProfile, TeacherStatus
    h = hdr(world["t_user"])
    r = client.post(f"{API}/teachers/me/video", files=_file(MP4, "video/mp4", "v.mp4"), headers=h)
    assert r.status_code == 200, r.text
    db.expire_all()
    tp = db.get(TeacherProfile, world["tp"].id)
    assert tp.status == TeacherStatus.approved and tp.video_url == "http://v"
    assert tp.video_pending_public_id == "pid1"
    assert len([m for m in sent if "pendiente" in m["subject"].lower()]) == 1
    client.post(f"{API}/teachers/me/video", files=_file(MP4, "video/mp4", "v.mp4"), headers=h)
    assert len([m for m in sent if "pendiente" in m["subject"].lower()]) == 1, "ya habia pendiente: no se avisa otra vez"
    assert cloud["deleted"] == [("pid1", "video")]


# ═══ Menores 4: TTS ═════════════════════════════════════════════════════════

def _vocab(db, world, n=3, owner=None):
    from app.models.material import Material
    m = Material(teacher_id=(owner or world["tp"]).id, title="V", category="vocabulary",
                 vocabulary_words=[f"w{i}" for i in range(n)], is_active=True)
    db.add(m)
    db.commit()
    return m


@pytest.fixture
def tts_stub(monkeypatch):
    calls = []

    async def fake_batch(words, voice, speed, language=None):
        calls.append(list(words))
        return {w: "http://audio/" + w for w in words}
    monkeypatch.setattr("app.api.v1.endpoints.tts.generate_batch_audio", fake_batch)
    return calls


def test_m4_vocabulary_access_rules(client, world, db, tts_stub):
    from app.models.material import MaterialAssignment
    from app.models.teacher import TeacherProfile, TeacherStatus
    m = _vocab(db, world)
    url = f"{API}/tts/vocabulary/{m.id}"
    assert client.post(url, headers=hdr(world["s_user"])).status_code == 403  # alumno sin asignacion
    other = _mk_user(db, "teacher", "otroprofe")
    db.add(TeacherProfile(user_id=other.id, user_username="otroprofe", status=TeacherStatus.approved))
    db.commit()
    assert client.post(url, headers=hdr(other)).status_code == 403  # otro profesor
    assert client.post(url, headers=hdr(world["t_user"])).status_code == 200
    assert client.post(url, headers=hdr(world["admin"])).status_code == 200
    db.add(MaterialAssignment(material_id=m.id, student_id=world["sp"].id))
    db.commit()
    assert client.post(url, headers=hdr(world["s_user"])).status_code == 200


def test_m4_vocabulary_validates_voice_speed_and_caps_words(client, world, db, tts_stub):
    m = _vocab(db, world, n=80)
    url = f"{API}/tts/vocabulary/{m.id}"
    h = hdr(world["t_user"])
    assert client.post(url, params={"voice": "evil"}, headers=h).status_code == 422
    assert client.post(url, params={"speed": 9}, headers=h).status_code == 422
    assert client.post(url, params={"speed": 0.1}, headers=h).status_code == 422
    r = client.post(url, headers=h)
    assert r.status_code == 200 and len(tts_stub[-1]) == 50 and len(r.json()["audio_urls"]) == 50


def test_m4_vocabulary_rate_limited(client, world, db, tts_stub):
    m = _vocab(db, world)
    h = hdr(world["t_user"])
    codes = [client.post(f"{API}/tts/vocabulary/{m.id}", headers=h).status_code for _ in range(7)]
    assert codes[:6] == [200] * 6 and codes[6] == 429, codes


def test_m4_tts_errors_do_not_leak_details(client, world, db, monkeypatch):
    async def boom(words, voice, speed, language=None):
        raise RuntimeError("sk-SECRET-key leaked from openai")
    monkeypatch.setattr("app.api.v1.endpoints.tts.generate_batch_audio", boom)
    r = client.post(f"{API}/tts/batch", json={"words": ["a"]}, headers=hdr(world["s_user"]))
    assert r.status_code == 500 and "SECRET" not in r.text
    m = _vocab(db, world)
    r = client.post(f"{API}/tts/vocabulary/{m.id}", headers=hdr(world["t_user"]))
    assert r.status_code == 500 and "SECRET" not in r.text


def test_m4_batch_cached_counter(client, world, monkeypatch):
    from app.core import tts_service
    tts_service._audio_cache.clear()
    tts_service._audio_cache[tts_service._get_cache_key("uno", "nova", 0.9)] = "http://audio/uno"

    async def fake_batch(words, voice, speed, language=None):
        return {w: "http://audio/" + w for w in words}
    monkeypatch.setattr("app.api.v1.endpoints.tts.generate_batch_audio", fake_batch)
    r = client.post(f"{API}/tts/batch", json={"words": ["uno", "dos", "tres"]}, headers=hdr(world["s_user"]))
    assert r.status_code == 200
    assert r.json()["cached"] == 1 and r.json()["generated"] == 2 and r.json()["failed"] == 0
    tts_service._audio_cache.clear()


def test_m4_tts_upload_does_not_block_event_loop(monkeypatch):
    """generate_word_audio sube a Cloudinary en un hilo (run_in_threadpool), no en el bucle de eventos."""
    import asyncio
    import threading
    from app.core import tts_service
    tts_service._audio_cache.clear()
    seen = {}

    async def fake_pcm(word, voice, language):
        return b"\x00\x00" * 100  # la sesión Realtime se sustituye: solo importa el hilo de la subida

    monkeypatch.setattr(tts_service, "_synthesize_pcm", fake_pcm)

    def fake_upload(**kw):
        seen["thread"] = threading.current_thread()
        return {"url": "http://audio/x"}
    monkeypatch.setattr(tts_service, "upload_file", fake_upload)

    async def run():
        return await tts_service.generate_word_audio("hola"), threading.current_thread()

    url, main = asyncio.run(run())
    assert url == "http://audio/x" and seen["thread"] is not main
    tts_service._audio_cache.clear()


# ═══ Menores 7: perfil de profesor y materiales ═════════════════════════════

@pytest.mark.parametrize("body", [
    {"timezone": "Mars/Base"},
    {"bio": "x" * 2001},
    {"title": "x" * 151},
    {"theme_color": "red"},
    {"theme_color": "#12345"},
    {"gallery": ["http://evil.test/a.png"]},
    {"gallery": ["https://res.cloudinary.com/x.png"] * 13},
    {"social_links": {"web": "javascript:alert(1)"}},
    {"social_links": {f"k{i}": "https://x.test" for i in range(11)}},
    {"subjects": ["x"] * 31},
    {"languages": ["x" * 61]},
    {"certificates": [{"title": "t"}] * 21},
    {"certificates": [{"title": "x" * 500}]},
])
def test_m7_teacher_profile_rejects_bad_values(client, world, body):
    r = client.patch(f"{API}/teachers/me/profile", json=body, headers=hdr(world["t_user"]))
    assert r.status_code == 422, (body, r.text)


def test_m7_teacher_profile_accepts_valid_values(client, world):
    body = {"timezone": "America/Bogota", "bio": "Hola", "title": "Profe", "theme_color": "#ec4899",
            "gallery": ["https://res.cloudinary.com/demo/a.png"], "social_links": {"web": "https://x.test", "whatsapp": "+57 300 1234567"},
            "subjects": ["English"], "languages": ["Spanish"], "certificates": [{"title": "CELTA", "year": "2020"}]}
    r = client.patch(f"{API}/teachers/me/profile", json=body, headers=hdr(world["t_user"]))
    assert r.status_code == 200, r.text


@pytest.mark.parametrize("avatar", ["javascript:alert(1)", "http://res.cloudinary.com/a.png", "https://evil.test/a.png"])
def test_m7_user_avatar_url_only_cloudinary(client, world, avatar):
    h = hdr(world["s_user"])
    assert client.patch(f"{API}/users/me", json={"avatar": avatar}, headers=h).status_code == 422
    assert client.patch(f"{API}/users/me", json={"avatar": "https://res.cloudinary.com/a.png"}, headers=h).status_code == 200
    assert client.patch(f"{API}/users/me", json={"avatar": ""}, headers=h).status_code == 200


def test_m7_material_form_validated(client, world):
    h = hdr(world["t_user"])
    assert client.post(f"{API}/materials/", data={"title": "T", "category": "hack"}, headers=h).status_code == 422
    assert client.post(f"{API}/materials/", data={"title": "T", "category": "grammar", "level": "Z9"}, headers=h).status_code == 422
    assert client.post(f"{API}/materials/", data={"title": "T" * 201, "category": "grammar"}, headers=h).status_code == 422
    r = client.post(f"{API}/materials/", data={"title": "T", "category": "grammar", "level": "B1"}, headers=h)
    assert r.status_code == 201, r.text
    mid = r.json()["id"]
    assert client.patch(f"{API}/materials/{mid}", json={"category": "hack"}, headers=h).status_code == 422
    assert client.patch(f"{API}/materials/{mid}", json={"level": "Z9"}, headers=h).status_code == 422
    assert client.patch(f"{API}/materials/{mid}", json={"level": "C1"}, headers=h).status_code == 200


def test_m7_deleted_material_not_editable_assignable_or_streamable(client, world, db):
    from app.models.material import Material, MaterialAssignment
    m = Material(teacher_id=world["tp"].id, title="X", category="grammar", file_url="https://res.cloudinary.com/x.pdf",
                 file_type="raw", is_active=False)
    db.add(m)
    db.commit()
    h = hdr(world["t_user"])
    assert client.patch(f"{API}/materials/{m.id}", json={"title": "Y"}, headers=h).status_code == 404
    world["tp"].students = [world["sp"].id]
    db.commit()
    assert client.post(f"{API}/materials/{m.id}/assign", json={"student_ids": [world["sp"].id]}, headers=h).status_code == 404
    db.add(MaterialAssignment(material_id=m.id, student_id=world["sp"].id))
    db.commit()
    assert client.get(f"{API}/materials/{m.id}/stream", headers=hdr(world["s_user"]), follow_redirects=False).status_code == 404
    assert client.get(f"{API}/materials/{m.id}/stream", headers=h, follow_redirects=False).status_code == 404
    m.is_active = True
    db.commit()
    assert client.get(f"{API}/materials/{m.id}/stream", headers=hdr(world["s_user"]), follow_redirects=False).status_code in (302, 307)


# ═══ Menores 8: chat (backend) ══════════════════════════════════════════════

def _convo(db, world, preview="secreto"):
    from app.models.chat import ChatConversation, ChatConversationType
    c = ChatConversation(conversation_type=ChatConversationType.direct, teacher_id=world["tp"].id,
                         student_id=world["sp"].id, last_message_preview=preview, last_message_at=utc_now())
    db.add(c)
    db.commit()
    return c


def test_m8_purge_clears_preview_of_conversations_without_messages(db, world):
    from datetime import timedelta
    from app.core.chat import purge_old_messages
    from app.models.chat import ChatConversation, ChatConversationType, ChatMessage
    from app.models.student import StudentProfile
    old = _convo(db, world, "viejo")
    other = _mk_user(db, "student", "otro_al")
    sp2 = StudentProfile(user_id=other.id, user_username="otro_al")
    db.add(sp2)
    db.flush()
    fresh = ChatConversation(conversation_type=ChatConversationType.direct, teacher_id=world["tp"].id,
                             student_id=sp2.id, last_message_preview="nuevo", last_message_at=utc_now())
    db.add(fresh)
    db.flush()
    db.add(ChatMessage(conversation_id=old.id, sender_id=world["s_user"].id, content="viejo",
                       created_at=utc_now() - timedelta(days=40)))
    db.add(ChatMessage(conversation_id=fresh.id, sender_id=other.id, content="nuevo", created_at=utc_now()))
    db.commit()
    assert purge_old_messages(db, 30) == 1
    db.expire_all()
    assert db.get(ChatConversation, old.id).last_message_preview is None
    assert db.get(ChatConversation, fresh.id).last_message_preview == "nuevo"


def test_m8_broadcast_excludes_inactive_users(db, world):
    from app.core.chat import conversation_participant_user_ids
    c = _convo(db, world)
    assert conversation_participant_user_ids(db, c) == {world["t_user"].id, world["s_user"].id}
    world["s_user"].is_active = False
    db.commit()
    assert conversation_participant_user_ids(db, c) == {world["t_user"].id}


def test_m8_banned_user_socket_is_closed(client, world, db, monkeypatch):
    from starlette.websockets import WebSocketDisconnect
    from app.api.v1.endpoints import chat as chat_mod
    from app.auth.jwt import create_access_token
    monkeypatch.setattr(chat_mod, "WS_ACTIVE_RECHECK_SECONDS", 0)
    token = create_access_token(world["s_user"].id, "student")
    with client.websocket_connect(f"{API}/chat/ws?token={token}") as ws:
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"
        world["s_user"].is_active = False
        db.commit()
        ws.send_json({"type": "ping"})
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()


def test_m8_chat_copy_is_tuteo():
    import inspect
    import app.core.chat as c
    import app.core.storage as st
    src = inspect.getsource(c) + inspect.getsource(st)
    for voseo in ("tenés", "asignado a vos", "Verificá"):
        assert voseo not in src
