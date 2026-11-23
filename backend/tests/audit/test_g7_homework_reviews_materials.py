"""Cobertura de tareas, reseñas y materiales (`homework.py`, `reviews.py`, `materials.py`)."""
import io
from datetime import timedelta

import pytest

from tests.audit.conftest import _mk_user, hdr, future
from tests.audit.helpers import API
from tests.audit.test_g1_god_mode_actions import mk_class, mk_teacher, mk_student
from tests.audit.test_g3_cohorts import mk_gpkg, mk_cohort, mk_member
from app.core.timezone import utc_now
from app.models.class_ import ClassType
from app.models.class_participant import ClassParticipant
from app.models.homework import HomeworkAssignment
from app.models.material import Material, MaterialAssignment
from app.models.package import Enrollment, EnrollmentStatus
from app.models.review import Review

HW = f"{API}/homework"
RV = f"{API}/reviews"
MT = f"{API}/materials"


def link(db, w, sp=None):
    """El profesor «posee» al alumno cuando su id está en `teacher.students`."""
    tp = w["tp"]
    tp.students = list({*(tp.students or []), (sp or w["sp"]).id})
    db.commit()


def th(w):
    return hdr(w["t_user"])


def sh(w):
    return hdr(w["s_user"])


# ── tareas ───────────────────────────────────────────────────────────────────────────────
def hw_body(w, **kw):
    b = {"title": "Tarea 1", "description": "Resolver los ejercicios", "due_date_utc": future(48).isoformat(), "student_ids": [w["sp"].id]}
    b.update(kw)
    return b


def test_homework_full_cycle(client, world, db):
    link(db, world)
    r = client.post(f"{HW}/", json=hw_body(world), headers=th(world))
    assert r.status_code == 201, r.text
    hid = r.json()["id"]
    assert len(client.get(f"{HW}/my-homework", headers=th(world)).json()) == 1
    # el alumno la ve y la entrega
    mine = client.get(f"{HW}/student/my-homework", headers=sh(world)).json()
    aid = mine[0]["id"]
    assert client.post(f"{HW}/student/999/submit", json={"submission": "x"}, headers=sh(world)).status_code == 404
    # aún sin entregar: no se puede calificar
    assert client.patch(f"{HW}/{hid}/submissions/{aid}/grade", json={"score": 8}, headers=th(world)).status_code == 400
    assert client.post(f"{HW}/student/{aid}/submit", json={"submission": "Mi entrega"}, headers=sh(world)).status_code == 200
    subs = client.get(f"{HW}/{hid}/submissions", headers=th(world)).json()
    assert subs[0]["status"] == "submitted" and subs[0]["student_name"]
    assert client.get(f"{HW}/999/submissions", headers=th(world)).status_code == 404
    assert client.patch(f"{HW}/{hid}/submissions/999/grade", json={"score": 8}, headers=th(world)).status_code == 404
    assert client.patch(f"{HW}/{hid}/submissions/{aid}/grade", json={"score": 11}, headers=th(world)).status_code == 422
    assert client.patch(f"{HW}/{hid}/submissions/{aid}/grade", json={"score": 8, "feedback": "Bien"}, headers=th(world)).status_code == 200
    # ya calificada: no se modifica
    assert client.post(f"{HW}/student/{aid}/submit", json={"submission": "otra"}, headers=sh(world)).status_code == 400
    # otro profesor no la califica
    ot_u, ot_tp = mk_teacher(db, "otro_prof")
    assert client.patch(f"{HW}/{hid}/submissions/{aid}/grade", json={"score": 9}, headers=hdr(ot_u)).status_code == 403
    assert client.delete(f"{HW}/{hid}", headers=th(world)).status_code == 200
    assert client.delete(f"{HW}/{hid}", headers=hdr(ot_u)).status_code == 404
    assert client.get(f"{HW}/student/my-homework", headers=sh(world)).json() == []
    # desactivada: tampoco se califica
    assert client.patch(f"{HW}/{hid}/submissions/{aid}/grade", json={"score": 9}, headers=th(world)).status_code == 400


def test_homework_update_and_validation(client, world, db):
    link(db, world)
    hid = client.post(f"{HW}/", json=hw_body(world), headers=th(world)).json()["id"]
    assert client.patch(f"{HW}/{hid}", json={"title": "Nuevo título"}, headers=th(world)).status_code == 200
    assert client.patch(f"{HW}/{hid}", json={"title": "  "}, headers=th(world)).status_code == 422
    assert client.patch(f"{HW}/999", json={"title": "x"}, headers=th(world)).status_code == 404
    assert client.post(f"{HW}/", json=hw_body(world, student_ids=[]), headers=th(world)).status_code == 400
    assert client.post(f"{HW}/", json=hw_body(world, student_ids=[], cohort_id=999), headers=th(world)).status_code == 404


