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
    """
    Técnico: golpea GET /health y verifica 200 con status "ok". No toca
    base de datos ni autenticación — solo confirma que el proceso del
    backend está arriba y respondiendo.
    UX: si esto falla, la plataforma entera está caída — nadie puede ni
    siquiera cargar la página de login.
    """
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_register_and_login_student(client, volatile):
    """
    Técnico: POST /auth/register con role=student crea un usuario efímero
    de verdad (no uno de los 4 fijos), confirma que devuelve access_token
    y role correctos, y que login con esas mismas credenciales funciona
    después. Es el único test de la suite donde el USUARIO mismo es un
    dato volátil (se borra en el teardown, cascada limpia su perfil).
    UX: prueba el flujo real de "crear mi cuenta" que ve cualquier
    estudiante nuevo en /register — si esto falla, nadie nuevo puede
    registrarse en la plataforma.
    """
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
    """
    Técnico: registra con el email del estudiante fijo (que ya existe) y
    espera 400 (no 500 ni 201 duplicado). Verifica el constraint de email
    único a nivel de aplicación, no solo de BD.
    UX: si alguien intenta crear una cuenta con un correo que ya está
    registrado, debe ver un mensaje de error claro ("ese correo ya está en
    uso"), no una pantalla de error genérica ni, peor, una cuenta duplicada.
    """
    student = fixed_users["student"]
    r = client.post("/api/v1/auth/register", json={
        "name": "X", "surname": "Y", "username": "otro-username-cualquiera",
        "email": student.email, "password": "TestPass123!", "role": "student",
    })
    assert r.status_code == 400


def test_register_rejects_privileged_role(client):
    """
    Técnico: intenta registrar con role=superadmin vía el endpoint público
    y espera 422 (rechazado por el schema, RegisterRequest.validate_role
    solo permite student/teacher).
    UX: cierra un hueco de seguridad — nadie debería poder auto-otorgarse
    permisos de administrador simplemente registrándose con ese rol en el
    formulario público.
    """
    r = client.post("/api/v1/auth/register", json={
        "name": "X", "surname": "Y", "username": f"hacker_{uuid.uuid4().hex[:6]}",
        "email": f"hacker.{uuid.uuid4().hex[:6]}@tpmh.internal", "password": "TestPass123!",
        "role": "superadmin",
    })
    assert r.status_code == 422


def test_me_authenticated_matches_fixed_student(client, student_token, fixed_users):
    """
    Técnico: GET /users/me con el token del estudiante fijo devuelve
    exactamente su email y role="student".
    UX: es la base de "quién soy" — cualquier pantalla que muestre el
    nombre/avatar del usuario logueado depende de que esto devuelva los
    datos correctos.
    """
    r = client.get("/api/v1/users/me", headers=auth_headers(student_token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["email"] == fixed_users["student"].email
    assert body["role"] == "student"


def test_me_without_token_is_rejected(client):
    """
    Técnico: GET /users/me sin header Authorization espera 401/403, no 200
    ni un error 500 por acceder a un current_user inexistente.
    UX: garantiza que nadie sin sesión pueda ver datos de un usuario — la
    barrera de "tenés que iniciar sesión" funciona.
    """
    r = client.get("/api/v1/users/me")
    assert r.status_code in (401, 403)


def test_forgot_password_does_not_leak_existence(client, fixed_users):
    """
    Técnico: compara la respuesta de POST /auth/forgot-password para un
    email que existe vs. uno que no — deben devolver el mismo status
    (200 en ambos casos).
    UX: por seguridad, la pantalla de "olvidé mi contraseña" nunca debe
    revelar si un correo está o no registrado en la plataforma (evita que
    alguien use ese formulario para verificar cuentas de otras personas).
    """
    r1 = client.post("/api/v1/auth/forgot-password", json={"email": fixed_users["student"].email})
    r2 = client.post("/api/v1/auth/forgot-password", json={"email": "no-existe-nadie-con-este-correo@tpmh.internal"})
    assert r1.status_code == 200
    assert r2.status_code == r1.status_code
