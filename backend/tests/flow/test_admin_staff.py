"""
Suite: Endpoints de staff (superadmin + teacher_admin).

Esto ES la regresión directa del bug original que motivó toda esta suite:
`get_current_staff` acepta superadmin Y teacher_admin; `get_current_teacher`
acepta teacher Y teacher_admin; ningún endpoint de "profesor" acepta un
superadmin puro. El flow-tester viejo asumía que el token del admin
logueado servía para todo, y por eso fallaban en cascada los tests de
profesor cuando quien probaba era un superadmin sin perfil de profesor.

También corrige un bug de URL del tester viejo: llamaba a
`/api/v1/admin/withdrawals/pending`, que no existe — el router de retiros
está montado bajo el prefijo `/payments`, así que la ruta real es
`/api/v1/payments/admin/withdrawals/pending`.
"""
import pytest

from tests.flow.conftest import auth_headers

pytestmark = pytest.mark.integration


@pytest.mark.parametrize("path", [
    "/api/v1/admin/stats",
    "/api/v1/admin/users",
    "/api/v1/admin/platform-config",
    "/api/v1/admin/support-tickets",
])
def test_staff_endpoints_accept_both_superadmin_and_teacher_admin(
    client, superadmin_token, teacher_admin_token, path,
):
    """
    Técnico: regresión directa del bug original — cada endpoint de
    `get_current_staff` debe aceptar TANTO al superadmin COMO al
    teacher_admin (parametrizado sobre /admin/stats, /admin/users,
    /admin/platform-config, /admin/support-tickets).
    UX: el panel de administración debe funcionar igual sin importar si
    quien lo usa es el dueño de la plataforma (superadmin) o un encargado
    de gestionar profesores (teacher_admin) — ambos son "staff".
    """
    for token in (superadmin_token, teacher_admin_token):
        r = client.get(path, headers=auth_headers(token))
        assert r.status_code == 200, f"{path} con token de staff debería ser 200, fue {r.status_code}: {r.text}"


@pytest.mark.parametrize("path", [
    "/api/v1/admin/stats",
    "/api/v1/admin/users",
    "/api/v1/admin/support-tickets",
])
def test_staff_endpoints_reject_teacher_and_student(client, teacher_token, student_token, path):
    """
    Técnico: la contraparte del test anterior — los mismos endpoints deben
    rechazar con 403 a un teacher o student normal (sin privilegios de staff).
    UX: un profesor o estudiante nunca debería poder ver el panel de
    administración ni sus datos agregados, aunque conozca la URL.
    """
    for token in (teacher_token, student_token):
        r = client.get(path, headers=auth_headers(token))
        assert r.status_code == 403, f"{path} con token no-staff debería ser 403, fue {r.status_code}"


def test_only_superadmin_can_change_user_role(client, superadmin_token, teacher_admin_token, fixed_users):
    """
    Técnico: admin_update_user (cambiar rol teacher <-> teacher_admin) usa
    require_superadmin, NO get_current_staff — un teacher_admin no debería
    poder tocar esto ni siquiera sobre sí mismo.
    UX: solo el dueño de la plataforma (superadmin) puede ascender o
    degradar el rol de una cuenta de staff — un teacher_admin no puede
    auto-otorgarse (ni quitarse) ese nivel de acceso.
    """
    teacher_admin_id = fixed_users["teacher_admin"].id
    r = client.patch(
        f"/api/v1/admin/users/{teacher_admin_id}",
        json={"phone_number": None},
        headers=auth_headers(teacher_admin_token),
    )
    assert r.status_code == 403


def test_withdrawals_pending_real_path(client, superadmin_token):
    """
    Técnico: documenta un bug de URL del tester viejo — llamaba a
    /api/v1/admin/withdrawals/pending (404, no existe bajo ese router) en
    vez de la ruta real /api/v1/payments/admin/withdrawals/pending (el
    router de pagos está montado bajo /payments).
    UX: es la pantalla de staff donde se revisan y aprueban las solicitudes
    de retiro de dinero de los profesores — si la URL estuviera mal en el
    frontend, esa pantalla se vería siempre vacía o rota.
    """
    r_wrong = client.get("/api/v1/admin/withdrawals/pending", headers=auth_headers(superadmin_token))
    assert r_wrong.status_code == 404

    r_right = client.get("/api/v1/payments/admin/withdrawals/pending", headers=auth_headers(superadmin_token))
    assert r_right.status_code == 200, r_right.text
    assert isinstance(r_right.json(), list)


def test_admin_classes_list_endpoint_does_not_exist(client, superadmin_token):
    """
    Técnico: documenta explícitamente que /api/v1/admin/classes (usado por
    el tester viejo como 'cls-admin-list') no existe en este backend — no
    hay listado global de clases para admin, solo por profesor/estudiante/
    cohorte. Si algún día se agrega, este test empezará a fallar y habrá
    que actualizar esta nota.
    UX: no aplica directamente a una pantalla — es documentación viva de
    una limitación conocida del backend, para que nadie pierda tiempo
    "arreglando" un endpoint que nunca existió.
    """
    r = client.get("/api/v1/admin/classes", headers=auth_headers(superadmin_token))
    assert r.status_code == 404
