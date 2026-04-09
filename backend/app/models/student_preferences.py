from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base


class StudentSchedulePreference(Base):
    """
    Preferencias de horario del estudiante.
    Se usan en el calendario para resaltar en morado
    los slots que coinciden con sus horas preferidas.
    No bloquean ni reservan nada — son solo preferencias visuales.
    """
    __tablename__ = "student_schedule_preferences"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("student_profiles.id"), nullable=False)

    day_of_week = Column(Integer, nullable=False)   # 0=Lunes ... 6=Domingo
    start_time_utc = Column(String(5), nullable=False)  # "09:00" UTC
    end_time_utc = Column(String(5), nullable=False)    # "17:00" UTC

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    student = relationship("StudentProfile", backref="schedule_preferences")