"""Fase 18 - transición single/multi.

- single->multi: backfill atómico, idempotente y re-ejecutable (link + teacher.students + conversación), para
  cualquier profesor, sin cancelados ni alumnos baneados/inactivos; corre siempre que se pida multi.
- Los creadores de links toleran la restricción única (nunca 500).
- `_sync_student_teacher_username` ya no saca al alumno de la lista del profesor anterior.
- /users/me/teachers usa la destacada resuelta (BD o entorno); single sin destacada -> 400.
- multi->single y cambio de destacada A->B: 409 con alumnos afectados (sin force) hasta que no queden vivos; PATCH solo superadmin.
"""
from datetime import timedelta

import pytest

from app.core.teacher_students import (
    backfill_student_teacher_links, ensure_student_teacher_link, link_student_to_teacher,
)
from app.core.timezone import utc_now
from app.models.chat import ChatConversation
from app.models.class_ import Class
from app.models.package import Enrollment, EnrollmentStatus
from app.models.student import StudentProfile
from app.models.student_teacher_link import StudentTeacherLink
from app.models.teacher import TeacherProfile
from tests.audit.conftest import _mk_user, future, hdr
from tests.audit.helpers import API
from tests.audit.test_f15_tenant_modes import (
    _links, _my_teachers, _second_student, _second_teacher, _set_mode,
)


def _enroll(db, w, teacher_w, status=EnrollmentStatus.active, sp=None):
    sp = sp or w["sp"]
    e = Enrollment(student_id=sp.id, package_id=teacher_w["pkg"].id, teacher_id=teacher_w["tp"].id,
                   classes_total=4, classes_used=0, status=status)
    db.add(e)
    db.commit()
    return e


def _cls(db, tw, sp, hours=48, status="confirmed"):
    start = future(hours)
    c = Class(teacher_id=tw["tp"].id, student_id=sp.id, start_time_utc=start,
              end_time_utc=start + timedelta(minutes=50), duration=50, status=status)
    db.add(c)
    db.commit()
    return c


def _convs(db, sid, tid):
    db.expire_all()
    return db.query(ChatConversation).filter_by(student_id=sid, teacher_id=tid).count()


def _members(db, tid):
    db.expire_all()
    return list(db.get(TeacherProfile, tid).students or [])


def _patch(client, w, body, user=None):
    return client.patch(f"{API}/admin/platform-config", json=body, headers=hdr(user or w["admin"]))


# ─── 1. backfill ────────────────────────────────────────────────────────────

def test_backfill_covers_any_teacher_not_only_previous_featured(client, db, world):
    wb = _second_teacher(db, world)
    _set_mode(client, world, True, featured="profe")
    _enroll(db, world, wb)  # enrollment con otro profesor (etapa multi anterior)
    _set_mode(client, world, False)
    sid = world["sp"].id
    assert _links(db, sid) == {wb["tp"].id}
    assert sid in _members(db, wb["tp"].id)
    assert _convs(db, sid, wb["tp"].id) == 1


def test_backfill_from_classes_with_student_only(client, db, world):
    wb = _second_teacher(db, world)
    _cls(db, wb, world["sp"])
    _cls(db, world, _second_student(db, world)["sp"])
    r = _patch(client, world, {"is_single_tenant": False})
    assert r.status_code == 200, r.text
    assert _links(db, world["sp"].id) == {wb["tp"].id}


def test_backfill_skips_cancelled_only_and_inactive_and_banned(client, db, world):
    wb = _second_teacher(db, world)
    # cancelado: sin link
    _enroll(db, world, wb, status=EnrollmentStatus.cancelled)
    _cls(db, wb, world["sp"], status="cancelled")
    # baneado e inactivo con enrollment vivo: sin link
    banned = _second_student(db, world, "baneado")
    banned["s_user"].is_banned = True
    banned["s_user"].is_active = False
    inactive = _second_student(db, world, "inactivo")
    inactive["s_user"].is_active = False
    db.commit()
    _enroll(db, world, wb, sp=banned["sp"])
    _enroll(db, world, wb, sp=inactive["sp"])
    # control: alumno sano con enrollment vivo
    ok = _second_student(db, world, "sano")
    _enroll(db, world, wb, sp=ok["sp"])
    assert _patch(client, world, {"is_single_tenant": False}).status_code == 200
    assert _links(db, world["sp"].id) == set()
    assert _links(db, banned["sp"].id) == set()
    assert _links(db, inactive["sp"].id) == set()
    assert _links(db, ok["sp"].id) == {wb["tp"].id}


