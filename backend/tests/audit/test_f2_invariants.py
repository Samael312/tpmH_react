"""Fase 2 — PRUEBAS DE INVARIANTES.

Se ejecuta una secuencia ALEATORIA (con semilla fija, reproducible) de operaciones reales
de la API y, tras cada una, se comprueban propiedades que SIEMPRE deben cumplirse,
sin importar el orden de las operaciones.
"""
import random
from datetime import timedelta

import pytest

from tests.audit.conftest import hdr, future
from tests.audit.helpers import API, iso, book, set_status, age_class, ready_student, restrict_availability
from app.models.class_ import Class
from app.models.package import Enrollment

DEAD = ("cancelled", "expired")


def _live(db, teacher_id=None, student_id=None):
    db.expire_all()
    q = db.query(Class).filter(Class.status.notin_(DEAD))
    if teacher_id:
        q = q.filter(Class.teacher_id == teacher_id)
    if student_id:
        q = q.filter(Class.student_id == student_id)
    return q.all()


def _overlaps(classes):
    cs = sorted(classes, key=lambda c: c.start_time_utc)
    for a, b in zip(cs, cs[1:]):
        if b.start_time_utc < a.end_time_utc:
            return (a.id, b.id)
    return None


def check_invariants(db, world, eid, label):
    # I1: el profesor nunca tiene dos clases vivas solapadas
    clash = _overlaps(_live(db, teacher_id=world["tp"].id))
    assert clash is None, f"[{label}] clases del profesor solapadas: {clash}"
    # I2: el alumno tampoco
    clash = _overlaps(_live(db, student_id=world["sp"].id))
    assert clash is None, f"[{label}] clases del alumno solapadas: {clash}"
    # I3: contadores dentro de rango y estado coherente
    e = db.get(Enrollment, eid)
    assert 0 <= e.classes_used <= e.classes_total, f"[{label}] classes_used={e.classes_used}"
    assert e.status.value in ("active", "completed"), f"[{label}] estado {e.status}"
    assert (e.status.value == "completed") == (e.classes_used >= e.classes_total), \
        f"[{label}] estado {e.status.value} con {e.classes_used}/{e.classes_total}"
    # I4: nunca hay más clases vivas del paquete que créditos totales
    live = [c for c in _live(db) if c.enrollment_id == eid]
    assert len(live) <= e.classes_total, f"[{label}] {len(live)} clases vivas > {e.classes_total} créditos"
    # I5: toda clase viva tiene fin > inicio
    assert all(c.end_time_utc > c.start_time_utc for c in live), f"[{label}] clase con fin <= inicio"


@pytest.mark.parametrize("seed", [1, 7, 42])
def test_random_operation_sequences_keep_invariants(client, world, db, seed):
    rnd = random.Random(seed)
    eid, _ = ready_student(client, world)
    restrict_availability(db, world)
    check_invariants(db, world, eid, "inicio")

    for step in range(22):
        op = rnd.choice(["book", "book", "cancel", "reschedule", "complete", "teacher_cancel"])
        live = [c for c in _live(db, student_id=world["sp"].id)
                if c.enrollment_id == eid and c.status == "confirmed"]
        label = f"seed={seed} paso={step} op={op}"
        if op == "book" or not live:
            start = future(rnd.randint(30, 600)).replace(hour=rnd.randint(7, 20), minute=rnd.choice([0, 30]))
            book(client, world, start, enrollment_id=eid)
        else:
            c = rnd.choice(live)
            if op == "cancel":
                client.delete(f"{API}/classes/{c.id}", headers=hdr(world["s_user"]))
            elif op == "teacher_cancel":
                client.delete(f"{API}/classes/teacher/{c.id}", headers=hdr(world["t_user"]))
            elif op == "reschedule":
                new = future(rnd.randint(30, 600)).replace(hour=rnd.randint(7, 20), minute=rnd.choice([0, 30]))
                client.patch(f"{API}/classes/{c.id}/reschedule", json={
                    "start_time_utc": iso(new), "end_time_utc": iso(new + timedelta(minutes=c.duration))},
                    headers=hdr(world["s_user"]))
            elif op == "complete":
                age_class(c.id, hours_ago=3 + 2 * c.id)
                set_status(client, world, c.id, rnd.choice(["completed", "no_show"]))
        check_invariants(db, world, eid, label)


def test_booking_attempts_never_exceed_credits(client, world, db):
    """Intentar reservar 12 veces con 4 créditos: nunca más de 4 clases vivas."""
    eid, _ = ready_student(client, world)
    codes = [book(client, world, future(40 + 24 * i), enrollment_id=eid).status_code for i in range(12)]
    assert codes.count(201) == 4, codes
    check_invariants(db, world, eid, "tras 12 intentos")


def test_cancel_book_cycle_conserves_credits(client, world, db):
    """Reservar y cancelar muchas veces no crea ni destruye créditos."""
    eid, _ = ready_student(client, world)
    for i in range(10):
        cid = book(client, world, future(40 + i), enrollment_id=eid).json()["class_id"]
        assert client.delete(f"{API}/classes/{cid}", headers=hdr(world["s_user"])).status_code == 200
        db.expire_all()
        assert db.get(Enrollment, eid).classes_used == 0
    # tras 10 ciclos siguen disponibles los 4 créditos
    codes = [book(client, world, future(100 + 24 * i), enrollment_id=eid).status_code for i in range(5)]
    assert codes.count(201) == 4, codes
