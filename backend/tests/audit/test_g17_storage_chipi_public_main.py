"""Cobertura de `core/storage.py`, `endpoints/chipi.py`, `endpoints/public.py` y `main.py` (sin red: Cloudinary y OpenAI simulados)."""
import asyncio
import io
import json

import pytest
from starlette.requests import Request

from app import main as main_mod
from app.api.v1.endpoints import chipi as chipi_ep
from app.api.v1.endpoints import public as public_ep
from app.core import storage
from app.core.cache import cache_invalidate
from app.models.package import Package
from app.models.payment_config import PlatformConfig
from app.models.review import Review
from tests.audit.conftest import hdr
from tests.audit.helpers import API

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32


# ── storage ──────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("ctype,good,bad", [
    ("application/pdf", b"%PDF-1.4", b"nope"),
    ("image/jpeg", b"\xff\xd8\xff\xe0", b"nope"),
    ("image/png", PNG, b"nope"),
    ("image/gif", b"GIF89a....", b"nope"),
    ("image/webp", b"RIFF\x00\x00\x00\x00WEBP", b"RIFFxxxxnope"),
    ("video/mp4", b"\x00\x00\x00\x18ftypmp42", b"xxxxxxxxxxxx"),
    ("audio/mpeg", b"ID3\x03\x00", b"\x00\x00\x00"),
    ("application/msword", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", b"nope"),
    ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", b"PK\x03\x04", b"nope"),
])
def test_magic_bytes(ctype, good, bad):
    assert storage._matches_declared_type(good, ctype) is True
    assert storage._matches_declared_type(bad, ctype) is False


def test_magic_bytes_extra_cases():
    assert storage._matches_declared_type(b"\xff\xfb\x90\x00", "audio/mpeg") is True  # cabecera de trama MP3
    assert storage._matches_declared_type(b"\xff", "audio/mpeg") is False
    assert storage._matches_declared_type(b"cualquier cosa", "text/plain") is True  # tipo sin firma conocida


def test_resource_types():
    assert storage._resource_type_for("video/mp4") == "video"
    assert storage._resource_type_for("image/png") == "image"
    assert storage._resource_type_for("application/pdf") == "auto"


class FakeUploader:
    def __init__(self):
        self.calls = []

    def upload(self, data, **kw):
        self.calls.append(("upload", kw))
        return {"secure_url": "https://cdn/x.png", "public_id": "p/1", "resource_type": "image", "format": "png", "bytes": 40}

    def upload_large(self, data, **kw):
        self.calls.append(("upload_large", kw))
        return {"secure_url": "https://cdn/v.mp4", "public_id": "p/2"}

    def destroy(self, public_id, **kw):
        if public_id == "boom":
            raise RuntimeError("sin red")
        return {"result": "ok" if public_id == "p/1" else "not found"}


@pytest.fixture
def uploader(monkeypatch):
    fake = FakeUploader()
    monkeypatch.setattr(storage.cloudinary, "uploader", fake)
    return fake


def test_upload_and_validation(uploader):
    out = storage.upload_file(PNG, "Foto Bonita.png", "image/png", display_name="Mi foto")
    assert out["public_id"] == "p/1" and uploader.calls[-1][1]["filename"] == "mi-foto.png"
    with pytest.raises(ValueError, match="no permitido"):
        storage.upload_file(b"x", "a.exe", "application/x-msdownload")
    with pytest.raises(ValueError, match="no coincide"):
        storage.upload_file(b"no es png", "a.png", "image/png")
    big = PNG + b"0" * (storage.MAX_DOCUMENT_SIZE + 1)
    with pytest.raises(ValueError, match="tamaño máximo"):
        storage.upload_file(big, "a.pdf", "application/pdf") if False else storage._validate_upload(b"%PDF-", storage.MAX_DOCUMENT_SIZE + 1, "application/pdf")
    with pytest.raises(ValueError, match="video supera"):
        storage._validate_upload(b"\x00\x00\x00\x18ftypmp42", storage.MAX_VIDEO_SIZE + 1, "video/mp4")
    with pytest.raises(ValueError, match="tamaño máximo"):
        storage._validate_upload(PNG, 100, "image/png", max_bytes=10)


def test_upload_stream_paths(uploader):
    assert storage.upload_file_stream(io.BytesIO(PNG), "f.png", "image/png")["url"] == "https://cdn/x.png"
    video = io.BytesIO(b"\x00\x00\x00\x18ftypmp42" + b"0" * 32)
    out = storage.upload_file_stream(video, "v.mp4", "video/mp4", folder="videos")
    assert uploader.calls[-1][0] == "upload_large" and out["format"] == ""
    with pytest.raises(ValueError, match="no permitido"):
        storage.upload_file_stream(io.BytesIO(PNG), "f.png", "image/png", allowed_types={"application/pdf"})


