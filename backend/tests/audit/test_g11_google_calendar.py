"""Cobertura de `app/core/google_calendar.py` con un servicio de Google simulado (sin red)."""
import json
from datetime import timedelta

import httplib2
import pytest
from googleapiclient.errors import HttpError
from google.auth.exceptions import RefreshError

from app.core import google_calendar as gc
from app.core.timezone import utc_now
from app.models.class_ import Class, ClassType
from app.models.google_calendar import GoogleCalendarToken
from tests.audit.conftest import future
from tests.audit.test_g1_god_mode_actions import mk_class


# ── doble de prueba del cliente de Google ────────────────────────────────────────────────
def http_error(status, reasons=(), api_status=None, raw=None):
    body = raw if raw is not None else json.dumps({"error": {"errors": [{"reason": r} for r in reasons], "status": api_status}}).encode()
    return HttpError(httplib2.Response({"status": status}), body)


class Req:
    def __init__(self, fn):
        self.execute = fn


class Events:
    def __init__(self, h):
        self.h = h

    def _r(self, name):
        def make(**kw):
            fn = self.h.get(name)
            return Req(lambda: fn(**kw) if callable(fn) else fn)
        return make

    def __getattr__(self, name):
        if name in ("list", "insert", "get", "update", "delete"):
            return self._r(name)
        raise AttributeError(name)


class FreeBusy:
    def __init__(self, h):
        self.h = h

    def query(self, body=None):
        fn = self.h.get("freebusy")
        return Req(lambda: fn(body) if callable(fn) else fn)


class Service:
    def __init__(self, **h):
        self.h = h

    def events(self):
        return Events(self.h)

    def freebusy(self):
        return FreeBusy(self.h)


def raiser(exc):
    def f(*a, **k):
        raise exc
    return f


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(gc.time, "sleep", lambda s: None)


def mk_token(db, w, **kw):
    t = GoogleCalendarToken(user_id=w["t_user"].id, teacher_id=w["tp"].id, access_token="tok", refresh_token="ref", **kw)
    db.add(t)
    db.commit()
    return t


# ── OAuth y credenciales ─────────────────────────────────────────────────────────────────
def test_oauth_url_and_exchange(monkeypatch):
    url = gc.get_auth_url(state="abc")
    assert "accounts.google.com" in url and "code_challenge" not in url and "state=abc" in url
    assert "accounts.google.com" in gc.get_auth_url()

    class FakeCreds:
        token, refresh_token, expiry, id_token = "a", "r", None, None

    class FakeFlow:
        credentials = FakeCreds()
        code_verifier = None

        def fetch_token(self, code, timeout):
            self.code = code

    monkeypatch.setattr(gc, "get_oauth_flow", lambda: FakeFlow())
    out = gc.exchange_code_for_tokens("code", code_verifier="ver")
    assert out["access_token"] == "a" and out["google_sub"] is None


def test_identity_from_id_token():
    import jwt
    tok = jwt.encode({"sub": 123, "email": "A@B.com"}, "k", algorithm="HS256")
    assert gc._identity_from_id_token(tok) == ("123", "a@b.com")
    assert gc._identity_from_id_token("basura") == (None, None)
    assert gc._identity_from_id_token(None) == (None, None)


def test_calendar_id_for_and_revoke(monkeypatch):
    assert gc.calendar_id_for(GoogleCalendarToken(calendar_id="x@y.com")) == "primary"
    assert gc.calendar_id_for(GoogleCalendarToken(calendar_id="cal1")) == "cal1"
    monkeypatch.setattr(gc.requests, "post", raiser(RuntimeError("sin red")))
    gc.revoke_token("tok")  # no propaga


