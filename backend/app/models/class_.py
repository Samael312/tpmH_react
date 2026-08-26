from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Enum, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base
import enum


class ClassType(str, enum.Enum):
    trial   = "trial"    # Prueba — no consume del paquete, staff la ofrece
    regular = "regular"  # Clase normal del paquete
    group   = "group"    # Sesión grupal — múltiples alumnos vía ClassParticipant


class Class(Base):
    __tablename__ = "classes"

    id = Column(Integer, primary_key=True, index=True)
    enrollment_id = Column(Integer, ForeignKey("enrollments.id"), nullable=True)
    teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=False)
    # NULL solo cuando class_type == "group" (los alumnos viven en
    # ClassParticipant). Para trial/regular sigue siendo obligatorio,
    # validado a nivel de aplicación en core/class_logic.py.
    student_id = Column(Integer, ForeignKey("student_profiles.id"), nullable=True)
    cohort_id = Column(Integer, ForeignKey("group_cohorts.id"), nullable=True)
    class_type = Column(Enum(ClassType),default=ClassType.regular,nullable=False)
    subject = Column(String, nullable=True)
    start_time_utc = Column(DateTime(timezone=True), nullable=False)
    end_time_utc = Column(DateTime(timezone=True), nullable=False)
    day_of_week = Column(String, nullable=True) # Nuevo campo (ej. "Lunes", "Martes")
    duration = Column(Integer, nullable=False)
    google_event_id = Column(String, nullable=True)  # Para sync con Calendar
    status = Column(String, default="pending")
    # pending_trial      → bloquea horario
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
    payment_expires_at = Column(DateTime(timezone=True), nullable=True)
    used_prepaid_credit = Column(Boolean, default=False)  # para saber si hay que devolver crédito al cancelar
    reminder_sent_at = Column(DateTime(timezone=True), nullable=True)  # evita reenviar el recordatorio de 24h

    enrollment = relationship("Enrollment", back_populates="classes")

    student = relationship("StudentProfile", backref="classes_as_student")
    teacher = relationship("TeacherProfile", backref="classes_as_teacher")
    cohort = relationship("GroupCohort", back_populates="classes")
    # Solo poblado para class_type == "group"
    participants = relationship(
        "ClassParticipant", back_populates="class_", cascade="all, delete-orphan"
    )

    @property
    def duration_minutes(self):
        return self.duration