def test_upload_failure_and_delete(uploader, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("cloudinary caído")

    monkeypatch.setattr(uploader, "upload", boom)
    with pytest.raises(ValueError, match="Error al subir"):
        storage.upload_file(PNG, "a.png", "image/png")
    assert storage.delete_file("p/1") is True
    assert storage.delete_file("otro") is False
    assert storage.delete_file("boom") is False


# ── Chipi ────────────────────────────────────────────────────────────────────────────────
@pytest.fixture
def fake_ai(monkeypatch):
    state = {"fail": False, "prompts": []}

    async def get_resp(message, system_prompt, history):
        state["prompts"].append(system_prompt)
        if state["fail"]:
            raise ValueError("openai caído")
        return "Hola, soy Chipi"

    async def stream_resp(message, system_prompt, history):
        state["prompts"].append(system_prompt)
        if state["fail"]:
            raise RuntimeError("stream roto")
        yield "Ho"
        yield "la"

    monkeypatch.setattr(chipi_ep, "get_chipi_response", get_resp)
    monkeypatch.setattr(chipi_ep, "stream_chipi_response", stream_resp)
    return state


def test_chipi_plain_and_stream_for_every_role(client, world, db, fake_ai):
    from tests.audit.test_g1_god_mode_actions import mk_teacher
    ta, _ = mk_teacher(db, "profe_admin_chipi", "teacher_admin")
    body = {"message": "¿Cómo reservo?", "screen": "/dashboard", "history": [{"role": "user", "content": "hola"}, {"role": "assistant", "content": "qué tal"}]}
    for user in (None, world["s_user"], world["t_user"], ta, world["admin"]):
        h = hdr(user) if user else {}
        r = client.post(f"{API}/chipi/chat", json={**body, "stream": False}, headers=h)
        assert r.status_code == 200 and r.json()["response"] == "Hola, soy Chipi", r.text
    s = client.post(f"{API}/chipi/chat", json={**body, "stream": True}, headers=hdr(world["s_user"]))
    chunks = [json.loads(line[6:]) for line in s.text.split("\n\n") if line.startswith("data: ")]
    assert [c.get("chunk") for c in chunks[:2]] == ["Ho", "la"] and chunks[-1] == {"done": True}


def test_chipi_failures_do_not_leak_details(client, world, fake_ai):
    fake_ai["fail"] = True
    body = {"message": "hola", "screen": "/x", "history": []}
    r = client.post(f"{API}/chipi/chat", json={**body, "stream": False}, headers=hdr(world["s_user"]))
    assert r.status_code == 500 and "openai" not in r.text
    s = client.post(f"{API}/chipi/chat", json={**body, "stream": True}, headers=hdr(world["s_user"]))
    err = json.loads(s.text.split("data: ", 1)[1].splitlines()[0])["error"]
    assert "no está disponible" in err and "stream roto" not in s.text


# ── landing pública ──────────────────────────────────────────────────────────────────────
def test_landing_single_and_multi_tenant(client, world, db):
    cfg = db.query(PlatformConfig).first()
    tp, sp = world["tp"], world["sp"]
    tp.profile_photo_url = "https://cdn/p.png"
    db.add(Package(teacher_id=tp.id, name="Pack", subject="English", classes_count=4, price=40.0, duration_minutes=50, is_active=True))
    db.add(Review(teacher_id=tp.id, student_id=sp.id, rating=5.0, comment="Excelente"))
    db.add(Review(teacher_id=tp.id, student_id=None, rating=4.0, comment="Muy bien", legacy_student_name="Ana Legacy", is_legacy=True))
    db.commit()
    for single in (False, True):
        cfg.is_single_tenant = single
        if single:
            cfg.featured_teacher_id = tp.id
        db.commit()
        cache_invalidate(public_ep.LANDING_CACHE_KEY)
        r = client.get(f"{API}/public/landing")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["is_single_tenant"] is single
        assert len(body["teachers"]) == 1 and len(body["packages"]) == 2
        names = {rv["student_name"] for rv in body["reviews"]}
        assert "Ana Legacy" in names and len(body["reviews"]) == 2
    cache_invalidate(public_ep.LANDING_CACHE_KEY)


def test_display_name_fallbacks():
    class T:
        def __init__(self, name, surname, username):
            self.name, self.surname, self.user_username = name, surname, username

    assert public_ep._display_name(T("Ana", "Pérez", "ana")) == "Ana Pérez"
    assert public_ep._display_name(T(None, None, "ana.perez_x")) == "ana perez x"
    assert public_ep._display_name(T("", "", None)) == "Profesor"


# ── main.py ──────────────────────────────────────────────────────────────────────────────
def test_lifespan_starts_and_stops(monkeypatch):
    calls = []
    monkeypatch.setattr(main_mod, "start_scheduler", lambda: calls.append("start"))
    monkeypatch.setattr(main_mod, "stop_scheduler", lambda: calls.append("stop"))
    monkeypatch.setattr(main_mod, "shutdown_email_queue", lambda: calls.append("mail"))

    async def run():
        async with main_mod.lifespan(main_mod.app):
            calls.append("running")

    asyncio.run(run())
    assert calls == ["start", "running", "stop", "mail"]


def test_unhandled_exception_handler_logs_and_returns_500(db):
    scope = {"type": "http", "method": "GET", "path": "/api/v1/boom", "query_string": b"a=1", "headers": [], "client": ("t", 1), "server": ("t", 80)}
    request = Request(scope)
    try:
        raise RuntimeError("fallo imprevisto")
    except RuntimeError as exc:
        resp = asyncio.run(main_mod.unhandled_exception_handler(request, exc))
    assert resp.status_code == 500 and b"error interno" in resp.body
    from app.models.error_log import ErrorLog
    db.expire_all()
    assert db.query(ErrorLog).filter(ErrorLog.message.like("RuntimeError%")).count() == 1
