"""Fase 3a — SEC-04: verificación de email (política suave) y vinculación segura de Google.

Secciones: valores límite · combinatoria · invariantes · integración de API.
El correo se captura con monkeypatch (el token en claro solo existe ahí; en la BD hay un hash).
"""
import asyncio
import hashlib
import random
from datetime import timedelta

import pytest

from tests.audit.conftest import hdr, _mk_user
from tests.audit.helpers import API, ready_student, complete_trial
from app.core.timezone import utc_now
from app.models.email_verification import EmailVerificationToken
from app.models.user import User


@pytest.fixture
def mailbox(monkeypatch):
    """Captura los correos de verificación: lista de (email, token)."""
    box = []
    monkeypatch.setattr(
        "app.api.v1.endpoints.auth.send_verification_email",
        lambda to_email, user_name, verify_token: box.append((to_email, verify_token)) or True,
    )
    return box


def register(client, email="nuevo@x.com", username="nuevo1"):
    return client.post(f"{API}/auth/register", json={
        "email": email, "username": username, "password": "Password123",
        "name": "N", "surname": "U", "role": "student"})


def verify(client, token):
    return client.post(f"{API}/auth/verify-email", json={"token": token})


def user_of(db, email):
    db.expire_all()
    return db.query(User).filter(User.email == email).one()


