"""Fase 11: paginacion (`limit`/`offset` + `X-Total-Count`) de los listados de apoyo del Modo Dios."""
import pytest

from tests.audit.conftest import _mk_user, hdr
from app.models.student_teacher_link import StudentTeacherLink
from app.models.god_mode_audit import GodModeAuditLog
from app.models.package import Enrollment
from app.models.student import StudentProfile
from app.models.teacher import TeacherProfile, TeacherStatus
from app.models.group_cohort import GroupCohort

API = "/api/v1/god-mode"
N = 6


def seed_teachers(db, w):
    for i in range(N):
        u = _mk_user(db, "teacher", f"prof{i}")
        db.add(TeacherProfile(user_id=u.id, user_username=u.username, status=TeacherStatus.approved, timezone="UTC",
                              languages=["English"], subjects=["English"], video_url="http://v"))
    db.commit()
    return "/lookup/teachers"


def seed_students(db, w):
    for i in range(N):
        u = _mk_user(db, "student", f"alu{i}")
        sp = StudentProfile(user_id=u.id, user_username=u.username, timezone="UTC")
        db.add(sp)
        db.flush()
        db.add(StudentTeacherLink(student_id=sp.id, teacher_id=w["tp"].id))
    db.commit()
    return f"/lookup/teachers/{w['tp'].id}/students"


def seed_enrollments(db, w):
    for _ in range(N):
        db.add(Enrollment(student_id=w["sp"].id, package_id=w["pkg"].id, teacher_id=w["tp"].id))
    db.commit()
    return f"/lookup/students/{w['sp'].id}/enrollments"


def seed_cohorts(db, w):
    for _ in range(N):
        db.add(GroupCohort(package_id=w["pkg"].id, teacher_id=w["tp"].id, min_students=1, max_students=5))
    db.commit()
    return f"/lookup/teachers/{w['tp'].id}/cohorts"


def seed_history(db, w):
    for i in range(N):
        db.add(GodModeAuditLog(actor_user_id=w["admin"].id, actor_role="superadmin", action=f"a{i}",
                               entity_type="enrollment", entity_id=42, reason="r"))
    db.commit()
    return "/audit-log/enrollment/42"


@pytest.mark.parametrize("seed", [seed_teachers, seed_students, seed_enrollments, seed_cohorts, seed_history])
def test_listado_paginado(client, db, world, seed):
    url = seed(db, world)
    h = hdr(world["admin"])
    full = client.get(f"{API}{url}", headers=h)
    assert full.status_code == 200, full.text
    total = int(full.headers["X-Total-Count"])
    assert total == len(full.json()) and total >= N
    page = client.get(f"{API}{url}?limit=2&offset=1", headers=h)
    assert page.status_code == 200 and len(page.json()) == 2
    assert int(page.headers["X-Total-Count"]) == total
    assert page.json() == full.json()[1:3]
    assert client.get(f"{API}{url}?limit=5&offset={total}", headers=h).json() == []
    assert client.get(f"{API}{url}?limit=0", headers=h).status_code == 422
    assert client.get(f"{API}{url}?limit=501", headers=h).status_code == 422


def test_historial_trae_el_nombre_del_autor(client, db, world):
    url = seed_history(db, world)
    rows = client.get(f"{API}{url}", headers=hdr(world["admin"])).json()
    assert len(rows) == N
    assert all(r["actor_name"] for r in rows)


def test_teacher_admin_solo_ve_lo_suyo_tambien_paginado(client, db, world):
    # el filtro de permisos se aplica antes de paginar: un profesor ajeno sigue dando 403
    other = _mk_user(db, "teacher", "otro")
    tp2 = TeacherProfile(user_id=other.id, user_username=other.username, status=TeacherStatus.approved, timezone="UTC",
                         languages=["English"], subjects=["English"], video_url="http://v")
    db.add(tp2)
    db.commit()
    r = client.get(f"{API}/lookup/teachers/{tp2.id}/cohorts", headers=hdr(world["t_user"]))
    assert r.status_code in (401, 403)
