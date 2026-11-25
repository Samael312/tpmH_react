"""Modo de plataforma: single-tenant (solo la profesora destacada) y multi-tenant (marketplace).

Reglas que se comprueban:
- En single-tenant todo se agenda y se compra con la profesora destacada (featured_teacher); el alumno no elige profesor.
- Al pasar de single a multi, los alumnos que ya tenían relación con la destacada siguen vinculados a ella
  (StudentTeacherLink, TeacherProfile.students y la conversación de chat), y sus vínculos con otros profesores se
  mantienen.
- Pasar de multi a single no borra vínculos: si se vuelve a multi, todo sigue como estaba.
"""
from app.models.availability import TeacherAvailability
from app.models.class_ import Class
from app.models.package import Enrollment, Package
from app.models.student import StudentProfile
from app.models.student_teacher_link import StudentTeacherLink
from app.models.teacher import TeacherProfile, TeacherStatus
from tests.audit.conftest import _mk_user, future, hdr
from tests.audit.helpers import API, book, buy_package, complete_trial


# ─── utilidades ──────────────────────────────────────────────────────────────

def _second_teacher(db, w, username="profe2"):
    """Otro profesor aprobado con disponibilidad 24 h y su paquete. Devuelve un `world` donde él es el profesor."""
    t_user = _mk_user(db, "teacher", username)
    tp = TeacherProfile(user_id=t_user.id, user_username=t_user.username, status=TeacherStatus.approved,
                        timezone="UTC", languages=["French"], subjects=["French"], video_url="http://v")
    db.add(tp)
    db.flush()
    for dow in range(7):
        db.add(TeacherAvailability(teacher_id=tp.id, day_of_week=dow, is_available=True,
                                   start_time_local="00:00", end_time_local="00:00"))
    pkg = Package(teacher_id=tp.id, name="P4-FR", subject="French", classes_count=4,
                  price=100.0, price_per_class=25.0, duration_minutes=50, is_active=True)
    db.add(pkg)
    db.commit()
    return {**w, "t_user": t_user, "tp": tp, "pkg": pkg}


def _second_student(db, w, username="alumno2"):
    s_user = _mk_user(db, "student", username)
    sp = StudentProfile(user_id=s_user.id, user_username=s_user.username, timezone="UTC")
    db.add(sp)
    db.commit()
    return {**w, "s_user": s_user, "sp": sp}


def _set_mode(client, w, single, featured=None):
    body = {"is_single_tenant": single}  # multi->single y A->B se bloquean (409) con alumnos vivos en otros profesores
    if featured is not None:
        body["featured_teacher_username"] = featured
    r = client.patch(f"{API}/admin/platform-config", json=body, headers=hdr(w["admin"]))
    assert r.status_code == 200, r.text


def _set_mode_db(db, single, featured_tp_id):
    """Fija el modo directo en la BD: reproduce estados anteriores al bloqueo (alumnos vivos con otros profesores)."""
    from app.models.payment_config import PlatformConfig
    cfg = db.query(PlatformConfig).first() or PlatformConfig()
    cfg.is_single_tenant = single
    cfg.featured_teacher_id = featured_tp_id
    db.add(cfg)
    db.commit()


def _links(db, student_id):
    db.expire_all()
    return {l.teacher_id for l in db.query(StudentTeacherLink).filter_by(student_id=student_id).all()}


def _my_teachers(client, w):
    r = client.get(f"{API}/users/me/teachers", headers=hdr(w["s_user"]))
    assert r.status_code == 200, r.text
    return {t["teacher_username"]: t for t in r.json()}


# ─── single-tenant: solo la destacada ───────────────────────────────────────

def test_single_trial_always_goes_to_featured_even_if_other_teacher_requested(client, db, world):
    other = _second_teacher(db, world)
    _set_mode(client, world, True, featured="profe")
    r = book(client, other, future(30))  # pide profe2
    assert r.status_code == 201, r.text
    cls = db.get(Class, r.json()["class_id"])
    assert cls.teacher_id == world["tp"].id


def test_single_my_teachers_is_only_the_featured_one(client, db, world):
    other = _second_teacher(db, world)
    db.add(StudentTeacherLink(student_id=world["sp"].id, teacher_id=other["tp"].id))  # vínculo de una etapa multi
    db.commit()
    _set_mode(client, world, True, featured="profe")
    assert set(_my_teachers(client, world)) == {"profe"}


def test_single_student_cannot_pick_or_drop_teachers(client, db, world):
    _second_teacher(db, world)
    _set_mode(client, world, True, featured="profe")
    h = hdr(world["s_user"])
    assert client.post(f"{API}/users/me/teachers/profe2", headers=h).status_code == 400
    assert client.delete(f"{API}/users/me/teachers/profe", headers=h).status_code == 400


