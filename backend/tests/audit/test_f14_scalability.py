"""Fase 14 — escalabilidad sin cambiar la estructura base."""
import time
from datetime import timedelta


def test_emails_leave_the_request_path_when_async(monkeypatch):
    """E1: con EMAIL_ASYNC el correo se encola y la petición no espera a Resend; al apagar, la cola se vacía."""
    import resend
    from app.core import email as email_mod
    from app.core.config import settings

    sent = []

    def slow_send(payload):
        time.sleep(0.3)
        sent.append(payload["to"])
        return {"id": "x"}

    monkeypatch.setattr(resend.Emails, "send", slow_send)
    monkeypatch.setattr(settings, "EMAIL_ASYNC", True)
    t0 = time.monotonic()
    assert email_mod._send("a@x.com", "Asunto", "<p>hola</p>") is True
    assert email_mod._send("b@x.com", "Asunto", "<p>hola</p>") is True
    assert time.monotonic() - t0 < 0.2  # no esperó a los 0,3 s de cada envío
    email_mod.shutdown_email_queue(wait=True)
    assert sorted(sent) == ["a@x.com", "b@x.com"]


def test_emails_are_sent_inline_when_async_is_off(monkeypatch):
    import resend
    from app.core import email as email_mod
    from app.core.config import settings

    sent = []
    monkeypatch.setattr(resend.Emails, "send", lambda p: sent.append(p["to"]) or {"id": "x"})
    monkeypatch.setattr(settings, "EMAIL_ASYNC", False)
    assert email_mod._send("c@x.com", "Asunto", "<p>hola</p>") is True
    assert sent == ["c@x.com"]


# ─── E3: caché corta de la rejilla de huecos ─────────────────────────────────

from tests.audit.conftest import future, hdr  # noqa: E402

API = "/api/v1"


def _slots(client, world, date):
    r = client.get(f"{API}/availability/profe/slots?date={date}&duration=50", headers=hdr(world["s_user"]))
    assert r.status_code == 200, r.text
    return {s["start_time_utc"][:16]: s for s in r.json()}


def _count_grid_loads(monkeypatch):
    """Cuenta cuántas veces se recalcula la rejilla (la llamada a Google es parte del cálculo)."""
    from app.api.v1.endpoints import availability as av
    calls = []
    monkeypatch.setattr(av, "get_teacher_busy_ranges", lambda **k: calls.append(1) or [])
    return calls


def _add_class(db, world, start, status="confirmed"):
    from app.models.class_ import Class
    c = Class(teacher_id=world["tp"].id, student_id=world["sp"].id, start_time_utc=start,
              end_time_utc=start + timedelta(minutes=50), duration=50, buffer_minutes=10, status=status)
    db.add(c)
    db.commit()
    return c


def test_slot_grid_is_cached_between_requests(client, world, monkeypatch):
    calls = _count_grid_loads(monkeypatch)
    date = future(72).strftime("%Y-%m-%d")
    first = _slots(client, world, date)
    second = _slots(client, world, date)
    assert first == second
    assert len(calls) == 1  # la segunda petición no recalculó (ni llamó a Google)
    _slots(client, world, future(96).strftime("%Y-%m-%d"))
    assert len(calls) == 2  # otra fecha, otra entrada


def test_booking_and_cancelling_invalidate_the_teacher_slots(client, world, db, monkeypatch):
    calls = _count_grid_loads(monkeypatch)
    start = future(72).replace(hour=10)
    date, key = start.strftime("%Y-%m-%d"), start.strftime("%Y-%m-%dT%H:%M")
    assert _slots(client, world, date)[key]["is_available"] is True

    c = _add_class(db, world, start)
    assert _slots(client, world, date)[key]["is_available"] is False

    c.status = "cancelled"
    db.commit()
    assert _slots(client, world, date)[key]["is_available"] is True
    assert len(calls) == 3


def test_availability_change_and_bulk_update_invalidate(client, world, db, monkeypatch):
    from app.models.availability import TeacherAvailabilityException
    from app.models.class_ import Class
    _count_grid_loads(monkeypatch)
    start = future(72).replace(hour=10)
    date, key = start.strftime("%Y-%m-%d"), start.strftime("%Y-%m-%dT%H:%M")
    _add_class(db, world, start)
    assert _slots(client, world, date)[key]["is_available"] is False

    # UPDATE masivo (como al banear un alumno): no sabe de qué profesor, borra toda la caché de huecos
    db.query(Class).filter(Class.student_id == world["sp"].id).update({"status": "cancelled"}, synchronize_session=False)
    db.commit()
    assert _slots(client, world, date)[key]["is_available"] is True

    db.add(TeacherAvailabilityException(teacher_id=world["tp"].id, start_time_utc=start,
                                        end_time_utc=start + timedelta(hours=2), is_available=False))
    db.commit()
    assert _slots(client, world, date)[key]["is_available"] is False


def test_other_teachers_cache_survives(client, world, db, monkeypatch):
    from app.core import cache
    from app.core.slots_cache import slots_key
    cache.cache_set(slots_key(999, "2099-01-01", 50, 60), ["otro"], 60)
    _add_class(db, world, future(72).replace(hour=10))
    assert cache.cache_get(slots_key(999, "2099-01-01", 50, 60)) == ["otro"]


def test_slots_cache_can_be_disabled(client, world, monkeypatch):
    from app.core.config import settings
    calls = _count_grid_loads(monkeypatch)
    monkeypatch.setattr(settings, "SLOTS_CACHE_TTL_SECONDS", 0)
    date = future(72).strftime("%Y-%m-%d")
    _slots(client, world, date)
    _slots(client, world, date)
    assert len(calls) == 2


