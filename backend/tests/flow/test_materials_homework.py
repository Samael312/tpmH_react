"""
Suite: Materiales y Tareas.

BUGS encontrados en el flow-tester viejo (nada tenía que ver con roles):
- `POST /materials/` es un endpoint multipart (`Form(...)`), no JSON — el
  tester viejo mandaba `Content-Type: application/json`, así que FastAPI
  rechazaba el body con 422 antes de llegar a la lógica de negocio.
- `category` se valida en minúsculas ("vocabulary"), el tester viejo mandaba
  "Vocabulary" con mayúscula → 422.
- Asignar material/tarea a un estudiante que el profesor no tiene vinculado
  (`TeacherProfile.students`) se salta en silencio (`skipped_not_mine`),
  nunca da error — así que el test viejo "pasaba" (200) sin haber asignado
  nada en realidad. Aquí vinculamos explícitamente al estudiante fijo antes
  de asignar, para probar el camino real, y lo revertimos al terminar.
"""
import pytest
from datetime import datetime, timedelta, timezone as tz

from app.models.teacher import TeacherProfile
from app.models.material import Material, MaterialAssignment
from app.models.homework import Homework, HomeworkAssignment
from tests.flow.conftest import auth_headers

pytestmark = pytest.mark.integration


def _register_material_cleanup(volatile, teacher_token, material_id):
    """
    DELETE /materials/{id} es un soft-delete (is_active=False, se conserva
    para no romper referencias) — a propósito, por diseño del producto. Para
    que la suite cumpla "no dejar basura en la BD" igual hacemos un hard
    delete por debajo, después de ejercer el endpoint real.
    Orden de registro (se ejecuta en reversa, LIFO):
      1) hard-delete Material           -> se ejecuta último
      2) hard-delete MaterialAssignment -> se ejecuta primero (hijo antes que padre)
      3) DELETE real por API            -> se ejecuta antes que nada (soft-delete)
    """
    volatile.db(Material, material_id, label=f"hard-delete material #{material_id}")
    volatile.db_query(MaterialAssignment, material_id=material_id, label=f"hard-delete assignments de material #{material_id}")
    volatile.api("DELETE", f"/api/v1/materials/{material_id}", token=teacher_token)


def _register_homework_cleanup(volatile, teacher_token, homework_id):
    """Mismo razonamiento que _register_material_cleanup, para tareas."""
    volatile.db(Homework, homework_id, label=f"hard-delete homework #{homework_id}")
    volatile.db_query(HomeworkAssignment, homework_id=homework_id, label=f"hard-delete assignments de homework #{homework_id}")
    volatile.api("DELETE", f"/api/v1/homework/{homework_id}", token=teacher_token)


@pytest.fixture
def linked_student(db, fixed_users, volatile):
    """Vincula temporalmente al estudiante fijo con el profesor fijo."""
    teacher = db.query(TeacherProfile).filter(TeacherProfile.user_id == fixed_users["teacher"].id).first()
    original_students = list(teacher.students or [])

    from app.models.student import StudentProfile
    student_profile = db.query(StudentProfile).filter(StudentProfile.user_id == fixed_users["student"].id).first()

    if student_profile.id not in original_students:
        teacher.students = original_students + [student_profile.id]
        db.commit()

    def _restore():
        from app.db.base import SessionLocal
        s = SessionLocal()
        try:
            t = s.query(TeacherProfile).filter(TeacherProfile.id == teacher.id).first()
            t.students = original_students
            s.commit()
        finally:
            s.close()

    volatile.custom(_restore, label="revertir vínculo profesor-estudiante fijo")
    return student_profile.id


def test_teacher_creates_and_lists_material(client, teacher_token, volatile):
    r = client.post(
        "/api/v1/materials/",
        data={"title": "Flow-test material", "category": "vocabulary", "level": "A1"},
        headers=auth_headers(teacher_token),
    )
    assert r.status_code == 201, r.text
    material = r.json()
    assert material["id"]
    material_id = material["id"]
    _register_material_cleanup(volatile, teacher_token, material_id)

    r_list = client.get("/api/v1/materials/my-materials", headers=auth_headers(teacher_token))
    assert r_list.status_code == 200
    assert any(m["id"] == material_id for m in r_list.json())


def test_only_teacher_can_create_material(client, student_token):
    r = client.post(
        "/api/v1/materials/",
        data={"title": "No debería crearse", "category": "vocabulary"},
        headers=auth_headers(student_token),
    )
    assert r.status_code == 403


def test_material_vocabulary_and_assignment(client, teacher_token, student_token, linked_student, volatile):
    r = client.post(
        "/api/v1/materials/",
        data={"title": "Vocab flow-test", "category": "vocabulary"},
        headers=auth_headers(teacher_token),
    )
    assert r.status_code == 201, r.text
    material_id = r.json()["id"]
    _register_material_cleanup(volatile, teacher_token, material_id)

    r_vocab = client.post(
        f"/api/v1/materials/{material_id}/vocabulary",
        json={"words": ["hello", "world", "hello"]},
        headers=auth_headers(teacher_token),
    )
    assert r_vocab.status_code == 200, r_vocab.text
    assert r_vocab.json()["words"] == ["Hello", "World"]

    r_assign = client.post(
        f"/api/v1/materials/{material_id}/assign",
        json={"student_ids": [linked_student]},
        headers=auth_headers(teacher_token),
    )
    assert r_assign.status_code == 200, r_assign.text
    body = r_assign.json()
    assert body["assigned"] == 1, f"Debería asignarse 1 (vinculamos al estudiante antes): {body}"

    r_student_materials = client.get("/api/v1/materials/student/my-materials", headers=auth_headers(student_token))
    assert r_student_materials.status_code == 200, r_student_materials.text
    assert any(a["material_id"] == material_id for a in r_student_materials.json())


def test_homework_create_assign_and_delete(client, teacher_token, linked_student, volatile):
    due = (datetime.now(tz.utc) + timedelta(days=7)).isoformat()
    r = client.post("/api/v1/homework/", json={
        "title": "Flow-test homework",
        "description": "Tarea creada por la suite automática de flow-tests.",
        "due_date_utc": due,
        "student_ids": [linked_student],
    }, headers=auth_headers(teacher_token))
    assert r.status_code == 201, r.text
    homework_id = r.json()["id"]
    _register_homework_cleanup(volatile, teacher_token, homework_id)

    r_list = client.get("/api/v1/homework/my-homework", headers=auth_headers(teacher_token))
    assert r_list.status_code == 200
    assert any(h["id"] == homework_id for h in r_list.json())

    r_del = client.delete(f"/api/v1/homework/{homework_id}", headers=auth_headers(teacher_token))
    assert r_del.status_code in (200, 204)
    # El resto de la limpieza (hard-delete) queda registrada en `volatile`.


def test_homework_requires_approved_teacher_role(client, student_token):
    due = (datetime.now(tz.utc) + timedelta(days=7)).isoformat()
    r = client.post("/api/v1/homework/", json={
        "title": "No debería crearse", "description": "x", "due_date_utc": due, "student_ids": [],
    }, headers=auth_headers(student_token))
    assert r.status_code == 403