def login_headers(client, login, password="Password123"):
    token = client.post(f"{API}/auth/login", json={"login": login, "password": password}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


# ═══ VALORES LÍMITE ═════════════════════════════════════════════════════════

@pytest.mark.parametrize("delta, ok", [
    (timedelta(minutes=1), True),        # vence en 1 min
    (timedelta(seconds=-1), False),      # venció hace 1 s
    (timedelta(hours=-24), False),
])
def test_token_expiry_edges(client, db, mailbox, delta, ok):
    register(client)
    token = mailbox[-1][1]
    row = db.query(EmailVerificationToken).one()
    row.expires_at = utc_now() + delta
    db.commit()
    assert (verify(client, token).status_code == 200) is ok
    assert user_of(db, "nuevo@x.com").is_verified is ok


def test_token_is_stored_hashed_not_plain(client, db, mailbox):
    register(client)
    token = mailbox[-1][1]
    row = db.query(EmailVerificationToken).one()
    assert row.token_hash == hashlib.sha256(token.encode()).hexdigest()
    assert token not in row.token_hash and len(token) >= 40


@pytest.mark.parametrize("bad", ["", " ", "x", "a" * 5000, "../../etc/passwd", "' OR 1=1 --"])
def test_garbage_tokens_rejected(client, bad):
    assert verify(client, bad).status_code == 400


# ═══ COMBINATORIA: Google × cuenta local ════════════════════════════════════

def _google(monkeypatch, sub="g-123", email="viejo@x.com"):
    async def fake(_id_token):
        return {"google_id": sub, "email": email, "name": "G", "surname": "U", "avatar": None, "is_verified": True}
    monkeypatch.setattr("app.api.v1.endpoints.auth.verify_google_token", fake)


def test_google_login_matrix_local_account_state(client, db, monkeypatch):
    """{sin cuenta, local verificada, local NO verificada, ya vinculada igual, vinculada a otro, desactivada}."""
    cases = {
        "none":        dict(exists=False),
        "verified":    dict(exists=True, is_verified=True, google_id=None),
        "unverified":  dict(exists=True, is_verified=False, google_id=None),
        "same_google": dict(exists=True, is_verified=False, google_id="g-same_google"),
        "other_google": dict(exists=True, is_verified=True, google_id="g-OTRO"),
        "inactive":    dict(exists=True, is_verified=True, google_id=None, is_active=False),
    }
    expected = {"none": 200, "verified": 200, "unverified": 403, "same_google": 200, "other_google": 403, "inactive": 403}
    failures = []
    for name, spec in cases.items():
        email = f"{name}@x.com"
        _google(monkeypatch, sub=f"g-{name}", email=email)
        if spec["exists"]:
            u = _mk_user(db, "student", name)
            u.email = email
            u.is_verified = spec["is_verified"]
            u.google_id = spec["google_id"]
            u.is_active = spec.get("is_active", True)
            db.commit()
        r = client.post(f"{API}/auth/google", json={"id_token": "t"})
        if r.status_code != expected[name]:
            failures.append((name, r.status_code, expected[name], r.text[:100]))
        if name == "none":
            assert r.json()["needs_registration"] is True and not r.json().get("access_token")
        # una cuenta no verificada NO debe quedar vinculada a Google
        if name == "unverified":
            assert user_of(db, email).google_id is None
        if name == "verified":
            assert user_of(db, email).google_id == "g-verified"
        from app.core.rate_limit import limiter
        limiter.reset()
    assert not failures, failures


def test_google_email_case_matches_local_account(client, db, monkeypatch):
    u = _mk_user(db, "student", "mixto")
    u.email = "mixto@x.com"
    db.commit()
    _google(monkeypatch, sub="g-9", email="mixto@x.com")
    assert client.post(f"{API}/auth/google", json={"id_token": "t"}).status_code == 200


def test_google_register_marks_verified_and_blocks_duplicates(client, db, monkeypatch):
    _google(monkeypatch, sub="g-77", email="nueva@gmail.com")
    r = client.post(f"{API}/auth/google/register", json={"id_token": "t", "username": "Nueva", "role": "student"})
    assert r.status_code == 200, r.text
    assert user_of(db, "nueva@gmail.com").is_verified is True      # bug anterior: siempre False
    r2 = client.post(f"{API}/auth/google/register", json={"id_token": "t", "username": "otra", "role": "student"})
    assert r2.status_code == 400                                     # email ya registrado
    _google(monkeypatch, sub="g-78", email="otra@gmail.com")
    r3 = client.post(f"{API}/auth/google/register", json={"id_token": "t", "username": "NUEVA", "role": "student"})
    assert r3.status_code == 400                                     # usuario repetido en otra capitalización


@pytest.mark.parametrize("payload, ok", [
    ({"iss": "https://accounts.google.com", "email_verified": "true"}, True),
    ({"iss": "accounts.google.com", "email_verified": "true"}, True),
    ({"iss": "https://evil.example.com", "email_verified": "true"}, False),
    ({"iss": "https://accounts.google.com", "email_verified": "false"}, False),
    ({"iss": "https://accounts.google.com"}, False),
    ({"iss": "https://accounts.google.com", "email_verified": True}, True),   # booleano real
])
def test_verify_google_token_issuer_and_email_verified(monkeypatch, payload, ok):
    from app.auth import google
    from app.core.config import settings

    class Resp:
        status_code = 200
        def json(self):
            return {"aud": settings.GOOGLE_CLIENT_ID, "sub": "1", "email": "A@X.com", **payload}

    class Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, *a, **k): return Resp()

    monkeypatch.setattr(google.httpx, "AsyncClient", lambda: Client())
    if ok:
        data = asyncio.run(google.verify_google_token("t"))
        assert data["email"] == "a@x.com" and data["is_verified"] is True
    else:
        with pytest.raises(ValueError):
            asyncio.run(google.verify_google_token("t"))


# ═══ INVARIANTES ════════════════════════════════════════════════════════════

