"""
Suite: Landing pública (/public/landing) y logs de errores (/logs).

Dos features nuevas desde la última corrida de esta suite:

1. GET /public/landing — consolida en una sola llamada lo que antes eran
   varios fetches separados de la página de inicio (config de plataforma,
   profesores destacados, reseñas, paquetes). Reutiliza el mismo filtro
   `is_test_account` que ya se prueba en test_availability.py para el
   marketplace — este test es la misma garantía pero sobre este código
   nuevo y separado, para que no se destape ahí si algún día cambia.

2. POST /logs/frontend + GET /logs* — log centralizado de errores de
   backend/frontend para la pantalla de Logs en /admin. Es de solo
   lectura por diseño (sin DELETE, como GodModeAuditLog) — pero a
   diferencia del audit log (que es responsabilidad real de staff, vale
   la pena conservarlo aunque haya pasado durante un test), una fila de
   "error falso reportado por la suite" no aporta nada al dashboard de
   monitoreo real, así que igual se limpia por ORM directo en el teardown.
"""
import pytest

from app.models.error_log import ErrorLog
from tests.flow.conftest import auth_headers

pytestmark = pytest.mark.integration


# ─── Landing pública ────────────────────────────────────────────────────────

def test_landing_endpoint_hides_test_teacher(client, fixed_users):
    """
    Técnico: GET /public/landing no debe incluir al profesor fijo de
    pruebas entre los "teachers" que devuelve, sin importar si la
    plataforma está en modo single-tenant o multi-tenant — mismo filtro
    User.is_test_account que ya se prueba para GET /teachers/, pero
    ejercido sobre este endpoint nuevo y separado.
    UX: la página de inicio pública (la que ve cualquier visitante antes
    de registrarse) nunca debería mostrar la cuenta de pruebas del equipo
    como si fuera un profesor real disponible para agendar.
    """
    r = client.get("/api/v1/public/landing")
    assert r.status_code == 200, r.text
    usernames = [t["user_username"] for t in r.json()["teachers"]]
    assert fixed_users["teacher"].username not in usernames


def test_landing_endpoint_does_not_require_authentication(client):
    """
    Técnico: GET /public/landing responde 200 sin header Authorization.
    UX: es la página de inicio — tiene que cargar para cualquier
    visitante, logueado o no.
    """
    r = client.get("/api/v1/public/landing")
    assert r.status_code == 200
    body = r.json()
    assert "platform_name" in body
    assert "teachers" in body


# ─── Logs de errores ────────────────────────────────────────────────────────

@pytest.fixture
def error_log_cleanup(volatile):
    ids = []

    def _cleanup():
        from app.db.base import SessionLocal
        s = SessionLocal()
        try:
            if ids:
                s.query(ErrorLog).filter(ErrorLog.id.in_(ids)).delete(synchronize_session=False)
                s.commit()
        finally:
            s.close()

    volatile.custom(_cleanup, label="hard-delete de ErrorLog creados por flow-tests")
    return ids


def test_frontend_error_report_creates_log_visible_to_staff(
    client, student_token, superadmin_token, db, error_log_cleanup,
):
    """
    Técnico: POST /logs/frontend (autenticado, con el usuario asociado)
    crea una fila en ErrorLog con source="frontend" y el user_id
    correcto; GET /logs (staff) la lista, filtrable por source.
    UX: cuando la app del estudiante crashea, el equipo de soporte puede
    ver ese error real en el panel de administración — con quién le pasó,
    en qué pantalla, y cuándo — sin depender de que el usuario lo reporte
    manualmente.
    """
    r_report = client.post("/api/v1/logs/frontend", json={
        "message": "Flow-test: error sintético reportado por la suite",
        "screen": "/dashboard/flow-test",
        "level": "error",
        "stack": "Error: flow-test\\n  at test_public_and_logs.py",
    }, headers=auth_headers(student_token))
    assert r_report.status_code == 204

    log_row = db.query(ErrorLog).filter(ErrorLog.screen == "/dashboard/flow-test").order_by(ErrorLog.id.desc()).first()
    assert log_row is not None
    assert log_row.source == "frontend"
    assert log_row.user_id is not None
    error_log_cleanup.append(log_row.id)

    r_list = client.get("/api/v1/logs?source=frontend", headers=auth_headers(superadmin_token))
    assert r_list.status_code == 200, r_list.text
    listed_ids = [item["id"] for item in r_list.json()["items"]]
    assert log_row.id in listed_ids


def test_frontend_error_report_works_without_authentication(client, db, error_log_cleanup):
    """
    Técnico: POST /logs/frontend acepta un reporte sin token
    (get_current_user_optional) — la fila queda con user_id=None.
    UX: un crash puede ocurrir ANTES de que la sesión termine de cargar
    (p. ej. en /login) — el reporte no debe fallar solo porque todavía no
    hay nadie logueado.
    """
    r = client.post("/api/v1/logs/frontend", json={
        "message": "Flow-test: error anónimo (sin sesión)",
        "screen": "/login",
        "level": "warning",
    })
    assert r.status_code == 204

    log_row = db.query(ErrorLog).filter(ErrorLog.screen == "/login", ErrorLog.message.like("Flow-test%")).first()
    assert log_row is not None
    assert log_row.user_id is None
    error_log_cleanup.append(log_row.id)


@pytest.mark.parametrize("path", ["/api/v1/logs", "/api/v1/logs/users", "/api/v1/logs/stats"])
def test_logs_endpoints_reject_non_staff(client, student_token, teacher_token, path):
    """
    Técnico: los 3 endpoints de lectura de /logs (listado, usuarios,
    stats) devuelven 403 para student/teacher — son exclusivos de staff.
    UX: los logs de errores pueden contener detalles técnicos (stacks,
    payloads) de otros usuarios — nunca deberían ser visibles para
    alguien que no sea del equipo.
    """
    for token in (student_token, teacher_token):
        r = client.get(path, headers=auth_headers(token))
        assert r.status_code == 403


def test_logs_stats_and_users_smoke(client, superadmin_token, teacher_admin_token):
    """
    Técnico: smoke test de los endpoints agregados — responden 200 con la
    forma esperada para ambos roles de staff, incluso sin filtrar nada.
    UX: las StatCards y el selector de usuario de la pantalla de Logs
    deben poder cargar de entrada, sin errores, para cualquier miembro
    del staff.
    """
    for token in (superadmin_token, teacher_admin_token):
        r_stats = client.get("/api/v1/logs/stats", headers=auth_headers(token))
        assert r_stats.status_code == 200, r_stats.text
        for key in ("total", "errors", "warnings", "backend", "frontend", "security", "last_24h"):
            assert key in r_stats.json()

        r_users = client.get("/api/v1/logs/users", headers=auth_headers(token))
        assert r_users.status_code == 200, r_users.text
        assert isinstance(r_users.json(), list)
