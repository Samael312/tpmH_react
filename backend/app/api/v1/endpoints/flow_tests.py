"""
Disparador de la suite backend/tests/flow desde el panel de staff
(/admin/flow-tester en el frontend).

Corre pytest como subproceso en un hilo de background (no bloquea el
event loop) y expone un endpoint de polling para consultar el progreso
en vivo, leyendo un `--report-log` de pytest (una línea JSON por evento,
escrita a medida que cada test termina — no hay que esperar a que
termine la corrida completa para saber qué va pasando).

Solo pensado para entornos de desarrollo: se niega a arrancar si
ENVIRONMENT es 'production', igual que la propia suite de tests.
"""
import json
import logging
import subprocess
import sys
import threading
import uuid
from collections import OrderedDict
from datetime import datetime
from pathlib import Path
from tempfile import gettempdir
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.auth.dependencies import get_current_staff
from app.core.config import settings
from app.models.user import User

router = APIRouter()
logger = logging.getLogger(__name__)

# backend/app/api/v1/endpoints/flow_tests.py -> backend/
BACKEND_DIR = Path(__file__).resolve().parents[4]
MAX_STORED_RUNS = 5
MAX_MESSAGE_CHARS = 4000


# ─── Estado en memoria de las corridas ──────────────────────────────────────
# Nota: vive en el proceso de un solo worker. Con varios workers/réplicas
# cada uno tendría su propio estado — aceptable para una herramienta interna
# de desarrollo, no pensado para producción.

class _RunState:
    def __init__(self, run_id: str, include_destructive: bool, node_ids: Optional[list[str]] = None):
        self.run_id = run_id
        self.include_destructive = include_destructive
        self.node_ids = node_ids or None
        self.status = "running"  # running | completed | error_starting
        self.started_at = datetime.utcnow()
        self.finished_at: Optional[datetime] = None
        self.return_code: Optional[int] = None
        self.log_path = Path(gettempdir()) / f"flow-tests-{run_id}.jsonl"
        self.stderr_tail: Optional[str] = None
        self.lock = threading.Lock()


_runs: "OrderedDict[str, _RunState]" = OrderedDict()
_runs_lock = threading.Lock()


def _store_run(state: _RunState):
    with _runs_lock:
        _runs[state.run_id] = state
        while len(_runs) > MAX_STORED_RUNS:
            _runs.popitem(last=False)


def _get_run(run_id: str) -> _RunState:
    with _runs_lock:
        state = _runs.get(run_id)
    if not state:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No se encontró esa corrida (o ya expiró de la memoria)")
    return state


def _current_running() -> Optional[_RunState]:
    with _runs_lock:
        for state in reversed(_runs.values()):
            if state.status == "running":
                return state
    return None


def _require_dev_environment():
    env = (settings.ENVIRONMENT or "").lower()
    if env == "production":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Los flow-tests están deshabilitados en producción. Esta herramienta "
            "solo debe usarse contra un backend de desarrollo/local.",
        )


def _run_pytest_in_background(state: _RunState):
    cmd = [
        sys.executable, "-m", "pytest", "-v",
        "--run-flow-tests",
        "--report-log", str(state.log_path),
    ]
    if state.node_ids:
        # Selección explícita (test individual o bloque/módulo elegido en
        # la UI): corre exactamente esos node_ids, ignorando el filtro de
        # destructivos — si el usuario los eligió a mano, sabe lo que hace.
        cmd += state.node_ids
    else:
        cmd += ["tests/flow"]
        if not state.include_destructive:
            cmd += ["-m", "not destructive"]

    try:
        result = subprocess.run(
            cmd,
            cwd=str(BACKEND_DIR),
            capture_output=True,
            text=True,
            timeout=600,
        )
        state.return_code = result.returncode

        # BUG real encontrado en producción: un returncode == 1 normalmente
        # significa "corrieron tests y alguno falló", así que antes NO
        # capturábamos stderr en ese caso — pero `python -m pytest` también
        # devuelve exactamente 1 cuando el módulo `pytest` ni siquiera está
        # instalado en el intérprete que corre el servidor (p. ej. no se
        # corrió `pip install -r requirements.txt` en ese entorno después
        # de actualizar). Eso daba "0 tests, sin error" en la UI: el peor
        # resultado posible, silencioso. Ahora: si el report-log terminó
        # vacío (0 tests reales), SIEMPRE mostramos la salida del proceso,
        # sin importar el returncode.
        tests_found = len(_parse_report_log(state.log_path))
        looks_broken = result.returncode not in (0, 1) or tests_found == 0

        if looks_broken:
            combined = (result.stdout or "") + (result.stderr or "")
            if not combined.strip():
                combined = (
                    f"pytest terminó con código {result.returncode} sin collectar "
                    "ningún test y sin salida — revisa que 'tests/flow' exista en "
                    f"{BACKEND_DIR} y que el intérprete {sys.executable} tenga "
                    "instalado backend/requirements.txt (incluye pytest, "
                    "pytest-order y pytest-reportlog)."
                )
            state.stderr_tail = combined[-MAX_MESSAGE_CHARS:]
            logger.warning(
                "flow-tests sospechoso: código=%s tests_encontrados=%s -> %s",
                result.returncode, tests_found, state.stderr_tail,
            )
    except subprocess.TimeoutExpired:
        state.stderr_tail = "La corrida superó el límite de 10 minutos y fue cancelada."
        state.return_code = -1
    except Exception as e:
        logger.exception("Error lanzando el subproceso de flow-tests")
        state.stderr_tail = str(e)[:MAX_MESSAGE_CHARS]
        state.return_code = -1
    finally:
        state.finished_at = datetime.utcnow()
        state.status = "completed"


