from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Enum, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base
import enum


class ClassType(str, enum.Enum):
    trial    = "trial"     # Prueba — no consume del paquete, staff la ofrece
    regular  = "regular"   # Clase normal del paquete
    group    = "group"     # Sesión grupal — múltiples alumnos vía ClassParticipant
    external = "external"  # Importada desde el Google Calendar del profesor
                            # (ej. clases de Preply, ver core/google_calendar.py
                            # ::import_external_classes_for_teacher). No tiene
                            # student_id (no existe como alumno en la plataforma)
                            # ni enrollment_id, y no consume paquete/crédito.


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
    # Minutos de margen que esta clase reserva DESPUÉS de su fin real
    # (end_time_utc) para que el profesor se prepare para la siguiente.
    # Se fija una sola vez al crear la clase, según su class_type y los
    # valores configurados por el superadmin (buffer_trial_minutes /
    # buffer_regular_minutes / buffer_group_minutes en PlatformConfig) —
    # ver core/class_logic.py::get_buffer_minutes_for_type. El "bloque"
    # que realmente ocupa la agenda del profesor es siempre
    # [start_time_utc, end_time_utc + buffer_minutes).
    buffer_minutes = Column(Integer, nullable=False, default=10)
    google_event_id = Column(String, nullable=True)  # Para sync con Calendar
    # Origen de una clase class_type=="external" (ej. "preply"). NULL para
    # cualquier otra clase (creada normalmente en la plataforma).
    external_source = Column(String, nullable=True)
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