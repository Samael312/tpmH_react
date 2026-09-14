"""
Suite: Regresión de D5 (ver backlog_tpmH.md).

D5: `can_book_slot()` (core/class_logic.py) solo comparaba
`nuevo_candidato.start_time_utc < existente.end_time_utc + buffer`, es
decir, UNA sola dirección del chequeo de solape de intervalos. Con una
clase existente 8:30-9:20 (buffer 10min -> ocupada hasta las 9:30), un
candidato 7:30-8:20 (que ni siquiera toca ese horario) también empezaba
"antes de las 9:30" y quedaba bloqueado por error.

Fix: se agregó el parámetro `end_time_utc` (fin del bloque ocupado por el
candidato, incluyendo SU PROPIO margen) y la segunda condición del
solape real de intervalos: `existente.start_time_utc < candidato_end`.

Estos tests llaman a `can_book_slot` directamente (sin pasar por HTTP)
insertando las clases "existentes" por ORM -- no hace falta todo el
flujo de reserva para ejercer esta función pura.
"""
from datetime import datetime, timedelta, timezone as tz

import pytest

from app.models.teacher import TeacherProfile
from app.models.student import StudentProfile
from app.models.class_ import Class, ClassType
from app.models.class_participant import ClassParticipant
from app.models.package import Package, Enrollment, EnrollmentStatus
from app.core.class_logic import can_book_slot

pytestmark = pytest.mark.integration


@pytest.fixture
def slot_env(db, fixed_users, volatile):
    teacher = db.query(TeacherProfile).filter(TeacherProfile.user_id == fixed_users["teacher"].id).first()
    student = db.query(StudentProfile).filter(StudentProfile.user_id == fixed_users["student"].id).first()
    tracked = {
        "teacher_id": teacher.id, "student_id": student.id,
        "class_ids": [], "participant_ids": [], "enrollment_ids": [], "package_ids": [],
    }

    def _cleanup():
        from app.db.base import SessionLocal
        s = SessionLocal()
        try:
            def _run(fn):
                try:
                    fn()
                    s.commit()
                except Exception:
                    s.rollback()

            if tracked["participant_ids"]:
                _run(lambda: s.query(ClassParticipant).filter(
                    ClassParticipant.id.in_(tracked["participant_ids"])
                ).delete(synchronize_session=False))
            if tracked["class_ids"]:
                _run(lambda: s.query(Class).filter(
                    Class.id.in_(tracked["class_ids"])
                ).delete(synchronize_session=False))
            if tracked["enrollment_ids"]:
                _run(lambda: s.query(Enrollment).filter(
                    Enrollment.id.in_(tracked["enrollment_ids"])
                ).delete(synchronize_session=False))
            if tracked["package_ids"]:
                _run(lambda: s.query(Package).filter(
                    Package.id.in_(tracked["package_ids"])
                ).delete(synchronize_session=False))
        finally:
            s.close()

    volatile.custom(_cleanup, label="limpieza de test_d5_slot_overlap_regression")
    return tracked


def _make_group_class_with_participant(db, tracked, *, start, duration_minutes=50, buffer_minutes=10):
    """
    Clase grupal (Class.student_id=None, como corresponde a class_type
    group) con una inscripción concreta (ClassParticipant) del alumno de
    slot_env -- necesaria para poder ejercer la rama de código que
    revienta con el bug adicional descrito en el docstring del módulo.
    """
    pkg = Package(
        teacher_id=tracked["teacher_id"], name="Flow-test D5 grupal", subject="English",
        price=50.0, classes_count=4, duration_minutes=duration_minutes, is_group=True,
    )
    db.add(pkg)
    db.commit()
    db.refresh(pkg)
    tracked["package_ids"].append(pkg.id)

    enrollment = Enrollment(
        student_id=tracked["student_id"], teacher_id=tracked["teacher_id"], package_id=pkg.id,
        classes_used=0, classes_total=4, unlocked_credits=4,
        payment_status="paid", status=EnrollmentStatus.active,
        activated_at=datetime.now(tz.utc),
    )
    db.add(enrollment)
    db.commit()
    db.refresh(enrollment)
    tracked["enrollment_ids"].append(enrollment.id)

    group_class = Class(
        teacher_id=tracked["teacher_id"], student_id=None,
        class_type=ClassType.group, status="confirmed",
        start_time_utc=start, end_time_utc=start + timedelta(minutes=duration_minutes),
        duration=duration_minutes, buffer_minutes=buffer_minutes,
    )
    db.add(group_class)
    db.commit()
    db.refresh(group_class)
    tracked["class_ids"].append(group_class.id)

    participant = ClassParticipant(
        class_id=group_class.id, student_id=tracked["student_id"], enrollment_id=enrollment.id,
        attendance_status="confirmed",
    )
    db.add(participant)
    db.commit()
    db.refresh(participant)
    tracked["participant_ids"].append(participant.id)

    return group_class