def test_get_calendar_service_success_refresh_and_failures(world, db, monkeypatch):
    t = mk_token(db, world, token_expiry=utc_now() - timedelta(hours=1))
    monkeypatch.setattr(gc, "build", lambda *a, **k: "SERVICIO")
    monkeypatch.setattr(gc.Credentials, "refresh", lambda self, req: setattr(self, "token", "nuevo"))
    assert gc.get_calendar_service_for_token(t, db) == "SERVICIO"
    assert t.access_token == "nuevo"
    # refresh revocado: marca reautenticación y avisa una vez
    monkeypatch.setattr(gc.Credentials, "refresh", raiser(RefreshError("revocado")))
    t.token_expiry = utc_now().replace(tzinfo=None) - timedelta(hours=1)
    db.commit()
    assert gc.get_calendar_service_for_token(t, db) is None
    assert t.needs_reauth is True and t.is_active is False
    assert gc.get_calendar_service_for_token(t, db) is None  # ya sin aviso
    # error inesperado
    monkeypatch.setattr(gc, "build", raiser(RuntimeError("boom")))
    t.token_expiry = None
    assert gc.get_calendar_service_for_token(t, db) is None
    assert "boom" in t.last_error


def test_notify_reauth_swallows_errors(world, db, monkeypatch):
    t = mk_token(db, world)
    import app.core.notifications as n
    monkeypatch.setattr(n, "create_notification", raiser(RuntimeError("falla")))
    gc.notify_calendar_reauth(t, db)


def test_background_sync_swallows_errors(monkeypatch):
    monkeypatch.setattr(gc, "sync_calendar_logic", raiser(RuntimeError("x")))
    gc.run_calendar_sync_background(1)


def test_reset_platform_sync_state(world, db):
    c = mk_class(db, world, hours=30)
    c.google_event_id = "e1"
    c.google_sync_hash = "h"
    db.commit()
    assert gc.reset_platform_sync_state(world["tp"].id, db, clear_event_ids=False) == 1
    assert c.google_event_id == "e1" and c.google_sync_hash is None
    gc.reset_platform_sync_state(world["tp"].id, db, clear_event_ids=True)
    assert c.google_event_id is None


# ── errores de la API y reintentos ───────────────────────────────────────────────────────
def test_http_error_kind():
    assert gc.http_error_kind(http_error(429)) == "quota"
    assert gc.http_error_kind(http_error(403, ["rateLimitExceeded"])) == "quota"
    assert gc.http_error_kind(http_error(403, api_status="RESOURCE_EXHAUSTED")) == "quota"
    assert gc.http_error_kind(http_error(403, ["forbidden"])) == "permission"
    assert gc.http_error_kind(http_error(401, raw=b"no es json")) == "permission"
    assert gc.http_error_kind(http_error(404)) == "gone"
    assert gc.http_error_kind(http_error(500)) == "other"
    e = http_error(500)
    e.resp.status = "raro"
    assert gc.http_error_kind(e) == "other"


def test_with_retries():
    calls = {"n": 0}

    def flaky():
        calls["n"] += 1
        if calls["n"] < 3:
            raise http_error(503)
        return "ok"

    assert gc._with_retries(flaky) == "ok" and calls["n"] == 3
    with pytest.raises(HttpError):
        gc._with_retries(raiser(http_error(404)))
    with pytest.raises(HttpError):
        gc._with_retries(raiser(http_error(503)))


# ── ocupado / eventos ────────────────────────────────────────────────────────────────────
def test_busy_ranges_variants():
    from datetime import datetime
    n0, n1 = datetime(2030, 1, 1), datetime(2030, 1, 2)
    ok = {"calendars": {"primary": {"busy": [{"start": "2030-01-01T10:00:00Z", "end": "2030-01-01T11:00:00Z"}, {"start": "x"}, {"start": "mal", "end": "mal"}]}}}
    assert len(gc.get_busy_ranges(Service(freebusy=ok), "primary", n0, n1)) == 1
    alt = {"calendars": {"real@x.com": {"busy": [{"start": "2030-01-01T10:00:00Z", "end": "2030-01-01T11:00:00Z"}]}}}
    assert len(gc.get_busy_ranges(Service(freebusy=alt), "primary", n0, n1)) == 1
    bad = {"calendars": {"primary": {"errors": [{"reason": "notFound"}]}}}
    assert gc.get_busy_ranges(Service(freebusy=bad), "primary", n0, n1) == []
    with pytest.raises(gc.FreebusyError):
        gc.get_busy_ranges(Service(freebusy=bad), "primary", n0, n1, strict=True)
    err = Service(freebusy=raiser(http_error(404)))
    assert gc.get_busy_ranges(err, "primary", n0, n1) == []
    with pytest.raises(gc.FreebusyError):
        gc.get_busy_ranges(err, "primary", n0, n1, strict=True)


