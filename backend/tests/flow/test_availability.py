"""
Suite: Disponibilidad del profesor.

BUG encontrado en el flow-tester viejo: llamaba `POST /availability/me/weekly`,
pero el endpoint real es un `PUT` (reemplaza toda la disponibilidad semanal).
Con POST, FastAPI devuelve 405 Method Not Allowed — el test "fallaba" pero
por un motivo totalmente distinto al que aparentaba (no era un tema de roles).
"""
import pytest

from app.models.availability import TeacherAvailability, TeacherAvailabilityException
from tests.flow.conftest import auth_headers

pytestmark = pytest.mark.integration


def test_only_teacher_or_teacher_admin_can_set_weekly_availability(
    client, student_token, superadmin_token,
):
    """
    Regresión directa del bug original: un rol que NO sea teacher/teacher_admin
    debe recibir 403, tanto si es student como si es superadmin puro.
    """
    payload = {"timezone": "America/Bogota", "slots": [
        {"day_of_week": 1, "start_time_local": "09:00", "end_time_local": "12:00"},
    ]}
    r_student = client.put("/api/v1/availability/me/weekly", json=payload, headers=auth_headers(student_token))
    assert r_student.status_code == 403

    r_superadmin = client.put("/api/v1/availability/me/weekly", json=payload, headers=auth_headers(superadmin_token))
    assert r_superadmin.status_code == 403


def test_teacher_sets_weekly_availability(client, teacher_token, fixed_users, volatile):
    payload = {
        "timezone": "America/Bogota",
        "slots": [
            {"day_of_week": 1, "start_time_local": "09:00", "end_time_local": "12:00"},
            {"day_of_week": 3, "start_time_local": "14:00", "end_time_local": "18:00"},
        ],
    }
    r = client.put("/api/v1/availability/me/weekly", json=payload, headers=auth_headers(teacher_token))
    assert r.status_code == 200, r.text
    slots = r.json()
    assert len(slots) == 2

    # PUT reemplaza todo, así que no queda basura acumulándose entre corridas,
    # pero igual lo dejamos limpio explícitamente por si un test futuro
    # asume "sin disponibilidad" como estado inicial.
    volatile.db_query(TeacherAvailability, teacher_id=slots[0]["teacher_id"], label="disponibilidad semanal profesor fijo")

    r_get = client.get("/api/v1/availability/me/weekly", headers=auth_headers(teacher_token))
    assert r_get.status_code == 200
    assert len(r_get.json()) == 2


def test_public_slots_for_fixed_teacher(client, teacher_token, student_token, fixed_users, volatile):
    # Primero aseguramos que el profesor fijo tiene disponibilidad ese día.
    payload = {"timezone": "UTC", "slots": [
        {"day_of_week": d, "start_time_local": "08:00", "end_time_local": "20:00"} for d in range(7)
    ]}
    r = client.put("/api/v1/availability/me/weekly", json=payload, headers=auth_headers(teacher_token))
    assert r.status_code == 200, r.text
    teacher_id = r.json()[0]["teacher_id"]
    volatile.db_query(TeacherAvailability, teacher_id=teacher_id, label="disponibilidad semanal profesor fijo")

    from datetime import datetime, timedelta, timezone as tz
    date = (datetime.now(tz.utc) + timedelta(days=3)).strftime("%Y-%m-%d")
    username = fixed_users["teacher"].username

    r_slots = client.get(
        f"/api/v1/availability/{username}/slots?date={date}&duration=60",
        headers=auth_headers(student_token),
    )
    assert r_slots.status_code == 200, r_slots.text
    assert isinstance(r_slots.json(), list)
    assert len(r_slots.json()) > 0, "El profesor fijo debería tener slots libres con disponibilidad todo el día"


def test_slots_requires_authentication(client, fixed_users):
    from datetime import datetime, timedelta, timezone as tz
    date = (datetime.now(tz.utc) + timedelta(days=3)).strftime("%Y-%m-%d")
    r = client.get(f"/api/v1/availability/{fixed_users['teacher'].username}/slots?date={date}&duration=60")
    assert r.status_code in (401, 403)


def test_teacher_availability_exception_create_and_delete(client, teacher_token, volatile):
    from datetime import datetime, timedelta, timezone as tz
    date = (datetime.now(tz.utc) + timedelta(days=5)).strftime("%Y-%m-%d")

    r = client.post("/api/v1/availability/me/exceptions", json={
        "date": date, "timezone": "America/Bogota",
        "is_full_day": False, "start_time_local": "09:00", "end_time_local": "10:00",
        "is_available": False, "reason": "Bloqueo de prueba (flow-tests)",
    }, headers=auth_headers(teacher_token))
    assert r.status_code in (200, 201), r.text
    created = r.json()
    assert len(created) == 1
    exception_id = created[0]["id"]

    # Hay endpoint DELETE real — lo usamos en vez de tocar la BD directo.
    volatile.api("DELETE", f"/api/v1/availability/me/exceptions/{exception_id}", token=teacher_token)

    r_del = client.delete(f"/api/v1/availability/me/exceptions/{exception_id}", headers=auth_headers(teacher_token))
    assert r_del.status_code == 204
    # El teardown de `volatile` intentará borrar de nuevo (ya no existe);
    # un 404 ahí es inofensivo y no genera warning (ver Volatile.api).
