"""Cobertura de `flow_tests.py` (sin lanzar jamás la suite real: el subproceso se simula) y de `logs.py`."""
import json
import subprocess
from datetime import timedelta
from pathlib import Path

import pytest

from app.api.v1.endpoints import flow_tests as ft
from app.core.config import settings
from app.core.timezone import utc_now
from app.models.error_log import ErrorLog
from tests.audit.conftest import hdr
from tests.audit.helpers import API

FT = f"{API}/flow-tests"
LG = f"{API}/logs"


@pytest.fixture(autouse=True)
def isolated_flow_state(monkeypatch):
    monkeypatch.setattr(settings, "FLOW_TESTS_ENABLED", True)
    monkeypatch.setattr(settings, "ENVIRONMENT", "development")
    ft._runs.clear()
    yield
    ft._runs.clear()


class CompletedProcess:
    def __init__(self, code=0, out="", err=""):
        self.returncode, self.stdout, self.stderr = code, out, err


def report_line(nodeid, outcome, when="call", duration=0.1, longrepr=None):
    return json.dumps({"$report_type": "TestReport", "nodeid": nodeid, "outcome": outcome, "when": when,
                       "duration": duration, "longrepr": longrepr})


# ── guardas ──────────────────────────────────────────────────────────────────────────────
def test_environment_guards(client, world, monkeypatch):
    ah = hdr(world["admin"])
    monkeypatch.setattr(settings, "FLOW_TESTS_ENABLED", False)
    assert client.get(f"{FT}/manifest", headers=ah).status_code == 403
    monkeypatch.setattr(settings, "FLOW_TESTS_ENABLED", True)
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    assert client.post(f"{FT}/run", json={}, headers=ah).status_code == 403
    assert client.get(f"{FT}/abc", headers=ah).status_code == 403
    monkeypatch.setattr(settings, "ENVIRONMENT", "development")
    assert client.get(f"{FT}/abc", headers=ah).status_code == 404
    assert client.get(f"{FT}/abc", headers=hdr(world["t_user"])).status_code == 403


def test_node_id_validation(client, world):
    ah = hdr(world["admin"])
    for bad in ("-p", "tests/flow/../x", "tests/flow/a b", "tests/flow/\\x", "otro/x.py", "tests/flow/" + "a" * 300):
        assert client.post(f"{FT}/run", json={"node_ids": [bad]}, headers=ah).status_code == 422, bad
    assert client.post(f"{FT}/run", json={"node_ids": ["tests/flow/a.py::t"] * 2001}, headers=ah).status_code == 422


# ── manifiesto ───────────────────────────────────────────────────────────────────────────
def test_manifest_builds_from_collect_output(client, world, monkeypatch):
    def fake_run(cmd, **kw):
        path = Path(cmd[cmd.index("--emit-manifest") + 1])
        path.write_text(json.dumps({"tests": [
            {"node_id": "tests/flow/a.py::t1", "module": "a.py", "name": "t1",
             "docstring": "Técnico: hace algo\n    UX: se ve algo", "markers": ["destructive"]},
            {"node_id": "tests/flow/a.py::t2", "module": "a.py", "name": "t2", "docstring": "solo texto"},
            {"node_id": "tests/flow/b.py::t3", "module": "b.py", "name": "t3", "docstring": None},
        ]}), encoding="utf-8")
        return CompletedProcess()

    monkeypatch.setattr(ft.subprocess, "run", fake_run)
    r = client.get(f"{FT}/manifest", headers=hdr(world["admin"]))
    assert r.status_code == 200
    body = r.json()
    assert body["modules"] == ["a.py", "b.py"]
    assert body["tests"][0]["is_destructive"] is True and body["tests"][0]["ux_description"] == "se ve algo"
    assert body["tests"][1]["technical_description"] == "solo texto" and body["tests"][1]["ux_description"] is None


def test_manifest_failure_reports_output(client, world, monkeypatch):
    monkeypatch.setattr(ft.subprocess, "run", lambda cmd, **kw: CompletedProcess(2, "salida", "error de collect"))
    r = client.get(f"{FT}/manifest", headers=hdr(world["admin"]))
    assert r.status_code == 500 and "error de collect" in r.text


def test_split_technical_ux():
    assert ft._split_technical_ux(None) == (None, None)
    assert ft._split_technical_ux("Técnico: a\nUX: b") == ("a", "b")
    assert ft._split_technical_ux("sin convención") == ("sin convención", None)


# ── corridas ─────────────────────────────────────────────────────────────────────────────
def test_run_starts_thread_and_blocks_second_run(client, world, monkeypatch):
    started = []

    class FakeThread:
        def __init__(self, target, args, daemon):
            self.target, self.args = target, args

        def start(self):
            started.append(self.args[0])

    import threading
    from types import SimpleNamespace
    monkeypatch.setattr(ft, "threading", SimpleNamespace(Thread=FakeThread, Lock=threading.Lock))
    ah = hdr(world["admin"])
    r = client.post(f"{FT}/run", json={"include_destructive": True, "node_ids": ["tests/flow/a.py::t"]}, headers=ah)
    assert r.status_code == 202 and r.json()["status"] == "running" and len(started) == 1
    again = client.post(f"{FT}/run", json={}, headers=ah)
    assert again.json()["run_id"] == r.json()["run_id"] and len(started) == 1  # no lanza otra
    assert client.get(f"{FT}/{r.json()['run_id']}", headers=ah).json()["node_ids"] == ["tests/flow/a.py::t"]


def test_runs_are_capped():
    for i in range(ft.MAX_STORED_RUNS + 3):
        ft._store_run(ft._RunState(f"r{i}", False))
    assert len(ft._runs) == ft.MAX_STORED_RUNS and "r0" not in ft._runs