def test_teacher_busy_ranges(world, db, monkeypatch):
    from datetime import datetime
    a, b = datetime(2030, 1, 1), datetime(2030, 1, 2)
    assert gc.get_teacher_busy_ranges(world["tp"].id, a, b, db) == []
    mk_token(db, world)
    monkeypatch.setattr(gc, "get_calendar_service_for_token", lambda t, d: None)
    assert gc.get_teacher_busy_ranges(world["tp"].id, a, b, db) == []
    with pytest.raises(gc.FreebusyError):
        gc.get_teacher_busy_ranges(world["tp"].id, a, b, db, strict=True)
    monkeypatch.setattr(gc, "get_calendar_service_for_token", lambda t, d: Service(freebusy={"calendars": {}}))
    assert gc.get_teacher_busy_ranges(world["tp"].id, a, b, db) == []


def test_list_events_pagination_and_errors():
    from datetime import datetime
    pages = iter([{"items": [{"id": "1"}], "nextPageToken": "p2"}, {"items": [{"id": "2"}]}])
    svc = Service(list=lambda **k: next(pages))
    assert [e["id"] for e in gc.list_calendar_events(svc, "primary", datetime(2030, 1, 1), datetime(2030, 1, 2))] == ["1", "2"]
    assert gc.list_calendar_events(Service(list=raiser(http_error(404))), "primary", datetime(2030, 1, 1), datetime(2030, 1, 2)) == []


def ev(id, title="Clase Preply con Ana", start="2030-01-01T10:00:00Z", end="2030-01-01T11:00:00Z", **kw):
    return {"id": id, "summary": title, "start": {"dateTime": start}, "end": {"dateTime": end}, **kw}


def test_match_external_source():
    assert gc._match_external_source(ev("1")) == "preply"
    assert gc._match_external_source(ev("1", extendedProperties={"private": {"tpmh_managed": "true"}})) is None
    assert gc._match_external_source(ev("1", status="cancelled")) is None
    assert gc._match_external_source({"id": "1", "summary": "Preply", "start": {"date": "2030-01-01"}, "end": {"date": "2030-01-02"}}) is None
    assert gc._match_external_source(ev("1", title="Reunión")) is None


def test_import_external_classes(world, db):
    from datetime import datetime
    tp = world["tp"].id
    lo, hi = utc_now(), utc_now() + timedelta(days=30)
    s1 = (utc_now() + timedelta(days=2)).replace(microsecond=0)
    fmt = lambda d: d.strftime("%Y-%m-%dT%H:%M:%SZ")
    events = [
        ev("e1", start=fmt(s1), end=fmt(s1 + timedelta(hours=1)), hangoutLink="https://meet.google.com/aaa"),
        ev("e2", start=fmt(s1 + timedelta(days=1)), end=fmt(s1 + timedelta(days=1, hours=1)), location="https://zoom.us/j/1"),
        ev("e3", title="Reunión interna"),
        {"summary": "sin id"},
    ]
    svc = Service(list=lambda **k: {"items": events})
    r = gc.import_external_classes_for_teacher(tp, svc, "primary", db, lo, hi)
    db.commit()
    assert r["new_count"] == 2
    # segunda corrida con un cambio y una cancelación
    events[0]["summary"] = "Preply cambiada"
    events.pop(1)
    r2 = gc.import_external_classes_for_teacher(tp, svc, "primary", db, lo, hi)
    db.commit()
    assert r2["updated_count"] == 1 and r2["cancelled_count"] == 1
    # reaparece la cancelada: se reactiva
    events.append(ev("e2", start=fmt(s1 + timedelta(days=1)), end=fmt(s1 + timedelta(days=1, hours=1)), location="https://zoom.us/j/1"))
    r3 = gc.import_external_classes_for_teacher(tp, svc, "primary", db, lo, hi)
    assert r3["updated_count"] == 1


