from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.db.base import Base


class TeacherAvailability(Base):
    """
    Disponibilidad semanal recurrente del profesor, en HORA LOCAL (Fase 26).

    `day_of_week` (0=Lunes ... 6=Domingo, ISO) y `start_time_local`/`end_time_local` ("HH:MM") son el
    dia y la hora de reloj del propio profesor, en la zona IANA ACTUAL de `teacher_profiles.timezone`.
    No hay UTC guardado: el instante real de cada fecha lo calcula `core/slot_availability.py` con
    zoneinfo, asi el horario sigue siendo "18:00-20:00 en Madrid" antes y despues del cambio de hora y,
    si el profesor cambia de zona, conserva su hora local semanal. Si fin <= inicio la franja cruza la
    medianoche local y termina al dia siguiente (00:00-00:00 = 24 h).
    """
    __tablename__ = "teacher_availability"

    id = Column(Integer, primary_key=True, index=True)
    teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=False)
    day_of_week = Column(Integer, nullable=False)       # 0-6 ISO, dia LOCAL del profesor
    start_time_local = Column(String(5), nullable=False)  # "09:00" hora local
    end_time_local = Column(String(5), nullable=False)    # "18:00" hora local
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