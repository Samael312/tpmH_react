"""Fase 23 — video pendiente de revision (el anterior sigue publico) y cierre de websockets al banear.
Sin red: Resend/Cloudinary se sustituyen con monkeypatch."""
import io

import pytest

from tests.audit.conftest import hdr, _mk_user
from tests.audit.helpers import API
from tests.audit.test_permissions_money import _teacher_admin

MP4 = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom" + b"\x00" * 64


@pytest.fixture
def sent(monkeypatch):
    box = []
    import resend
    monkeypatch.setattr(resend.Emails, "send", lambda payload, *a, **k: box.append(payload) or {"id": "x"})
    return box


@pytest.fixture
def cloud(monkeypatch):
    import cloudinary.uploader as up
    box = {"uploads": [], "deleted": []}

    def fake_upload(data, **kw):
        box["uploads"].append(kw)
        n = len(box["uploads"])
        return {"secure_url": f"https://res.cloudinary.com/x/v{n}.mp4", "public_id": f"pid{n}",
                "resource_type": kw["resource_type"], "bytes": 1}

    monkeypatch.setattr(up, "upload", fake_upload)
    monkeypatch.setattr(up, "upload_large", fake_upload)
    monkeypatch.setattr(up, "destroy", lambda pid, **kw: box["deleted"].append((pid, kw.get("resource_type"))) or {"result": "ok"})
    return box


def _up(client, user):
    return client.post(f"{API}/teachers/me/video", files={"file": ("v.mp4", io.BytesIO(MP4), "video/mp4")}, headers=hdr(user))


def _tp(db, world):
    from app.models.teacher import TeacherProfile
    db.expire_all()
    return db.get(TeacherProfile, world["tp"].id)


def _approved_with_old(db, world):
    tp = world["tp"]
    tp.video_url, tp.video_public_id = "http://old", "old1"
    db.commit()


def test_approved_upload_goes_pending_old_stays_public(client, world, db, cloud, sent):
    _approved_with_old(db, world)
    r = _up(client, world["t_user"])
    assert r.status_code == 200, r.text
    tp = _tp(db, world)
    assert tp.status.value == "approved" and tp.video_url == "http://old" and tp.video_public_id == "old1"
    assert tp.video_pending_url and tp.video_pending_public_id == "pid1"
    assert cloud["deleted"] == []
    # nunca en endpoints publicos
    for url in (f"{API}/teachers/", f"{API}/teachers/{tp.user_username}", f"{API}/public/landing"):
        body = client.get(url).text
        assert "v1.mp4" not in body and "pid1" not in body, url
    mine = client.get(f"{API}/teachers/me/profile", headers=hdr(world["t_user"])).json()
    assert mine["video_pending_url"] and mine["video_url"] == "http://old"


def test_retry_replaces_pending_deletes_previous_notifies_once(client, world, db, cloud, sent):
    from app.models.notification import Notification
    _approved_with_old(db, world)
    _up(client, world["t_user"])
    _up(client, world["t_user"])
    tp = _tp(db, world)
    assert tp.video_pending_public_id == "pid2" and cloud["deleted"] == [("pid1", "video")]
    assert len([m for m in sent if "pendiente" in m["subject"].lower()]) == 1
    assert db.query(Notification).filter(Notification.type == "teacher_pending").count() == 1


def test_first_video_keeps_onboarding_flow(client, world, db, cloud, sent):
    from app.models.teacher import TeacherStatus
    tp = world["tp"]
    tp.status, tp.video_url = TeacherStatus.pending, None
    db.commit()
    assert _up(client, world["t_user"]).status_code == 200
    tp = _tp(db, world)
    assert tp.video_url and tp.video_pending_url is None and tp.status == TeacherStatus.pending


