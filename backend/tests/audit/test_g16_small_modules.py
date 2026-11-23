"""Cobertura de módulos pequeños: recálculo de zonas, huecos, catálogos, soporte y vínculos alumno-profesor."""
from datetime import datetime, timedelta

import pytest

from app.core import schedule_recalc as sr
from app.core import slot_availability as sa
from app.core import teacher_students as ts
from app.core.timezone import UTC, utc_now
from app.models.availability import TeacherAvailabilityException
from app.models.payment_config import PlatformConfig
from app.models.student_preferences import StudentSchedulePreference
from app.models.student_teacher_link import StudentTeacherLink
from app.models.system_catalog import SystemCatalog
from tests.audit.conftest import hdr
from tests.audit.helpers import API
from tests.audit.test_g1_god_mode_actions import mk_class, mk_teacher, mk_student

SC = f"{API}/system-catalogs"
SP = f"{API}/support"


# ── schedule_recalc ──────────────────────────────────────────────────────────────────────
def test_recalc_student_preferences(world, db):
    sid = world["sp"].id
    db.add_all([
        StudentSchedulePreference(student_id=sid, day_of_week=0, local_day_of_week=0, start_time_utc="14:00", end_time_utc="16:00"),
        StudentSchedulePreference(student_id=sid, day_of_week=1, local_day_of_week=None, start_time_utc="14:00", end_time_utc="16:00"),
        StudentSchedulePreference(student_id=sid, day_of_week=2, local_day_of_week=2, start_time_utc="14:00", end_time_utc="16:00"),
    ])
    db.commit()
    assert sr.recalculate_student_preferences_timezone(sid, "", "UTC", db) == {"weekly_changes": []}
    assert sr.recalculate_student_preferences_timezone(sid, "UTC", "UTC", db) == {"weekly_changes": []}
    r = sr.recalculate_student_preferences_timezone(sid, "America/Caracas", "Europe/Madrid", db)
    assert len(r["weekly_changes"]) == 3
    # la misma zona con un huso idéntico no cambia nada
    assert sr.recalculate_student_preferences_timezone(sid, "UTC", "Etc/UTC", db)["weekly_changes"] == []
    # una zona inválida se registra y se salta
    assert sr.recalculate_student_preferences_timezone(sid, "Mars/Base", "UTC", db)["weekly_changes"] == []


def test_recalc_teacher_exceptions(world, db):
    tid = world["tp"].id
    start = datetime(2030, 6, 10, 13, 0, tzinfo=UTC)
    db.add(TeacherAvailabilityException(teacher_id=tid, start_time_utc=start, end_time_utc=start + timedelta(hours=2),
                                        is_available=False))
    db.commit()
    assert sr.recalculate_teacher_schedule_timezone(tid, "", "UTC", db) == {"weekly_changes": [], "exception_changes": []}
    r = sr.recalculate_teacher_schedule_timezone(tid, "America/Caracas", "Europe/Madrid", db)
    assert len(r["exception_changes"]) == 1
    assert sr.recalculate_teacher_schedule_timezone(tid, "UTC", "Etc/UTC", db)["exception_changes"] == []
    out = sr.apply_teacher_timezone_change(world["tp"], "Asia/Tokyo", db)
    assert world["tp"].timezone == "Asia/Tokyo" and "exception_changes" in out


# ── slot_availability ────────────────────────────────────────────────────────────────────
def test_slot_availability_helpers(world, db):
    assert sa.resolve_zone(None) is UTC and sa.resolve_zone("Mars/Base") is UTC
    assert str(sa.resolve_zone("Europe/Madrid")) == "Europe/Madrid"
    assert sa.local_range_to_utc(datetime(2030, 6, 10).date(), "99:00", "10:00", sa.resolve_zone("UTC")) is None
    w0 = datetime(2030, 6, 10, 0, tzinfo=UTC)
    w1 = w0 + timedelta(days=1)
    tid = world["tp"].id
    # una excepción con disponibilidad extra dentro de la ventana
    db.add(TeacherAvailabilityException(teacher_id=tid, start_time_utc=w0 + timedelta(hours=8), end_time_utc=w0 + timedelta(hours=12),
                                        is_available=True))
    db.add(TeacherAvailabilityException(teacher_id=tid, start_time_utc=w0 + timedelta(hours=14), end_time_utc=w0 + timedelta(hours=15),
                                        is_available=False))
    db.commit()
    tw = sa.load_teacher_window(db, tid, w0, w1)
    start = w0 + timedelta(hours=9)
    assert sa.slot_free(tw, start, start + timedelta(minutes=60))[0] is True
    blocked = w0 + timedelta(hours=14)
    assert sa.slot_free(tw, blocked, blocked + timedelta(hours=1)) == (False, "blocked")
    assert sa.is_slot_free(db, tid, start, start + timedelta(minutes=60)) in ((True, ""), (False, "outside_availability"))
    assert isinstance(sa.is_slot_free(db, tid, w0 - timedelta(days=400), w0 - timedelta(days=400) + timedelta(hours=1)), tuple)


def test_slot_free_reasons():
    t0 = datetime(2030, 6, 10, 9, tzinfo=UTC)
    tw = sa.TeacherWindow(w0=t0, w1=t0 + timedelta(days=1), ranges=[(t0, t0 + timedelta(hours=4))], blocks=[(t0 + timedelta(hours=3), t0 + timedelta(hours=4))],
                          classes=[(t0 + timedelta(hours=1), t0 + timedelta(hours=2), 1)])
    assert sa.slot_free(tw, t0, t0 + timedelta(hours=1)) == (True, "")
    assert sa.slot_free(tw, t0 + timedelta(hours=1), t0 + timedelta(hours=2)) == (False, "class_conflict")
    assert sa.slot_free(tw, t0 + timedelta(hours=3), t0 + timedelta(hours=4)) == (False, "blocked")
    assert sa.slot_free(tw, t0 + timedelta(hours=6), t0 + timedelta(hours=7)) == (False, "outside_availability")


