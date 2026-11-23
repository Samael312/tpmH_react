"""Cobertura de `users.py` (perfil, avatar, preferencias, profesores, borrado) y `teachers.py` (vídeo, apelaciones, alumnos)."""
import io

import pytest

from tests.audit.conftest import _mk_user, hdr, future
from tests.audit.helpers import API, ready_student
from tests.audit.test_g1_god_mode_actions import mk_teacher, mk_student, mk_class, mk_enrollment
from app.models.google_calendar import GoogleCalendarToken
from app.models.material import Material
from app.models.package import Enrollment, EnrollmentStatus
from app.models.payment import Payment, TeacherWallet, Withdrawal
from app.models.student_teacher_link import StudentTeacherLink
from app.models.teacher import TeacherStatus
from app.models.teacher_appeal import TeacherAppeal

U = f"{API}/users"
T = f"{API}/teachers"
GOOD_PW = "Password123"


@pytest.fixture
def fake_storage(monkeypatch):
    calls = {"deleted": [], "uploads": 0}

    def fake_upload(stream, filename, content_type, folder, display_name=None, **kw):
        stream.read()
        calls["uploads"] += 1
        if filename.endswith(".exe"):
            raise ValueError("Tipo no permitido")
        if filename.endswith(".boom"):
            raise RuntimeError("fallo de red")
        return {"url": f"http://cdn.test/{filename}", "public_id": f"pid/{calls['uploads']}", "resource_type": "image"}

    def fake_delete(pid, resource_type="image"):
        calls["deleted"].append(pid)
        return True

    for mod in ("users", "teachers", "materials"):
        monkeypatch.setattr(f"app.api.v1.endpoints.{mod}.upload_file_stream", fake_upload, raising=False)
        monkeypatch.setattr(f"app.api.v1.endpoints.{mod}.delete_file", fake_delete, raising=False)
    return calls


def png():
    return io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"0" * 32)


# ── perfil ───────────────────────────────────────────────────────────────────────────────
def test_profile_update_paths(client, world, db):
    h = hdr(world["s_user"])
    assert client.get(f"{U}/me", headers=h).status_code == 200
    p = lambda **b: client.patch(f"{U}/me", json=b, headers=h)
    assert p(name="Nuevo").status_code == 200
    other = _mk_user(db, "student", "otro_nombre")
    other.phone_number = "+584140000001"
    db.commit()
    assert p(username="otro_nombre").status_code == 400  # ya en uso
    assert p(phone_number="+584140000001").status_code == 400
    assert p(phone_number="+584149999999").status_code == 200
    world["s_user"].avatar = None
    world["s_user"].onboarding_completed = False
    world["sp"].profile_photo_url = None
    db.commit()
    assert p(onboarding_completed=True).status_code == 422  # sin foto
    world["s_user"].google_id = "g-123"
    db.commit()
    assert p(email="nuevo@correo.com").status_code == 400  # cuenta de Google
    world["s_user"].google_id = None
    db.commit()
    r = p(email="NuevoCorreo@correo.com")
    assert r.status_code == 200 and r.json()["is_verified"] is False
    taken = _mk_user(db, "student", "tomado")
    db.commit()
    assert p(email=taken.email).status_code in (400, 200)


def test_change_password_paths(client, world, db):
    h = hdr(world["s_user"])
    cp = lambda **b: client.post(f"{U}/me/change-password", json=b, headers=h)
    assert cp(current_password="mala", new_password="NuevaClave123").status_code == 400
    assert cp(current_password=GOOD_PW, new_password="corta").status_code == 422
    assert cp(current_password=GOOD_PW, new_password="NuevaClave123").status_code == 200
    world["s_user"].password_hash = None
    db.commit()
    assert cp(current_password="x", new_password="NuevaClave123").status_code == 400


