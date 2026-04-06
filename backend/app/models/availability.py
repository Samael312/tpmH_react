from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Date
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base

class TeacherAvailability(Base):
    __tablename__ = "teacher_availability"

    id = Column(Integer, primary_key=True, index=True)
    teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=False)
    day_of_week = Column(String, nullable=False)  # Lunes, Martes...
    start_time = Column(Integer, nullable=False)   # HHMM
    end_time = Column(Integer, nullable=False)
    is_available = Column(Boolean, default=True)

    teacher = relationship("TeacherProfile", back_populates="availability")

class TeacherAvailabilityException(Base):
    __tablename__ = "teacher_availability_exceptions"

    id = Column(Integer, primary_key=True, index=True)
    teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=False)
    date = Column(String, nullable=False)
    start_time = Column(Integer, nullable=False)
    end_time = Column(Integer, nullable=False)
    is_available = Column(Boolean, default=True)

    teacher = relationship("TeacherProfile", back_populates="availability_exceptions")