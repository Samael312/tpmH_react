from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base


class Class(Base):
    """
    Clase individual agendada.
    start_time_utc y end_time_utc son la fuente de verdad.
    El frontend convierte a zona local para mostrar.
    """
    __tablename__ = "classes"

    id = Column(Integer, primary_key=True, index=True)
    enrollment_id = Column(Integer, ForeignKey("enrollments.id"), nullable=False)
    teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=False)
    student_id = Column(Integer, ForeignKey("student_profiles.id"), nullable=False)

    # Fuente de verdad — UTC siempre
    start_time_utc = Column(DateTime(timezone=True), nullable=False)
    end_time_utc = Column(DateTime(timezone=True), nullable=False)
    duration = Column(Integer, nullable=False)  # minutos

    # Metadatos de zona para auditoría y logs
    # No se usan para cálculos, solo para mostrar en reportes
    teacher_timezone = Column(String, nullable=True)
    student_timezone = Column(String, nullable=True)

    status = Column(String, default="pending")
    # pending → confirmed → completed
    # pending → cancelled
    # pending → no_show

    notes = Column(String, nullable=True)  # Notas del profesor sobre la clase
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    enrollment = relationship("Enrollment", back_populates="classes")