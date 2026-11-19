"""Sondas de auditoria del modo single-tenant. Cada test afirma el comportamiento
ACTUAL (un assert que pasa = hallazgo confirmado)."""
from datetime import timedelta

from tests.audit.conftest import _mk_user, hdr, future
from app.models.teacher import TeacherProfile, TeacherStatus
from app.models.student import StudentProfile
from app.models.package import Package, Enrollment, EnrollmentStatus
from app.models.payment_config import PlatformConfig
from app.models.availability import TeacherAvailability
from app.models.class_ import Class, ClassType
from app.models.group_cohort import GroupCohort, CohortStatus
from app.models.user import User


def _single(db, featured_id):
    cfg = db.query(PlatformConfig).first()
    cfg.is_single_tenant = True
    cfg.featured_teacher_id = featured_id
    db.commit()


def _teacher(db, username, status=TeacherStatus.approved, subjects=("French",)):
    u = _mk_user(db, "teacher", username)
    tp = TeacherProfile(user_id=u.id, user_username=username, status=status, timezone="UTC",
                        languages=list(subjects), subjects=list(subjects), video_url="http://v")
    db.add(tp)
    db.flush()
    for dow in range(7):
        db.add(TeacherAvailability(teacher_id=tp.id, day_of_week=dow, is_available=True,
                                   start_time_utc="00:00", end_time_utc="00:00"))
    db.commit()
    return u, tp


def _trial_body(h=48):
    s = future(h)
    return {"start_time_utc": s.isoformat(), "end_time_utc": (s + timedelta(minutes=25)).isoformat(),
            "duration_minutes": 25}


# ── H1: profesor destacado suspendido sigue recibiendo pruebas ──
def test_trial_with_suspended_featured_teacher(client, world, db):
    tp = world["tp"]
    _single(db, tp.id)
    tp.status = TeacherStatus.suspended
    db.commit()
    # los slots ya dicen 404 ...
    r_slots = client.get("/api/v1/availability/featured-teacher/slots",
                         params={"date": future(48).date().isoformat(), "duration": 25, "class_type": "trial"},
                         headers=hdr(world["s_user"]))
    assert r_slots.status_code == 404
    # ... pero reservar la prueba por API directa funciona
    r = client.post("/api/v1/payments/book", json=_trial_body(), headers=hdr(world["s_user"]))
    assert r.status_code == 201, r.text
    # y el endpoint publico sigue devolviendo su username
    r_u = client.get("/api/v1/availability/featured-teacher/username")
    assert r_u.status_code == 200 and r_u.json()["username"] == tp.user_username


# ── H2: featured solo por env: /users/me/teachers vacio pero booking-status OK ──
def test_env_only_featured_inconsistent(client, world, db, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "FEATURED_TEACHER_USERNAME", world["tp"].user_username)
    _single(db, None)
    r = client.get("/api/v1/payments/booking-status", headers=hdr(world["s_user"]))
    assert r.status_code == 200 and r.json()["teacher_username"] == "profe"
    r2 = client.get("/api/v1/users/me/teachers", headers=hdr(world["s_user"]))
    assert r2.status_code == 200 and r2.json() == []
    # La prueba se reserva igual con el profesor del env
    r3 = client.post("/api/v1/payments/book", json=_trial_body(), headers=hdr(world["s_user"]))
    assert r3.status_code == 201
    # Chipi no sabe el nombre (solo mira featured_teacher_id)
    from app.core.chipi.context import get_platform_context_for_chipi
    assert get_platform_context_for_chipi(db)["featured_teacher_name"] is None
    # La config publica tampoco lo muestra
    assert client.get("/api/v1/admin/platform-config").json()["featured_teacher"] is None


