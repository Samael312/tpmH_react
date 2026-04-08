from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Float
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base


class Homework(Base):
    """
    Tarea creada por un profesor.
    Una tarea puede asignarse a múltiples estudiantes.
    """
    __tablename__ = "homework"

    id = Column(Integer, primary_key=True, index=True)
    teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=False)

    title = Column(String, nullable=False)
    description = Column(String, nullable=False)
    due_date_utc = Column(DateTime(timezone=True), nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relaciones
    teacher = relationship("TeacherProfile", backref="homework")
    assignments = relationship("HomeworkAssignment", back_populates="homework")


class HomeworkAssignment(Base):
    """
    Asignación de una tarea a un estudiante específico.
    Aquí vive la respuesta y la calificación.
    """
    __tablename__ = "homework_assignments"

    id = Column(Integer, primary_key=True, index=True)
    homework_id = Column(Integer, ForeignKey("homework.id"), nullable=False)
    student_id = Column(Integer, ForeignKey("student_profiles.id"), nullable=False)

    status = Column(String, default="pending")
    # "pending" → "submitted" → "graded"

    submission = Column(String, nullable=True)       # Respuesta del estudiante
    submitted_at = Column(DateTime(timezone=True), nullable=True)

    # Calificación
    score = Column(Float, nullable=True)             # 0.0 - 10.0
    feedback = Column(String, nullable=True)
    graded_at = Column(DateTime(timezone=True), nullable=True)

    assigned_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relaciones
    homework = relationship("Homework", back_populates="assignments")
    student = relationship("StudentProfile", backref="homework_assignments")