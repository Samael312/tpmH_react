"""Rutas que faltaban en el inventario: `GET /calendar/auth-url`, `POST /calendar/sync` y `POST /ai-tools/analyze-test-failure`.

Google y Gemini van simulados: ninguna prueba toca la red.
"""
from tests.audit.conftest import hdr
from tests.audit.helpers import API
from app.api.v1.endpoints import ai_debug
from app.core import google_calendar as gc
from app.core.config import settings
from app.models.google_calendar import GoogleCalendarToken


def _token(db, w, **kw):
    t = GoogleCalendarToken(user_id=w["t_user"].id, teacher_id=w["tp"].id, access_token="tok", refresh_token="ref", **kw)
    db.add(t)
    db.commit()
    return t


# ── GET /calendar/auth-url ───────────────────────────────────────────────────────────────
def test_auth_url_teacher_only(client, world):
    r = client.get(f"{API}/calendar/auth-url", headers=hdr(world["t_user"]))
    assert r.status_code == 200
    url = r.json()["auth_url"]
    assert "accounts.google.com" in url and "state=" in url
    assert client.get(f"{API}/calendar/auth-url", headers=hdr(world["s_user"])).status_code == 403
    assert client.get(f"{API}/calendar/auth-url").status_code in (401, 403)


# ── POST /calendar/sync ──────────────────────────────────────────────────────────────────
def test_manual_sync_paths(client, world, db, monkeypatch):
    h = hdr(world["t_user"])
    assert client.post(f"{API}/calendar/sync", headers=h).status_code == 404  # no conectado
    tok = _token(db, world)
    monkeypatch.setattr("app.api.v1.endpoints.calendar.sync_calendar_logic", lambda tid, db_: {"ok": True, "tid": tid})
    r = client.post(f"{API}/calendar/sync", headers=h)
    assert r.status_code == 200 and r.json() == {"ok": True, "tid": world["tp"].id}
    tok.needs_reauth = True
    db.commit()
    assert client.post(f"{API}/calendar/sync", headers=h).status_code == 409
    assert client.post(f"{API}/calendar/sync", headers=hdr(world["s_user"])).status_code == 403


# ── POST /ai-tools/analyze-test-failure ──────────────────────────────────────────────────
BODY = dict(test_name="t", method="GET", path="/x", description="d", http_status=500, failed_assertions=["a"])


class _Resp:
    def __init__(self, payload):
        self._p = payload

    def json(self):
        return self._p


def _fake_httpx(payload=None, boom=None):
    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None):
            if boom:
                raise boom
            return _Resp(payload)

    return _Client


def test_analyze_failure_permissions_and_config(client, world, monkeypatch):
    url = f"{API}/ai-tools/analyze-test-failure"
    assert client.post(url, json=BODY, headers=hdr(world["s_user"])).status_code == 403
    assert client.post(url, json=BODY).status_code in (401, 403)
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")
    assert client.post(url, json=BODY, headers=hdr(world["admin"])).status_code == 503


def test_analyze_failure_success_and_errors(client, world, monkeypatch):
    url = f"{API}/ai-tools/analyze-test-failure"
    h = hdr(world["admin"])
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "k")
    ok = {"candidates": [{"content": {"parts": [{"text": '```json\n{"root_cause":"rc","issues":["i"],"fix":["f"]}\n```'}]}}]}
    monkeypatch.setattr(ai_debug.httpx, "AsyncClient", _fake_httpx(ok))
    r = client.post(url, json=BODY, headers=h)
    assert r.status_code == 200 and r.json() == {"root_cause": "rc", "issues": ["i"], "fix": ["f"]}
    # respuesta que no es JSON -> 502 sin filtrar detalles
    bad = {"candidates": [{"content": {"parts": [{"text": "no soy json"}]}}]}
    monkeypatch.setattr(ai_debug.httpx, "AsyncClient", _fake_httpx(bad))
    r = client.post(url, json=BODY, headers=h)
    assert r.status_code == 502 and "no soy json" not in r.text
    # fallo de red
    monkeypatch.setattr(ai_debug.httpx, "AsyncClient", _fake_httpx(boom=RuntimeError("red caída")))
    assert client.post(url, json=BODY, headers=h).status_code == 502
