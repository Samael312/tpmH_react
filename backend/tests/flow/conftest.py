"""
Fixtures compartidas de la suite de flow-tests.

Filosofía:
- Los 4 usuarios de prueba (superadmin / teacher_admin / teacher / student)
  son FIJOS: se crean una vez (ver seed.py) y se reutilizan en cada corrida.
  Nunca se borran.
- Todo lo demás que un test crea vía POST/PATCH (clases, materiales, tareas,
  enrollments, tickets de soporte, excepciones de disponibilidad...) es
  VOLÁTIL: se registra en el fixture `volatile` y se borra automáticamente
  al terminar el test, sin importar si el test pasó o falló.
- Por defecto la suite se niega a correr salvo que se le indique
  explícitamente (--run-flow-tests o RUN_FLOW_TESTS=1), y se niega SIEMPRE
  a correr si detecta que el backend apunta a producción.
"""
import logging
import os
import importlib

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.main import app
from app.core.config import settings
from app.db.base import SessionLocal
from app.models.user import User

from tests.flow.seed import ensure_fixed_users, FixedUser
from tests.flow import constants as C

logger = logging.getLogger("flow_tests")


# ─── Opt-in explícito + bloqueo de producción ──────────────────────────────

def pytest_addoption(parser):
    parser.addoption(
        "--run-flow-tests",
        action="store_true",
        default=False,
        help="Habilita la suite backend/tests/flow (crea y borra datos reales).",
    )
    parser.addoption(
        "--emit-manifest",
        action="store",
        default=None,
        help=(
            "Ruta de archivo: si se pasa, al terminar la colección se escribe un "
            "JSON con node_id/módulo/nombre/docstring/markers de cada test "
            "recolectado (sin ejecutar nada). Pensado para que la UI enumere los "
            "tests antes de correrlos y arme una barra de progreso precisa."
        ),
    )


def pytest_collection_finish(session):
    """
    Si se pasó --emit-manifest=<path>, vuelca la lista de tests recolectados
    (ya expandidos con sus parametrize) a un JSON y no hace nada más — la
    ejecución real sigue su curso normal (se usa junto con --collect-only
    desde flow_tests.py, así que en la práctica nunca llega a ejecutar nada).
    """
    manifest_path = session.config.getoption("--emit-manifest")
    if not manifest_path:
        return

    import json

    tests = []
    for item in session.items:
        node_id = item.nodeid
        parts = node_id.split("::", 1)
        module = parts[0].rsplit("/", 1)[-1]
        name = parts[1] if len(parts) > 1 else node_id
        doc = ""
        func = getattr(item, "function", None)
        if func is not None and func.__doc__:
            doc = func.__doc__.strip()
        markers = sorted({m.name for m in item.iter_markers()})
        tests.append({
            "node_id": node_id,
            "module": module,
            "name": name,
            "docstring": doc,
            "markers": markers,
        })

    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump({"tests": tests}, f, ensure_ascii=False, indent=2)


def pytest_collection_modifyitems(config, items):
    flow_items = [item for item in items if "tests/flow/" in str(item.fspath).replace("\\", "/")]
    if not flow_items:
        return

    enabled = config.getoption("--run-flow-tests") or os.getenv("RUN_FLOW_TESTS") == "1"
    if not enabled:
        skip_marker = pytest.mark.skip(
            reason=(
                "flow-tests deshabilitados por defecto: usa `pytest --run-flow-tests` "
                "o RUN_FLOW_TESTS=1 para correrlos. Son tests de integración que "
                "crean y borran datos reales en la base configurada en DATABASE_URL."
            )
        )
        for item in flow_items:
            item.add_marker(skip_marker)


@pytest.fixture(scope="session", autouse=True)
def _block_production(request):
    """
    Última línea de defensa: si por lo que sea alguien apunta DATABASE_URL/
    ENVIRONMENT a producción, la sesión entera aborta antes de tocar nada.
    Se puede saltar (bajo tu propio riesgo) con FLOW_TESTS_ALLOW_PROD=1.
    """
    if os.getenv("FLOW_TESTS_ALLOW_PROD") == "1":
        return

    env = (settings.ENVIRONMENT or "").lower()
    db_url = (os.getenv("DATABASE_URL") or "").lower()
    looks_like_prod = env == "production" or "prod" in db_url

    if looks_like_prod:
        pytest.exit(
            "Los flow-tests están BLOQUEADOS: ENVIRONMENT o DATABASE_URL parecen "
            "de producción. Corre esta suite solo contra un backend local/dev. "
            "Si esto es un falso positivo, exporta FLOW_TESTS_ALLOW_PROD=1.",
            returncode=1,
        )


# ─── Evita efectos secundarios reales (emails) durante los tests ──────────

_MODULES_WITH_EMAIL_SENDERS = [
    "app.api.v1.endpoints.homework",
    "app.api.v1.endpoints.auth",
    "app.api.v1.endpoints.classes",
    "app.api.v1.endpoints.reviews",
    "app.api.v1.endpoints.support",
    "app.api.v1.endpoints.payments",
    "app.api.v1.endpoints.teachers",
    "app.api.v1.endpoints.admin",
    "app.api.v1.endpoints.cohorts",
    "app.api.v1.endpoints.materials",
]


