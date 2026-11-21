from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Enum, Boolean, Index
from sqlalchemy.orm import relationship
from sqlalchemy import text
from sqlalchemy.sql import func
from app.db.base import Base
import enum

# Fase 25 (m2): veces que el ALUMNO puede reagendar una misma clase. El profesor y el admin no cuentan.
# Al llegar al tope, el alumno debe pedirselo al profesor o cancelar (regla de >= 12 h).
MAX_STUDENT_RESCHEDULES = 2


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
    __table_args__ = (
        # G2: un mismo evento de Google no puede estar dos veces para el mismo profesor
        # (evita reimportar la clase de Preply en cada sync).
        Index(
            "uq_classes_teacher_google_event", "teacher_id", "google_event_id", unique=True,
            postgresql_where=text("google_event_id IS NOT NULL"),
            sqlite_where=text("google_event_id IS NOT NULL"),
        ),
    )

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
    # Huella (hash corto) de lo ultimo empujado a Google para este evento: si no cambia, la sync no llama a update.
    google_sync_hash = Column(String(32), nullable=True)
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
    # Fase 25 (m2): reagendados hechos por el alumno (tope MAX_STUDENT_RESCHEDULES)
    student_reschedule_count = Column(Integer, nullable=False, default=0, server_default="0")

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