# ── H3: TeacherProfile.students "salta" entre profesores al reservar en single ──
def test_students_list_flip_flop(client, world, db):
    a = world["tp"]          # destacado
    b_user, b = _teacher(db, "profeb")
    _single(db, a.id)
    sp = world["sp"]
    # El alumno ya tenia historia con B (p. ej. de multi o del destacado anterior): paquete pagado
    pkg_b = Package(teacher_id=b.id, name="PB", subject="French", classes_count=4, price=100,
                    price_per_class=25, duration_minutes=50, is_active=True)
    db.add(pkg_b); db.flush()
    db.add(Class(teacher_id=b.id, student_id=sp.id, class_type=ClassType.trial, status="completed",
                 start_time_utc=future(-100), end_time_utc=future(-100) + timedelta(minutes=25), duration=25))
    enr = Enrollment(student_id=sp.id, package_id=pkg_b.id, teacher_id=b.id, classes_total=4,
                     unlocked_credits=4, payment_status="paid", status=EnrollmentStatus.active)
    db.add(enr)
    b.students = [sp.id]
    sp.teacher_username = "profeb"
    db.commit()
    enr_id = enr.id

    # 1) Reserva la prueba con el destacado A -> sacan al alumno de B.students
    r = client.post("/api/v1/payments/book", json=_trial_body(30), headers=hdr(world["s_user"]))
    assert r.status_code == 201, r.text
    db.expire_all()
    assert sp.id in (db.get(TeacherProfile, a.id).students or [])
    assert sp.id not in (db.get(TeacherProfile, b.id).students or [])
    # B ya no puede escribirle aunque el alumno tiene paquete activo con B
    r_chat = client.get("/api/v1/chat/conversations/direct/alumno", headers=hdr(b_user))
    assert r_chat.status_code == 403

    # 2) Reserva con su paquete de B -> ahora lo sacan de A
    s = future(72)
    r2 = client.post("/api/v1/payments/book", json={
        "enrollment_id": enr_id, "start_time_utc": s.isoformat(),
        "end_time_utc": (s + timedelta(minutes=50)).isoformat(), "duration_minutes": 50},
        headers=hdr(world["s_user"]))
    assert r2.status_code == 201, r2.text
    db.expire_all()
    assert sp.id in (db.get(TeacherProfile, b.id).students or [])
    assert sp.id not in (db.get(TeacherProfile, a.id).students or [])
    r_chat_a = client.get("/api/v1/chat/conversations/direct/alumno", headers=hdr(world["t_user"]))
    assert r_chat_a.status_code == 403  # el destacado pierde a su alumno con prueba pendiente


# ── H3b: /users/me/teachers en single oculta el paquete activo con otro profesor ──
def test_me_teachers_hides_other_teacher_enrollment(client, world, db):
    a = world["tp"]
    _, b = _teacher(db, "profeb")
    sp = world["sp"]
    pkg_b = Package(teacher_id=b.id, name="PB", subject="French", classes_count=4, price=100,
                    price_per_class=25, duration_minutes=50, is_active=True)
    db.add(pkg_b); db.flush()
    db.add(Enrollment(student_id=sp.id, package_id=pkg_b.id, teacher_id=b.id, classes_total=4,
                      unlocked_credits=4, payment_status="paid", status=EnrollmentStatus.active))
    b.status = TeacherStatus.suspended  # creditos congelados con B
    db.commit()
    _single(db, a.id)
    r = client.get("/api/v1/users/me/teachers", headers=hdr(world["s_user"]))
    names = [t["teacher_username"] for t in r.json()]
    assert names == ["profe"]  # B (con creditos congelados) no aparece -> no ve el boton de reembolso


# ── H4: inscribirse a una cohorte en single no vincula al profesor ──
def test_cohort_enroll_single_no_link(client, world, db):
    tp = world["tp"]
    _single(db, tp.id)
    gp = Package(teacher_id=tp.id, name="G", subject="English", classes_count=4, price=80,
                 price_per_class=20, duration_minutes=50, is_active=True, is_group=True,
                 min_students=2, max_students=5)
    db.add(gp); db.flush()
    c = GroupCohort(package_id=gp.id, teacher_id=tp.id, status=CohortStatus.filling, min_students=2, max_students=5)
    db.add(c); db.commit()
    r = client.post(f"/api/v1/cohorts/{c.id}/enroll", json={"cohort_id": c.id, "payment_method": "bank_transfer"},
                    headers=hdr(world["s_user"]))
    assert r.status_code == 201, r.text
    db.expire_all()
    assert world["sp"].id not in (db.get(TeacherProfile, tp.id).students or [])
    # el profesor no puede abrir chat directo con su alumno de grupo
    assert client.get("/api/v1/chat/conversations/direct/alumno", headers=hdr(world["t_user"])).status_code == 403


