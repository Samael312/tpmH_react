"""Cobertura del chat interno: REST, lógica (`core/chat.py`), gestor de sockets y WebSocket con dos sesiones."""
import asyncio
import json
from datetime import timedelta

import pytest
from starlette.websockets import WebSocketDisconnect

from app.api.v1.endpoints import chat as chat_ep
from app.auth.jwt import create_access_token
from app.core import chat as chat_core
from app.core.chat_ws import ChatConnectionManager, chat_manager
from app.core.timezone import utc_now
from app.models.chat import ChatConversation, ChatMessage, ChatReadState
from app.models.package import Enrollment, EnrollmentStatus
from app.models.payment_config import PlatformConfig
from app.models.teacher import TeacherStatus
from tests.audit.conftest import hdr
from tests.audit.helpers import API
from tests.audit.test_g1_god_mode_actions import mk_student
from tests.audit.test_g3_cohorts import mk_cohort, mk_gpkg

CH = f"{API}/chat"


@pytest.fixture(autouse=True)
def fresh_chat_settings():
    chat_core.invalidate_chat_settings()
    yield
    chat_core.invalidate_chat_settings()


def set_chat(db, enabled=True, reactivation=None):
    cfg = db.query(PlatformConfig).first()
    cfg.chat_enabled = enabled
    if reactivation is not None:
        cfg.chat_reactivation_hours = reactivation
    db.commit()
    chat_core.invalidate_chat_settings()


def link(db, w):
    w["tp"].students = [w["sp"].id]
    db.commit()


def direct(client, w):
    link_db = None  # noqa: F841
    r = client.get(f"{CH}/conversations/direct/{w['t_user'].username}", headers=hdr(w["s_user"]))
    assert r.status_code == 200, r.text
    return r.json()["id"]


def tok(user):
    return create_access_token(user.id, user.role.value if hasattr(user.role, "value") else user.role)


def group_with_member(db, w):
    gp = mk_gpkg(db, w)
    co = mk_cohort(db, w, gp)
    db.add(Enrollment(student_id=w["sp"].id, package_id=gp.id, teacher_id=w["tp"].id, cohort_id=co.id,
                      status=EnrollmentStatus.active, payment_status="paid", classes_total=4))
    db.commit()
    return co


# ── REST: conversaciones ─────────────────────────────────────────────────────────────────
def test_open_direct_rules(client, world, db):
    sh, th = hdr(world["s_user"]), hdr(world["t_user"])
    assert client.get(f"{CH}/conversations/direct/nadie", headers=sh).status_code == 404
    # el alumno puede escribir a un profesor aprobado aunque no esté vinculado
    cid = direct(client, world)
    assert direct(client, world) == cid  # idempotente
    world["tp"].status = TeacherStatus.pending
    db.commit()
    other_u, _ = mk_student(db, "alu_ajeno")
    assert client.get(f"{CH}/conversations/direct/{world['t_user'].username}", headers=hdr(other_u)).status_code == 404
    world["tp"].status = TeacherStatus.approved
    db.commit()
    # profesor -> alumno: solo si está asignado
    assert client.get(f"{CH}/conversations/direct/{world['s_user'].username}", headers=th).status_code == 403
    assert client.get(f"{CH}/conversations/direct/nadie", headers=th).status_code == 404
    link(db, world)
    assert client.get(f"{CH}/conversations/direct/{world['s_user'].username}", headers=th).status_code == 200
    assert client.get(f"{CH}/conversations/direct/{world['t_user'].username}", headers=hdr(world["admin"])).status_code == 403


def test_open_group_rules(client, world, db):
    sh, th = hdr(world["s_user"]), hdr(world["t_user"])
    assert client.get(f"{CH}/conversations/group/999", headers=sh).status_code == 404
    gp = mk_gpkg(db, world)
    co = mk_cohort(db, world, gp)
    assert client.get(f"{CH}/conversations/group/{co.id}", headers=sh).status_code == 403  # no es miembro
    assert client.get(f"{CH}/conversations/group/{co.id}", headers=hdr(world["admin"])).status_code == 403
    db.add(Enrollment(student_id=world["sp"].id, package_id=gp.id, teacher_id=world["tp"].id, cohort_id=co.id,
                      status=EnrollmentStatus.active, payment_status="paid", classes_total=4))
    db.commit()
    r = client.get(f"{CH}/conversations/group/{co.id}", headers=sh)
    assert r.status_code == 200 and r.json()["conversation_type"] == "group"
    assert client.get(f"{CH}/conversations/group/{co.id}", headers=th).status_code == 200  # ya existe
    other_t, _tp = None, None
    from tests.audit.test_g1_god_mode_actions import mk_teacher
    ot, otp = mk_teacher(db, "otro_prof", "teacher")
    assert client.get(f"{CH}/conversations/group/{co.id}", headers=hdr(ot)).status_code == 403