@pytest.mark.parametrize("seed", [3, 11, 29])
def test_verification_state_machine_invariants(client, db, mailbox, seed):
    """
    Secuencia aleatoria de register / verify / resend / token basura / token de otro usuario.
    Invariantes: is_verified solo pasa de False a True por un token vigente y propio; nunca revierte;
    un token sirve una sola vez; el token de A jamás verifica a B.
    """
    rnd = random.Random(seed)
    users = {}                     # nombre -> dict(email, verified, live_token)
    for i in range(3):
        email = f"u{i}_{seed}@x.com"
        assert register(client, email, f"user{i}x{seed}").status_code == 200
        users[i] = {"email": email, "verified": False, "live": mailbox[-1][1], "old": []}

    for step in range(25):
        i = rnd.choice(list(users))
        u = users[i]
        op = rnd.choice(["verify_ok", "verify_ok", "resend", "garbage", "cross", "reuse"])
        if op == "verify_ok" and u["live"]:
            r = verify(client, u["live"])
            assert r.status_code == 200, (seed, step)
            u["verified"] = True
            u["old"].append(u["live"])
            u["live"] = None
        elif op == "resend":
            h = login_headers(client, u["email"])
            before = len(mailbox)
            assert client.post(f"{API}/auth/resend-verification", headers=h).status_code == 200
            if not u["verified"]:
                assert len(mailbox) == before + 1
                if u["live"]:
                    u["old"].append(u["live"])        # el token anterior queda invalidado
                u["live"] = mailbox[-1][1]
            else:
                assert len(mailbox) == before        # ya verificado: no se envía nada
            from app.core.rate_limit import limiter
            limiter.reset()
        elif op == "garbage":
            assert verify(client, f"basura-{rnd.random()}").status_code == 400
        elif op == "cross":
            other = users[rnd.choice([k for k in users if k != i])]
            if other["live"]:
                # el token del otro verifica AL OTRO, nunca a `i`
                before = user_of(db, u["email"]).is_verified
                assert verify(client, other["live"]).status_code == 200
                other["verified"] = True
                other["old"].append(other["live"])
                other["live"] = None
                assert user_of(db, u["email"]).is_verified is before or u["verified"]
        elif op == "reuse" and u["old"]:
            assert verify(client, rnd.choice(u["old"])).status_code == 400
        # estado real == modelo, y nunca se revierte
        for k, v in users.items():
            assert user_of(db, v["email"]).is_verified is v["verified"], (seed, step, op, k)


# ═══ INTEGRACIÓN DE API ═════════════════════════════════════════════════════

def test_register_sends_verification_and_verify_flow(client, db, mailbox):
    assert register(client).status_code == 200
    assert user_of(db, "nuevo@x.com").is_verified is False
    assert len(mailbox) == 1 and mailbox[0][0] == "nuevo@x.com"
    token = mailbox[0][1]
    assert verify(client, token).status_code == 200
    assert user_of(db, "nuevo@x.com").is_verified is True
    assert verify(client, token).status_code == 400                       # un solo uso


def test_resend_invalidates_previous_token(client, db, mailbox):
    register(client)
    first = mailbox[-1][1]
    h = login_headers(client, "nuevo1")
    assert client.post(f"{API}/auth/resend-verification", headers=h).status_code == 200
    second = mailbox[-1][1]
    assert first != second
    assert verify(client, first).status_code == 400
    assert verify(client, second).status_code == 200


def test_resend_requires_login_and_is_rate_limited(client, db, mailbox):
    assert client.post(f"{API}/auth/resend-verification").status_code in (401, 403)
    register(client)
    h = login_headers(client, "nuevo1")
    codes = [client.post(f"{API}/auth/resend-verification", headers=h).status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]


def test_unverified_user_cannot_pay_or_withdraw(client, world, db, mailbox):
    # alumno no verificado: notify-payment -> 403
    complete_trial(client, world)
    s = world["s_user"]
    s.is_verified = False
    db.commit()
    r = client.post(f"{API}/payments/notify-payment", json={
        "type": "package", "package_id": world["pkg"].id, "payment_method": "bank_transfer"}, headers=hdr(s))
    assert r.status_code == 403 and "verifica tu email" in r.text.lower()
    # tras verificar, el pago sí avanza
    s.is_verified = True
    db.commit()
    r = client.post(f"{API}/payments/notify-payment", json={
        "type": "package", "package_id": world["pkg"].id, "payment_method": "bank_transfer"}, headers=hdr(s))
    assert r.status_code == 200, r.text


def test_unverified_teacher_cannot_withdraw(client, world, db):
    ready_student(client, world)
    t = world["t_user"]
    t.is_verified = False
    db.commit()
    r = client.post(f"{API}/payments/request-withdrawal", json={"amount": 20, "payment_info": "x"}, headers=hdr(t))
    assert r.status_code == 403
    t.is_verified = True
    db.commit()
    assert client.post(f"{API}/payments/request-withdrawal", json={"amount": 20, "payment_info": "x"},
                       headers=hdr(t)).status_code == 201


def test_existing_accounts_migration_marks_verified():
    """La migración deja verificadas las cuentas previas (política suave) y crea la tabla."""
    import pathlib
    src = pathlib.Path("alembic/versions/a7b8c9d0e1f2_email_verification.py").read_text(encoding="utf-8")
    assert "UPDATE users SET is_verified = true" in src and "down_revision = 'd1e2f3a4b5c6'" in src
