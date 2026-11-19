"""Sondas: que pasa con datos/relaciones al cambiar single<->multi y el profesor destacado."""
from tests.audit.conftest import hdr, future, _mk_user
from tests.audit.helpers import API, complete_trial, buy_package, book
from app.models.teacher import TeacherProfile, TeacherStatus
from app.models.package import Package
from app.models.availability import TeacherAvailability
from app.models.payment_config import PlatformConfig
from app.models.student_teacher_link import StudentTeacherLink
from app.models.student import StudentProfile


def second_teacher(db, w, username="profeb", status=TeacherStatus.approved):
    u = _mk_user(db, "teacher", username)
    tp = TeacherProfile(user_id=u.id, user_username=username, status=status, timezone="UTC",
                        languages=["French"], subjects=["French"], video_url="http://v")
    db.add(tp); db.flush()
    for dow in range(7):
        db.add(TeacherAvailability(teacher_id=tp.id, day_of_week=dow, is_available=True,
                                   start_time_utc="00:00", end_time_utc="00:00"))
    pkg = Package(teacher_id=tp.id, name="PB", subject="French", classes_count=4, price=80.0,
                  price_per_class=20.0, duration_minutes=50, is_active=True)
    db.add(pkg); db.commit()
    return dict(admin=w["admin"], s_user=w["s_user"], sp=w["sp"], t_user=u, tp=tp, pkg=pkg)


def set_mode(client, w, single, featured=None):
    body = {"is_single_tenant": single}
    if featured is not None:
        body["featured_teacher_username"] = featured
    r = client.patch(f"{API}/admin/platform-config", json=body, headers=hdr(w["admin"]))
    assert r.status_code == 200, r.text
    return r


def links(db, sid):
    db.expire_all()
    return sorted(l.teacher_id for l in db.query(StudentTeacherLink).filter_by(student_id=sid).all())


def my_teachers(client, w):
    r = client.get(f"{API}/users/me/teachers", headers=hdr(w["s_user"]))
    assert r.status_code == 200, r.text
    return [t["teacher_username"] for t in r.json()]


# -- single -> multi --------------------------------------------------------
def test_single_creates_no_link_and_backfill_on_switch(client, world, db):
    w = world
    set_mode(client, w, True, featured="profe")
    complete_trial(client, w)
    buy_package(client, w)
    assert links(db, w["sp"].id) == []          # single no crea StudentTeacherLink
    set_mode(client, w, False)
    assert links(db, w["sp"].id) == [w["tp"].id]  # backfill del featured
    assert my_teachers(client, w) == ["profe"]


def test_single_with_env_featured_only_has_no_backfill(client, world, db, monkeypatch):
    """featured_teacher_id NULL + FEATURED_TEACHER_USERNAME en env: single funciona, paso a multi no backfillea."""
    from app.core.config import settings
    monkeypatch.setattr(settings, "FEATURED_TEACHER_USERNAME", "profe")
    w = world
    set_mode(client, w, True)  # sin featured en BD
    db.expire_all()
    assert db.query(PlatformConfig).first().featured_teacher_id is None
    # /me/teachers en single lee SOLO featured_teacher_id -> lista vacia aunque se pueda reservar
    assert my_teachers(client, w) == []
    complete_trial(client, w)          # reserva va al profe del env
    buy_package(client, w)
    set_mode(client, w, False)
    assert links(db, w["sp"].id) == []           # huerfano
    assert my_teachers(client, w) == []
    r = client.get(f"{API}/payments/booking-status", headers=hdr(w["s_user"]))
    assert r.json()["stage"] == "needs_teacher", r.text
    r = client.get(f"{API}/packages/my-enrollments", headers=hdr(w["s_user"]))
    assert len(r.json()) == 1