def test_homework_for_cohort_and_deadline(client, world, db):
    link(db, world)
    gp = mk_gpkg(db, world)
    co = mk_cohort(db, world, gp)
    u, sp, e = mk_member(db, world, co, gp, "hw_miembro")
    link(db, world, sp)
    r = client.post(f"{HW}/", json=hw_body(world, student_ids=[999], cohort_id=co.id), headers=th(world))
    assert r.status_code == 201, r.text
    hid = r.json()["id"]
    a = db.query(HomeworkAssignment).filter_by(homework_id=hid).all()
    assert [x.student_id for x in a] == [sp.id]  # 999 no existe / no es suyo
    # fecha límite pasada
    hid2 = client.post(f"{HW}/", json=hw_body(world, due_date_utc=future(1).isoformat()), headers=th(world)).json()["id"]
    asg = db.query(HomeworkAssignment).filter_by(homework_id=hid2).first()
    from app.models.homework import Homework
    db.query(Homework).filter(Homework.id == hid2).update({"due_date_utc": future(-5)})
    db.commit()
    assert client.post(f"{HW}/student/{asg.id}/submit", json={"submission": "tarde"}, headers=sh(world)).status_code == 400


def test_homework_assigns_only_to_known_students(client, world, db):
    link(db, world)
    tp = world["tp"]
    tp.students = [world["sp"].id, 99999]  # un id que ya no existe
    db.commit()
    r = client.post(f"{HW}/", json=hw_body(world, student_ids=[world["sp"].id, 99999]), headers=th(world))
    assert r.status_code == 201
    assert db.query(HomeworkAssignment).filter_by(homework_id=r.json()["id"]).count() == 1


# ── reseñas ──────────────────────────────────────────────────────────────────────────────
def test_reviews_cycle(client, world, db):
    uname = world["t_user"].username
    assert client.post(f"{RV}/nadie", json={"rating": 5}, headers=sh(world)).status_code == 404
    assert client.post(f"{RV}/{uname}", json={"rating": 5}, headers=sh(world)).status_code == 403  # sin clase completada
    mk_class(db, world, hours=-30, status="completed")
    r = client.post(f"{RV}/{uname}", json={"rating": 4.7, "comment": "Muy buena"}, headers=sh(world))
    assert r.status_code == 201, r.text
    assert r.json()["rating"] == 4.5
    assert client.post(f"{RV}/{uname}", json={"rating": 5}, headers=sh(world)).status_code == 400
    assert client.post(f"{RV}/{uname}", json={"rating": 9}, headers=sh(world)).status_code == 422
    lst = client.get(f"{RV}/{uname}").json()
    assert lst[0]["student_name"]
    assert client.get(f"{RV}/nadie").status_code == 404
    s = client.get(f"{RV}/{uname}/summary").json()
    assert s["total_reviews"] == 1 and s["average_rating"] == 4.5
    assert client.get(f"{RV}/nadie/summary").status_code == 404
    assert client.delete(f"{RV}/{r.json()['id']}", headers=sh(world)).status_code == 200
    assert client.delete(f"{RV}/{r.json()['id']}", headers=sh(world)).status_code == 404
    assert client.get(f"{RV}/{uname}/summary").json()["total_reviews"] == 0


def test_review_after_group_class_and_legacy_listing(client, world, db):
    uname = world["t_user"].username
    gp = mk_gpkg(db, world)
    co = mk_cohort(db, world, gp)
    e = Enrollment(student_id=world["sp"].id, package_id=gp.id, teacher_id=world["tp"].id, cohort_id=co.id,
                   status=EnrollmentStatus.active, payment_status="paid", classes_total=4)
    db.add(e)
    g = mk_class(db, world, hours=-30, status="completed", ctype=ClassType.group)
    g.student_id = None
    g.cohort_id = co.id
    db.flush()
    db.add(ClassParticipant(class_id=g.id, student_id=world["sp"].id, enrollment_id=e.id, attendance_status="confirmed"))
    db.commit()
    assert client.post(f"{RV}/{uname}", json={"rating": 5}, headers=sh(world)).status_code == 201
    db.add(Review(teacher_id=world["tp"].id, student_id=None, rating=3.0, is_legacy=True, legacy_student_name="Ex alumno", total_completed_classes=6))
    db.commit()
    names = {x["student_name"] for x in client.get(f"{RV}/{uname}").json()}
    assert "Ex alumno" in names
    assert client.get(f"{RV}/{uname}/summary").json()["total_reviews"] == 2


# ── materiales ───────────────────────────────────────────────────────────────────────────
@pytest.fixture
def fake_storage(monkeypatch):
    calls = {"deleted": []}

    def fake_upload(stream, filename, content_type, folder, display_name=None):
        data = stream.read()
        if filename.endswith(".exe"):
            raise ValueError("Tipo de archivo no permitido")
        return {"url": f"http://cdn.test/{filename}", "public_id": f"pid/{filename}", "resource_type": "raw"}

    monkeypatch.setattr("app.api.v1.endpoints.materials.upload_file_stream", fake_upload)
    monkeypatch.setattr("app.api.v1.endpoints.materials.delete_file", lambda pid, rt="raw": calls["deleted"].append(pid) or True)
    return calls


def mk_material(client, w, **kw):
    data = {"title": "Guía 1", "category": "grammar", **kw}
    return client.post(f"{MT}/", data=data, headers=th(w))


