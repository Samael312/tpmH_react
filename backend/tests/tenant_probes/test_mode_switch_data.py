"""Cambio single<->multi: clases, materiales y tareas del alumno sobreviven intactos y el profesor sigue pudiendo asignar.

Los otros archivos de esta carpeta (y test_f18/f15) cubren paquetes, vínculos y chat. Aquí: lo que el alumno YA tiene
(clases, materiales asignados, tareas) no cambia con el modo, y tras el cambio un profesor que ya no es el destacado
sigue pudiendo asignar material y tareas a sus alumnos (se apoya en `TeacherProfile.students`, que no se limpia).
"""
from app.models.material import Material
from tests.audit.conftest import hdr, future
from tests.audit.helpers import API, complete_trial, buy_package, book
from tests.tenant_probes.test_tenant_transition import second_teacher, set_mode, set_mode_db, my_teachers

MT = f"{API}/materials"
HW = f"{API}/homework"


def _mk_material(db, wt, title):
    m = Material(teacher_id=wt["tp"].id, title=title, category="other", is_active=True)
    db.add(m)
    db.commit()
    return m.id


def _assign_material(client, wt, w, title, db):
    mid = _mk_material(db, wt, title)
    r = client.post(f"{MT}/{mid}/assign", json={"student_ids": [w["sp"].id]}, headers=hdr(wt["t_user"]))
    assert r.status_code == 200, r.text
    return mid


def _assign_homework(client, wt, w, title):
    r = client.post(f"{HW}/", json={"title": title, "description": "x", "due_date_utc": future(72).isoformat(),
                                    "student_ids": [w["sp"].id]}, headers=hdr(wt["t_user"]))
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _class_ids(client, w):
    r = client.get(f"{API}/classes/my-classes", headers=hdr(w["s_user"]), params={"limit": 100})
    assert r.status_code == 200, r.text
    return sorted(c["id"] for c in r.json()["classes"])


def _snapshot(client, w):
    """Lo que el alumno ve: clases, materiales asignados (por material) y tareas (por tarea)."""
    h = hdr(w["s_user"])
    mats = client.get(f"{MT}/student/my-materials", headers=h).json()
    hws = client.get(f"{HW}/student/my-homework", headers=h).json()
    enr = client.get(f"{API}/packages/my-enrollments", headers=h).json()
    return {
        "classes": _class_ids(client, w),
        "materials": sorted(m["material"]["title"] for m in mats),
        "homework": sorted(x["homework"]["title"] if "homework" in x else x["title"] for x in hws),
        "enrollments": sorted((e["id"], e["classes_used"], e["status"]) for e in enr),
    }


def _world_with_two_teachers(client, world, db):
    """Multi: el alumno tiene paquete y una clase con A y con B, y material + tarea de cada uno."""
    w = world
    wb = second_teacher(db, w)
    set_mode(client, w, False)
    complete_trial(client, w)
    eid_a, _ = buy_package(client, w)
    complete_trial(client, wb)
    eid_b, _ = buy_package(client, wb)
    assert book(client, w, future(100), enrollment_id=eid_a).status_code == 201
    assert book(client, wb, future(130), enrollment_id=eid_b).status_code == 201
    _assign_material(client, w, w, "Mat de A", db)
    _assign_material(client, wb, w, "Mat de B", db)
    _assign_homework(client, w, w, "Tarea de A")
    _assign_homework(client, wb, w, "Tarea de B")
    return w, wb


def test_multi_to_single_and_back_keeps_classes_materials_and_homework(client, world, db):
    w, wb = _world_with_two_teachers(client, world, db)
    before = _snapshot(client, w)
    assert len(before["classes"]) >= 2 and before["materials"] == ["Mat de A", "Mat de B"]
    assert before["homework"] == ["Tarea de A", "Tarea de B"]

    r = client.patch(f"{API}/admin/platform-config", json={"is_single_tenant": True, "featured_teacher_username": "profe"},
                     headers=hdr(w["admin"]))
    assert r.status_code == 409                            # la API lo bloquea con alumnos vivos en otros profesores
    set_mode_db(db, True, w["tp"].id)                      # estado previo al bloqueo: se prueba que nada se pierde
    assert my_teachers(client, w) == ["profe"]            # la lista de profesores sí cambia...
    assert _snapshot(client, w) == before                  # ...pero lo que el alumno ya tiene, no

    set_mode(client, w, False)
    assert sorted(my_teachers(client, w)) == ["profe", "profeb"]
    assert _snapshot(client, w) == before


def test_single_to_multi_keeps_classes_materials_and_homework(client, world, db):
    w = world
    set_mode(client, w, True, featured="profe")
    complete_trial(client, w)
    eid, _ = buy_package(client, w)
    assert book(client, w, future(100), enrollment_id=eid).status_code == 201
    _assign_material(client, w, w, "Mat de A", db)
    _assign_homework(client, w, w, "Tarea de A")
    before = _snapshot(client, w)
    assert before["materials"] == ["Mat de A"] and before["homework"] == ["Tarea de A"]

    set_mode(client, w, False)
    assert _snapshot(client, w) == before


def test_old_teacher_can_still_assign_after_multi_to_single(client, world, db):
    """B deja de ser el destacado, pero sigue en su lista de alumnos: puede asignar material y tareas nuevos."""
    w, wb = _world_with_two_teachers(client, world, db)
    set_mode_db(db, True, w["tp"].id)  # la API lo bloquea con alumnos vivos; se reproduce el estado previo
    _assign_material(client, wb, w, "Mat nuevo de B", db)
    _assign_homework(client, wb, w, "Tarea nueva de B")
    snap = _snapshot(client, w)
    assert "Mat nuevo de B" in snap["materials"] and "Tarea nueva de B" in snap["homework"]


def test_assign_after_switch_rejects_a_student_the_teacher_never_had(client, world, db):
    """El cambio de modo no abre la puerta: un profesor sin relación con el alumno sigue sin poder asignarle."""
    w = world
    wb = second_teacher(db, w)          # B nunca tuvo al alumno
    set_mode(client, w, False)
    mid = _mk_material(db, wb, "Intruso")
    r = client.post(f"{MT}/{mid}/assign", json={"student_ids": [w["sp"].id]}, headers=hdr(wb["t_user"]))
    set_mode(client, w, True, featured="profe")
    r2 = client.post(f"{MT}/{mid}/assign", json={"student_ids": [w["sp"].id]}, headers=hdr(wb["t_user"]))
    # la API responde 200 pero NO asigna (skipped_not_mine): antes y después del cambio de modo
    assert r.json()["assigned"] == 0 and r2.json()["assigned"] == 0, (r.text, r2.text)
    assert r2.json()["skipped_not_mine"] == 1
