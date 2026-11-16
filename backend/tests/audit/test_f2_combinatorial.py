"""Fase 2 — PRUEBAS EXHAUSTIVAS COMBINATORIAS.

Se recorren TODAS las combinaciones de los factores (actor × destino × estado × momento)
y se compara con una tabla de resultados esperados escrita a mano.
Para no recrear la BD por combinación, cada test recorre su matriz en un bucle.
"""
import itertools
from datetime import timedelta

from tests.audit.conftest import hdr, future
from tests.audit.helpers import (
    API, iso, book, set_status, age_class, ready_student, restrict_availability,
)
from app.models.class_ import Class
from app.models.package import Enrollment

# actor -> (ruta de reagendar, usuario del mundo, ¿exige disponibilidad?)
ACTORS = {
    "student": ("/classes/{id}/reschedule", "s_user", True),
    "teacher": ("/classes/teacher/{id}/reschedule", "t_user", False),
    "admin": ("/classes/admin/{id}/reschedule", "admin", False),
}


def _reschedule(client, world, actor, cid, new_start):
    path, who, _ = ACTORS[actor]
    return client.patch(f"{API}{path.format(id=cid)}", json={
        "start_time_utc": iso(new_start),
        "end_time_utc": iso(new_start + timedelta(minutes=50)),
    }, headers=hdr(world[who]))


def test_reschedule_matrix_actor_x_target(client, world, db):
    """3 actores × {dentro, fuera de disponibilidad} × {libre, ocupado}: 12 combinaciones."""
    eid, _ = ready_student(client, world)
    restrict_availability(db, world)  # 08:00-20:00 UTC

    combos = list(itertools.product(ACTORS, ("inside", "outside"), ("free", "busy")))
    assert len(combos) == 12
    failures = []
    day = 0
    for actor, where, occupancy in combos:
        day += 1
        # clase a mover (hora 14, dentro de disponibilidad) — 1 crédito por combinación, se cancela al final
        orig = future(72 + 24 * day).replace(hour=14)
        cid = book(client, world, orig, enrollment_id=eid).json().get("class_id")
        assert cid, f"no se pudo crear la clase base para {actor}/{where}/{occupancy}"

        target = future(300 + 24 * day).replace(hour=10 if where == "inside" else 3)
        if occupancy == "busy":
            # otra clase ya ocupa el destino -> solo posible si el destino está dentro; fuera se crea por SQL
            from app.models.class_ import Class as C
            blocker = C(teacher_id=world["tp"].id, student_id=None, class_type=db.get(C, cid).class_type,
                        start_time_utc=target, end_time_utc=target + timedelta(minutes=50),
                        duration=50, buffer_minutes=0, status="confirmed",
                        day_of_week="x", subject="English")
            db.add(blocker)
            db.commit()

        r = _reschedule(client, world, actor, cid, target)

        needs_availability = ACTORS[actor][2]
        if occupancy == "busy":
            expected = 409
        elif where == "outside" and needs_availability:
            expected = 409
        else:
            expected = 200
        got = 409 if r.status_code in (400, 409) else r.status_code
        if got != expected:
            failures.append((actor, where, occupancy, r.status_code, expected, r.text[:120]))

        # liberar el crédito para la siguiente combinación
        client.delete(f"{API}/classes/admin/{cid}", headers=hdr(world["admin"]))
    assert not failures, "\n".join(map(str, failures))


def test_complete_matrix_status_x_timing(client, world, db):
    """{completed, no_show} × {futura, pasada}: solo las pasadas se pueden cerrar."""
    eid, _ = ready_student(client, world)
    failures = []
    for i, (status_, timing) in enumerate(itertools.product(("completed", "no_show"), ("future", "past"))):
        cid = book(client, world, future(72 + 24 * i), enrollment_id=eid).json()["class_id"]
        if timing == "past":
            age_class(cid)
        r = set_status(client, world, cid, status_)
        expected = 200 if timing == "past" else 400
        if r.status_code != expected:
            failures.append((status_, timing, r.status_code, expected))
    assert not failures, failures


def test_cancel_matrix_who_cancels_x_notice(client, world, db):
    """{alumno, profesor, admin} × {>12 h, <12 h}: créditos que quedan usados."""
    eid, _ = ready_student(client, world)
    routes = {
        "student": ("DELETE", "/classes/{id}", "s_user"),
        "teacher": ("DELETE", "/classes/teacher/{id}", "t_user"),
        "admin": ("DELETE", "/classes/admin/{id}", "admin"),
    }
    results = {}
    for actor, notice_h in itertools.product(routes, (30, 6)):
        cid = book(client, world, future(notice_h), enrollment_id=eid).json().get("class_id")
        if not cid:  # <min_booking: reservar lejos y acercar por SQL
            cid = book(client, world, future(48 + len(results)), enrollment_id=eid).json()["class_id"]
            db.expire_all()
            c = db.get(Class, cid)
            c.start_time_utc = future(notice_h) + timedelta(minutes=len(results))
            c.end_time_utc = c.start_time_utc + timedelta(minutes=50)
            db.commit()
        method, path, who = routes[actor]
        db.expire_all()
        before = db.get(Enrollment, eid).classes_used
        r = client.request(method, f"{API}{path.format(id=cid)}", headers=hdr(world[who]))
        db.expire_all()
        after = db.get(Enrollment, eid).classes_used
        results[(actor, notice_h)] = (r.status_code, after - before)
        # limpiar para liberar crédito si sigue activa
        if r.status_code != 200:
            client.delete(f"{API}/classes/admin/{cid}", headers=hdr(world["admin"]))

    # alumno con >12 h: ok y sin consumo; alumno <12 h: bloqueado
    assert results[("student", 30)] == (200, 0), results
    assert results[("student", 6)][0] == 400, results
    # profesor/admin siempre pueden cancelar y nunca penalizan al alumno
    for actor in ("teacher", "admin"):
        for h in (30, 6):
            code, delta = results[(actor, h)]
            assert code == 200 and delta <= 0, (actor, h, results)