def test_featured_change_in_single_then_multi_orphans_old_featured_students(client, world, db):
    w = world
    wb = second_teacher(db, w)
    set_mode(client, w, True, featured="profe")
    complete_trial(client, w)
    eid_a, _ = buy_package(client, w)
    set_mode(client, w, True, featured="profeb")   # cambio de destacado A -> B
    assert my_teachers(client, w) == ["profeb"]   # A desaparece de "Tus profesores"
    r = client.get(f"{API}/payments/booking-status", headers=hdr(w["s_user"]))
    assert r.json()["stage"] == "needs_trial"     # paquete con A no cuenta
    r = book(client, w, future(72), enrollment_id=eid_a)   # el backend aun deja usar creditos de A
    assert r.status_code == 201, r.text
    r = book(client, wb, future(96))               # trial con B
    assert r.status_code == 201, r.text
    db.expire_all()
    a = db.get(TeacherProfile, w["tp"].id); b = db.get(TeacherProfile, wb["tp"].id)
    assert w["sp"].id not in (a.students or [])
    assert w["sp"].id in (b.students or [])
    r = client.get(f"{API}/teachers/me/students", headers=hdr(w["t_user"]))
    print("A /me/students:", r.status_code, r.text[:200])
    r = client.get(f"{API}/chat/conversations/direct/alumno", headers=hdr(w["t_user"]))
    print("A abre chat con alumno:", r.status_code, r.text[:200])
    r = client.get(f"{API}/classes/teacher/classes", headers=hdr(w["t_user"]))
    print("A ve sus clases:", r.status_code, r.json().get("total") if r.status_code == 200 else r.text[:100])
    set_mode(client, w, False)                     # paso a multi: backfill solo de B
    assert links(db, w["sp"].id) == [wb["tp"].id]
    assert my_teachers(client, w) == ["profeb"]   # paquete activo con A invisible en multi
    r = client.post(f"{API}/users/me/teachers/profe", headers=hdr(w["s_user"]))
    assert r.status_code == 200                   # recuperable a mano re-vinculando
    assert sorted(my_teachers(client, w)) == ["profe", "profeb"]


# -- multi -> single --------------------------------------------------------
def test_multi_to_single_hides_other_teachers_but_backend_still_allows(client, world, db):
    w = world
    wb = second_teacher(db, w)
    set_mode(client, w, False)
    complete_trial(client, w); buy_package(client, w)
    complete_trial(client, wb); eid_b, _ = buy_package(client, wb)
    assert sorted(my_teachers(client, w)) == ["profe", "profeb"]
    set_mode(client, w, True, featured="profe")
    assert my_teachers(client, w) == ["profe"]
    assert len(links(db, w["sp"].id)) == 2          # links quedan
    r = client.get(f"{API}/packages/my-enrollments", headers=hdr(w["s_user"]))
    assert len(r.json()) == 2                       # enrollments de B siguen visibles
    r = client.get(f"{API}/classes/my-classes", headers=hdr(w["s_user"]))
    print("my-classes en single:", r.status_code, r.json().get("total") if r.status_code == 200 else r.text[:100])
    r = book(client, wb, future(120), enrollment_id=eid_b)   # reservar con B en single
    assert r.status_code == 201, r.text
    db.expire_all()
    sp = db.get(StudentProfile, w["sp"].id)
    a = db.get(TeacherProfile, w["tp"].id)
    print("teacher_username tras reservar con B en single:", sp.teacher_username,
          "| alumno en A.students:", w["sp"].id in (a.students or []))
    r = client.get(f"{API}/payments/booking-status", params={"teacher_username": "profeb"}, headers=hdr(w["s_user"]))
    print("booking-status?teacher=B en single:", r.json().get("teacher_username"), r.json().get("stage"))
    r = client.delete(f"{API}/users/me/teachers/profeb", headers=hdr(w["s_user"]))
    assert r.status_code == 400                     # no puede terminar relacion con B
    r = client.get(f"{API}/chat/conversations/direct/profeb", headers=hdr(w["s_user"]))
    assert r.status_code == 200, r.text            # chat con B sigue
    r = client.post(f"{API}/payments/notify-payment", json={"type": "renewal", "enrollment_id": eid_b,
                    "package_id": wb["pkg"].id, "payment_method": "bank_transfer", "transaction_reference": "X"},
                    headers=hdr(w["s_user"]))
    print("renewal con B en single:", r.status_code, r.text[:150])


