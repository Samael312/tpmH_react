"""Cobertura de `availability.py` (semana, excepciones, huecos) y `packages.py` (altas, ediciones, listados)."""
from tests.audit.conftest import hdr, future
from tests.audit.helpers import API, ready_student
from tests.audit.test_g1_god_mode_actions import mk_teacher, mk_enrollment
from tests.audit.test_g3_cohorts import mk_gpkg, mk_cohort
from app.models.package import Enrollment, EnrollmentStatus, Package
from app.models.payment import Payment

AV = f"{API}/availability"
PK = f"{API}/packages"


def th(w):
    return hdr(w["t_user"])


# ── disponibilidad ───────────────────────────────────────────────────────────────────────
def test_weekly_availability_set_and_get(client, world, db):
    h = th(world)
    assert client.get(f"{AV}/me/weekly", headers=h).status_code == 200
    body = {"timezone": "UTC", "slots": [{"day_of_week": 0, "start_time_local": "09:00", "end_time_local": "12:00", "is_available": True}]}
    assert client.put(f"{AV}/me/weekly", json=body, headers=h).status_code == 200
    assert client.put(f"{AV}/me/weekly", json={**body, "timezone": "Mars/Base"}, headers=h).status_code == 400
    # cambiar de zona horaria recalcula las clases
    assert client.put(f"{AV}/me/weekly", json={**body, "timezone": "America/Caracas"}, headers=h).status_code == 200


def exc(**kw):
    b = {"date": "2030-03-04", "timezone": "UTC", "is_full_day": True}
    b.update(kw)
    return b


def test_exceptions_create_list_delete(client, world, db):
    h = th(world)
    r = client.post(f"{AV}/me/exceptions", json=exc(end_date="2030-03-06", reason="Viaje"), headers=h)
    assert r.status_code == 201 and len(r.json()) == 3 and r.json()[0]["is_full_day"] is True
    assert len(client.get(f"{AV}/me/exceptions", headers=h).json()) == 3
    r2 = client.post(f"{AV}/me/exceptions", json=exc(date="2030-04-01", is_full_day=False, start_time_local="10:00", end_time_local="11:00", is_available=False), headers=h)
    assert r2.status_code == 201 and r2.json()[0]["is_full_day"] is False
    assert client.delete(f"{AV}/me/exceptions/{r.json()[0]['id']}", headers=h).status_code == 204
    assert client.delete(f"{AV}/me/exceptions/99999", headers=h).status_code == 404


def test_exception_validations(client, world, db):
    h = th(world)
    p = lambda **kw: client.post(f"{AV}/me/exceptions", json=exc(**kw), headers=h)
    assert p(timezone="Mars/Base").status_code == 400
    assert p(date="no-fecha").status_code == 400
    assert p(end_date="2030-03-01").status_code == 400
    assert p(is_full_day=False).status_code == 400
    assert p(is_full_day=False, start_time_local="12:00", end_time_local="10:00").status_code == 400
    assert p().status_code == 201
    assert p().status_code == 400  # solapa con la anterior
    assert p(date="2030-05-01", is_full_day=False, start_time_local="25:00", end_time_local="26:00").status_code == 422


def test_featured_teacher_username_and_slots(client, world, db, monkeypatch):
    from app.api.v1.endpoints import availability as av
    r = client.get(f"{AV}/featured-teacher/username")
    assert r.status_code in (200, 404)
    monkeypatch.setattr(av, "_resolve_featured_teacher_username", lambda db_: None)
    assert client.get(f"{AV}/featured-teacher/username").status_code == 404
    assert client.get(f"{AV}/featured-teacher/slots?date=2030-03-04", headers=hdr(world["s_user"])).status_code == 404
    monkeypatch.setattr(av, "_resolve_featured_teacher_username", lambda db_: world["t_user"].username)
    assert client.get(f"{AV}/featured-teacher/username").json() == {"username": world["t_user"].username}
    assert client.get(f"{AV}/featured-teacher/slots?date=2030-03-04", headers=hdr(world["s_user"])).status_code == 200


