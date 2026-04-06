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

    # Fechas y horas en ambas zonas horarias
    date_teacher = Column(String, nullable=False)
    date_student = Column(String, nullable=False)
    start_time_teacher = Column(Integer, nullable=False)  # formato HHMM
    start_time_student = Column(Integer, nullable=False)
    end_time_teacher = Column(Integer, nullable=False)
    end_time_student = Column(Integer, nullable=False)
    duration = Column(Integer, default=60)  # minutos

    status = Column(String, default="pending")
    # pending, confirmed, completed, cancelled, no_show
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relaciones
    enrollment = relationship("Enrollment", back_populates="classes")