# ── crear / actualizar / borrar eventos ──────────────────────────────────────────────────
def test_create_update_delete_events():
    from datetime import datetime
    a, b = datetime(2030, 1, 1, 10), datetime(2030, 1, 1, 11)
    seen = {}
    svc = Service(insert=lambda **k: seen.update(k) or {"id": "ev1", "hangoutLink": "https://meet.google.com/z"})
    assert gc.create_calendar_event(svc, "primary", "T", a, b, meet_link="https://m", attendee_emails=["a@b.com"]) == "ev1"
    assert seen["body"]["location"] == "https://m" and seen["body"]["attendees"]
    assert gc.create_calendar_event(Service(insert=raiser(http_error(500))), "primary", "T", a, b) is None
    assert gc.create_calendar_event_with_meet(svc, "primary", "T", a, b, attendee_emails=["a@b.com"]) == ("ev1", "https://meet.google.com/z")
    assert gc.create_calendar_event_with_meet(Service(insert=raiser(http_error(500))), "primary", "T", a, b) == (None, None)
    assert gc._extract_meet_link({"conferenceData": {"entryPoints": [{"entryPointType": "phone"}, {"entryPointType": "video", "uri": "https://v"}]}}) == "https://v"
    assert gc._extract_meet_link({}) is None
    assert gc._build_attendees(None) is None

    ev_ok = {"id": "ev1", "start": {}, "end": {}}
    upd = Service(get=lambda **k: dict(ev_ok), update=lambda **k: {"id": "ev1"})
    assert gc.update_calendar_event(upd, "primary", "ev1", start_utc=a, end_utc=b, meet_link="https://m", attendee_emails=["a@b.com"]) is True
    assert gc.update_calendar_event(Service(get=raiser(http_error(404))), "primary", "ev1") is False
    with pytest.raises(HttpError):
        gc.update_calendar_event(Service(get=raiser(http_error(500))), "primary", "ev1")
    assert gc.update_calendar_event(Service(get=lambda **k: {"status": "cancelled"}), "primary", "ev1") is False
    gone = Service(get=lambda **k: dict(ev_ok), update=raiser(http_error(410)))
    assert gc.update_calendar_event(gone, "primary", "ev1") is False
    bad = Service(get=lambda **k: dict(ev_ok), update=raiser(http_error(500)))
    with pytest.raises(HttpError):
        gc.update_calendar_event(bad, "primary", "ev1")

    assert gc.delete_calendar_event(Service(delete={}), "primary", "ev1") is True
    assert gc.delete_calendar_event(Service(delete=raiser(http_error(410))), "primary", "ev1") is True
    assert gc.delete_calendar_event(Service(delete=raiser(http_error(500))), "primary", "ev1") is False


def test_add_meet_to_event():
    ev0 = {"id": "e", "status": "confirmed"}
    assert gc.add_meet_conference_to_event(Service(get=raiser(http_error(404))), "primary", "e") is None
    assert gc.add_meet_conference_to_event(Service(get=raiser(http_error(500))), "primary", "e") is None
    assert gc.add_meet_conference_to_event(Service(get={"status": "cancelled"}), "primary", "e") is None
    assert gc.add_meet_conference_to_event(Service(get={"hangoutLink": "https://ya"}), "primary", "e") == "https://ya"
    ok = Service(get=lambda **k: dict(ev0), update=lambda **k: {"hangoutLink": "https://nuevo"})
    assert gc.add_meet_conference_to_event(ok, "primary", "e", attendee_emails=["a@b.com"]) == "https://nuevo"
    fail = Service(get=lambda **k: dict(ev0), update=raiser(http_error(500)))
    assert gc.add_meet_conference_to_event(fail, "primary", "e") is None


# ── sincronización completa ──────────────────────────────────────────────────────────────
def patch_service(monkeypatch, svc):
    monkeypatch.setattr(gc, "get_calendar_service_for_token", lambda t, d: svc)


def test_sync_logic_guards(world, db, monkeypatch):
    assert gc.sync_calendar_logic(world["tp"].id, db)["ok"] is False  # sin token
    t = mk_token(db, world, needs_reauth=True)
    assert "reconectar" in gc.sync_calendar_logic(world["tp"].id, db)["message"]
    t.needs_reauth = False
    db.commit()
    patch_service(monkeypatch, None)
    assert gc.sync_calendar_logic(world["tp"].id, db)["ok"] is False