def test_list_unread_and_chat_disabled(client, world, db):
    cid = direct(client, world)
    sh = hdr(world["s_user"])
    assert [c["id"] for c in client.get(f"{CH}/conversations", headers=sh).json()] == [cid]
    assert client.get(f"{CH}/conversations", headers=hdr(world["admin"])).json() == []
    assert client.get(f"{CH}/conversations/unread-count", headers=hdr(world["admin"])).json() == {"unread_count": 0}
    gco = group_with_member(db, world)
    client.get(f"{CH}/conversations/group/{gco.id}", headers=sh)
    assert len(client.get(f"{CH}/conversations", headers=sh).json()) == 2
    bare = None
    from tests.audit.conftest import _mk_user
    nu = _mk_user(db, "student", "sin_perfil_chat")
    db.commit()
    assert client.get(f"{CH}/conversations", headers=hdr(nu)).json() == []
    set_chat(db, enabled=False)
    for path in ("/conversations", "/conversations/unread-count", f"/conversations/direct/{world['t_user'].username}",
                 f"/conversations/group/{gco.id}", f"/conversations/{cid}/messages"):
        assert client.get(f"{CH}{path}", headers=sh).status_code == 403
    assert client.post(f"{CH}/conversations/{cid}/read", headers=sh).status_code == 403


# ── REST: mensajes ───────────────────────────────────────────────────────────────────────
def test_send_history_read_and_unread(client, world, db):
    link(db, world)
    sh, th = hdr(world["s_user"]), hdr(world["t_user"])
    cid = direct(client, world)
    post = lambda body, h=sh, c=cid: client.post(f"{CH}/conversations/{c}/messages", json=body, headers=h)
    r1 = post({"content": "  Hola profe ", "client_id": "c1"})
    assert r1.status_code == 200 and r1.json()["content"] == "Hola profe"
    dup = post({"content": "Hola profe", "client_id": "c1"})
    assert dup.json()["id"] == r1.json()["id"]  # idempotente
    r2 = post({"content": "Respuesta"}, th)
    assert r2.status_code == 200
    assert post({"content": "   "}).status_code == 422
    assert post({"content": "x" * 4001}).status_code in (400, 422)
    assert post({"content": "hola"}, c=9999).status_code == 404
    other_u, _ = mk_student(db, "alu_ajeno2")
    assert post({"content": "hola"}, hdr(other_u)).status_code == 403
    assert post({"content": "hola"}, hdr(world["admin"])).status_code == 403

    hist = client.get(f"{CH}/conversations/{cid}/messages", headers=sh).json()
    assert [m["content"] for m in hist] == ["Hola profe", "Respuesta"]
    first = hist[0]["id"]
    assert [m["content"] for m in client.get(f"{CH}/conversations/{cid}/messages?after_id={first}", headers=sh).json()] == ["Respuesta"]
    assert [m["content"] for m in client.get(f"{CH}/conversations/{cid}/messages?before_id={hist[1]['id']}", headers=sh).json()] == ["Hola profe"]
    assert client.get(f"{CH}/conversations/9999/messages", headers=sh).status_code == 404
    assert client.get(f"{CH}/conversations/{cid}/messages", headers=hdr(other_u)).status_code == 403

    assert client.get(f"{CH}/conversations/unread-count", headers=sh).json()["unread_count"] == 1
    assert client.post(f"{CH}/conversations/9999/read", headers=sh).status_code == 404
    assert client.post(f"{CH}/conversations/{cid}/read", headers=hdr(other_u)).status_code == 403
    assert client.post(f"{CH}/conversations/{cid}/read", headers=sh).status_code == 200
    assert client.post(f"{CH}/conversations/{cid}/read", headers=sh).status_code == 200  # actualiza la fila existente
    assert client.get(f"{CH}/conversations/unread-count", headers=sh).json()["unread_count"] == 0


def test_group_message_reaches_members(client, world, db):
    co = group_with_member(db, world)
    cid = client.get(f"{CH}/conversations/group/{co.id}", headers=hdr(world["t_user"])).json()["id"]
    r = client.post(f"{CH}/conversations/{cid}/messages", json={"content": "Clase mañana"}, headers=hdr(world["t_user"]))
    assert r.status_code == 200
    assert client.get(f"{CH}/conversations/unread-count", headers=hdr(world["s_user"])).json()["unread_count"] == 1