# ─── E4: Cache-Control en lo público ─────────────────────────────────────────

def test_public_endpoints_send_cache_control(client, world):
    for path in ("/public/landing", "/teachers/", "/teachers/profe"):
        r = client.get(f"{API}{path}")
        assert r.status_code == 200, (path, r.text)
        cc = r.headers.get("cache-control", "")
        assert "public" in cc and "max-age=60" in cc and "stale-while-revalidate=300" in cc, (path, cc)
        assert "set-cookie" not in r.headers, path  # una respuesta con cookie no debe cachearse en compartido


def test_public_cache_skips_errors_and_private_routes(client, world):
    r = client.get(f"{API}/teachers/no-existe")
    assert r.status_code == 404
    assert "public" not in r.headers.get("cache-control", "")
    r = client.get(f"{API}/teachers/me/profile", headers=hdr(world["t_user"]))
    assert r.status_code == 200, r.text
    assert "public" not in r.headers.get("cache-control", "")


def test_public_cache_can_be_disabled(client, world, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "PUBLIC_CACHE_MAX_AGE", 0)
    assert client.get(f"{API}/teachers/").headers.get("cache-control") == "no-cache"


# ─── E6: listados del admin paginados y filtrados en el servidor ─────────────

def test_admin_users_reports_active_count_across_pages(client, world, db):
    from tests.audit.conftest import _mk_user
    for i in range(3):
        u = _mk_user(db, "student", f"extra{i}")
        u.is_active = i != 0  # uno inactivo
    db.commit()
    r = client.get(f"{API}/admin/users?role=student&is_banned=false&limit=1&skip=0", headers=hdr(world["admin"]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["users"]) == 1
    assert body["total"] == 4  # alumno + 3 extra
    assert body["active_count"] == 3  # contado en el servidor, no en la página
    r = client.get(f"{API}/admin/users?role=student&is_active=false", headers=hdr(world["admin"]))
    assert r.json()["active_count"] == 0


def test_admin_teachers_filters_by_video_in_server(client, world, db):
    from tests.audit.conftest import _mk_user
    from app.models.teacher import TeacherProfile, TeacherStatus
    u = _mk_user(db, "teacher", "sinvideo")
    db.add(TeacherProfile(user_id=u.id, user_username=u.username, status=TeacherStatus.pending, timezone="UTC",
                          languages=["English"], subjects=["English"], video_url=None))
    db.commit()
    h = hdr(world["admin"])
    all_ = client.get(f"{API}/admin/teachers", headers=h)
    with_video = client.get(f"{API}/admin/teachers?has_video=true", headers=h)
    without = client.get(f"{API}/admin/teachers?has_video=false", headers=h)
    assert all_.headers["x-total-count"] == "2"
    assert [t["username"] for t in with_video.json()] == ["profe"]
    assert with_video.headers["x-total-count"] == "1"
    assert [t["username"] for t in without.json()] == ["sinvideo"]


# ─── E9: menos consultas en lo que el dashboard y la reserva piden siempre ───
# Medido con tests/load (E5): cada consulta cuesta un viaje de red a Neon. Estos topes fallan si vuelven a crecer.

def _sql(fn):
    from sqlalchemy import event
    from app.db.base import engine
    stmts = []
    hook = lambda conn, cur, statement, *a: stmts.append(statement)  # noqa: E731
    event.listen(engine, "before_cursor_execute", hook)
    try:
        r = fn()
    finally:
        event.remove(engine, "before_cursor_execute", hook)
    return r, stmts


def test_dashboard_and_booking_query_budget(client, world, monkeypatch):
    from app.core import email as email_mod
    from tests.audit.helpers import book, ready_student
    eid, _ = ready_student(client, world)
    monkeypatch.setattr(email_mod, "_send", lambda *a, **k: True)  # los correos van en otro hilo en producción
    h = hdr(world["s_user"])

    r, stmts = _sql(lambda: client.get(f"{API}/users/me/teachers", headers=h))
    assert r.status_code == 200 and len(stmts) <= 8, len(stmts)  # antes 11
    r, stmts = _sql(lambda: client.get(f"{API}/payments/booking-status", headers=h))
    assert r.status_code == 200 and len(stmts) <= 10, len(stmts)  # antes 11
    r, stmts = _sql(lambda: book(client, world, future(96), enrollment_id=eid))
    assert r.status_code == 201, r.text
    assert len(stmts) <= 27, len(stmts)  # antes 29; +1 Fase 17: comprobar si el profesor tiene Calendar activo (G3); +1 AUD-24: profesor activo
    assert sum("FROM platform_config" in s for s in stmts) == 1  # antes 4 lecturas de la misma fila


def test_platform_config_is_read_once_per_session_and_never_stale(world, db):
    from app.core.platform_config import get_platform_config
    from app.db.base import SessionLocal
    from app.models.payment_config import PlatformConfig
    _, stmts = _sql(lambda: [get_platform_config(db) for _ in range(5)])
    assert sum("FROM platform_config" in s for s in stmts) == 1
    other = SessionLocal()  # otra petición cambia la config
    try:
        other.query(PlatformConfig).first().is_single_tenant = True
        other.commit()
    finally:
        other.close()
    db.commit()  # fin de la unidad de trabajo: los atributos caducan
    assert get_platform_config(db).is_single_tenant is True
    fresh = SessionLocal()
    try:
        assert get_platform_config(fresh).is_single_tenant is True
    finally:
        fresh.close()
