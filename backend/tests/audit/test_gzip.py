"""Fase 11: compresion gzip de la API (y el streaming de Chipi NO se comprime)."""
import pytest
from fastapi.responses import JSONResponse, StreamingResponse

from app.main import app

BIG = {"items": [{"id": i, "name": "profesor de ingles numero " + str(i)} for i in range(400)]}


@pytest.fixture()
def routes():
    async def big():
        return JSONResponse(BIG)

    async def small():
        return JSONResponse({"ok": True})

    async def sse():
        async def gen():
            for i in range(300):
                yield f"data: {'token ' * 10}{i}\n\n"
        return StreamingResponse(gen(), media_type="text/event-stream")

    app.add_api_route("/__gz/big", big)
    app.add_api_route("/__gz/small", small)
    app.add_api_route("/__gz/sse", sse)
    yield
    app.router.routes[:] = [r for r in app.router.routes if not getattr(r, "path", "").startswith("/__gz")]


def test_big_json_is_compressed(client, routes):
    r = client.get("/__gz/big", headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200
    assert r.headers.get("content-encoding") == "gzip"
    assert r.json() == BIG  # el cliente descomprime solo: el contenido es el mismo


def test_not_compressed_if_client_does_not_ask(client, routes):
    r = client.get("/__gz/big", headers={"Accept-Encoding": "identity"})
    assert "content-encoding" not in r.headers


def test_small_response_is_not_compressed(client, routes):
    r = client.get("/__gz/small", headers={"Accept-Encoding": "gzip"})
    assert "content-encoding" not in r.headers


def test_event_stream_is_never_compressed(client, routes):
    r = client.get("/__gz/sse", headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200
    assert "content-encoding" not in r.headers
    assert r.text.startswith("data: token")


def test_pagination_header_still_exposed_with_gzip(client):
    r = client.get("/health", headers={"Accept-Encoding": "gzip", "Origin": "http://localhost:3000"})
    assert r.status_code == 200