def test_staff_approve_promotes_and_deletes_old(client, world, db, cloud, sent):
    from app.models.notification import Notification
    _approved_with_old(db, world)
    _up(client, world["t_user"])
    r = client.patch(f"{API}/admin/teachers/{world['tp'].id}/pending-video/approve", headers=hdr(world["admin"]))
    assert r.status_code == 200, r.text
    tp = _tp(db, world)
    assert tp.video_url.endswith("v1.mp4") and tp.video_public_id == "pid1"
    assert tp.video_pending_url is None and tp.video_pending_public_id is None
    assert cloud["deleted"] == [("old1", "video")]
    assert db.query(Notification).filter_by(type="teacher_video_review", recipient_user_id=world["t_user"].id).count() == 1
    assert any("aprobado" in m["subject"].lower() for m in sent)
    # sin pendiente -> 400
    assert client.patch(f"{API}/admin/teachers/{world['tp'].id}/pending-video/approve", headers=hdr(world["admin"])).status_code == 400


def test_staff_reject_deletes_pending_keeps_old_and_requires_reason(client, world, db, cloud, sent):
    _approved_with_old(db, world)
    _up(client, world["t_user"])
    url = f"{API}/admin/teachers/{world['tp'].id}/pending-video/reject"
    assert client.patch(url, json={"reason": "  "}, headers=hdr(world["admin"])).status_code == 422
    r = client.patch(url, json={"reason": "Mala calidad"}, headers=hdr(world["admin"]))
    assert r.status_code == 200, r.text
    tp = _tp(db, world)
    assert tp.video_url == "http://old" and tp.video_pending_url is not None  # se conserva por si apela
    assert tp.video_pending_rejection_reason == "Mala calidad"
    assert cloud["deleted"] == []
    assert any("rechazado" in m["subject"].lower() and "Mala calidad" in m["html"] for m in sent)


def test_permissions_student_teacher_and_teacher_admin_own(client, world, db, cloud, sent):
    _approved_with_old(db, world)
    _up(client, world["t_user"])
    url = f"{API}/admin/teachers/{world['tp'].id}/pending-video/approve"
    assert client.patch(url, headers=hdr(world["s_user"])).status_code == 403
    assert client.patch(url, headers=hdr(world["t_user"])).status_code == 403
    # teacher_admin: puede con otro, no con el suyo
    ta, tap = _teacher_admin(db)
    assert client.patch(url, headers=hdr(ta)).status_code == 200
    _up(client, ta)
    own = f"{API}/admin/teachers/{tap.id}/pending-video/approve"
    assert client.patch(own, headers=hdr(ta)).status_code == 403
    assert client.patch(own, headers=hdr(world["admin"])).status_code == 200


# ═══ baneo: websockets ══════════════════════════════════════════════════════

class FakeWS:
    def __init__(self):
        self.closed = None

    async def close(self, code=1000):
        self.closed = code


@pytest.fixture(autouse=True)
def _clean_chat_manager():
    from app.core.chat_ws import chat_manager
    chat_manager._connections.clear()
    yield
    chat_manager._connections.clear()


def _register_ws(uid):
    from app.core.chat_ws import chat_manager
    ws = FakeWS()
    chat_manager._connections.setdefault(uid, set()).add(ws)
    return ws


def test_ban_closes_chat_sockets(client, world, db):
    ws = _register_ws(world["s_user"].id)
    r = client.post(f"{API}/admin/students/{world['s_user'].id}/ban", json={"reason": "abuso"}, headers=hdr(world["admin"]))
    assert r.status_code == 200, r.text
    assert ws.closed == 4401


def test_deactivate_closes_sockets_activate_does_not(client, world, db):
    ws = _register_ws(world["s_user"].id)
    uid = world["s_user"].id
    h = hdr(world["admin"])
    assert client.patch(f"{API}/admin/users/{uid}/status", json={"is_active": True}, headers=h).status_code == 200
    assert ws.closed is None
    assert client.patch(f"{API}/admin/users/{uid}/status", json={"is_active": False}, headers=h).status_code == 200
    assert ws.closed == 4401


# ═══ apelacion de un video pendiente rechazado ══════════════════════════════