def _make_existing_class(db, tracked, *, start, duration_minutes=50, buffer_minutes=10, teacher_id=None, student_id=None):
    c = Class(
        teacher_id=teacher_id or tracked["teacher_id"],
        student_id=student_id or tracked["student_id"],
        class_type=ClassType.regular,
        status="confirmed",
        start_time_utc=start,
        end_time_utc=start + timedelta(minutes=duration_minutes),
        duration=duration_minutes,
        buffer_minutes=buffer_minutes,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    tracked["class_ids"].append(c.id)
    return c


# Ancla lejos de "ahora" (no importa la antelación mínima -- estos tests
# llaman a can_book_slot directo, sin la validación de horas de antelación
# que hace el endpoint HTTP por encima).
BASE_DAY = datetime.now(tz.utc).replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=30)


def test_d5_candidate_before_existing_class_with_no_real_overlap_is_allowed(db, slot_env):
    """
    Técnico: reproduce literalmente el escenario del ticket. Clase
    existente 8:30-9:20 (+10min margen -> ocupada hasta 9:30). Candidato
    7:30-8:20 (+10min margen -> terminaría ocupando hasta las 8:30, justo
    cuando empieza la existente -- sin solape real). Antes del fix, esto
    se bloqueaba por error.
    UX: un estudiante debe poder agendar cualquier horario que de verdad
    quede libre en la agenda del profesor, sin falsos bloqueos por clases
    que están más tarde ese mismo día.
    """
    existing_start = BASE_DAY.replace(hour=8, minute=30)
    _make_existing_class(db, slot_env, start=existing_start, duration_minutes=50, buffer_minutes=10)

    candidate_start = BASE_DAY.replace(hour=7, minute=30)
    candidate_end = candidate_start + timedelta(minutes=50 + 10)  # ocupado: duración + margen propio

    can_book, error_msg = can_book_slot(
        start_time_utc=candidate_start,
        teacher_id=slot_env["teacher_id"],
        student_id=slot_env["student_id"],
        end_time_utc=candidate_end,
        db=db,
    )
    assert can_book is True, f"D5: 7:30-8:20 no debería chocar con una clase 8:30-9:20 (error: {error_msg!r})"


@pytest.mark.parametrize("hour", [8, 9])
def test_d5_genuinely_overlapping_slots_still_blocked(db, slot_env, hour):
    """
    Técnico: contraprueba de que el fix no abrió la puerta a solapes
    reales. Con la misma clase existente 8:30-9:20 (+10min margen), tanto
    8:00-8:50 como 9:00-9:50 SÍ se solapan de verdad con su bloque
    ocupado (8:30-9:30) y deben seguir bloqueados.
    UX: el profesor nunca debe terminar con dos clases que de verdad se
    pisan en su agenda.
    """
    existing_start = BASE_DAY.replace(hour=8, minute=30)
    _make_existing_class(db, slot_env, start=existing_start, duration_minutes=50, buffer_minutes=10)

    candidate_start = BASE_DAY.replace(hour=hour, minute=0)
    candidate_end = candidate_start + timedelta(minutes=50 + 10)

    can_book, error_msg = can_book_slot(
        start_time_utc=candidate_start,
        teacher_id=slot_env["teacher_id"],
        student_id=slot_env["student_id"],
        end_time_utc=candidate_end,
        db=db,
    )
    assert can_book is False, f"D5 (contraprueba): {candidate_start.strftime('%H:%M')} SÍ se solapa con 8:30-9:20 y debe bloquearse"
    assert "ya tiene una clase" in error_msg.lower()