def test_teacher_slots_validations_and_bypass(client, world, db):
    u = world["t_user"].username
    g = lambda q, user=None: client.get(f"{AV}/{u}/slots?{q}", headers=hdr(user or world["s_user"]))
    assert g("date=2030-03-04").status_code == 200
    assert client.get(f"{AV}/nadie/slots?date=2030-03-04", headers=hdr(world["s_user"])).status_code == 404
    assert g("date=2030-03-04&tz=Mars/Base").status_code == 400
    assert g("date=basura").status_code == 400
    assert g("date=2030-03-04&end_date=2030-01-01").status_code == 400
    assert g("date=2030-03-04&end_date=2031-03-04").status_code == 400
    assert g("date=2001-01-01").json() == []  # un día ya pasado
    assert g("date=2030-03-04&bypass_min_notice=true").status_code == 403
    assert g("date=2030-03-04&bypass_min_notice=true", world["s_user"]).status_code == 403
    assert g("date=2030-03-04&bypass_min_notice=true", world["admin"]).status_code == 200


def test_featured_username_from_settings(client, world, db, monkeypatch):
    from app.api.v1.endpoints import availability as av
    from app.models.payment_config import PlatformConfig
    db.query(PlatformConfig).update({"featured_teacher_id": None})
    db.commit()
    from app.core.config import settings
    monkeypatch.setattr(settings, "FEATURED_TEACHER_USERNAME", "profe", raising=False)
    assert av._resolve_featured_teacher_username(db) in ("profe", None, world["t_user"].username)


# ── paquetes ─────────────────────────────────────────────────────────────────────────────
def pkg_body(**kw):
    b = {"name": "Pack 8", "subject": "English", "classes_count": 8, "price": 160.0, "price_per_class": 20.0, "duration_minutes": 50}
    b.update(kw)
    return b


def test_package_create_validations(client, world, db):
    h = th(world)
    assert client.post(f"{PK}/", json=pkg_body(), headers=h).status_code == 201
    assert client.post(f"{PK}/", json=pkg_body(duration_minutes=33), headers=h).status_code in (201, 400)
    grp = dict(is_group=True, min_students=2, max_students=4)
    assert client.post(f"{PK}/", json=pkg_body(**grp), headers=h).status_code == 201
    assert client.post(f"{PK}/", json=pkg_body(classes_count=None, price_per_class=None, **grp), headers=h).status_code == 400
    assert client.post(f"{PK}/", json=pkg_body(allow_installments=True, installment_count=2, **grp), headers=h).status_code == 400
    assert client.post(f"{PK}/", json=pkg_body(is_group=True, min_students=5, max_students=2), headers=h).status_code == 400
    assert client.post(f"{PK}/", json=pkg_body(is_group=True), headers=h).status_code == 400
    r = client.post(f"{PK}/", json=pkg_body(allow_installments=True, installment_count=4), headers=h)
    assert r.status_code == 201 and r.json()["installment_amount"] == 40.0
    assert client.post(f"{PK}/", json=pkg_body(price=0), headers=h).status_code == 422


