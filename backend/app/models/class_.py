from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base


class Class(Base):
    __tablename__ = "classes"

    id = Column(Integer, primary_key=True, index=True)
    enrollment_id = Column(Integer, ForeignKey("enrollments.id"), nullable=False)
    teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=False)
    student_id = Column(Integer, ForeignKey("student_profiles.id"), nullable=False)

    start_time_utc = Column(DateTime(timezone=True), nullable=False)
    end_time_utc = Column(DateTime(timezone=True), nullable=False)
    duration = Column(Integer, nullable=False)

    status = Column(String, default="pending")
    # Estados del flujo:
    # pending          → slot reservado, esperando comprobante
    # pending_payment  → comprobante subido, esperando validación del admin
    # confirmed        → pago validado, clase activa, Meet visible
    # completed        → clase realizada
    # cancelled        → cancelada
    # no_show          → estudiante no asistió

    # Google Meet — solo visible cuando status = confirmed
    meet_link = Column(String, nullable=True)

    # Metadatos de zona para auditoría
    teacher_timezone = Column(String, nullable=True)
    student_timezone = Column(String, nullable=True)

    notes = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    enrollment = relationship("Enrollment", back_populates="classes")

    @property
    def duration_minutes(self):
        return self.duration