# ─── Parseo del --report-log (JSON Lines, uno por evento de pytest) ────────

_OUTCOME_PRIORITY = {"passed": 0, "skipped": 1, "failed": 2}


def _parse_report_log(log_path: Path) -> list[dict]:
    """
    Cada test puede aparecer hasta 3 veces (setup/call/teardown). Nos
    quedamos con el peor resultado de las tres fases, y el mensaje de
    error de la fase que falló (si alguna falló).
    """
    tests: "OrderedDict[str, dict]" = OrderedDict()

    if not log_path.exists():
        return []

    with log_path.open("r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue

            if event.get("$report_type") != "TestReport":
                continue

            node_id = event.get("nodeid", "")
            if not node_id:
                continue

            outcome = event.get("outcome", "unknown")
            duration = event.get("duration")
            when = event.get("when")

            parts = node_id.split("::", 1)
            module = parts[0].rsplit("/", 1)[-1]
            name = parts[1] if len(parts) > 1 else node_id

            existing = tests.get(node_id)
            if existing is None:
                tests[node_id] = {
                    "node_id": node_id,
                    "module": module,
                    "name": name,
                    "outcome": outcome,
                    "duration": duration or 0,
                    "message": None,
                }
                existing = tests[node_id]
            else:
                existing["duration"] = (existing["duration"] or 0) + (duration or 0)
                if _OUTCOME_PRIORITY.get(outcome, 0) > _OUTCOME_PRIORITY.get(existing["outcome"], 0):
                    existing["outcome"] = outcome

            if outcome == "failed":
                longrepr = event.get("longrepr")
                message = None
                if isinstance(longrepr, str):
                    message = longrepr
                elif isinstance(longrepr, dict):
                    # longrepr estructurado (crashes de pytest): intenta sacar
                    # el mensaje más útil sin volcar el objeto entero.
                    message = (
                        longrepr.get("reprcrash", {}).get("message")
                        or json.dumps(longrepr)[:MAX_MESSAGE_CHARS]
                    )
                if message:
                    existing["message"] = message[:MAX_MESSAGE_CHARS]
            elif outcome == "skipped" and not existing.get("message"):
                longrepr = event.get("longrepr")
                if isinstance(longrepr, (list, tuple)) and len(longrepr) >= 3:
                    existing["message"] = str(longrepr[2])[:MAX_MESSAGE_CHARS]

    return list(tests.values())


# ─── Schemas ────────────────────────────────────────────────────────────────

class FlowTestRunRequest(BaseModel):
    include_destructive: bool = False
    # Selección explícita: lista de node_ids exactos (tal como vienen del
    # manifiesto de /flow-tests/manifest) para correr un test individual o
    # un bloque/módulo entero. None o [] = correr la suite completa.
    node_ids: Optional[list[str]] = None


class FlowTestResult(BaseModel):
    node_id: str
    module: str
    name: str
    outcome: str
    duration: float
    message: Optional[str] = None


class FlowTestSummary(BaseModel):
    total: int
    passed: int
    failed: int
    skipped: int


class FlowTestRunResponse(BaseModel):
    run_id: str
    status: str  # running | completed
    include_destructive: bool
    node_ids: Optional[list[str]] = None
    started_at: datetime
    finished_at: Optional[datetime] = None
    return_code: Optional[int] = None
    stderr_tail: Optional[str] = None
    tests: list[FlowTestResult]
    summary: FlowTestSummary


class FlowTestManifestEntry(BaseModel):
    node_id: str
    module: str
    name: str
    is_destructive: bool
    technical_description: Optional[str] = None
    ux_description: Optional[str] = None


class FlowTestManifestResponse(BaseModel):
    modules: list[str]
    tests: list[FlowTestManifestEntry]


def _build_response(state: _RunState) -> FlowTestRunResponse:
    tests = _parse_report_log(state.log_path)
    summary = FlowTestSummary(
        total=len(tests),
        passed=sum(1 for t in tests if t["outcome"] == "passed"),
        failed=sum(1 for t in tests if t["outcome"] == "failed"),
        skipped=sum(1 for t in tests if t["outcome"] == "skipped"),
    )
    return FlowTestRunResponse(
        run_id=state.run_id,
        status=state.status,
        include_destructive=state.include_destructive,
        node_ids=state.node_ids,
        started_at=state.started_at,
        finished_at=state.finished_at,
        return_code=state.return_code,
        stderr_tail=state.stderr_tail,
        tests=[FlowTestResult(**t) for t in tests],
        summary=summary,
    )


def _split_technical_ux(docstring: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """
    Los docstrings de los tests siguen la convención:
        Técnico: ...
        UX: ...
    (pueden ocupar varias líneas cada uno). Esto separa ambas partes; si el
    docstring no sigue la convención (tests viejos sin actualizar, o
    ninguno), devuelve (docstring completo, None) como fallback razonable.
    """
    if not docstring:
        return None, None

    text = docstring.strip()
    marker = "\n    UX:" if "\n    UX:" in text else ("\nUX:" if "\nUX:" in text else None)
    if "Técnico:" not in text or marker is None:
        return text, None

    technical_part, _, ux_part = text.partition(marker)
    technical = technical_part.replace("Técnico:", "", 1).strip()
    technical = " ".join(line.strip() for line in technical.splitlines()).strip()
    ux = ux_part.replace("UX:", "", 1).strip()
    ux = " ".join(line.strip() for line in ux.splitlines()).strip()
    return technical or None, ux or None


# ─── Endpoints ──────────────────────────────────────────────────────────────

@router.get("/manifest", response_model=FlowTestManifestResponse)
def get_flow_tests_manifest(
    current_user: User = Depends(get_current_staff),
):
    """
    Enumera todos los tests de backend/tests/flow SIN ejecutarlos (usa
    `pytest --collect-only`, no toca la BD, tarda milisegundos), con su
    descripción técnica/UX (extraída del docstring de cada test) y si son
    destructivos. Pensado para que la UI arme la lista de tests y una
    barra de progreso precisa ANTES de arrancar una corrida.
    """
    _require_dev_environment()

    manifest_path = Path(gettempdir()) / f"flow-tests-manifest-{uuid.uuid4().hex[:8]}.json"
    cmd = [
        sys.executable, "-m", "pytest", "tests/flow", "--collect-only", "-q",
        "--run-flow-tests", "--emit-manifest", str(manifest_path),
    ]
    try:
        result = subprocess.run(cmd, cwd=str(BACKEND_DIR), capture_output=True, text=True, timeout=60)
        if not manifest_path.exists():
            combined = ((result.stdout or "") + (result.stderr or ""))[-MAX_MESSAGE_CHARS:]
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                f"No se pudo enumerar los tests (pytest salió con código {result.returncode}): {combined}",
            )
        with manifest_path.open("r", encoding="utf-8") as f:
            raw = json.load(f)
    finally:
        manifest_path.unlink(missing_ok=True)

    tests = []
    modules_seen: list[str] = []
    for t in raw.get("tests", []):
        technical, ux = _split_technical_ux(t.get("docstring"))
        if t["module"] not in modules_seen:
            modules_seen.append(t["module"])
        tests.append(FlowTestManifestEntry(
            node_id=t["node_id"],
            module=t["module"],
            name=t["name"],
            is_destructive="destructive" in (t.get("markers") or []),
            technical_description=technical,
            ux_description=ux,
        ))

    return FlowTestManifestResponse(modules=modules_seen, tests=tests)


@router.post("/run", response_model=FlowTestRunResponse, status_code=status.HTTP_202_ACCEPTED)
def start_flow_tests_run(
    data: FlowTestRunRequest,
    current_user: User = Depends(get_current_staff),
):
    """
    Lanza backend/tests/flow en background y devuelve de inmediato un
    run_id para hacer polling con GET /flow-tests/{run_id}. Si `node_ids`
    viene con contenido, corre exactamente esos tests (individual o
    bloque/módulo); si no, corre la suite completa respetando
    `include_destructive`.
    """
    _require_dev_environment()

    already_running = _current_running()
    if already_running:
        return _build_response(already_running)

    run_id = uuid.uuid4().hex[:12]
    state = _RunState(run_id, data.include_destructive, data.node_ids)
    _store_run(state)

    thread = threading.Thread(target=_run_pytest_in_background, args=(state,), daemon=True)
    thread.start()

    return _build_response(state)


@router.get("/{run_id}", response_model=FlowTestRunResponse)
def get_flow_tests_run(
    run_id: str,
    current_user: User = Depends(get_current_staff),
):
    """Progreso/resultado de una corrida — hacer polling mientras status=='running'."""
    state = _get_run(run_id)
    return _build_response(state)
