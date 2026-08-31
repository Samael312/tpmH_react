"""
Suite: Autenticación.

`auth-register-*` prueban el registro público real (POST /auth/register),
así que a propósito NO usan los usuarios fijos — crean una cuenta efímera
propia y la borran en el teardown (es lo único, en esta suite, donde
"usuario" también es un dato volátil: estamos probando el registro en sí).
"""
import uuid

import pytest

from app.models.user import User
from tests.flow.conftest import auth_headers

pytestmark = pytest.mark.integration


def test_health_check(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_register_and_login_student(client, volatile):
    suffix = uuid.uuid4().hex[:8]
    email = f"flowtest.ephemeral.{suffix}@tpmh.internal"
    username = f"flowtest_eph_{suffix}"

    r = client.post("/api/v1/auth/register", json={
        "name": "Efímero", "surname": "Test", "username": username,
        "email": email, "password": "TestPass123!", "role": "student",
    })
    assert r.status_code in (200, 201), r.text
    body = r.json()
    assert body.get("access_token")
    assert body.get("role") == "student"

    # Borra al usuario efímero recién creado (cascada limpia su student_profile).
    volatile.db_query(User, email=email, label=f"registro efímero {email}")

    r = client.post("/api/v1/auth/login", json={"login": email, "password": "TestPass123!"})
    assert r.status_code == 200, r.text
    assert r.json().get("access_token")


def test_register_rejects_duplicate_email(client, fixed_users):
    """El estudiante fijo ya existe: registrarlo de nuevo debe fallar 400, no 500."""
    student = fixed_users["student"]
    r = client.post("/api/v1/auth/register", json={
        "name": "X", "surname": "Y", "username": "otro-username-cualquiera",
        "email": student.email, "password": "TestPass123!", "role": "student",
    })
    assert r.status_code == 400


def test_register_rejects_privileged_role(client):
    """El registro público nunca debe poder crear superadmin/teacher_admin."""
    r = client.post("/api/v1/auth/register", json={
        "name": "X", "surname": "Y", "username": f"hacker_{uuid.uuid4().hex[:6]}",
        "email": f"hacker.{uuid.uuid4().hex[:6]}@tpmh.internal", "password": "TestPass123!",
        "role": "superadmin",
    })
    assert r.status_code == 422


def test_me_authenticated_matches_fixed_student(client, student_token, fixed_users):
    r = client.get("/api/v1/users/me", headers=auth_headers(student_token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["email"] == fixed_users["student"].email
    assert body["role"] == "student"


def test_me_without_token_is_rejected(client):
    r = client.get("/api/v1/users/me")
    assert r.status_code in (401, 403)


def test_forgot_password_does_not_leak_existence(client, fixed_users):
    """Debe responder igual exista o no el email (no filtrar qué correos están registrados)."""
    r1 = client.post("/api/v1/auth/forgot-password", json={"email": fixed_users["student"].email})
    r2 = client.post("/api/v1/auth/forgot-password", json={"email": "no-existe-nadie-con-este-correo@tpmh.internal"})
    assert r1.status_code == 200
    assert r2.status_code == r1.status_code
