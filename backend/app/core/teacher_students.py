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
    cada vez que un estudiante queda vinculado a un profesor.

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