def test_single_booking_status_ignores_requested_teacher(client, db, world):
    _second_teacher(db, world)
    _set_mode(client, world, True, featured="profe")
    r = client.get(f"{API}/payments/booking-status", params={"teacher_username": "profe2"}, headers=hdr(world["s_user"]))
    assert r.status_code == 200, r.text
    assert r.json().get("teacher_username") in (None, "profe")


def test_single_rejects_booking_with_a_package_of_another_teacher(client, db, world):
    """Paquete comprado con otro profesor en una etapa multi: en single no se puede agendar con él."""
    other = _second_teacher(db, world)
    complete_trial(client, other)
    enrollment_id, _ = buy_package(client, other)
    assert client.patch(f"{API}/admin/platform-config", json={"is_single_tenant": True, "featured_teacher_username": "profe"},
                        headers=hdr(world["admin"])).status_code == 409  # el bloqueo impide llegar aquí por la API
    _set_mode_db(db, True, world["tp"].id)
    r = book(client, other, future(72), enrollment_id=enrollment_id)
    assert r.status_code in (400, 403), r.text
    # y el perfil del alumno no se reasigna a ese profesor
    db.expire_all()
    assert db.get(StudentProfile, world["sp"].id).teacher_username != "profe2"


def test_single_rejects_buying_a_package_of_another_teacher(client, db, world):
    """Prueba completada con otro profesor en una etapa multi: en single no se le puede comprar un paquete."""
    other = _second_teacher(db, world)
    complete_trial(client, other)
    _set_mode(client, world, True, featured="profe")
    r = client.post(f"{API}/payments/notify-payment", json={
        "type": "package", "package_id": other["pkg"].id,
        "payment_method": "bank_transfer", "transaction_reference": "F15",
    }, headers=hdr(world["s_user"]))
    assert r.status_code in (400, 403), r.text


def test_single_featured_package_purchase_and_booking_work(client, db, world):
    _set_mode(client, world, True, featured="profe")
    complete_trial(client, world)
    enrollment_id, _ = buy_package(client, world)
    r = book(client, world, future(72), enrollment_id=enrollment_id)
    assert r.status_code == 201, r.text


def test_single_with_featured_not_approved_cannot_book(client, db, world):
    _set_mode(client, world, True, featured="profe")
    db.query(TeacherProfile).filter_by(id=world["tp"].id).update({"status": TeacherStatus.suspended})
    db.commit()
    r = book(client, world, future(30))
    assert r.status_code in (400, 403, 404), r.text


# ─── single → multi: los alumnos siguen vinculados ──────────────────────────

def test_switch_to_multi_links_students_with_history(client, db, world):
    _set_mode(client, world, True, featured="profe")
    s2 = _second_student(db, world)
    book(client, world, future(30))                       # alumno: prueba pendiente
    complete_trial(client, s2)                            # alumno2: prueba hecha y paquete
    enrollment_id, _ = buy_package(client, s2)
    # en single el vínculo ya se guarda al reservar (no se ve: «mis profesores» muestra solo la destacada)
    assert _links(db, world["sp"].id) == {world["tp"].id}

    _set_mode(client, world, False)

    for w in (world, s2):
        assert world["tp"].id in _links(db, w["sp"].id)
        assert "profe" in _my_teachers(client, w)
    db.expire_all()
    assert {world["sp"].id, s2["sp"].id} <= set(db.get(TeacherProfile, world["tp"].id).students or [])
    # alumno2 sigue agendando con su paquete y alumno ve su prueba pendiente con profe
    assert book(client, s2, future(96), enrollment_id=enrollment_id).status_code == 201
    st = client.get(f"{API}/payments/booking-status", params={"teacher_username": "profe"}, headers=hdr(world["s_user"]))
    assert st.status_code == 200 and st.json()["stage"] == "trial_in_progress", st.text


def test_switch_to_multi_creates_the_chat_conversation(client, db, world):
    from app.models.chat import ChatConversation
    _set_mode(client, world, True, featured="profe")
    book(client, world, future(30))
    _set_mode(client, world, False)
    r = client.get(f"{API}/chat/conversations", headers=hdr(world["s_user"]))
    assert r.status_code == 200, r.text
    assert db.query(ChatConversation).count() >= 1


def test_switch_to_multi_keeps_links_with_other_teachers(client, db, world):
    other = _second_teacher(db, world)
    complete_trial(client, other)                          # etapa multi con profe2 (crea vínculo)
    _set_mode(client, world, True, featured="profe")
    book(client, world, future(30))                        # etapa single con profe
    _set_mode(client, world, False)
    assert _links(db, world["sp"].id) == {world["tp"].id, other["tp"].id}
    assert set(_my_teachers(client, world)) == {"profe", "profe2"}


