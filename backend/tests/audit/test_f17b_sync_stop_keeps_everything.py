"""Fase 17b: regla del dueno. Si la sync se detiene (desconexion, token revocado, cambio de cuenta)
NO se cancela nada: ni eventos en Google ni clases en la plataforma. Las clases quedan, sin sincronizar."""
from datetime import timedelta

from tests.audit.conftest import hdr, future
from tests.audit.test_f17_google_preply import (
    API, _callback, _ext, _fake_exchange, _own_class, _RevokedCreds, can_book,
)
from tests.tz_probes.test_calendar_emails_jobs import FakeCalendar, _preply, _connect, _externals
from app.core import google_calendar as gc
from app.core.timezone import utc_now
from app.models.class_ import Class
from app.models.google_calendar import GoogleCalendarToken
from app.models.notification import Notification


def _snapshot(db, tp_id):
    db.expire_all()
    return {c.id: (c.status, c.google_event_id) for c in db.query(Class).filter(Class.teacher_id == tp_id).all()}


def test_disconnect_cancels_nothing_and_touches_no_google_event(client, db, world, monkeypatch):
    monkeypatch.setattr("app.api.v1.endpoints.calendar.revoke_token", lambda t: None)
    start = future(48)
    cal = _connect(db, world, monkeypatch, FakeCalendar(events=[_preply("f1", start)]))
    own = _own_class(db, world)
    gc.sync_calendar_logic(world["tp"].id, db)       # importa la externa y publica la propia
    (ext,) = _externals(db, world["tp"].id)
    assert ext.status == "confirmed"
    own_eid = db.get(Class, own.id).google_event_id
    assert own_eid
    before = _snapshot(db, world["tp"].id)
    cal.calls.clear()
    assert client.post(f"{API}/calendar/disconnect", headers=hdr(world["t_user"])).status_code == 200
    assert _snapshot(db, world["tp"].id) == before          # status Y google_event_id intactos
    assert not any(x[0] in ("delete", "update", "insert") for x in cal.calls)
    assert own_eid in cal.events_by_id
    assert db.query(GoogleCalendarToken).count() == 0
    # la externa sigue bloqueando el horario (aceptado por el dueno)
    assert can_book(db, world, ext.start_time_utc)[0] is False


def test_reauth_refresh_error_cancels_nothing_but_notifies(db, world, monkeypatch):
    sent = []
    monkeypatch.setattr("app.core.email.send_calendar_reauth_teacher_email", lambda *a, **k: sent.append(a) or True)
    monkeypatch.setattr(gc, "Credentials", _RevokedCreds)
    db.add(GoogleCalendarToken(user_id=world["t_user"].id, teacher_id=world["tp"].id, access_token="x",
                               refresh_token="y", is_active=True, needs_reauth=False,
                               token_expiry=utc_now() - timedelta(hours=1)))
    db.commit()
    _ext(db, world["tp"].id, 48, "f1")
    own = _own_class(db, world)
    own.google_event_id = "own-x"
    db.commit()
    before = _snapshot(db, world["tp"].id)
    r = gc.sync_calendar_logic(world["tp"].id, db)
    assert r["ok"] is False
    assert _snapshot(db, world["tp"].id) == before
    t = db.query(GoogleCalendarToken).one()
    assert t.needs_reauth is True and t.is_active is False
    assert db.query(Notification).filter(Notification.type == "calendar_reauth_required").count() == 1
    assert len(sent) == 1


def test_reconnect_with_different_account_cancels_nothing_and_deletes_nothing(client, db, world, monkeypatch):
    _fake_exchange(monkeypatch, sub="old")
    _callback(client, world["t_user"], world["tp"].id)
    ext = _ext(db, world["tp"].id, 48, "p1")
    own = _own_class(db, world)
    own.google_event_id, own.google_sync_hash = "own-old", "h"
    db.commit()
    deleted = []
    monkeypatch.setattr(gc, "delete_calendar_event", lambda *a, **k: deleted.append(a) or True)
    _fake_exchange(monkeypatch, sub="new")
    assert _callback(client, world["t_user"], world["tp"].id).status_code == 200
    db.expire_all()
    e = db.get(Class, ext.id)
    assert e.status == "confirmed" and e.google_event_id == "p1"
    o = db.get(Class, own.id)
    assert o.status == "confirmed"
    # clase propia: se re-empujara al calendario nuevo (ids y hash limpios), sin borrar nada en el viejo
    assert o.google_event_id is None and o.google_sync_hash is None
    assert deleted == []