def test_backfill_repairs_existing_link_missing_students_list_and_conversation(client, db, world):
    sid, tid = world["sp"].id, world["tp"].id
    _enroll(db, world, world)
    db.add(StudentTeacherLink(student_id=sid, teacher_id=tid))  # link ya existe; lista y chat no
    db.commit()
    assert sid not in _members(db, tid) and _convs(db, sid, tid) == 0
    assert _patch(client, world, {"is_single_tenant": False}).status_code == 200  # ya era multi: igual repara
    assert sid in _members(db, tid)
    assert _convs(db, sid, tid) == 1
    assert db.query(StudentTeacherLink).filter_by(student_id=sid, teacher_id=tid).count() == 1


def test_backfill_idempotent_and_callable_from_script(client, db, world):
    wb = _second_teacher(db, world)
    _enroll(db, world, world)
    _enroll(db, world, wb)
    s1 = backfill_student_teacher_links(db)
    s2 = backfill_student_teacher_links(db)
    assert s1["links_created"] == 2 and s2["links_created"] == 0 and s2["students_list_fixed"] == 0
    assert db.query(StudentTeacherLink).count() == 2
    assert db.query(ChatConversation).count() == 2


def test_backfill_skips_deleted_student_profile(db, world):
    wb = _second_teacher(db, world)
    _enroll(db, world, wb)
    db.query(StudentTeacherLink).delete()
    db.commit()
    # perfil huérfano: enrollment apunta a un perfil que ya no existe
    from sqlalchemy import text
    db.execute(text("PRAGMA foreign_keys=OFF"))
    db.execute(text("UPDATE enrollments SET student_id=9999"))
    db.commit()
    stats = backfill_student_teacher_links(db)
    assert stats["pairs"] == 0 and stats["skipped_students"] == 1


def test_backfill_is_atomic_rolls_back_everything_on_failure(db, world, monkeypatch):
    wb = _second_teacher(db, world)
    ok = _second_student(db, world, "sano")
    _enroll(db, world, wb)
    _enroll(db, world, wb, sp=ok["sp"])
    import app.core.chat as chat_mod
    real = chat_mod.ensure_direct_conversation
    calls = {"n": 0}

    def boom(*a, **k):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("fallo a medias")
        return real(*a, **k)

    monkeypatch.setattr(chat_mod, "ensure_direct_conversation", boom)
    with pytest.raises(RuntimeError):
        backfill_student_teacher_links(db)
    db.expire_all()
    assert db.query(StudentTeacherLink).count() == 0
    assert db.query(ChatConversation).count() == 0
    assert _members(db, wb["tp"].id) == []
    monkeypatch.setattr(chat_mod, "ensure_direct_conversation", real)
    backfill_student_teacher_links(db)  # reintento repara
    assert db.query(StudentTeacherLink).count() == 2


def test_link_student_to_teacher_commit_false_does_not_commit(db, world):
    wb = _second_teacher(db, world)
    link_student_to_teacher(db, world["sp"], wb["tp"], commit=False)
    db.rollback()
    db.expire_all()
    assert world["sp"].id not in _members(db, wb["tp"].id)
    assert _convs(db, world["sp"].id, wb["tp"].id) == 0


def test_ensure_link_tolerates_duplicate_and_race(db, world):
    sid, tid = world["sp"].id, world["tp"].id
    assert ensure_student_teacher_link(db, sid, tid) is True
    db.commit()
    assert ensure_student_teacher_link(db, sid, tid) is False
    # carrera: la consulta previa no ve la fila (otro commit en curso) pero el INSERT choca con la restricción
    from sqlalchemy.orm import Query
    orig = Query.first
    Query.first = lambda self: None
    try:
        assert ensure_student_teacher_link(db, sid, tid) is False  # IntegrityError tragado
    finally:
        Query.first = orig
    assert db.query(StudentTeacherLink).count() == 1