# ── avatar ───────────────────────────────────────────────────────────────────────────────
def test_avatar_upload_and_reads(client, world, db, fake_storage):
    h = hdr(world["s_user"])
    assert client.get(f"{U}/me/avatar", headers=h).json()
    assert client.get(f"{U}/me/photo", headers=h).status_code == 200
    f = lambda name="a.png": {"file": (name, png(), "image/png")}
    assert client.post(f"{U}/me/avatar", files=f(), headers=h).status_code == 200
    assert client.patch(f"{U}/me/avatar", files=f("b.png"), headers=h).status_code == 200  # borra la anterior
    assert client.post(f"{U}/me/photo", files=f("c.png"), headers=h).status_code == 200
    assert client.patch(f"{U}/me/photo", files=f("d.png"), headers=h).status_code == 200
    assert client.get(f"{U}/me/avatar", headers=h).json()
    assert client.post(f"{U}/me/avatar", files=f("v.exe"), headers=h).status_code == 400
    assert client.post(f"{U}/me/avatar", files=f("x.boom"), headers=h).status_code == 500
    th = hdr(world["t_user"])
    assert client.post(f"{U}/me/avatar", files=f("t.png"), headers=th).status_code == 200
    assert client.post(f"{U}/me/avatar", files=f("t2.png"), headers=th).status_code == 200
    assert client.get(f"{U}/me/avatar", headers=th).json()
    world["t_user"].avatar = None
    db.commit()
    assert client.get(f"{U}/me/avatar", headers=th).status_code == 200


# ── perfil de alumno y preferencias ──────────────────────────────────────────────────────
def test_student_profile_endpoints(client, world, db):
    sh = hdr(world["s_user"])
    assert client.get(f"{U}/me/student-profile", headers=sh).status_code == 200
    assert client.get(f"{U}/me/student-profile", headers=hdr(world["t_user"])).status_code == 403
    assert client.patch(f"{U}/me/student-profile", json={"goal": "Viajar"}, headers=hdr(world["t_user"])).status_code == 403
    assert client.patch(f"{U}/me/student-profile", json={"timezone": "Mars/Base"}, headers=sh).status_code == 422
    assert client.patch(f"{U}/me/student-profile", json={"timezone": "America/Caracas", "goal": "Trabajo"}, headers=sh).status_code == 200
    bare = _mk_user(db, "student", "sin_perfil_p")
    db.commit()
    assert client.get(f"{U}/me/student-profile", headers=hdr(bare)).status_code == 404
    assert client.patch(f"{U}/me/student-profile", json={"goal": "x"}, headers=hdr(bare)).status_code == 404


def test_schedule_preferences(client, world, db):
    sh = hdr(world["s_user"])
    body = {"timezone": "UTC", "slots": [{"day_of_week": 1, "start_time_local": "09:00", "end_time_local": "11:00"}]}
    assert client.get(f"{U}/me/preferences", headers=sh).json() == []
    assert client.post(f"{U}/me/preferences", json=body, headers=sh).status_code == 200
    assert client.put(f"{U}/me/preferences", json=body, headers=sh).status_code == 200
    assert len(client.get(f"{U}/me/preferences", headers=sh).json()) == 1
    for method in (client.post, client.put):
        assert method(f"{U}/me/preferences", json={**body, "timezone": "Mars/Base"}, headers=sh).status_code == 400
        assert method(f"{U}/me/preferences", json={"timezone": "UTC", "slots": [{"day_of_week": 1, "start_time_local": "99:00", "end_time_local": "11:00"}]}, headers=sh).status_code in (400, 422)


# ── profesores del alumno ────────────────────────────────────────────────────────────────
def test_student_teachers_link_unlink(client, world, db):
    sh = hdr(world["s_user"])
    from app.models.payment_config import PlatformConfig
    cfg = db.query(PlatformConfig).first()
    ta = world["t_user"].username
    assert client.post(f"{U}/me/teachers/nadie", headers=sh).status_code == 404
    assert client.post(f"{U}/me/teachers/{ta}", headers=sh).status_code in (200, 201)
    assert client.get(f"{U}/me/teachers", headers=sh).status_code == 200
    # un profesor que ya no tiene usuario válido se omite del listado
    assert client.delete(f"{U}/me/teachers/nadie", headers=sh).status_code == 404
    e = Enrollment(student_id=world["sp"].id, package_id=world["pkg"].id, teacher_id=world["tp"].id, status=EnrollmentStatus.active, classes_total=4)
    db.add(e)
    db.commit()
    assert client.delete(f"{U}/me/teachers/{ta}", headers=sh).status_code == 400  # paquete activo
    e.status = EnrollmentStatus.completed
    db.commit()
    assert client.delete(f"{U}/me/teachers/{ta}", headers=sh).status_code == 200
    cfg.is_single_tenant = True
    db.commit()
    assert client.delete(f"{U}/me/teachers/{ta}", headers=sh).status_code == 400


