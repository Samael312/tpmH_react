"""Fase 5: las subidas a Cloudinary van por streaming (sin cargar el archivo entero en RAM)."""
import io

import pytest

from tests.audit.conftest import hdr
from app.core import storage

API = "/api/v1"
MP4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.fixture
def cloud(monkeypatch):
    calls = {"upload": [], "upload_large": []}

    def fake(kind):
        def _f(data, **kw):
            calls[kind].append(data)
            body = data.read() if hasattr(data, "read") else data
            return {"secure_url": "http://c/x", "public_id": "pid", "resource_type": "video" if kind == "upload_large" else "image",
                    "format": "x", "bytes": len(body)}
        return _f

    monkeypatch.setattr(storage.cloudinary.uploader, "upload", fake("upload"))
    monkeypatch.setattr(storage.cloudinary.uploader, "upload_large", fake("upload_large"))
    monkeypatch.setattr(storage.cloudinary.uploader, "destroy", lambda *a, **k: {"result": "ok"})
    return calls


def test_avatar_va_como_archivo_no_como_bytes(client, world, cloud):
    r = client.post(f"{API}/users/me/avatar", files={"file": ("a.png", PNG, "image/png")}, headers=hdr(world["s_user"]))
    assert r.status_code == 200, r.text
    assert len(cloud["upload"]) == 1 and hasattr(cloud["upload"][0], "read")


def test_video_usa_subida_por_trozos(client, world, cloud):
    r = client.post(f"{API}/teachers/me/video", files={"file": ("v.mp4", MP4, "video/mp4")}, headers=hdr(world["t_user"]))
    assert r.status_code == 200, r.text
    assert len(cloud["upload_large"]) == 1 and not cloud["upload"]


def test_firma_falsa_se_rechaza_sin_subir(client, world, cloud):
    r = client.post(f"{API}/users/me/avatar", files={"file": ("a.png", b"<html>no soy png</html>", "image/png")},
                    headers=hdr(world["s_user"]))
    assert r.status_code == 400
    assert not cloud["upload"] and not cloud["upload_large"]


def test_limite_de_tamano_exacto_sin_subir(monkeypatch, cloud):
    monkeypatch.setattr(storage, "MAX_DOCUMENT_SIZE", 1000)
    ok = io.BytesIO(PNG + b"\x00" * (1000 - len(PNG)))          # 1000 bytes: permitido
    storage.upload_file_stream(ok, "a.png", "image/png")
    assert len(cloud["upload"]) == 1
    big = io.BytesIO(PNG + b"\x00" * (1001 - len(PNG)))         # 1001 bytes: rechazado
    with pytest.raises(ValueError, match="tamaño máximo"):
        storage.upload_file_stream(big, "a.png", "image/png")
    assert len(cloud["upload"]) == 1


def test_tipo_no_permitido(cloud):
    with pytest.raises(ValueError, match="no permitido"):
        storage.upload_file_stream(io.BytesIO(b"x"), "a.exe", "application/x-msdownload")


def test_upload_file_con_bytes_sigue_funcionando(cloud):
    r = storage.upload_file(PNG, "a.png", "image/png")  # camino de TTS
    assert r["url"] == "http://c/x" and isinstance(cloud["upload"][0], bytes)