def test_link_teacher_endpoint_idempotent_never_500(client, db, world):
    wb = _second_teacher(db, world)
    for _ in range(2):
        r = client.post(f"{API}/users/me/teachers/{wb['t_user'].username}", headers=hdr(world["s_user"]))
        assert r.status_code == 200, r.text
    assert db.query(StudentTeacherLink).filter_by(student_id=world["sp"].id).count() == 1


# ─── 2. single: students list, me/teachers, destacada obligatoria ───────────

def test_sync_username_keeps_student_in_old_teacher_list(client, db, world):
    from app.api.v1.endpoints.payments import _sync_student_teacher_username
    wb = _second_teacher(db, world)
    sid = world["sp"].id
    _set_mode(client, world, True, featured="profe")
    ta = db.get(TeacherProfile, world["tp"].id)
    tb = db.get(TeacherProfile, wb["tp"].id)
    tb.students = [sid]
    world["sp"].teacher_username = tb.user_username
    db.commit()
    _sync_student_teacher_username(world["s_user"], ta, db)  # reserva con la destacada
    assert sid in _members(db, wb["tp"].id)  # ya no se saca de B
    assert sid in _members(db, world["tp"].id)


def test_me_teachers_single_uses_env_featured(client, db, world, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "FEATURED_TEACHER_USERNAME", "profe")
    assert _patch(client, world, {"is_single_tenant": True}).status_code == 200  # el env resuelve la destacada
    assert list(_my_teachers(client, world)) == ["profe"]


def test_single_without_featured_is_rejected(client, db, world, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "FEATURED_TEACHER_USERNAME", "")
    r = _patch(client, world, {"is_single_tenant": True})
    assert r.status_code == 400, r.text
    assert client.get(f"{API}/admin/platform-config").json()["is_single_tenant"] is False
    # control: con destacada en el mismo PATCH sí se acepta
    assert _patch(client, world, {"is_single_tenant": True, "featured_teacher_username": "profe"}).status_code == 200


# ─── 3. multi -> single y A -> B: bloqueo (409) ────────────────────────────────────

def test_multi_to_single_409_lists_affected_students(client, db, world):
    wb = _second_teacher(db, world)
    _enroll(db, world, wb)  # alumno 1: enrollment vivo con B
    s2 = _second_student(db, world, "alumno2")
    _cls(db, wb, s2["sp"])  # alumno 2: clase futura con B
    r = _patch(client, world, {"is_single_tenant": True, "featured_teacher_username": "profe"})
    assert r.status_code == 409, r.text
    d = r.json()["detail"]
    assert d["affected_students"] == 2
    assert {x["student_username"] for x in d["sample"]} == {"alumno", "alumno2"}
    # nada cambió
    assert client.get(f"{API}/admin/platform-config").json()["is_single_tenant"] is False


def test_multi_to_single_blocked_until_other_teachers_have_no_live_students(client, db, world):
    wb = _second_teacher(db, world)
    e = _enroll(db, world, wb)
    c = _cls(db, wb, world["sp"])
    body = {"is_single_tenant": True, "featured_teacher_username": "profe"}
    assert _patch(client, world, body).status_code == 409
    assert _patch(client, world, {**body, "force": True}).status_code == 409  # ya no existe force
    db.expire_all()
    assert db.get(Enrollment, e.id).teacher_id == wb["tp"].id and db.get(Class, c.id).status == "confirmed"
    # sin alumnos vivos con otros profesores la opción se habilita de nuevo
    db.get(Enrollment, e.id).status = EnrollmentStatus.cancelled
    db.get(Class, c.id).status = "cancelled"
    db.commit()
    assert _patch(client, world, body).status_code == 200