def test_my_teachers_shows_pending_refund(client, world, db):
    sh = hdr(world["s_user"])
    eid, _ = ready_student(client, world)
    db.expire_all()
    e = db.get(Enrollment, eid)
    db.add(Payment(enrollment_id=e.id, student_id=e.student_id, teacher_id=e.teacher_id, amount_total=5, amount_teacher=0,
                   amount_platform=0, payment_method="manual", status="pending_review", payment_type="refund"))
    db.commit()
    r = client.get(f"{U}/me/teachers", headers=sh)
    assert r.status_code == 200 and r.json()


# ── borrar cuenta ────────────────────────────────────────────────────────────────────────
def test_delete_account_student(client, world, db, fake_storage):
    sh = hdr(world["s_user"])
    d = lambda **b: client.request("DELETE", f"{U}/me", json=b, headers=sh)
    assert d(confirm_username="otro", password=GOOD_PW).status_code == 400
    assert d(confirm_username=world["s_user"].username, password="mala").status_code == 400
    # con un paquete con clases libres y un pago pendiente no se puede borrar
    eid, _ = ready_student(client, world)
    r = d(confirm_username=world["s_user"].username, password=GOOD_PW)
    assert r.status_code == 409
    db.expire_all()
    e = db.get(Enrollment, eid)
    e.status = EnrollmentStatus.completed
    e.classes_used = e.classes_total
    db.add(Payment(enrollment_id=e.id, student_id=e.student_id, teacher_id=e.teacher_id, amount_total=5, amount_teacher=0,
                   amount_platform=0, payment_method="manual", status="pending_review", payment_type="package"))
    db.commit()
    assert "pagos pendientes" in d(confirm_username=world["s_user"].username, password=GOOD_PW).text
    db.query(Payment).filter(Payment.status == "pending_review").update({"status": "approved"})
    world["sp"].profile_photo_public_id = "pid/foto"
    db.commit()
    ok = d(confirm_username=world["s_user"].username, password=GOOD_PW)
    assert ok.status_code == 200, ok.text
    assert "pid/foto" in fake_storage["deleted"]


def test_delete_account_teacher_blockers_and_retire(client, world, db, fake_storage):
    th = hdr(world["t_user"])
    d = lambda: client.request("DELETE", f"{U}/me", json={"confirm_username": world["t_user"].username, "password": GOOD_PW}, headers=th)
    db.add(TeacherWallet(teacher_id=world["tp"].id, available_balance=10.0, total_earned=10.0, total_withdrawn=0.0))
    db.add(Withdrawal(teacher_id=world["tp"].id, amount=5.0, status="pending", destination_details="x"))
    db.commit()
    r = d()
    assert r.status_code == 409 and "retiro" in r.text.lower() and "billetera" in r.text.lower()
    db.query(TeacherWallet).update({"available_balance": 0.0})
    db.query(Withdrawal).update({"status": "completed"})
    tp = world["tp"]
    tp.video_public_id = "vid/1"
    tp.video_pending_public_id = "vid/2"
    tp.profile_photo_public_id = "pid/prof"
    db.add(Material(teacher_id=tp.id, title="M", category="other", file_url="http://x", file_public_id="mat/1", file_type="video", is_active=True))
    db.add(Material(teacher_id=tp.id, title="M2", category="other", file_url="http://y", file_public_id="mat/2", file_type="raw", is_active=True))
    db.add(GoogleCalendarToken(user_id=world["t_user"].id, teacher_id=tp.id, access_token="tok", refresh_token="ref"))
    db.commit()
    ok = d()
    assert ok.status_code == 200, ok.text
    assert {"vid/1", "vid/2", "mat/1", "mat/2", "pid/prof"} <= set(fake_storage["deleted"])