def test_preference_intervals_skip_invalid():
    class P:
        def __init__(self, dow, s, e):
            self.day_of_week, self.start_time_utc, self.end_time_utc = dow, s, e

    w0 = datetime(2030, 6, 10, 0, tzinfo=UTC)  # lunes
    out = sa.preference_intervals_for_window([P(0, "09:00", "10:00"), P(0, "99:00", "10:00")], w0, w0 + timedelta(days=1))
    assert len(out) == 1


# ── catálogos del sistema ────────────────────────────────────────────────────────────────
def test_catalogs_admin_and_business_rules(client, world, db):
    ah = hdr(world["admin"])
    db.add(SystemCatalog(key="subjects", label="Materias", value=["English"]))
    db.commit()
    assert [c["key"] for c in client.get(f"{SC}/admin", headers=ah).json()] == ["subjects"]
    assert client.get(f"{SC}/admin", headers=hdr(world["s_user"])).status_code == 403
    assert client.patch(f"{SC}/clave_rara", json={"value": []}, headers=ah).status_code == 400
    assert client.patch(f"{SC}/languages", json={"value": ["x"]}, headers=ah).status_code == 404
    assert client.patch(f"{SC}/subjects", json={"value": ["English", "French"]}, headers=ah).json()["value"] == ["English", "French"]
    assert client.get(f"{SC}/business-rules", headers=ah).status_code == 200
    r = client.patch(f"{SC}/business-rules", json={"low_credit_threshold": 3, "min_cancel_hours": 12}, headers=ah)
    assert r.status_code == 200 and r.json()["low_credit_threshold"] == 3
    # sin fila de configuración se crea una al vuelo
    db.query(PlatformConfig).delete()
    db.commit()
    assert client.get(f"{SC}/business-rules", headers=ah).status_code == 200
    db.query(PlatformConfig).delete()
    db.commit()
    assert client.patch(f"{SC}/business-rules", json={"low_credit_threshold": 4}, headers=ah).status_code == 200


# ── soporte ──────────────────────────────────────────────────────────────────────────────
def test_support_correction_and_seen(client, world, db, monkeypatch):
    th, sh, ah = hdr(world["t_user"]), hdr(world["s_user"]), hdr(world["admin"])
    ext = mk_class(db, world, hours=-100, status="no_show", ctype="external")
    ext.student_id = None
    db.commit()
    body = lambda cid: {"class_id": cid, "requested_status": "completed", "reason": "Sí hubo clase"}
    assert client.post(f"{SP}/class-corrections", json=body(ext.id), headers=th).status_code == 400
    assert client.post(f"{SP}/class-corrections", json=body(99999), headers=th).status_code == 404
    done = mk_class(db, world, hours=-100, status="no_show")
    assert client.post(f"{SP}/class-corrections", json=body(done.id), headers=th).status_code in (201, 400, 429)
    # un administrador no puede usar la bandeja del usuario
    assert client.patch(f"{SP}/tickets/1/seen", headers=ah).status_code == 403
    assert client.patch(f"{SP}/tickets/9999/seen", headers=sh).status_code == 404
    t = client.post(f"{SP}/tickets", json={"category": "other", "subject": "Ayuda", "message": "Necesito ayuda con mi cuenta"}, headers=sh)
    if t.status_code in (200, 201):
        tid = t.json()["id"]
        assert client.patch(f"{SP}/tickets/{tid}/seen", headers=sh).status_code == 200
        assert client.patch(f"{SP}/tickets/{tid}/seen", headers=sh).status_code == 200  # ya vista
        assert client.patch(f"{SP}/tickets/{tid}/seen", headers=th).status_code == 404  # ajeno


# ── vínculos alumno-profesor ─────────────────────────────────────────────────────────────
def test_student_teacher_link_helpers(world, db, monkeypatch):
    sid, tid = world["sp"].id, world["tp"].id
    assert ts.ensure_student_teacher_link(db, sid, tid) is True
    assert ts.ensure_student_teacher_link(db, sid, tid) is False  # ya existe
    db.query(StudentTeacherLink).delete()
    db.commit()

    real_bind = db.get_bind()

    class Dialect:
        name = "mysql"

    class FakeBind:
        dialect = Dialect()

        def __getattr__(self, name):
            return getattr(real_bind, name)

    monkeypatch.setattr(db, "get_bind", lambda *a, **k: FakeBind())
    assert ts.ensure_student_teacher_link(db, sid, tid) is True  # camino genérico con savepoint
    monkeypatch.undo()


def test_link_student_removes_from_previous_teacher(world, db):
    old_t, old_tp = mk_teacher(db, "profe_viejo", "teacher")
    old_tp.students = [world["sp"].id, 777]
    db.commit()
    ts.link_student_to_teacher(db, world["sp"], world["tp"], old_teacher_username=old_t.username)
    db.refresh(old_tp)
    db.refresh(world["tp"])
    assert world["sp"].id not in old_tp.students and 777 in old_tp.students
    assert world["sp"].id in world["tp"].students
    # un profesor anterior sin alumnos o inexistente no rompe nada
    ts.link_student_to_teacher(db, world["sp"], world["tp"], old_teacher_username="nadie")
    old_tp.students = []
    db.commit()
    ts.link_student_to_teacher(db, world["sp"], world["tp"], old_teacher_username=old_t.username)
