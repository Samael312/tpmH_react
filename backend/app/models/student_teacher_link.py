from sqlalchemy import Column, Integer, ForeignKey, DateTime, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base


class StudentTeacherLink(Base):
    """
    Vínculo estudiante-profesor en modo multi-tenant.
    Un estudiante puede tener varios profesores simultáneamente
    (distintas materias/idiomas, o incluso dos profesores del
    mismo idioma). En modo single-tenant esta tabla NO se usa —
    todo se sigue resolviendo contra platform_config.featured_teacher_id.

    Se crea al elegir profesor (choose-teacher) y se borra al
    "terminar relación" con un profesor (solo permitido si no hay
    enrollment activo/pendiente con él).
    """
    __tablename__ = "student_teacher_links"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("student_profiles.id"), nullable=False)
    teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=False)
    linked_at = Column(DateTime(timezone=True), server_default=func.now())

    student = relationship("StudentProfile", backref="teacher_links")
    teacher = relationship("TeacherProfile", backref="student_links")

    __table_args__ = (
        UniqueConstraint("student_id", "teacher_id", name="uq_student_teacher_link"),
    )