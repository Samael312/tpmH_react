# app/models/class_participant.py

from sqlalchemy import Column, Integer, String, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship

from app.db.base import Base


class ClassParticipant(Base):
    """
    Alumno inscrito en una sesión de clase grupal (Class con class_type="group").
    Para clases individuales esta tabla NO se usa — se sigue resolviendo
    directamente con Class.student_id, igual que antes.
    """
    __tablename__ = "class_participants"

    id = Column(Integer, primary_key=True, index=True)
    class_id = Column(Integer, ForeignKey("classes.id"), nullable=False)
    student_id = Column(Integer, ForeignKey("student_profiles.id"), nullable=False)
    enrollment_id = Column(Integer, ForeignKey("enrollments.id"), nullable=False)

    # "confirmed" | "no_show" | "cancelled" (el alumno salió de esta sesión puntual)
    attendance_status = Column(String, default="confirmed")

    class_ = relationship("Class", back_populates="participants")
    student = relationship("StudentProfile", backref="class_participations")
    enrollment = relationship("Enrollment", backref="class_participations")

    __table_args__ = (
        UniqueConstraint("class_id", "student_id", name="uq_class_participant"),
    )