# ── profesores: perfil, alumnos, vídeo, apelaciones ──────────────────────────────────────
def test_teacher_public_and_own_profile(client, world, db):
    assert client.get(f"{T}/").status_code == 200
    assert client.get(f"{T}/?subject=English&language=English&search=profe").status_code in (200, 422)
    assert client.get(f"{T}/{world['t_user'].username}").status_code == 200
    assert client.get(f"{T}/nadie").status_code == 404
    h = hdr(world["t_user"])
    assert client.get(f"{T}/me/profile", headers=h).status_code == 200
    assert client.patch(f"{T}/me/profile", json={"bio": "Hola"}, headers=h).status_code == 200
    world["tp"].social_links = {"whatsapp": "+58414", "instagram": "x"}
    db.commit()
    from app.models.payment_config import PlatformConfig
    db.query(PlatformConfig).update({"show_teacher_whatsapp": False})
    db.commit()
    pub = client.get(f"{T}/{world['t_user'].username}").json()
    assert "whatsapp" not in (pub.get("social_links") or {})
    bare = _mk_user(db, "teacher", "sin_perfil_t")
    db.commit()
    assert client.get(f"{T}/me/profile", headers=hdr(bare)).status_code in (403, 404)


def test_teacher_students_lists(client, world, db):
    h = hdr(world["t_user"])
    ready_student(client, world)
    world["tp"].students = [world["sp"].id, 99999]
    db.commit()
    assert client.get(f"{T}/me/students", headers=h).status_code == 200
    r = client.get(f"{T}/me/students-full", headers=h)
    assert r.status_code == 200 and r.json()


def test_teacher_video_upload_and_delete(client, world, db, fake_storage):
    h = hdr(world["t_user"])
    f = lambda name: {"file": (name, io.BytesIO(b"\x00\x00\x00\x18ftypmp42" + b"0" * 32), "video/mp4")}
    tp = world["tp"]
    # aprobado con vídeo: el nuevo queda pendiente
    assert client.post(f"{T}/me/video", files=f("n1.mp4"), headers=h).status_code == 200
    assert client.post(f"{T}/me/video", files=f("n2.mp4"), headers=h).status_code == 200  # pisa el pendiente
    assert client.post(f"{T}/me/video", files=f("n.exe"), headers=h).status_code == 400
    # rechazado: el vídeo nuevo reinicia la revisión
    db.expire_all()
    tp.status = TeacherStatus.rejected
    tp.video_public_id = "old/vid"
    tp.video_pending_url = None
    tp.video_pending_public_id = None
    db.commit()
    r = client.post(f"{T}/me/video", files=f("n3.mp4"), headers=h)
    assert r.status_code == 200 and "revisión" in r.json()["message"]
    # con una apelación de vídeo pendiente no se sube otro
    db.add(TeacherAppeal(teacher_id=tp.id, appeal_number=1, message="x", kind="video", status="pending"))
    db.commit()
    assert client.post(f"{T}/me/video", files=f("n4.mp4"), headers=h).status_code == 400
    assert client.delete(f"{T}/me/video", headers=h).status_code == 200
    assert client.patch(f"{T}/me/feedback-seen", headers=h).status_code == 200


def test_teacher_appeals(client, world, db):
    h = hdr(world["t_user"])
    tp = world["tp"]
    ap = lambda msg="Por favor revisen": client.post(f"{T}/me/appeal", json={"message": msg}, headers=h)
    assert ap().status_code == 400  # aprobado: nada que apelar
    assert ap("   ").status_code == 422
    tp.status = TeacherStatus.rejected
    db.commit()
    assert ap().status_code == 201
    assert ap().status_code == 400  # ya hay una pendiente
    db.query(TeacherAppeal).update({"status": "rejected"})
    tp.appeal_count = 2
    db.commit()
    assert ap().status_code == 400  # agotadas
    tp.appeal_count = 0
    db.commit()
    assert ap().status_code == 201
    assert len(client.get(f"{T}/me/appeals", headers=h).json()) == 2
    # apelación del vídeo nuevo
    db.query(TeacherAppeal).update({"status": "approved"})
    tp.status = TeacherStatus.approved
    tp.video_pending_rejection_reason = "Mala calidad"
    tp.video_pending_appeal_used = False
    db.commit()
    assert ap().status_code == 201
    db.query(TeacherAppeal).update({"status": "rejected"})
    db.commit()
    assert ap().status_code == 400  # ya apelaste este vídeo
    assert client.get(f"{T}/me/notifications", headers=h).status_code == 200
    assert client.get(f"{T}/me/notifications/unread-count", headers=h).status_code == 200
    assert client.post(f"{T}/me/notifications/mark-all-read", headers=h).status_code == 200
    assert client.patch(f"{T}/me/notifications/999/read", headers=h).status_code == 404