def test_single_trial_ignores_requested_teacher(client, world, db):
    w = world
    wb = second_teacher(db, w)
    set_mode(client, w, True, featured="profe")
    r = book(client, wb, future(48))  # pide B, en single se ignora
    assert r.status_code == 201
    db.expire_all()
    from app.models.class_ import Class
    assert db.get(Class, r.json()["class_id"]).teacher_id == w["tp"].id


def test_single_student_can_chat_any_approved_teacher(client, world, db):
    w = world
    second_teacher(db, w)
    set_mode(client, w, True, featured="profe")
    r = client.get(f"{API}/chat/conversations/direct/profeb", headers=hdr(w["s_user"]))
    assert r.status_code == 200, r.text


# -- validaciones del cambio ------------------------------------------------
def test_toggle_single_without_featured_is_accepted(client, world, db):
    w = world
    set_mode(client, w, True)
    r = book(client, w, future(48))
    print("book single sin featured:", r.status_code, r.text[:150])
    assert r.status_code in (400, 404)
    r = client.get(f"{API}/public/landing")
    print("landing single sin featured:", r.status_code, [t.get("username") for t in r.json().get("teachers", [])])


def test_featured_can_be_unapproved_teacher(client, world, db):
    w = world
    second_teacher(db, w, username="suspendida", status=TeacherStatus.suspended)
    set_mode(client, w, True, featured="suspendida")
    r = client.get(f"{API}/admin/platform-config")
    assert r.json()["featured_teacher"]["username"] == "suspendida"
    r = client.get(f"{API}/public/landing")
    print("landing con featured suspendida, teachers:", r.json().get("teachers"))
    r = book(client, w, future(48))
    print("trial con featured suspendida:", r.status_code, r.text[:200])


def test_teacher_admin_can_switch_mode(client, world, db):
    w = world
    u = _mk_user(db, "teacher_admin", "tadmin")
    db.commit()
    r = client.patch(f"{API}/admin/platform-config", json={"is_single_tenant": True}, headers=hdr(u))
    print("teacher_admin cambia modo:", r.status_code)
    assert r.status_code == 200


def test_backfill_includes_cancelled_history(client, world, db):
    w = world
    set_mode(client, w, True, featured="profe")
    cid = book(client, w, future(48)).json()["class_id"]
    r = client.patch(f"{API}/classes/{cid}/status", json={"status": "cancelled"}, headers=hdr(w["t_user"]))
    print("cancel trial:", r.status_code)
    set_mode(client, w, False)
    assert links(db, w["sp"].id) == [w["tp"].id]


def test_landing_cache_invalidated_on_toggle(client, world, db):
    w = world
    assert client.get(f"{API}/public/landing").json()["is_single_tenant"] is False
    set_mode(client, w, True, featured="profe")
    assert client.get(f"{API}/public/landing").json()["is_single_tenant"] is True


def test_multi_to_single_flipflop_removes_student_from_other_teacher(client, world, db):
    w = world
    wb = second_teacher(db, w)
    set_mode(client, w, False)
    complete_trial(client, w); eid_a, _ = buy_package(client, w)
    complete_trial(client, wb); eid_b, _ = buy_package(client, wb)
    set_mode(client, w, True, featured="profe")
    assert book(client, wb, future(120), enrollment_id=eid_b).status_code == 201  # teacher_username := profeb
    assert book(client, w, future(150), enrollment_id=eid_a).status_code == 201   # old=profeb -> lo saca de B
    db.expire_all()
    b = db.get(TeacherProfile, wb["tp"].id)
    assert w["sp"].id not in (b.students or [])
    r = client.get(f"{API}/chat/conversations/direct/alumno", headers=hdr(wb["t_user"]))
    print("B abre chat con alumno tras flip-flop:", r.status_code)
    r = client.get(f"{API}/teachers/me/students", headers=hdr(wb["t_user"]))
    print("B /me/students:", r.text[:120])