def write_log(state, *lines):
    state.log_path.write_text("\n".join(lines), encoding="utf-8")


def test_background_runner_variants(monkeypatch):
    calls = []

    def run_ok(cmd, **kw):
        calls.append(cmd)
        return CompletedProcess(0)

    # selección explícita de tests
    s1 = ft._RunState("v1", False, ["tests/flow/a.py::t"])
    write_log(s1, report_line("tests/flow/a.py::t", "passed"))
    monkeypatch.setattr(ft.subprocess, "run", run_ok)
    ft._run_pytest_in_background(s1)
    assert s1.status == "completed" and s1.return_code == 0 and s1.stderr_tail is None and calls[-1][-1] == "tests/flow/a.py::t"
    # suite completa sin destructivos
    s2 = ft._RunState("v2", False)
    write_log(s2, report_line("tests/flow/a.py::t", "failed", longrepr="boom"))
    ft._run_pytest_in_background(s2)
    assert calls[-1][-2:] == ["-m", "not destructive"] and s2.return_code == 0
    # con destructivos y sin ningún test: se muestra la salida del proceso
    s3 = ft._RunState("v3", True)
    ft._run_pytest_in_background(s3)
    assert "no collectar" in s3.stderr_tail or "sin collectar" in s3.stderr_tail
    monkeypatch.setattr(ft.subprocess, "run", lambda cmd, **kw: CompletedProcess(3, "out", "err"))
    s4 = ft._RunState("v4", True)
    ft._run_pytest_in_background(s4)
    assert s4.stderr_tail.endswith("outerr")
    # tiempo agotado y error al lanzar
    monkeypatch.setattr(ft.subprocess, "run", lambda cmd, **kw: (_ for _ in ()).throw(subprocess.TimeoutExpired("pytest", 600)))
    s5 = ft._RunState("v5", False)
    ft._run_pytest_in_background(s5)
    assert "10 minutos" in s5.stderr_tail and s5.return_code == -1
    monkeypatch.setattr(ft.subprocess, "run", lambda cmd, **kw: (_ for _ in ()).throw(OSError("sin python")))
    s6 = ft._RunState("v6", False)
    ft._run_pytest_in_background(s6)
    assert "sin python" in s6.stderr_tail and s6.status == "completed"


def test_parse_report_log_merges_phases(tmp_path):
    p = tmp_path / "log.jsonl"
    p.write_text("\n".join([
        "", "no es json", json.dumps({"$report_type": "SessionStart"}),
        json.dumps({"$report_type": "TestReport", "nodeid": "", "outcome": "passed"}),
        report_line("tests/flow/a.py::t1", "passed", "setup", 0.5),
        report_line("tests/flow/a.py::t1", "failed", "call", 0.5, longrepr={"reprcrash": {"message": "falló aserción"}}),
        report_line("tests/flow/a.py::t2", "failed", longrepr={"otro": "x"}),
        report_line("tests/flow/a.py::t3", "skipped", longrepr=["f.py", 3, "Skipped: motivo"]),
        report_line("tests/flow/solo-modulo", "passed"),
    ]), encoding="utf-8")
    tests = {t["node_id"]: t for t in ft._parse_report_log(p)}
    assert tests["tests/flow/a.py::t1"]["outcome"] == "failed" and tests["tests/flow/a.py::t1"]["message"] == "falló aserción"
    assert tests["tests/flow/a.py::t1"]["duration"] == 1.0
    assert tests["tests/flow/a.py::t2"]["message"] and "otro" in tests["tests/flow/a.py::t2"]["message"]
    assert tests["tests/flow/a.py::t3"]["message"] == "Skipped: motivo"
    assert tests["tests/flow/solo-modulo"]["name"] == "tests/flow/solo-modulo"
    assert ft._parse_report_log(tmp_path / "no-existe") == []


# ── logs ─────────────────────────────────────────────────────────────────────────────────
def test_error_log_endpoints(client, world, db):
    ah = hdr(world["admin"])
    now = utc_now()
    db.add_all([
        ErrorLog(source="backend", level="error", message="b1", screen="/api/x", user_id=world["s_user"].id, user_name="Alumno A", created_at=now),
        ErrorLog(source="frontend", level="warning", message="f1", screen="/dashboard", user_id=None, created_at=now - timedelta(days=3)),
        ErrorLog(source="security", level="error", message="s1", screen="/auth", created_at=now - timedelta(days=10)),
    ])
    db.commit()
    assert client.get(LG, headers=ah).json()["total"] == 3
    assert client.get(f"{LG}?source=backend&level=error", headers=ah).json()["total"] == 1
    assert client.get(f"{LG}?screen=dash&user_name=nadie", headers=ah).json()["total"] == 0
    assert client.get(f"{LG}?screen=dash", headers=ah).json()["total"] == 1
    assert client.get(f"{LG}?user_id={world['s_user'].id}&user_name=Alumno", headers=ah).json()["total"] == 1
    since = (now - timedelta(days=5)).strftime("%Y-%m-%dT%H:%M:%S")
    until = (now - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S")
    assert client.get(f"{LG}?date_from={since}&date_to={until}", headers=ah).json()["total"] == 1
    assert client.get(f"{LG}?source=otro", headers=ah).status_code == 422
    assert client.get(LG, headers=hdr(world["s_user"])).status_code == 403
    assert isinstance(client.get(f"{LG}/users", headers=ah).json(), list)
    st = client.get(f"{LG}/stats", headers=ah).json()
    assert st["total"] == 3 and st["errors"] == 2 and st["warnings"] == 1
    assert st["backend"] == 1 and st["frontend"] == 1 and st["security"] == 1 and st["last_24h"] == 1
    assert client.get(f"{LG}/stats", headers=hdr(world["t_user"])).status_code == 403