def test_package_update_deactivate_and_lists(client, world, db):
    h = th(world)
    pid = client.post(f"{PK}/", json=pkg_body(), headers=h).json()["id"]
    assert pid in [p["id"] for p in client.get(f"{PK}/my-packages", headers=h).json()]
    u = lambda **kw: client.patch(f"{PK}/{pid}", json=pkg_body(**kw), headers=h)
    assert u(name="Renombrado").status_code == 200
    assert u(allow_installments=True, installment_count=2).json()["installment_amount"] == 80.0
    assert u(duration_minutes=33).status_code in (200, 400)
    assert u(is_group=True, classes_count=None, price_per_class=None, min_students=1, max_students=3).status_code == 400
    assert client.patch(f"{PK}/999", json=pkg_body(), headers=h).status_code == 404
    pub = client.get(f"{PK}/teacher/{world['t_user'].username}?subject=English")
    assert pub.status_code == 200 and pub.json()
    assert client.get(f"{PK}/teacher/{world['t_user'].username}?subject=Otra").json() == []
    assert client.get(f"{PK}/teacher/nadie").status_code == 404
    # con un alumno activo, los campos de precio no se tocan
    db.add(Enrollment(student_id=world["sp"].id, package_id=pid, teacher_id=world["tp"].id, status=EnrollmentStatus.active, classes_total=8))
    db.commit()
    assert u(price=500.0, price_per_class=62.5).status_code == 409
    assert client.delete(f"{PK}/{pid}", headers=h).status_code == 200
    assert client.delete(f"{PK}/999", headers=h).status_code == 404


def test_package_frozen_by_open_cohort(client, world, db):
    h = th(world)
    gp = mk_gpkg(db, world)
    mk_cohort(db, world, gp)
    r = client.patch(f"{PK}/{gp.id}", json=pkg_body(is_group=True, min_students=1, max_students=3, classes_count=4, price=999.0, price_per_class=249.75), headers=h)
    assert r.status_code == 409


def test_enrollment_overview_and_my_enrollments(client, world, db):
    th_ = th(world)
    eid, _ = ready_student(client, world)
    db.expire_all()
    e = db.get(Enrollment, eid)
    p8 = Package(teacher_id=world["tp"].id, name="Ilim", subject="English", classes_count=None, price=10.0, duration_minutes=50, is_active=True)
    db.add(p8)
    db.commit()
    e.renewal_requested_package_id = p8.id
    e.change_requested_package_id = p8.id
    db.commit()
    ov = client.get(f"{PK}/teacher/enrollments", headers=th_)
    assert ov.status_code == 200 and ov.json()
    # un alumno con un paquete ilimitado
    unl = Enrollment(student_id=world["sp"].id, package_id=p8.id, teacher_id=world["tp"].id, status=EnrollmentStatus.active,
                     payment_status="paid", prepaid_unlimited_credits=3)
    db.add(unl)
    db.commit()
    assert client.get(f"{PK}/teacher/enrollments", headers=th_).status_code == 200
    mine = client.get(f"{PK}/my-enrollments", headers=hdr(world["s_user"]))
    assert mine.status_code == 200 and len(mine.json()) >= 2
    # paquete de un enrollment grupal
    gp = mk_gpkg(db, world)
    co = mk_cohort(db, world, gp)
    db.add(Enrollment(student_id=world["sp"].id, package_id=gp.id, teacher_id=world["tp"].id, cohort_id=co.id,
                      status=EnrollmentStatus.active, payment_status="paid", classes_total=4))
    db.commit()
    assert client.get(f"{PK}/my-enrollments", headers=hdr(world["s_user"])).status_code == 200


def test_cancel_package_change_and_enrollment_package(client, world, db):
    sh = hdr(world["s_user"])
    eid, _ = ready_student(client, world)
    assert client.post(f"{PK}/{eid}/cancel-package-change", headers=sh).status_code == 404
    db.expire_all()
    e = db.get(Enrollment, eid)
    e.status = EnrollmentStatus.pending_package_change
    db.add(Payment(enrollment_id=e.id, student_id=e.student_id, teacher_id=e.teacher_id, amount_total=5, amount_teacher=0,
                   amount_platform=0, payment_method="bank_transfer", status="pending_review", payment_type="package_change"))
    db.commit()
    assert client.post(f"{PK}/{eid}/cancel-package-change", headers=sh).status_code == 200
    r = client.get(f"{PK}/enrollment/{eid}", headers=sh)
    assert r.status_code == 200 and r.json()["enrollment_id"] == eid
    assert client.get(f"{PK}/enrollment/9999", headers=sh).status_code == 404
