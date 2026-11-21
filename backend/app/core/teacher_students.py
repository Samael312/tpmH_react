from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.models.teacher import TeacherProfile
from app.models.student import StudentProfile
from app.models.student_teacher_link import StudentTeacherLink


def ensure_student_teacher_link(db: Session, student_id: int, teacher_id: int) -> bool:
    """
    Crea el StudentTeacherLink si no existe. Devuelve True si lo creó.

    Tolera la carrera con otra petición (restricción única uq_student_teacher_link): el INSERT va en un
    savepoint y, si pierde la carrera, el IntegrityError se traga y la transacción del llamador sigue viva.
    No hace commit.
    """
    existing = db.query(StudentTeacherLink).filter(
        StudentTeacherLink.student_id == student_id,
        StudentTeacherLink.teacher_id == teacher_id,
    ).first()
    if existing:
        return False
    dialect = db.get_bind().dialect.name
    if dialect in ("postgresql", "sqlite"):
        # INSERT ... ON CONFLICT DO NOTHING: atómico frente a la carrera y sin savepoint (en SQLite/pysqlite un
        # SAVEPOINT fuera de transacción confirmaría lo anterior, rompiendo la atomicidad del backfill).
        if dialect == "postgresql":
            from sqlalchemy.dialects.postgresql import insert as dialect_insert
        else:
            from sqlalchemy.dialects.sqlite import insert as dialect_insert
        stmt = dialect_insert(StudentTeacherLink).values(
            student_id=student_id, teacher_id=teacher_id
        ).on_conflict_do_nothing(index_elements=["student_id", "teacher_id"])
        return db.execute(stmt).rowcount == 1
    try:
        with db.begin_nested():
            db.add(StudentTeacherLink(student_id=student_id, teacher_id=teacher_id))
    except IntegrityError:
        return False
    return True


def link_student_to_teacher(
    db: Session,
    student_profile: StudentProfile,
    new_teacher: TeacherProfile,
    old_teacher_username: str | None = None,
    commit: bool = True,
) -> None:
    """
    Mantiene sincronizado teacher_profiles.students (lista de StudentProfile.id)
    cada vez que un estudiante queda vinculado a un profesor, y crea (si no
    existe todavía) la conversación de chat directa entre ambos — así no
    hace falta que ninguno de los dos entre a apretar "Chat" para que la
    conversación exista (N1/N2, ver core/chat.py::ensure_direct_conversation).
    Esto pasa sin importar si PlatformConfig.chat_enabled está prendido o
    no: el gate del chat es solo para USARLO, no para que la conversación
    exista quieta esperando a que se habilite.

    - Si tenía un profesor anterior distinto, lo remueve de esa lista
      (un estudiante solo pertenece a un profesor a la vez).
    - Lo agrega a la lista del nuevo profesor si no estaba ya.
    - commit=False: no confirma (ni la lista ni la conversación); solo hace flush, para que el llamador
      (p. ej. el backfill single->multi) haga todo en una única transacción.
    """
    if old_teacher_username and old_teacher_username != new_teacher.user_username:
        old_teacher = db.query(TeacherProfile).filter(
            TeacherProfile.user_username == old_teacher_username
        ).first()
        if old_teacher and old_teacher.students:
            if student_profile.id in old_teacher.students:
                old_teacher.students = [
                    sid for sid in old_teacher.students if sid != student_profile.id
                ]

    current = list(new_teacher.students or [])
    if student_profile.id not in current:
        current.append(student_profile.id)
        new_teacher.students = current

    if commit:
        db.commit()
    else:
        db.flush()

    # Import diferido para evitar un ciclo de imports a nivel de módulo
    # (core/chat.py no depende de este archivo, así que no hay ciclo real,
    # pero se mantiene el import acá adentro por si en el futuro alguno de
    # los dos empieza a importar del otro en el nivel superior).
    from app.core.chat import ensure_direct_conversation
    ensure_direct_conversation(db, student_profile.id, new_teacher.id, commit=commit)


# Estados de Class que no cuentan como relación vigente al reconstruir vínculos.
_DEAD_CLASS_STATUSES = ("cancelled", "rejected", "expired")


def backfill_student_teacher_links(db: Session, commit: bool = True) -> dict:
    """
    Reconstruye, de forma ATÓMICA e idempotente, los vínculos alumno-profesor a partir del historial.

    Cubre todos los pares (alumno, profesor) con un Enrollment no cancelado o una Class con alumno
    (student_id no NULL; las de grupo viven en ClassParticipant y ya tienen su Enrollment) que no esté
    cancelada/rechazada/expirada, para CUALQUIER profesor. Omite a alumnos baneados/inactivos y perfiles
    de alumno o profesor inexistentes.

    Por cada par garantiza las TRES fuentes de verdad aunque el link ya existiera: StudentTeacherLink,
    TeacherProfile.students y la conversación directa de chat. Todo en una sola transacción: si algo
    falla se hace rollback y se relanza (reintentar repara). Con commit=False el llamador confirma.

    Desde un script: `with SessionLocal() as db: backfill_student_teacher_links(db)`.
    """
    from app.models.class_ import Class
    from app.models.package import Enrollment, EnrollmentStatus
    from app.models.user import User
    from app.core.chat import ensure_direct_conversation

    stats = {"pairs": 0, "links_created": 0, "students_list_fixed": 0, "skipped_students": 0}
    try:
        pairs: set[tuple[int, int]] = set()
        for sid, tid in db.query(Enrollment.student_id, Enrollment.teacher_id).filter(
            Enrollment.status != EnrollmentStatus.cancelled
        ).distinct().all():
            pairs.add((sid, tid))
        for sid, tid in db.query(Class.student_id, Class.teacher_id).filter(
            Class.student_id.isnot(None),
            Class.teacher_id.isnot(None),
            Class.status.notin_(_DEAD_CLASS_STATUSES),
        ).distinct().all():
            pairs.add((sid, tid))

        students: dict = {}
        teachers: dict = {}
        for sid, tid in sorted(pairs):
            if sid not in students:
                sp = db.get(StudentProfile, sid)
                user = db.get(User, sp.user_id) if sp else None
                if sp is None or user is None or not user.is_active or user.is_banned:
                    sp = None
                    stats["skipped_students"] += 1
                students[sid] = sp
            sp = students[sid]
            if sp is None:
                continue
            if tid not in teachers:
                teachers[tid] = db.get(TeacherProfile, tid)
            tp = teachers[tid]
            if tp is None:
                continue

            stats["pairs"] += 1
            if ensure_student_teacher_link(db, sid, tid):
                stats["links_created"] += 1
            current = list(tp.students or [])
            if sid not in current:
                current.append(sid)
                tp.students = current
                stats["students_list_fixed"] += 1
            ensure_direct_conversation(db, sid, tid, commit=False)

        if commit:
            db.commit()
        else:
            db.flush()
    except Exception:
        db.rollback()
        raise
    return stats