def test_inactive_sender_rejected(client, world, db):
    cid = direct(client, world)
    world["s_user"].is_active = False
    db.commit()
    from app.db.base import ChatSessionLocal
    with pytest.raises(chat_ep.HTTPException) as e:
        chat_ep._persist_message(world["s_user"].id, cid, "hola", None)
    assert e.value.status_code == 401


# ── lógica de core/chat.py ───────────────────────────────────────────────────────────────
def test_core_helpers(client, world, db):
    cid = direct(client, world)
    convo = db.get(ChatConversation, cid)
    cfg = chat_core.get_chat_settings(db)
    with pytest.raises(chat_ep.HTTPException):
        chat_core.send_message(db, cfg, convo, world["s_user"], "  ")
    with pytest.raises(chat_ep.HTTPException):
        chat_core.send_message(db, cfg, convo, world["s_user"], "x" * 4001)
    m, notify, dup = chat_core.send_message(db, cfg, convo, world["s_user"], "uno", client_id="k")
    assert notify is True and dup is False
    assert chat_core.find_message_by_client_id(db, cid, world["s_user"].id, None) is None
    assert chat_core.find_message_by_client_id(db, cid, world["s_user"].id, "k").id == m.id
    # con reactivación 0 siempre avisa; con ventana larga solo la primera vez
    set_chat(db, reactivation=0)
    assert chat_core.send_message(db, chat_core.get_chat_settings(db), convo, world["s_user"], "dos")[1] is True
    set_chat(db, reactivation=24)
    assert chat_core.send_message(db, chat_core.get_chat_settings(db), convo, world["s_user"], "tres")[1] is False
    assert chat_core.send_message(db, chat_core.get_chat_settings(db), convo, world["t_user"], "profe")[1] is False
    assert chat_core.assert_chat_enabled_ws(db) is not None
    set_chat(db, enabled=False)
    assert chat_core.assert_chat_enabled_ws(db) is None
    set_chat(db)

    assert chat_core.list_conversations_for_user(db, world["s_user"])[0].id == cid
    assert chat_core.list_conversations_for_user(db, world["admin"]) == []
    assert chat_core.conversation_ids_subquery(world["admin"]) is None
    assert chat_core.get_unread_count_for_user(db, world["admin"]) == 0
    assert chat_core.unread_counts(db, 1, []) == {}
    assert chat_core.catch_up_deliveries(db, world["admin"]) == {}
    assert chat_core.catch_up_deliveries(db, world["t_user"]) and chat_core.catch_up_deliveries(db, world["t_user"]) == {}
    assert chat_core.mark_delivered_by_id(db, m.id) is None  # ya entregado por el catch-up
    assert chat_core.mark_delivered_by_id(db, 99999) is None

    # participantes
    teacher_other = db.query(ChatConversation).first()
    assert chat_core.conversation_participant_user_ids(db, convo) == {world["s_user"].id, world["t_user"].id}
    chat_core.assert_participant(db, world["s_user"], convo)
    chat_core.assert_participant(db, world["t_user"], convo)
    with pytest.raises(chat_ep.HTTPException):
        chat_core.assert_participant(db, world["admin"], convo)
    from tests.audit.test_g1_god_mode_actions import mk_teacher
    ot, _ = mk_teacher(db, "otro_prof2", "teacher")
    with pytest.raises(chat_ep.HTTPException):
        chat_core.assert_participant(db, ot, convo)


def test_group_participant_checks(client, world, db):
    co = group_with_member(db, world)
    cid = client.get(f"{CH}/conversations/group/{co.id}", headers=hdr(world["s_user"])).json()["id"]
    convo = db.get(ChatConversation, cid)
    chat_core.assert_participant(db, world["s_user"], convo)
    chat_core.assert_participant(db, world["t_user"], convo)
    out_u, _ = mk_student(db, "alu_fuera")
    with pytest.raises(chat_ep.HTTPException):
        chat_core.assert_participant(db, out_u, convo)
    from tests.audit.test_g1_god_mode_actions import mk_teacher
    ot, _ = mk_teacher(db, "otro_prof3", "teacher")
    with pytest.raises(chat_ep.HTTPException):
        chat_core.assert_participant(db, ot, convo)
    with pytest.raises(chat_ep.HTTPException):
        chat_core.assert_participant(db, world["admin"], convo)
    assert world["s_user"].id in chat_core.conversation_participant_user_ids(db, convo)