def test_switch_to_multi_is_idempotent(client, db, world):
    _set_mode(client, world, True, featured="profe")
    book(client, world, future(30))
    _set_mode(client, world, False)
    _set_mode(client, world, False)
    _set_mode(client, world, True, featured="profe")
    _set_mode(client, world, False)
    db.expire_all()
    assert db.query(StudentTeacherLink).filter_by(student_id=world["sp"].id).count() == 1
    assert (db.get(TeacherProfile, world["tp"].id).students or []).count(world["sp"].id) == 1


def test_switch_to_multi_and_change_featured_in_the_same_save(client, db, world):
    """El panel puede mandar el modo y la destacada juntos: se vincula con la destacada que había."""
    _second_teacher(db, world)
    _set_mode(client, world, True, featured="profe")
    book(client, world, future(30))
    _set_mode(client, world, False, featured="profe2")
    assert world["tp"].id in _links(db, world["sp"].id)


def test_switch_to_multi_links_students_of_a_former_featured_teacher(client, db, world):
    """La destacada cambió durante la etapa single: los alumnos de la anterior tampoco pierden el vínculo."""
    other = _second_teacher(db, world)
    _set_mode(client, world, True, featured="profe")
    book(client, world, future(30))                        # alumno con profe
    _set_mode_db(db, True, other["tp"].id)                 # ahora la destacada es profe2 (la API lo bloquearía)
    s2 = _second_student(db, world)
    book(client, {**other, "s_user": s2["s_user"]}, future(40))
    _set_mode(client, world, False)
    assert world["tp"].id in _links(db, world["sp"].id)
    assert other["tp"].id in _links(db, s2["sp"].id)


def test_switch_to_multi_when_featured_came_from_the_env_fallback(client, db, world, monkeypatch):
    """Sin destacada guardada en la BD se usa FEATURED_TEACHER_USERNAME: esos alumnos también se vinculan."""
    from app.core.config import settings
    monkeypatch.setattr(settings, "FEATURED_TEACHER_USERNAME", "profe")
    _set_mode(client, world, True)
    r = book(client, world, future(30))
    assert r.status_code == 201, r.text
    _set_mode(client, world, False)
    assert world["tp"].id in _links(db, world["sp"].id)


# ─── multi → single → multi: nada se pierde ─────────────────────────────────

def test_switch_to_single_and_back_keeps_every_link(client, db, world):
    other = _second_teacher(db, world)
    complete_trial(client, other)
    complete_trial(client, world)
    before = _links(db, world["sp"].id)
    assert before == {world["tp"].id, other["tp"].id}
    _set_mode(client, world, True, featured="profe")
    assert _links(db, world["sp"].id) == before
    _set_mode(client, world, False)
    assert _links(db, world["sp"].id) == before
    assert set(_my_teachers(client, world)) == {"profe", "profe2"}


def test_enrollment_rows_untouched_by_mode_switches(client, db, world):
    _set_mode(client, world, True, featured="profe")
    complete_trial(client, world)
    enrollment_id, _ = buy_package(client, world)
    _set_mode(client, world, False)
    _set_mode(client, world, True, featured="profe")
    db.expire_all()
    e = db.get(Enrollment, enrollment_id)
    assert e.teacher_id == world["tp"].id and e.student_id == world["sp"].id


def test_switch_to_multi_backfills_legacy_single_students_without_link(client, db, world):
    """Alumnos que reservaron en single antes de que el vínculo se guardara: se vinculan al pasar a multi."""
    _set_mode(client, world, True, featured="profe")
    book(client, world, future(30))
    db.query(StudentTeacherLink).delete()
    db.commit()
    _set_mode(client, world, False)
    assert world["tp"].id in _links(db, world["sp"].id)
    assert "profe" in _my_teachers(client, world)


def test_single_group_enrollment_only_with_featured(client, db, world):
    """Inscribirse a un grupo de otro profesor en single-tenant: 400."""
    from app.models.group_cohort import CohortStatus, GroupCohort
    other = _second_teacher(db, world)
    gpkg = Package(teacher_id=other["tp"].id, name="G-FR", subject="French", classes_count=4, price=60.0,
                   price_per_class=15.0, duration_minutes=50, is_active=True, is_group=True,
                   min_students=1, max_students=5)
    db.add(gpkg)
    db.flush()
    cohort = GroupCohort(package_id=gpkg.id, teacher_id=other["tp"].id, status=CohortStatus.filling,
                         min_students=1, max_students=5)
    db.add(cohort)
    db.commit()
    _set_mode(client, world, True, featured="profe")
    r = client.post(f"{API}/cohorts/{cohort.id}/enroll", json={"cohort_id": cohort.id, "payment_method": "bank_transfer"},
                    headers=hdr(world["s_user"]))
    assert r.status_code == 400, r.text
    assert "solo gestiona" in r.json()["detail"]
