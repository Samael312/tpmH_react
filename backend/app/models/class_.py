from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base
import enum


class ClassType(str, enum.Enum):
    trial   = "trial"    # Prueba — no consume del paquete, staff la ofrece
    regular = "regular"  # Clase normal del paquete


class Class(Base):
    __tablename__ = "classes"

    id = Column(Integer, primary_key=True, index=True)
    enrollment_id = Column(
        Integer, ForeignKey("enrollments.id"), nullable=True
    )
    # nullable=True porque las clases trial no tienen enrollment

    teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=False)
    student_id = Column(Integer, ForeignKey("student_profiles.id"), nullable=False)

    # Tipo de clase
    class_type = Column(
        Enum(ClassType),
        default=ClassType.regular,
        nullable=False
    )

    # Materia — se hereda del paquete o se asigna manualmente en trial
    subject = Column(String, nullable=True)
    # "Inglés", "Francés", "Guitarra", etc.

    start_time_utc = Column(DateTime(timezone=True), nullable=False)
    end_time_utc = Column(DateTime(timezone=True), nullable=False)
    duration = Column(Integer, nullable=False)

    # Estados
    status = Column(String, default="pending")
    # pending          → bloquea slot, esperando comprobante
    # pending_payment  → comprobante subido, en revisión
    # confirmed        → pago validado, Meet link visible
    # completed        → clase realizada
    # cancelled        → cancelada
    # no_show          → no asistió
    # rescheduled      → slot original (histórico tras mover)

    meet_link = Column(String, nullable=True)
    teacher_timezone = Column(String, nullable=True)
    student_timezone = Column(String, nullable=True)
    notes = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    enrollment = relationship("Enrollment", back_populates="classes")

    @property
    def duration_minutes(self):
        return self.duration