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


def test_register_race_on_unique_index_returns_400(client, monkeypatch):
    """Dos registros simultáneos pasan la comprobación previa; el índice único rechaza al segundo -> 400, no 500."""
    from sqlalchemy.exc import IntegrityError
    from sqlalchemy.orm import Session

    def boom(self, *a, **k):
        raise IntegrityError("INSERT", {}, Exception("duplicate key"))

    monkeypatch.setattr(Session, "flush", boom)
    r = client.post(f"{API}/auth/register", json={
        "username": "carrera_1", "email": "carrera1@x.com", "password": "Password123",
        "name": "Ca", "surname": "Rr", "role": "student",
    })
    assert r.status_code == 400 and "registrado" in r.json()["detail"]


def test_mark_read_survives_simultaneous_first_open(db, world):
    """Dos /read simultáneos de un hilo sin estado de lectura: el segundo no debe romper por la fila única."""
    from app.core.chat import mark_read
    from app.models.chat import ChatConversation, ChatConversationType, ChatReadState

    convo = ChatConversation(conversation_type=ChatConversationType.direct, teacher_id=world["tp"].id,
                             student_id=world["sp"].id)
    db.add(convo)
    db.commit()
    user = world["s_user"]
    # Otra petición ya creó la fila entre la comprobación y el commit de ésta.
    real_query = db.query
    calls = {"n": 0}

    class _Blind:
        def __init__(self, q): self.q = q
        def filter(self, *a, **k): return _Blind(self.q.filter(*a, **k))
        def first(self):
            calls["n"] += 1
            return None if calls["n"] == 1 else self.q.first()

    db.add(ChatReadState(conversation_id=convo.id, user_id=user.id, last_read_at=convo.created_at))
    db.commit()
    db.query = lambda m, *a, **k: _Blind(real_query(m, *a, **k)) if m is ChatReadState else real_query(m, *a, **k)
    try:
        mark_read(db, convo, user)  # no debe lanzar IntegrityError
    finally:
        db.query = real_query
    assert db.query(ChatReadState).filter_by(conversation_id=convo.id, user_id=user.id).count() == 1