def test_purge_old_messages(client, world, db):
    cid = direct(client, world)
    convo = db.get(ChatConversation, cid)
    cfg = chat_core.get_chat_settings(db)
    m, *_ = chat_core.send_message(db, cfg, convo, world["s_user"], "viejo")
    assert chat_core.purge_old_messages(db, 0) == 0
    m.created_at = utc_now() - timedelta(days=100)
    db.commit()
    assert chat_core.purge_old_messages(db, 30) == 1
    db.refresh(convo)
    assert convo.last_message_preview is None


# ── administración ───────────────────────────────────────────────────────────────────────
def test_admin_audit_endpoints(client, world, db):
    link(db, world)
    cid = direct(client, world)
    client.post(f"{CH}/conversations/{cid}/messages", json={"content": "secreto"}, headers=hdr(world["s_user"]))
    co = group_with_member(db, world)
    gid = client.get(f"{CH}/conversations/group/{co.id}", headers=hdr(world["s_user"])).json()["id"]
    ah = hdr(world["admin"])
    lst = client.get(f"{CH}/admin/conversations", headers=ah)
    assert lst.status_code == 200 and len(lst.json()) == 2
    assert client.get(f"{CH}/admin/conversations?teacher_username={world['t_user'].username}", headers=ah).status_code == 200
    assert client.get(f"{CH}/admin/conversations?student_username={world['s_user'].username}", headers=ah).status_code == 200
    assert client.get(f"{CH}/admin/conversations", headers=hdr(world["s_user"])).status_code == 403
    assert client.get(f"{CH}/admin/conversations/{cid}", headers=ah).json()["message_count"] == 1
    assert client.get(f"{CH}/admin/conversations/{gid}", headers=ah).json()["conversation_type"] == "group"
    assert client.get(f"{CH}/admin/conversations/9999", headers=ah).status_code == 404
    assert client.get(f"{CH}/admin/conversations/9999/messages?reason=auditoria", headers=ah).status_code == 404
    assert client.get(f"{CH}/admin/conversations/{cid}/messages", headers=ah).status_code == 422  # falta el motivo
    r = client.get(f"{CH}/admin/conversations/{cid}/messages?reason=reclamo%20del%20alumno", headers=ah)
    assert r.status_code == 200 and r.json()[0]["content"] == "secreto"


# ── gestor de sockets ────────────────────────────────────────────────────────────────────
def test_connection_manager_paths():
    class FakeWS:
        def __init__(self, fail=False, close_fail=False):
            self.fail, self.close_fail, self.sent, self.closed = fail, close_fail, [], None

        async def accept(self):
            pass

        async def send_text(self, data):
            if self.fail:
                raise RuntimeError("socket muerto")
            self.sent.append(json.loads(data))

        async def close(self, code=1000):
            if self.close_fail:
                raise RuntimeError("ya cerrado")
            self.closed = code

    async def run():
        m = ChatConnectionManager()
        a, dead, closer = FakeWS(), FakeWS(fail=True), FakeWS(close_fail=True)
        await m.connect(1, a)
        await m.connect(1, dead)
        await m.connect(2, closer)
        assert m.is_online(1) and not m.is_online(3)
        assert await m.send_to_user(3, {"x": 1}) is False
        assert await m.send_to_user(1, {"x": 1}) is True and a.sent == [{"x": 1}]
        assert len(m._connections[1]) == 1  # el muerto se retiró
        assert await m.broadcast_to_users({1, 2, 3}, {"y": 2}) == {1, 2}
        m.disconnect(9, a)  # usuario desconocido
        m.disconnect(1, a)
        assert not m.is_online(1)
        assert await m.close_user(2) == 1  # el fallo al cerrar se ignora
        assert await m.close_user(2) == 0

    asyncio.run(run())


# ── WebSocket ────────────────────────────────────────────────────────────────────────────
def ws_hdr(user):
    # El token viaja solo en la cookie HttpOnly (SEC-05); header por conexión para poder abrir varios usuarios a la vez.
    return {"cookie": f"{chat_ep.ACCESS_COOKIE}={tok(user)}"}