# ── H4b: en single se puede unir a la cohorte de OTRO profesor (incluso suspendido) ──
def test_cohort_enroll_other_suspended_teacher_single(client, world, db):
    _single(db, world["tp"].id)
    _, b = _teacher(db, "profeb", status=TeacherStatus.suspended)
    gp = Package(teacher_id=b.id, name="G", subject="French", classes_count=4, price=80,
                 price_per_class=20, duration_minutes=50, is_active=True, is_group=True,
                 min_students=2, max_students=5)
    db.add(gp); db.flush()
    c = GroupCohort(package_id=gp.id, teacher_id=b.id, status=CohortStatus.filling, min_students=2, max_students=5)
    db.add(c); db.commit()
    r = client.post(f"/api/v1/cohorts/{c.id}/enroll", json={"cohort_id": c.id, "payment_method": "bank_transfer"},
                    headers=hdr(world["s_user"]))
    assert r.status_code == 201, r.text


# ── H5: prueba creada por staff no vincula ──
def test_staff_trial_no_link(client, world, db):
    tp = world["tp"]
    _single(db, tp.id)
    s = future(48)
    r = client.post("/api/v1/classes/trial", json={
        "teacher_username": "profe", "student_id": world["sp"].id, "subject": "English",
        "start_time_utc": s.isoformat(), "end_time_utc": (s + timedelta(minutes=25)).isoformat(),
        "duration_minutes": 25}, headers=hdr(world["admin"]))
    assert r.status_code == 201, r.text
    db.expire_all()
    assert world["sp"].id not in (db.get(TeacherProfile, tp.id).students or [])


# ── H6: chat del alumno con cualquier profesor aprobado en single ──
def test_student_chat_any_teacher_single(client, world, db):
    _single(db, world["tp"].id)
    _teacher(db, "profeb")
    r = client.get("/api/v1/chat/conversations/direct/profeb", headers=hdr(world["s_user"]))
    assert r.status_code == 200
    # y el directorio lista al otro profesor
    names = [t["user_username"] for t in client.get("/api/v1/teachers/").json()]
    assert "profeb" in names


# ── H7: teacher_admin se pone de destacado / destacado no aprobado ──
def test_teacher_admin_sets_self_featured(client, world, db):
    ta_user, ta = _teacher(db, "tadmin")
    from app.models.user import UserRole
    ta_user.role = UserRole.teacher_admin
    db.commit()
    _single(db, world["tp"].id)
    r = client.patch("/api/v1/admin/platform-config", json={"featured_teacher_username": "tadmin"},
                     headers=hdr(ta_user))
    assert r.status_code == 200
    db.expire_all()
    assert db.query(PlatformConfig).first().featured_teacher_id == ta.id


def test_featured_can_be_pending_teacher(client, world, db):
    _, p = _teacher(db, "pendiente", status=TeacherStatus.pending)
    _single(db, world["tp"].id)
    r = client.patch("/api/v1/admin/platform-config", json={"featured_teacher_username": "pendiente"},
                     headers=hdr(world["admin"]))
    assert r.status_code == 200
    # la landing queda sin profesor
    land = client.get("/api/v1/public/landing").json()
    assert land["teachers"] == [] and land["packages"] == []


# ── H8: pasar a multi sin featured_teacher_id (solo env) no crea vinculos ──
def test_switch_to_multi_env_only_no_links(client, world, db, monkeypatch):
    from app.core.config import settings
    from app.models.student_teacher_link import StudentTeacherLink
    monkeypatch.setattr(settings, "FEATURED_TEACHER_USERNAME", "profe")
    _single(db, None)
    assert client.post("/api/v1/payments/book", json=_trial_body(), headers=hdr(world["s_user"])).status_code == 201
    r = client.patch("/api/v1/admin/platform-config", json={"is_single_tenant": False}, headers=hdr(world["admin"]))
    assert r.status_code == 200
    assert db.query(StudentTeacherLink).count() == 0
    st = client.get("/api/v1/payments/booking-status", headers=hdr(world["s_user"])).json()
    assert st["stage"] == "needs_teacher"  # el alumno con prueba pendiente "pierde" a su profesor


