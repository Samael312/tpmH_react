from sqlalchemy.orm import Session
from app.models.teacher import TeacherProfile
from app.models.student import StudentProfile


def link_student_to_teacher(
    db: Session,
    student_profile: StudentProfile,
    new_teacher: TeacherProfile,
    old_teacher_username: str | None = None,
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

    db.commit()

    # Import diferido para evitar un ciclo de imports a nivel de módulo
    # (core/chat.py no depende de este archivo, así que no hay ciclo real,
    # pero se mantiene el import acá adentro por si en el futuro alguno de
    # los dos empieza a importar del otro en el nivel superior).
    from app.core.chat import ensure_direct_conversation
    ensure_direct_conversation(db, student_profile.id, new_teacher.id)