def _rejected_video(client, world, db):
    _approved_with_old(db, world)
    _up(client, world["t_user"])
    r = client.patch(f"{API}/admin/teachers/{world['tp'].id}/pending-video/reject", json={"reason": "Mala calidad"},
                     headers=hdr(world["admin"]))
    assert r.status_code == 200, r.text


def _appeal(client, user, msg="Es buen video"):
    return client.post(f"{API}/teachers/me/appeal", json={"message": msg}, headers=hdr(user))


def _resolve(client, user, appeal_id, action, resp="ok"):
    return client.patch(f"{API}/admin/appeals/{appeal_id}/resolve", json={"action": action, "admin_response": resp}, headers=hdr(user))


def test_appeal_only_once_and_only_when_video_rejected(client, world, db, cloud, sent):
    _approved_with_old(db, world)
    assert _appeal(client, world["t_user"]).status_code == 400  # nada rechazado
    _rejected_video(client, world, db)
    r = _appeal(client, world["t_user"])
    assert r.status_code == 201, r.text
    assert _appeal(client, world["t_user"]).status_code == 400  # ya hay una pendiente
    assert client.get(f"{API}/teachers/me/appeals", headers=hdr(world["t_user"])).json()[0]["kind"] == "video"


def test_appeal_approved_promotes_pending_and_deletes_old(client, world, db, cloud, sent):
    _rejected_video(client, world, db)
    aid = _appeal(client, world["t_user"]).json()["id"]
    assert cloud["deleted"] == []
    r = _resolve(client, world["admin"], aid, "approve")
    assert r.status_code == 200, r.text
    tp = _tp(db, world)
    assert tp.video_url.endswith("v1.mp4") and tp.video_pending_url is None and tp.video_pending_rejection_reason is None
    assert tp.status.value == "approved" and cloud["deleted"] == [("old1", "video")]


def test_appeal_rejected_deletes_pending_keeps_old(client, world, db, cloud, sent):
    _rejected_video(client, world, db)
    aid = _appeal(client, world["t_user"]).json()["id"]
    assert _resolve(client, world["admin"], aid, "reject").status_code == 200
    tp = _tp(db, world)
    assert tp.video_url == "http://old" and tp.video_pending_url is None and tp.status.value == "approved"
    assert cloud["deleted"] == [("pid1", "video")]
    assert _appeal(client, world["t_user"]).status_code == 400  # sin video rechazado ya


def test_new_upload_after_rejection_replaces_pending_and_notifies_again(client, world, db, cloud, sent):
    _rejected_video(client, world, db)
    n = len([m for m in sent if "pendiente" in m["subject"].lower()])
    assert _up(client, world["t_user"]).status_code == 200
    tp = _tp(db, world)
    assert tp.video_pending_public_id == "pid2" and tp.video_pending_rejection_reason is None
    assert cloud["deleted"] == [("pid1", "video")]
    assert len([m for m in sent if "pendiente" in m["subject"].lower()]) == n + 1


def test_upload_blocked_while_video_appeal_pending(client, world, db, cloud, sent):
    _rejected_video(client, world, db)
    _appeal(client, world["t_user"])
    assert _up(client, world["t_user"]).status_code == 400


def test_teacher_admin_cannot_resolve_own_appeal(client, world, db, cloud, sent):
    ta, tap = _teacher_admin(db)
    tap.video_url, tap.video_public_id = "http://old", "old1"
    db.commit()
    _up(client, ta)
    assert client.patch(f"{API}/admin/teachers/{tap.id}/pending-video/reject", json={"reason": "x"}, headers=hdr(world["admin"])).status_code == 200
    aid = _appeal(client, ta).json()["id"]
    assert _resolve(client, ta, aid, "approve").status_code == 403
    assert _resolve(client, world["admin"], aid, "approve").status_code == 200


def test_delete_account_closes_chat_sockets(client, world, db):
    ws = _register_ws(world["s_user"].id)
    u = world["s_user"]
    r = client.request("DELETE", f"{API}/users/me", headers=hdr(u), json={"password": "Password123", "confirm_username": u.username})
    assert r.status_code == 200, r.text
    assert ws.closed == 4401