# ── H8b: cambiar el destacado A->B en single no migra nada; pasar luego a multi solo vincula con B ──
def test_change_featured_then_multi_loses_a(client, world, db):
    from app.models.student_teacher_link import StudentTeacherLink
    _single(db, world["tp"].id)
    assert client.post("/api/v1/payments/book", json=_trial_body(), headers=hdr(world["s_user"])).status_code == 201
    _, b = _teacher(db, "profeb")
    assert client.patch("/api/v1/admin/platform-config", json={"featured_teacher_username": "profeb"},
                        headers=hdr(world["admin"])).status_code == 200
    r = client.get("/api/v1/users/me/teachers", headers=hdr(world["s_user"])).json()
    assert [t["teacher_username"] for t in r] == ["profeb"]  # su prueba pendiente con profe desaparece
    assert client.patch("/api/v1/admin/platform-config", json={"is_single_tenant": False},
                        headers=hdr(world["admin"])).status_code == 200
    assert db.query(StudentTeacherLink).count() == 0  # profeb no tenia historial; profe no se migra


# ── H9: Chipi en single lista materias de TODOS los profesores ──
def test_chipi_landscape_includes_other_teachers(client, world, db):
    _single(db, world["tp"].id)
    _, b = _teacher(db, "profeb")
    db.add(Package(teacher_id=b.id, name="PB", subject="Guitarra", classes_count=4, price=100,
                   price_per_class=25, duration_minutes=50, is_active=True))
    db.commit()
    from app.core.chipi.context import get_platform_context_for_chipi
    ctx = get_platform_context_for_chipi(db)
    assert "Guitarra" in ctx["package_landscape"]["subjects"]
    assert ctx["package_landscape"]["teachers_with_packages_count"] == 2


# ── H10: profesor destacado que borra su cuenta sigue siendo destacado y recibe pruebas ──
def test_deleted_featured_teacher_still_bookable(client, world, db):
    tp = world["tp"]
    _single(db, tp.id)
    r = client.request("DELETE", "/api/v1/users/me", json={"password": "Password123", "confirm_username": "profe"},
                       headers=hdr(world["t_user"]))
    assert r.status_code == 200, r.text
    db.expire_all()
    t = db.get(TeacherProfile, tp.id)
    assert t.status == TeacherStatus.approved
    r2 = client.post("/api/v1/payments/book", json=_trial_body(), headers=hdr(world["s_user"]))
    assert r2.status_code == 201, r2.text
    land = client.get("/api/v1/public/landing").json()
    # landing en single busca por username anonimizado -> aparece "Usuario eliminado"
    print("landing teachers:", land["teachers"])


# ── H11: single + paquete de otro profesor: comprar exige prueba con ese profesor (ok) ──
def test_buy_other_teacher_package_single(client, world, db):
    _single(db, world["tp"].id)
    _, b = _teacher(db, "profeb")
    pkg_b = Package(teacher_id=b.id, name="PB", subject="French", classes_count=4, price=100,
                    price_per_class=25, duration_minutes=50, is_active=True)
    db.add(pkg_b); db.commit()
    r = client.post("/api/v1/payments/notify-payment", json={"type": "package", "package_id": pkg_b.id,
                    "payment_method": "bank_transfer"}, headers=hdr(world["s_user"]))
    assert r.status_code == 400  # needs_trial con B -> bloqueado, correcto


# ── H12: booking-status sin fila de config / con config None ──
def test_users_me_teachers_no_config_row(client, world, db):
    db.query(PlatformConfig).delete(); db.commit()
    # payments trata "sin fila" como single, users.py como multi
    r = client.get("/api/v1/users/me/teachers", headers=hdr(world["s_user"]))
    assert r.status_code == 200 and r.json() == []


# ── H13: teacher_username "rancio" -> nunca se vuelve a vincular ──
def test_stale_teacher_username_never_relinks(client, world, db):
    tp = world["tp"]
    _single(db, tp.id)
    sp = world["sp"]
    sp.teacher_username = "profe"   # quedo asi tras un reembolso por suspension / unlink en multi
    tp.students = []
    db.commit()
    r = client.post("/api/v1/payments/book", json=_trial_body(), headers=hdr(world["s_user"]))
    assert r.status_code == 201, r.text
    db.expire_all()
    assert sp.id not in (db.get(TeacherProfile, tp.id).students or [])
    assert client.get("/api/v1/chat/conversations/direct/alumno", headers=hdr(world["t_user"])).status_code == 403
