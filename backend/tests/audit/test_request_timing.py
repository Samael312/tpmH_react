"""Fase 11: cabecera Server-Timing y aviso de peticiones lentas."""
import logging
import time

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient

from app.core.request_timing import RequestTimingMiddleware


def make_app(slow_ms):
    app = FastAPI()

    @app.get("/fast")
    def fast():
        return {"ok": True}

    @app.get("/slow")
    def slow():
        time.sleep(0.05)
        return {"ok": True}

    @app.get("/health")
    def health():
        time.sleep(0.05)
        return {"ok": True}

    @app.get("/stream")
    def stream():
        def gen():
            yield b"a"
            yield b"b"
        return StreamingResponse(gen(), media_type="text/plain")

    app.add_middleware(RequestTimingMiddleware, slow_ms=slow_ms)
    return TestClient(app)


def test_adds_server_timing_header():
    r = make_app(0).get("/fast")
    assert r.status_code == 200
    value = r.headers["server-timing"]
    assert value.startswith("app;dur=") and float(value.split("=")[1]) >= 0


def test_slow_request_is_logged(caplog):
    with caplog.at_level(logging.WARNING, logger="app.slow_requests"):
        make_app(10).get("/slow")
    assert any("Peticion lenta: GET /slow" in r.message for r in caplog.records)


def test_fast_request_is_not_logged(caplog):
    with caplog.at_level(logging.WARNING, logger="app.slow_requests"):
        make_app(5000).get("/fast")
    assert not caplog.records


def test_zero_disables_the_log_but_not_the_header(caplog):
    with caplog.at_level(logging.WARNING, logger="app.slow_requests"):
        r = make_app(0).get("/slow")
    assert not caplog.records
    assert "server-timing" in r.headers


def test_health_is_never_logged(caplog):
    with caplog.at_level(logging.WARNING, logger="app.slow_requests"):
        make_app(10).get("/health")
    assert not caplog.records


def test_streaming_body_still_arrives_intact():
    r = make_app(10).get("/stream")
    assert r.text == "ab" and "server-timing" in r.headers