@pytest.fixture(autouse=True)
def _no_real_emails(monkeypatch):
    """
    Los endpoints importan `send_*` de app.core.email con `from ... import`,
    así que hay que parchear cada módulo que lo importó (parchear
    app.core.email no basta, esos módulos ya tienen su propia referencia).
    """
    def _noop(*args, **kwargs):
        return None

    for module_name in _MODULES_WITH_EMAIL_SENDERS:
        module = importlib.import_module(module_name)
        for attr_name in dir(module):
            if attr_name.startswith("send_"):
                monkeypatch.setattr(module, attr_name, _noop, raising=False)


# ─── Cliente HTTP contra la app real (in-process, sin levantar un server) ──

@pytest.fixture(scope="session")
def client():
    # OJO: instanciar sin `with` evita disparar el lifespan (arranca el
    # APScheduler), que no queremos vivo durante los tests.
    return TestClient(app)


@pytest.fixture
def db(_block_production):
    """Sesión de BD de corta duración para setup/verificación/limpieza directa."""
    session: Session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


# ─── Usuarios fijos + tokens por rol ───────────────────────────────────────

@pytest.fixture(scope="session")
def fixed_users(_block_production) -> dict[str, FixedUser]:
    session: Session = SessionLocal()
    try:
        users = ensure_fixed_users(session)
        logger.info("Usuarios fijos de flow-tests listos: %s", {k: v.id for k, v in users.items()})
        return users
    finally:
        session.close()


def _login(client: TestClient, login: str, password: str) -> str:
    resp = client.post("/api/v1/auth/login", json={"login": login, "password": password})
    assert resp.status_code == 200, (
        f"No se pudo loguear como '{login}' (status {resp.status_code}): {resp.text}"
    )
    token = resp.json().get("access_token")
    assert token, f"Login de '{login}' no devolvió access_token: {resp.json()}"
    return token


@pytest.fixture(scope="session")
def superadmin_token(client, fixed_users):
    u = fixed_users["superadmin"]
    return _login(client, u.email, u.password)


@pytest.fixture(scope="session")
def teacher_admin_token(client, fixed_users):
    u = fixed_users["teacher_admin"]
    return _login(client, u.email, u.password)


@pytest.fixture(scope="session")
def teacher_token(client, fixed_users):
    u = fixed_users["teacher"]
    return _login(client, u.email, u.password)


@pytest.fixture(scope="session")
def student_token(client, fixed_users):
    u = fixed_users["student"]
    return _login(client, u.email, u.password)


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ─── Tracker de datos volátiles: se limpia solo, en orden LIFO ────────────

class Volatile:
    """
    Registra "cosas que hay que deshacer" y las ejecuta al terminar el test,
    en orden inverso al que se registraron (LIFO) — así, si un test crea
    A y luego B (donde B depende de A), al limpiar se borra primero B y
    luego A, respetando las foreign keys.

    - .api(...)      → borra vía un endpoint DELETE real de la app.
    - .db(...)       → borra una fila directo por ORM (para lo que no
                       tiene endpoint DELETE, ej. Enrollment, SupportTicket).
    - .db_query(...) → borra TODAS las filas que matcheen un filtro; útil
                       como red de seguridad "por si acaso" al principio
                       de un test (se registra primero, así corre último).
    - .custom(fn)    → cualquier otra función de limpieza a medida.
    """

    def __init__(self, client: TestClient, db_factory):
        self._client = client
        self._db_factory = db_factory
        self._actions: list[tuple[str, callable]] = []

    def api(self, method: str, path: str, token: str | None = None, label: str | None = None):
        def _do():
            headers = auth_headers(token) if token else {}
            resp = self._client.request(method, path, headers=headers)
            if resp.status_code >= 400 and resp.status_code != 404:
                logger.warning(
                    "Limpieza API %s %s devolvió %s: %s",
                    method, path, resp.status_code, resp.text[:300],
                )
        self._actions.append((label or f"API {method} {path}", _do))

    def db(self, model, id_, label: str | None = None):
        def _do():
            session = self._db_factory()
            try:
                obj = session.query(model).filter(model.id == id_).first()
                if obj is not None:
                    session.delete(obj)
                    session.commit()
            finally:
                session.close()
        self._actions.append((label or f"DB delete {model.__name__}#{id_}", _do))

    def db_query(self, model, label: str | None = None, **filters):
        def _do():
            session = self._db_factory()
            try:
                session.query(model).filter_by(**filters).delete(synchronize_session=False)
                session.commit()
            finally:
                session.close()
        self._actions.append((label or f"DB delete-by-filter {model.__name__}{filters}", _do))

    def custom(self, fn, label: str = "custom cleanup"):
        self._actions.append((label, fn))

    def _run_all(self):
        for label, action in reversed(self._actions):
            try:
                action()
            except Exception:
                logger.exception("Fallo al limpiar dato volátil: %s", label)


@pytest.fixture
def volatile(client, _block_production):
    tracker = Volatile(client, SessionLocal)
    yield tracker
    tracker._run_all()