def test_material_create_validation_and_upload(client, world, db, fake_storage):
    assert mk_material(client, world).status_code == 201
    assert mk_material(client, world, category="rara").status_code == 422
    assert mk_material(client, world, level="Z9").status_code == 422
    ok = client.post(f"{MT}/", data={"title": "PDF", "category": "reading"}, files={"file": ("guia.pdf", io.BytesIO(b"%PDF-1.4 x"), "application/pdf")}, headers=th(world))
    assert ok.status_code == 201, ok.text
    assert ok.json()["file_url"].endswith("guia.pdf")
    bad = client.post(f"{MT}/", data={"title": "X", "category": "reading"}, files={"file": ("virus.exe", io.BytesIO(b"MZ"), "application/octet-stream")}, headers=th(world))
    assert bad.status_code == 400


def test_material_crud_and_listing(client, world, db, fake_storage):
    mid = mk_material(client, world).json()["id"]
    assert client.patch(f"{MT}/{mid}", json={"title": "Guía 2"}, headers=th(world)).status_code == 200
    assert client.patch(f"{MT}/999", json={"title": "x"}, headers=th(world)).status_code == 404
    r = client.post(f"{MT}/{mid}/vocabulary", json={"words": ["hello", "Hello", " world ", ""]}, headers=th(world))
    assert r.status_code == 200 and r.json()["words"] == ["Hello", "World"]
    assert client.post(f"{MT}/999/vocabulary", json={"words": ["a"]}, headers=th(world)).status_code == 404
    assert client.post(f"{MT}/{mid}/vocabulary", json={"words": ["x" * 101]}, headers=th(world)).status_code == 422
    assert len(client.get(f"{MT}/my-materials", headers=th(world)).json()) == 1
    assert "used_bytes" in client.get(f"{MT}/quota", headers=th(world)).json() or client.get(f"{MT}/quota", headers=th(world)).status_code == 200
    adm = client.get(f"{MT}/admin/list?q=Gu%C3%ADa&teacher_id={world['tp'].id}", headers=hdr(world["admin"]))
    assert adm.status_code == 200 and adm.headers["X-Total-Count"] == "1"
    assert client.get(f"{MT}/admin/list", headers=th(world)).status_code == 403
    up = client.post(f"{MT}/", data={"title": "Con archivo", "category": "other"}, files={"file": ("a.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf")}, headers=th(world)).json()
    assert client.delete(f"{MT}/{up['id']}", headers=th(world)).status_code == 200
    assert fake_storage["deleted"]
    assert client.delete(f"{MT}/999", headers=th(world)).status_code == 404


def test_material_assignment_progress_and_stream(client, world, db, fake_storage):
    link(db, world)
    up = client.post(f"{MT}/", data={"title": "Con archivo", "category": "other"}, files={"file": ("a.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf")}, headers=th(world)).json()
    mid = up["id"]
    asg = lambda **b: client.post(f"{MT}/{mid}/assign", json=b, headers=th(world))
    assert client.post(f"{MT}/999/assign", json={"student_ids": [1]}, headers=th(world)).status_code == 404
    assert asg(student_ids=[]).status_code == 400
    assert asg(student_ids=[], cohort_id=999).status_code == 404
    r = asg(student_ids=[world["sp"].id, 999])
    assert r.status_code == 200 and r.json()["assigned"] == 1 and r.json()["skipped_not_mine"] == 1
    assert asg(student_ids=[world["sp"].id]).json()["already_assigned"] == 1
    mine = client.get(f"{MT}/student/my-materials", headers=sh(world)).json()
    aid = mine[0]["id"]
    assert client.patch(f"{MT}/student/{aid}/progress", json={"progress": "completed"}, headers=sh(world)).status_code == 200
    assert client.patch(f"{MT}/student/999/progress", json={"progress": "completed"}, headers=sh(world)).status_code == 404
    assert client.patch(f"{MT}/student/{aid}/progress", json={"progress": "otra"}, headers=sh(world)).status_code == 422
    # stream: dueño, alumno asignado y admin pasan; otro alumno no; sin archivo, 404
    for u in (world["t_user"], world["s_user"], world["admin"]):
        assert client.get(f"{MT}/{mid}/stream", headers=hdr(u), follow_redirects=False).status_code in (302, 307)
    other_u, _ = mk_student(db, "alu_sin_acceso")
    assert client.get(f"{MT}/{mid}/stream", headers=hdr(other_u), follow_redirects=False).status_code == 403
    nof = mk_material(client, world).json()["id"]
    assert client.get(f"{MT}/{nof}/stream", headers=th(world)).status_code == 404


def test_material_assign_to_cohort(client, world, db, fake_storage):
    gp = mk_gpkg(db, world)
    co = mk_cohort(db, world, gp)
    u, sp, e = mk_member(db, world, co, gp, "mat_miembro")
    link(db, world, sp)
    mid = mk_material(client, world).json()["id"]
    r = client.post(f"{MT}/{mid}/assign", json={"student_ids": [], "cohort_id": co.id}, headers=th(world))
    assert r.status_code == 200 and r.json()["assigned"] == 1
