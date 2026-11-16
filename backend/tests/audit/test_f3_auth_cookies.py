"""Fase 3b — SEC-05: sesión por cookies HttpOnly + refresh con rotación.

Secciones: límite · combinatoria · invariantes · integración de API.
"""
from datetime import timedelta

import pytest

from tests.audit.conftest import _mk_user
from tests.audit.helpers import API
from app.auth.jwt import create_access_token
from app.auth.session import ACCESS_COOKIE, REFRESH_COOKIE, SESSION_COOKIE, hash_token
from app.core.timezone import utc_now
from app.models.refresh_token import RefreshToken


def register(client, email="c1@x.com", username="cook1"):
    return client.post(f"{API}/auth/register", json={
        "email": email, "username": username, "password": "Password123",
        "name": "N", "surname": "U", "role": "student"})


def login(client, login="cook1"):
    return client.post(f"{API}/auth/login", json={"login": login, "password": "Password123"})


@pytest.fixture
def user(client):
    assert register(client).status_code == 200
    client.post(f"{API}/auth/logout")  # cierra la sesión creada por el registro: cada test parte sin tokens activos
    client.cookies.clear()
    return "cook1"


# ═══ INTEGRACIÓN ═══════════════════════════════════════════════════════════

def test_login_sets_httponly_cookies(client, user):
    r = login(client)
    assert r.status_code == 200
    raw = r.headers.get_list("set-cookie")
    for name in (ACCESS_COOKIE, REFRESH_COOKIE, SESSION_COOKIE):
        line = next(c for c in raw if c.startswith(name + "="))
        assert "HttpOnly" in line and "samesite=lax" in line.lower()
    refresh = next(c for c in raw if c.startswith(REFRESH_COOKIE + "="))
    assert "Path=/api/v1/auth" in refresh
    assert r.json()["user_id"]


def test_cookie_authenticates_without_bearer(client, user):
    login(client)
    assert client.get(f"{API}/users/me").status_code == 200  # solo cookie


def test_bearer_still_works(client, user):
    token = login(client).json()["access_token"]
    client.cookies.clear()
    r = client.get(f"{API}/users/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200


def test_no_credentials_is_401(client):
    assert client.get(f"{API}/users/me").status_code == 401


def test_refresh_rotates_and_old_token_rejected(client, user):
    login(client)
    old = client.cookies.get(REFRESH_COOKIE, path="/api/v1/auth")
    assert client.post(f"{API}/auth/refresh").status_code == 200
    new = client.cookies.get(REFRESH_COOKIE, path="/api/v1/auth")
    assert new and new != old


def test_refresh_reuse_after_grace_revokes_family(client, db, user):
    login(client)
    old = client.cookies.get(REFRESH_COOKIE, path="/api/v1/auth")
    assert client.post(f"{API}/auth/refresh").status_code == 200
    # envejece la revocación del token viejo fuera de la ventana de gracia
    rec = db.query(RefreshToken).filter(RefreshToken.token_hash == hash_token(old)).one()
    rec.revoked_at = utc_now() - timedelta(minutes=5)
    db.commit()
    client.cookies.clear()
    assert client.post(f"{API}/auth/refresh", headers={"Cookie": f"{REFRESH_COOKIE}={old}"}).status_code == 401
    db.expire_all()
    assert db.query(RefreshToken).filter(RefreshToken.revoked_at.is_(None)).count() == 0


def test_refresh_reuse_inside_grace_is_accepted(client, user):
    login(client)
    old = client.cookies.get(REFRESH_COOKIE, path="/api/v1/auth")
    assert client.post(f"{API}/auth/refresh").status_code == 200
    client.cookies.clear()
    assert client.post(f"{API}/auth/refresh", headers={"Cookie": f"{REFRESH_COOKIE}={old}"}).status_code == 200  # dos pestañas a la vez


def test_refresh_without_cookie_401(client):
    assert client.post(f"{API}/auth/refresh").status_code == 401


def test_expired_refresh_rejected(client, db, user):
    login(client)
    rec = db.query(RefreshToken).filter(RefreshToken.revoked_at.is_(None)).one()
    rec.expires_at = utc_now() - timedelta(seconds=1)
    db.commit()
    assert client.post(f"{API}/auth/refresh").status_code == 401


def test_logout_revokes_and_clears(client, db, user):
    login(client)
    assert client.post(f"{API}/auth/logout").status_code == 200
    db.expire_all()
    assert db.query(RefreshToken).filter(RefreshToken.revoked_at.is_(None)).count() == 0
    assert client.post(f"{API}/auth/refresh").status_code == 401


def test_logout_without_session_ok(client):
    assert client.post(f"{API}/auth/logout").status_code == 200


def test_foreign_origin_with_cookies_blocked(client, user):
    login(client)
    r = client.post(f"{API}/auth/logout", headers={"Origin": "https://evil.example"})
    assert r.status_code == 403
    ok = client.post(f"{API}/auth/logout", headers={"Origin": "http://localhost:3000"})
    assert ok.status_code == 200


def test_foreign_origin_with_bearer_not_blocked(client, user):
    token = login(client).json()["access_token"]
    client.cookies.clear()
    r = client.post(f"{API}/auth/logout", headers={"Origin": "https://evil.example", "Authorization": f"Bearer {token}"})
    assert r.status_code == 200


def test_refresh_token_type_is_not_an_access_token(client):
    from app.auth.jwt import create_oauth_state
    r = client.get(f"{API}/users/me", headers={"Cookie": f"{ACCESS_COOKIE}={create_oauth_state(1)}"})
    assert r.status_code == 401


def test_change_password_revokes_other_sessions(client, db, user):
    login(client)
    other = RefreshToken  # sesión de otro dispositivo
    r1 = client.post(f"{API}/auth/refresh")  # misma familia; creamos un 2º login "otro dispositivo"
    assert r1.status_code == 200
    c2_cookies = dict(client.cookies)
    client.cookies.clear()
    login(client)
    n_before = db.query(other).filter(other.revoked_at.is_(None)).count()
    assert n_before >= 2
    r = client.post(f"{API}/users/me/change-password",
                    json={"current_password": "Password123", "new_password": "NuevaPass123"})
    assert r.status_code == 200, r.text
    db.expire_all()
    active = db.query(other).filter(other.revoked_at.is_(None)).count()
    assert active == 1  # solo la sesión actual, con cookies nuevas
    assert c2_cookies is not None
    assert client.get(f"{API}/users/me").status_code == 200


def test_register_sets_cookies(client):
    r = register(client, "c2@x.com", "cook2")
    assert any(c.startswith(ACCESS_COOKIE + "=") for c in r.headers.get_list("set-cookie"))


def test_inactive_user_cannot_refresh(client, db, user):
    from app.models.user import User
    login(client)
    u = db.query(User).filter(User.username == "cook1").one()
    u.is_active = False
    db.commit()
    assert client.post(f"{API}/auth/refresh").status_code == 401


def test_only_hash_is_stored(client, db, user):
    login(client)
    raw = client.cookies.get(REFRESH_COOKIE, path="/api/v1/auth")
    rec = db.query(RefreshToken).filter(RefreshToken.revoked_at.is_(None)).one()
    assert rec.token_hash == hash_token(raw) and rec.token_hash != raw
