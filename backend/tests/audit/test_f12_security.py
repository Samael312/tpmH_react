"""Fase 12, tanda 3 — seguridad: tope de contraseña, login sin enumeración por tiempo, clave de límite por cookie, cabeceras."""
from datetime import timedelta

from tests.audit.conftest import hdr, _mk_user
from tests.audit.helpers import API


def test_reset_and_change_password_have_max_length(client, db):
    r = client.post(f"{API}/auth/reset-password", json={"token": "x", "new_password": "a" * 129})
    assert r.status_code == 422
    u = _mk_user(db, "student", "sec12user")
    db.commit()
    r = client.post(f"{API}/users/me/change-password", headers=hdr(u),
                    json={"current_password": "x", "new_password": "a" * 129})
    assert r.status_code == 422


def test_login_unknown_user_runs_password_check(client, monkeypatch):
    calls = {"n": 0}
    monkeypatch.setattr("app.api.v1.endpoints.auth.burn_password_check", lambda p: calls.__setitem__("n", calls["n"] + 1))
    r = client.post(f"{API}/auth/login", json={"login": "no-existe-zzz", "password": "Whatever1"})
    assert r.status_code == 401 and calls["n"] == 1


def test_rate_limit_key_uses_cookie_session():
    from starlette.requests import Request
    from app.auth.jwt import create_access_token
    from app.auth.session import ACCESS_COOKIE
    from app.core.rate_limit import user_or_ip_key
    tok = create_access_token(7, "student")
    scope = {"type": "http", "headers": [(b"cookie", f"{ACCESS_COOKIE}={tok}".encode())], "client": ("1.2.3.4", 1)}
    assert user_or_ip_key(Request(scope)) == "user:7"


def test_security_headers_present(client):
    r = client.get("/")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"


# ─── A1: bloqueo por cuenta tras logins fallidos ───
from app.core.config import settings  # noqa: E402
from app.core.timezone import utc_now  # noqa: E402
from app.models.user import User  # noqa: E402


def _login(client, username, password):
    return client.post(f"{API}/auth/login", json={"login": username, "password": password})


def test_account_locks_after_max_failures_and_blocks_correct_password(client, db):
    _mk_user(db, "student", "lockme")
    db.commit()
    for _ in range(settings.LOGIN_MAX_FAILED):
        assert _login(client, "lockme", "mala-clave-1").status_code == 401
    r = _login(client, "lockme", "Password123")  # la correcta tampoco entra mientras dure el bloqueo
    assert r.status_code == 429
    assert "tpm_access" not in r.cookies


def test_lock_expires_and_success_resets_counter(client, db):
    u = _mk_user(db, "student", "lockexp")
    db.commit()
    for _ in range(settings.LOGIN_MAX_FAILED):
        _login(client, "lockexp", "mala-clave-1")
    u = db.query(User).filter(User.username == "lockexp").one()
    assert u.locked_until is not None
    u.locked_until = utc_now() - timedelta(seconds=1)  # plazo vencido
    db.commit()
    assert _login(client, "lockexp", "Password123").status_code == 200
    db.expire_all()
    u = db.query(User).filter(User.username == "lockexp").one()
    assert u.failed_login_count == 0 and u.locked_until is None


def test_failures_below_threshold_do_not_lock_and_success_clears(client, db):
    _mk_user(db, "student", "lockfew")
    db.commit()
    for _ in range(settings.LOGIN_MAX_FAILED - 1):
        assert _login(client, "lockfew", "mala-clave-1").status_code == 401
    assert _login(client, "lockfew", "Password123").status_code == 200
    db.expire_all()
    assert db.query(User).filter(User.username == "lockfew").one().failed_login_count == 0
