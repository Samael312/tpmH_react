# app/models/group_cohort.py

import enum
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.base import Base


class CohortStatus(str, enum.Enum):
    filling = "filling"          # abierta, aceptando inscripciones
    confirmed = "confirmed"      # cerrada por el profesor o llegó al máximo; fecha fija
    in_progress = "in_progress"  # ya iniciaron las clases
    completed = "completed"
    cancelled = "cancelled"      # no se llenó / el profesor la canceló


class GroupCohort(Base):
    """
    Instancia concreta de un paquete grupal (ej. "Inglés B1 - cohorte marzo").
    Un mismo Package grupal (plantilla) puede reutilizarse en varias cohortes
    a lo largo del tiempo.
    """
    __tablename__ = "group_cohorts"

    id = Column(Integer, primary_key=True, index=True)
    package_id = Column(Integer, ForeignKey("packages.id"), nullable=False)
    teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=False)

    # NULL mientras status == "filling" (aún no hay fecha fija)
    start_date = Column(DateTime(timezone=True), nullable=True)

    status = Column(Enum(CohortStatus), default=CohortStatus.filling, nullable=False)

    # Definidos por el profesor al crear la cohorte. min_students es de
    # referencia/advertencia (no bloquea el cierre manual), max_students sí
    # limita cuántos enrollments pueden apuntar a esta cohorte.
    min_students = Column(Integer, nullable=False)
    max_students = Column(Integer, nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    closed_at = Column(DateTime(timezone=True), nullable=True)  # cuándo se confirmó/canceló

    # Relaciones
    package = relationship("Package", backref="cohorts")
    teacher = relationship("TeacherProfile", backref="cohorts")
    enrollments = relationship("Enrollment", back_populates="cohort")
    classes = relationship("Class", back_populates="cohort")
