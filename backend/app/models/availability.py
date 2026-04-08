from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.db.base import Base


class TeacherAvailability(Base):
    """
    Disponibilidad semanal recurrente del profesor.
    Las horas se guardan en UTC como string HH:MM.
    El día de la semana sigue el estándar ISO:
    0=Lunes, 1=Martes, 2=Miércoles, 3=Jueves,
    4=Viernes, 5=Sábado, 6=Domingo
    """
    __tablename__ = "teacher_availability"

    id = Column(Integer, primary_key=True, index=True)
    teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=False)
    day_of_week = Column(Integer, nullable=False)   # 0-6 ISO
    start_time_utc = Column(String(5), nullable=False)  # "09:00" UTC
    end_time_utc = Column(String(5), nullable=False)    # "18:00" UTC
    is_available = Column(Boolean, default=True)

    teacher = relationship("TeacherProfile", back_populates="availability")


class TeacherAvailabilityException(Base):
    """
    Excepción puntual al horario recurrente.
    Puede ser un bloqueo (is_available=False) o
    un extra de disponibilidad (is_available=True).
    Las fechas son DateTime completo en UTC.
    """
    __tablename__ = "teacher_availability_exceptions"

    id = Column(Integer, primary_key=True, index=True)
    teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=False)
    start_time_utc = Column(DateTime(timezone=True), nullable=False)
    end_time_utc = Column(DateTime(timezone=True), nullable=False)
    is_available = Column(Boolean, default=True)
    reason = Column(String, nullable=True)  # "Vacaciones", "Festivo", etc.

    teacher = relationship(
        "TeacherProfile",
        back_populates="availability_exceptions"
    )