def test_reconnect_same_account_keeps_event_ids_and_hash(client, db, world, monkeypatch):
    _fake_exchange(monkeypatch, sub="same")
    _callback(client, world["t_user"], world["tp"].id)
    own = _own_class(db, world)
    own.google_event_id, own.google_sync_hash = "own-1", "h"
    db.commit()
    _callback(client, world["t_user"], world["tp"].id)
    db.expire_all()
    o = db.get(Class, own.id)
    assert o.google_event_id == "own-1" and o.google_sync_hash == "h"


def test_disconnect_then_reconnect_same_account_no_duplicates(client, db, world, monkeypatch):
    monkeypatch.setattr("app.api.v1.endpoints.calendar.revoke_token", lambda t: None)
    start = future(72)
    cal = _connect(db, world, monkeypatch, FakeCalendar(events=[_preply("preply-1", start)]))
    own = _own_class(db, world)
    gc.sync_calendar_logic(world["tp"].id, db)
    assert len(_externals(db, world["tp"].id)) == 1
    own_eid = db.get(Class, own.id).google_event_id
    assert client.post(f"{API}/calendar/disconnect", headers=hdr(world["t_user"])).status_code == 200
    assert len(_externals(db, world["tp"].id)) == 1                    # sigue ahi
    # reconecta (misma cuenta: mismo FakeCalendar)
    monkeypatch.setattr("app.api.v1.endpoints.calendar.run_calendar_sync_background", lambda tid: None)
    monkeypatch.setattr("app.api.v1.endpoints.calendar.exchange_code_for_tokens",
                        lambda code, code_verifier=None: {"access_token": "a", "refresh_token": "r",
                                                          "token_expiry": None, "google_sub": "s",
                                                          "google_email": "e"})
    assert _callback(client, world["t_user"], world["tp"].id).status_code == 200
    monkeypatch.setattr(gc, "get_calendar_service_for_token", lambda token, d: cal)
    cal.calls.clear()
    gc.sync_calendar_logic(world["tp"].id, db)
    exts = _externals(db, world["tp"].id)
    assert len(exts) == 1 and exts[0].google_event_id == "preply-1" and exts[0].status == "confirmed"
    # la clase propia reanuda sobre el MISMO evento (update, no insert): sin duplicado en Google
    assert not any(x[0] == "insert" for x in cal.calls)
    assert db.get(Class, own.id).google_event_id == own_eid
    assert len([e for e in cal.events_by_id if e.startswith("own-")]) == 1


def test_disconnect_then_reconnect_other_account_recreates_own_event_in_new_calendar(client, db, world, monkeypatch):
    monkeypatch.setattr("app.api.v1.endpoints.calendar.revoke_token", lambda t: None)
    old = _connect(db, world, monkeypatch, FakeCalendar())
    own = _own_class(db, world)
    gc.sync_calendar_logic(world["tp"].id, db)
    assert len(old.events_by_id) == 1
    client.post(f"{API}/calendar/disconnect", headers=hdr(world["t_user"]))
    new = FakeCalendar()                                                # otra cuenta: calendario vacio
    monkeypatch.setattr("app.api.v1.endpoints.calendar.exchange_code_for_tokens",
                        lambda code, code_verifier=None: {"access_token": "a", "refresh_token": "r",
                                                          "token_expiry": None, "google_sub": "other",
                                                          "google_email": "o"})
    real_sync = gc.sync_calendar_logic
    monkeypatch.setattr("app.api.v1.endpoints.calendar.run_calendar_sync_background", lambda tid: None)
    assert _callback(client, world["t_user"], world["tp"].id).status_code == 200
    monkeypatch.setattr(gc, "get_calendar_service_for_token", lambda token, d: new)
    real_sync(world["tp"].id, db)
    assert len(new.events_by_id) == 1 and len(old.events_by_id) == 1    # el viejo no se toco
    assert not any(x[0] == "delete" for x in old.calls)
