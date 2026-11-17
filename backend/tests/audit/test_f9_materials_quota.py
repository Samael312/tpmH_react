"""Fase 9: cuota de almacenamiento de materiales por profesor (413 antes de tocar Cloudinary)."""
import pytest

from tests.audit.conftest import hdr
from app.core import storage, upload_quota
from app.models.material import Material

API = "/api/v1"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 1016          # 1024 bytes


@pytest.fixture
def cloud(monkeypatch):
    calls = []

    def fake(data, **kw):
        calls.append(1)
        body = data.read() if hasattr(data, "read") else data
        return {"secure_url": "http://c/x", "public_id": f"pid{len(calls)}", "resource_type": "image",
                "format": "png", "bytes": len(body)}

    monkeypatch.setattr(storage.cloudinary.uploader, "upload", fake)
    monkeypatch.setattr(storage.cloudinary.uploader, "destroy", lambda *a, **k: {"result": "ok"})
    return calls


@pytest.fixture
def tiny_quota(monkeypatch):
    """Cuota de ~2.5 KB para probar sin subir megas: monkeypatch de quota_bytes."""
    monkeypatch.setattr(upload_quota, "quota_bytes", lambda: 2500)


def _upload(client, w, title="m", data=PNG):
    return client.post(f"{API}/materials/", data={"title": title, "category": "grammar"},
                       files={"file": ("a.png", data, "image/png")}, headers=hdr(w["t_user"]))


def test_upload_records_file_size(client, db, world, cloud):
    r = _upload(client, world)
    assert r.status_code == 201, r.text
    assert r.json()["file_size"] == len(PNG)
    assert db.get(Material, r.json()["id"]).file_size == len(PNG)


def test_quota_endpoint_reports_usage(client, world, cloud, tiny_quota):
    _upload(client, world)
    q = client.get(f"{API}/materials/quota", headers=hdr(world["t_user"])).json()
    assert q == {"used_bytes": 1024, "limit_bytes": 2500, "unlimited": False, "remaining_bytes": 1476}


def test_over_quota_is_413_and_never_reaches_cloudinary(client, world, cloud, tiny_quota):
    assert _upload(client, world, "a").status_code == 201
    assert _upload(client, world, "b").status_code == 201
    n = len(cloud)
    r = _upload(client, world, "c")               # 3 * 1024 = 3072 > 2500
    assert r.status_code == 413
    assert "espacio" in r.json()["detail"]
    assert len(cloud) == n


def test_deleting_a_material_frees_space(client, world, cloud, tiny_quota):
    a = _upload(client, world, "a").json()["id"]
    _upload(client, world, "b")
    assert _upload(client, world, "c").status_code == 413
    assert client.delete(f"{API}/materials/{a}", headers=hdr(world["t_user"])).status_code == 200
    assert _upload(client, world, "c").status_code == 201


def test_exact_limit_is_allowed(client, world, cloud, monkeypatch):
    monkeypatch.setattr(upload_quota, "quota_bytes", lambda: 2048)
    assert _upload(client, world, "a").status_code == 201
    assert _upload(client, world, "b").status_code == 201       # 2048 == limite: permitido
    assert _upload(client, world, "c").status_code == 413


def test_quota_is_per_teacher(client, db, world, cloud, tiny_quota):
    from tests.audit.conftest import _mk_user
    from app.models.teacher import TeacherProfile, TeacherStatus
    _upload(client, world, "a")
    _upload(client, world, "b")
    other = _mk_user(db, "teacher", "profe2")
    tp2 = TeacherProfile(user_id=other.id, user_username=other.username, status=TeacherStatus.approved,
                         timezone="UTC", languages=["English"], subjects=["English"], video_url="http://v")
    db.add(tp2)
    db.commit()
    r = client.post(f"{API}/materials/", data={"title": "x", "category": "grammar"},
                    files={"file": ("a.png", PNG, "image/png")}, headers=hdr(other))
    assert r.status_code == 201, r.text


def test_zero_disables_the_quota(client, world, cloud, monkeypatch):
    monkeypatch.setattr(upload_quota, "quota_bytes", lambda: 0)
    for i in range(3):
        assert _upload(client, world, f"m{i}").status_code == 201
    q = client.get(f"{API}/materials/quota", headers=hdr(world["t_user"])).json()
    assert q["unlimited"] is True and q["remaining_bytes"] is None


def test_material_without_file_and_legacy_rows_count_zero(client, db, world, cloud, tiny_quota):
    r = client.post(f"{API}/materials/", data={"title": "vocab", "category": "vocabulary"}, headers=hdr(world["t_user"]))
    assert r.status_code == 201 and r.json()["file_size"] is None
    assert upload_quota.used_bytes(db, world["tp"].id) == 0


def test_student_cannot_see_teacher_quota(client, world):
    assert client.get(f"{API}/materials/quota", headers=hdr(world["s_user"])).status_code in (401, 403)