def test_ws_two_sessions_message_delivery_and_catch_up(client, world, db):
    link(db, world)
    cid = direct(client, world)
    with client.websocket_connect(f"{CH}/ws", headers=ws_hdr(world["s_user"])) as stu:
        stu.send_json({"type": "ping"})
        assert stu.receive_json() == {"type": "pong"}
        # el profesor está offline: no hay segundo check
        stu.send_json({"type": "send", "conversation_id": cid, "content": "¿Hay clase?", "client_id": "a1"})
        echo = stu.receive_json()
        assert echo["type"] == "message" and echo["client_id"] == "a1"
        # el profesor se conecta: catch-up avisa "entregado" al alumno
        with client.websocket_connect(f"{CH}/ws", headers=ws_hdr(world["t_user"])) as tea:
            assert stu.receive_json() == {"type": "delivered", "id": echo["id"]}
            # ahora ambos online: el mensaje llega al profesor y el alumno recibe el check
            stu.send_json({"type": "send", "conversation_id": cid, "content": "Gracias", "client_id": "a2"})
            assert stu.receive_json()["type"] == "message"
            assert tea.receive_json()["content"] == "Gracias"
            assert stu.receive_json()["type"] == "delivered"
            # duplicado: solo eco al emisor
            stu.send_json({"type": "send", "conversation_id": cid, "content": "Gracias", "client_id": "a2"})
            assert stu.receive_json()["type"] == "message"
            # profesor responde por el mismo socket
            tea.send_json({"conversation_id": cid, "content": "Sí, mañana"})  # tipo por defecto = send
            assert tea.receive_json()["content"] == "Sí, mañana"
            assert stu.receive_json()["content"] == "Sí, mañana"


def test_ws_protocol_errors(client, world, db):
    cid = direct(client, world)
    other_u, _ = mk_student(db, "alu_ajeno3")
    with client.websocket_connect(f"{CH}/ws", headers=ws_hdr(world["s_user"])) as ws:
        ws.send_text("no es json")
        ws.send_text("[1, 2]")
        ws.send_json({"type": "desconocido"})
        ws.send_json({"type": "send", "content": "x"})
        assert ws.receive_json()["detail"] == "Falta conversation_id"
        ws.send_json({"type": "send", "conversation_id": 9999, "content": "x", "client_id": "e1"})
        err = ws.receive_json()
        assert err["type"] == "error" and err["client_id"] == "e1"
        ws.send_json({"type": "send", "conversation_id": cid, "content": "   "})
        assert ws.receive_json()["type"] == "error"
        ws.send_json({"type": "send", "conversation_id": "no-numero", "content": "x"})
        assert ws.receive_json()["detail"] == "No se pudo enviar el mensaje"


def test_ws_rejects_bad_connections(client, world, db):
    def closes(url, **kw):
        with pytest.raises(WebSocketDisconnect) as e:
            with client.websocket_connect(url, **kw) as ws:
                ws.receive_text()
        return e.value.code

    assert closes(f"{CH}/ws") == 4401  # sin token ni cookie
    assert closes(f"{CH}/ws", headers={"cookie": f"{chat_ep.ACCESS_COOKIE}=basura"}) == 4401
    assert closes(f"{CH}/ws?token={tok(world['s_user'])}") == 4401  # ?token= ya no se acepta
    assert closes(f"{CH}/ws", headers=ws_hdr(world["admin"])) == 4403  # rol sin chat
    world["s_user"].is_active = False
    db.commit()
    assert closes(f"{CH}/ws", headers=ws_hdr(world["s_user"])) == 4401
    world["s_user"].is_active = True
    db.commit()
    set_chat(db, enabled=False)
    assert closes(f"{CH}/ws", headers=ws_hdr(world["s_user"])) == 4403
    set_chat(db)
    # cookie con un origen que no es el del frontend
    client.cookies.set(chat_ep.ACCESS_COOKIE, tok(world["s_user"]))
    try:
        assert closes(f"{CH}/ws", headers={"origin": "https://sitio-ajeno.example"}) == 4403
        with client.websocket_connect(f"{CH}/ws") as ws:  # cookie sin Origin: permitido
            ws.send_json({"type": "ping"})
            assert ws.receive_json() == {"type": "pong"}
    finally:
        client.cookies.clear()


def test_ws_rechecks_account_while_open(client, world, db, monkeypatch):
    monkeypatch.setattr(chat_ep, "WS_ACTIVE_RECHECK_SECONDS", -1)
    with client.websocket_connect(f"{CH}/ws", headers=ws_hdr(world["s_user"])) as ws:
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}
        world["s_user"].is_active = False
        db.commit()
        ws.send_json({"type": "ping"})
        with pytest.raises(WebSocketDisconnect) as e:
            ws.receive_text()
        assert e.value.code == 4401
    world["s_user"].is_active = True
    db.commit()