def test_sync_logic_creates_updates_and_deletes(world, db, monkeypatch):
    mk_token(db, world)
    new = mk_class(db, world, hours=30, status="confirmed")
    known = mk_class(db, world, hours=60, status="confirmed")
    known.google_event_id = "old"
    known.google_sync_hash = "viejo"
    gone = mk_class(db, world, hours=70, status="confirmed")
    gone.google_event_id = "borrado"
    cancelled = mk_class(db, world, hours=80, status="cancelled")
    cancelled.google_event_id = "para-borrar"
    unchanged = mk_class(db, world, hours=90, status="confirmed")
    ignored = mk_class(db, world, hours=100, status="completed")
    db.commit()

    def get(eventId=None, **k):
        if eventId == "borrado":
            raise http_error(404)
        return {"id": eventId, "start": {}, "end": {}}

    import itertools
    ids = itertools.count()
    svc = Service(freebusy={"calendars": {"primary": {"busy": []}}}, list={"items": []}, insert=lambda **k: {"id": "nuevo-%d" % next(ids)},
                  get=get, update={}, delete={})
    patch_service(monkeypatch, svc)
    r = gc.sync_calendar_logic(world["tp"].id, db)
    assert r["ok"] is True and r["updated_count"] == 1 and r["deleted_count"] == 1 and r["new_count"] >= 3
    # una segunda corrida no cambia nada (huella igual): cero llamadas
    r2 = gc.sync_calendar_logic(world["tp"].id, db)
    assert r2["skipped_count"] >= 1


def test_sync_logic_error_kinds(world, db, monkeypatch):
    tok = mk_token(db, world)
    mk_class(db, world, hours=30, status="confirmed")
    base = dict(freebusy={"calendars": {}}, list={"items": []})
    patch_service(monkeypatch, Service(insert=raiser(http_error(429)), **base))
    r = gc.sync_calendar_logic(world["tp"].id, db)
    assert r["error_count"] == 1  # create_calendar_event devuelve None
    # permiso denegado al actualizar
    c = db.query(Class).first()
    c.google_event_id = "x"
    c.google_sync_hash = "viejo"
    db.commit()
    patch_service(monkeypatch, Service(get=raiser(http_error(403, ["forbidden"])), **base))
    assert gc.sync_calendar_logic(world["tp"].id, db)["ok"] is False
    assert "403" in tok.last_error
    # cuota agotada
    patch_service(monkeypatch, Service(get=raiser(http_error(429)), **base))
    gc.sync_calendar_logic(world["tp"].id, db)
    # el mensaje de cuota se borra al final porque error_count queda en 0 (ver KNOWN_ISSUES)
    assert tok.last_error is None
    # error genérico de Google y error inesperado
    patch_service(monkeypatch, Service(get=raiser(http_error(500)), **base))
    assert gc.sync_calendar_logic(world["tp"].id, db)["error_count"] == 1
    patch_service(monkeypatch, Service(get=raiser(RuntimeError("raro")), **base))
    assert gc.sync_calendar_logic(world["tp"].id, db)["error_count"] == 1


def test_sync_logic_survives_failing_phases(world, db, monkeypatch):
    mk_token(db, world)
    patch_service(monkeypatch, Service(freebusy={"calendars": {}}, list={"items": []}))
    monkeypatch.setattr(gc, "get_busy_ranges", raiser(RuntimeError("fase A")))
    monkeypatch.setattr(gc, "import_external_classes_for_teacher", raiser(RuntimeError("fase A.2")))
    assert gc.sync_calendar_logic(world["tp"].id, db)["ok"] is True


def test_sync_all_teachers(world, db, monkeypatch):
    assert gc._teachers_needing_sync(db, [], utc_now()) == []
    t = mk_token(db, world, last_synced_at=utc_now().replace(tzinfo=None))
    assert gc._teachers_needing_sync(db, [t], utc_now()) == []  # sincronizado hace poco y sin clases próximas
    mk_class(db, world, hours=1, status="confirmed")
    assert gc._teachers_needing_sync(db, [t], utc_now()) == [t]
    monkeypatch.setattr(gc, "sync_calendar_logic", lambda tid, d: {"ok": True})
    assert gc.run_calendar_sync_for_all_teachers(db)["teachers_synced"] == 1
    monkeypatch.setattr(gc, "sync_calendar_logic", raiser(RuntimeError("falla")))
    assert gc.run_calendar_sync_for_all_teachers(db)["results"][0]["ok"] is False