def test_bug_adicional_group_participation_conflict_check_does_not_crash_and_blocks_real_overlap(db, slot_env):
    """
    Técnico: bug adicional hallado auditando D5 (no estaba en el
    backlog). El chequeo de "el alumno ya tiene una participación grupal
    a esta hora" hacía `db.query(ClassParticipant)...` y después llamaba
    `_occupied_end(c)` sobre esos resultados -- pero ClassParticipant NO
    tiene end_time_utc/buffer_minutes/start_time_utc, así que si esta
    rama llegaba a ejecutarse (alumno con una inscripción grupal
    cualquiera dentro de la ventana de búsqueda) reventaba con
    AttributeError en vez de devolver True/False. Fix: la query ahora
    selecciona `Class` (mismo join), que sí tiene esos campos, y de paso
    aplica el chequeo bidireccional de D5.

    Este test verifica las dos puntas: (a) no explota, y (b) sigue
    bloqueando un solape real con la sesión grupal.
    """
    group_start = BASE_DAY.replace(hour=10, minute=0)
    _make_group_class_with_participant(db, slot_env, start=group_start, duration_minutes=50, buffer_minutes=10)
    # Bloque ocupado de la sesión grupal: 10:00 -> 10:50+10min = 11:00.

    overlapping_start = BASE_DAY.replace(hour=10, minute=30)
    overlapping_end = overlapping_start + timedelta(minutes=50 + 10)

    can_book, error_msg = can_book_slot(
        start_time_utc=overlapping_start,
        teacher_id=slot_env["teacher_id"] + 1000,  # otro profesor -- solo importa el lado del alumno
        student_id=slot_env["student_id"],
        end_time_utc=overlapping_end,
        db=db,
    )
    assert can_book is False, f"Debería bloquear: el alumno ya está en una sesión grupal a esa hora (error: {error_msg!r})"
    assert "ya tienes una clase" in error_msg.lower()

    non_overlapping_start = BASE_DAY.replace(hour=13, minute=0)
    non_overlapping_end = non_overlapping_start + timedelta(minutes=50 + 10)

    can_book_2, error_msg_2 = can_book_slot(
        start_time_utc=non_overlapping_start,
        teacher_id=slot_env["teacher_id"] + 1000,
        student_id=slot_env["student_id"],
        end_time_utc=non_overlapping_end,
        db=db,
    )
    assert can_book_2 is True, f"No debería bloquear un horario que de verdad está libre (error: {error_msg_2!r})"


def test_d5_candidate_right_after_existing_class_buffer_is_allowed(db, slot_env):
    """
    Técnico: simétrico al primer test, del otro lado -- un candidato que
    empieza EXACTO cuando termina el bloque ocupado (con margen) de la
    clase existente no debería bloquearse (no hay solape, son bloques
    contiguos).
    UX: el margen de preparación debe alcanzar exactamente lo
    configurado, ni un minuto de más "fantasma" bloqueando el siguiente
    horario disponible.
    """
    existing_start = BASE_DAY.replace(hour=8, minute=30)
    _make_existing_class(db, slot_env, start=existing_start, duration_minutes=50, buffer_minutes=10)
    # Bloque ocupado de la existente: 8:30 -> 9:30 (50min + 10min margen).

    candidate_start = BASE_DAY.replace(hour=9, minute=30)
    candidate_end = candidate_start + timedelta(minutes=50 + 10)

    can_book, error_msg = can_book_slot(
        start_time_utc=candidate_start,
        teacher_id=slot_env["teacher_id"],
        student_id=slot_env["student_id"],
        end_time_utc=candidate_end,
        db=db,
    )
    assert can_book is True, f"D5: 9:30 no debería chocar (empieza justo cuando libera la clase anterior): {error_msg!r}"