def test_single_blockers_endpoint_matches_the_patch(client, db, world, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "FEATURED_TEACHER_USERNAME", "")
    url = f"{API}/admin/platform-config/single-blockers"
    wb = _second_teacher(db, world)
    # sin destacada: nada que comprobar
    r = client.get(url, headers=hdr(world["admin"]))
    assert r.status_code == 200 and r.json() == {"blocked": False, "target": None, "affected_students": 0, "sample": []}
    # alumno con paquete vivo y otro con clase futura con B
    e = _enroll(db, world, wb)
    s2 = _second_student(db, world, "alumno2")
    c = _cls(db, wb, s2["sp"])
    r = client.get(url, params={"featured_teacher_username": "profe"}, headers=hdr(world["admin"])).json()
    assert r["blocked"] is True and r["target"] == "profe" and r["affected_students"] == 2
    assert {x["student_username"] for x in r["sample"]} == {"alumno", "alumno2"}
    # con B como destino, los alumnos de B no bloquean
    assert client.get(url, params={"featured_teacher_username": wb["t_user"].username}, headers=hdr(world["admin"])).json()["blocked"] is False
    # sin parámetro usa la destacada guardada
    assert _patch(client, world, {"featured_teacher_username": "profe"}).status_code == 200
    assert client.get(url, headers=hdr(world["admin"])).json()["target"] == "profe"
    # el PATCH coincide con el endpoint y se desbloquea al resolverse
    assert _patch(client, world, {"is_single_tenant": True}).status_code == 409
    e.status = EnrollmentStatus.cancelled
    c.status = "cancelled"
    db.commit()
    assert client.get(url, headers=hdr(world["admin"])).json()["blocked"] is False
    assert _patch(client, world, {"is_single_tenant": True}).status_code == 200


def test_single_blockers_endpoint_errors_and_permissions(client, db, world):
    url = f"{API}/admin/platform-config/single-blockers"
    assert client.get(url, params={"featured_teacher_username": "nadie"}, headers=hdr(world["admin"])).status_code == 404
    ta = _mk_user(db, "teacher_admin", "tadmin")
    db.commit()
    assert client.get(url, headers=hdr(ta)).status_code == 403
    assert client.get(url, headers=hdr(world["s_user"])).status_code == 403
    assert client.get(url).status_code in (401, 403)


def test_featured_change_inside_single_blocked_when_old_featured_has_live_students(client, db, world):
    wb = _second_teacher(db, world)
    _set_mode(client, world, True, featured="profe")
    e = _enroll(db, world, world)  # alumno con paquete vivo con la destacada actual (A)
    r = _patch(client, world, {"featured_teacher_username": wb["t_user"].username})
    assert r.status_code == 409, r.text
    assert r.json()["detail"]["affected_students"] == 1
    assert client.get(f"{API}/admin/platform-config").json()["featured_teacher"]["username"] == "profe"
    # reenviar la misma destacada no es un cambio: pasa; al quedar A sin vivos, B también
    assert _patch(client, world, {"featured_teacher_username": "profe", "platform_name": "X"}).status_code == 200
    e.status = EnrollmentStatus.completed
    db.commit()
    assert _patch(client, world, {"featured_teacher_username": wb["t_user"].username}).status_code == 200


def test_multi_to_single_no_conflict_when_only_featured_or_dead_data(client, db, world):
    wb = _second_teacher(db, world)
    _enroll(db, world, world)                                   # con la destacada: no afecta
    _enroll(db, world, wb, status=EnrollmentStatus.cancelled)    # cancelado: no afecta
    _enroll(db, world, wb, status=EnrollmentStatus.completed)    # completado: no afecta
    _cls(db, wb, world["sp"], hours=-48, status="completed")     # pasada: no afecta
    _cls(db, wb, world["sp"], status="cancelled")                # cancelada: no afecta
    assert _patch(client, world, {"is_single_tenant": True, "featured_teacher_username": "profe"}).status_code == 200


def test_pending_states_count_as_live(client, db, world):
    wb = _second_teacher(db, world)
    _enroll(db, world, wb, status=EnrollmentStatus.pending_renewal)
    r = _patch(client, world, {"is_single_tenant": True, "featured_teacher_username": "profe"})
    assert r.status_code == 409


def test_platform_config_patch_is_superadmin_only(client, db, world):
    ta = _mk_user(db, "teacher_admin", "tadmin")
    db.commit()
    assert _patch(client, world, {"is_single_tenant": True}, user=ta).status_code == 403
