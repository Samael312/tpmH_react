# app/models/package.py

import enum
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import JSONB

from app.db.base import Base


class EnrollmentStatus(str, enum.Enum):
    active = "active"
    completed = "completed"  # Todas las clases usadas
    cancelled = "cancelled"
    pending_renewal = "pending_renewal"  # Estudiante solicitó renovar, esperando pago/confirmación
    pending_package_change = "pending_package_change"


class Package(Base):
    __tablename__ = "packages"

    id = Column(Integer, primary_key=True, index=True)
    teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=False)

    name = Column(String, nullable=False)
    subject = Column(String, nullable=False)  # "Inglés", "Francés", "Guitarra", "Matemáticas", etc.

    description = Column(String, nullable=True)
    classes_count = Column(Integer, nullable=True)  # NULL si es paquete ilimitado/mensual
    price = Column(Float, nullable=False)
    duration_minutes = Column(Integer, default=50)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    icon = Column(String, nullable=True, default="📦")
    color = Column(String, nullable=True, default="#ec4899")
    description_type = Column(String, default="paragraph")  # "paragraph" | "list"
    description_items = Column(JSONB, nullable=True)  # ["Punto 1", "Punto 2", ...]

    # Clases grupales
    is_group = Column(Boolean, default=False)
    min_students = Column(Integer, nullable=True)  # referencia al crear una cohorte
    max_students = Column(Integer, nullable=True)  # cupo máximo por cohorte

    # Campos para pagos en cuotas
    allow_installments = Column(Boolean, default=False)
    installment_count = Column(Integer, nullable=True)   # Número total de cuotas (ej. 3)
    installment_amount = Column(Float, nullable=True)    # Precio por cuota

    # Relaciones
    teacher = relationship("TeacherProfile", back_populates="packages")
    enrollments = relationship(
        "Enrollment",
        back_populates="package",
        foreign_keys="Enrollment.package_id",
    )


class Enrollment(Base):
    __tablename__ = "enrollments"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("student_profiles.id"), nullable=False)
    package_id = Column(Integer, ForeignKey("packages.id"), nullable=False)
    teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=False)

    classes_used = Column(Integer, default=0)
    classes_total = Column(Integer, nullable=True)

    status = Column(Enum(EnrollmentStatus), default=EnrollmentStatus.active)

    # Renovación y Cambio de Paquete
    renewal_count = Column(Integer, default=0)
    previous_enrollment_id = Column(Integer, ForeignKey("enrollments.id"), nullable=True)
    renewal_requested_package_id = Column(Integer, ForeignKey("packages.id"), nullable=True)
    change_requested_package_id = Column(Integer, ForeignKey("packages.id"), nullable=True)

    # Clases grupales — NULL si es un enrollment individual
    cohort_id = Column(Integer, ForeignKey("group_cohorts.id"), nullable=True)
    # Resto fraccional a favor tras convertir créditos grupales a individuales
    # (ver migración grupal -> individual en core/class_logic.py)
    credit_balance_usd = Column(Float, nullable=True)

    # Gestión de Créditos, Activación y Cuotas
    unlocked_credits = Column(Integer, default=0)
    prepaid_unlimited_credits = Column(Integer, default=0)
    payment_status = Column(String, default="unpaid")  # "unpaid" | "partially_paid" | "paid"
    paid_via_installments = Column(Boolean, default=False)
    installments_paid = Column(Integer, default=0)
    low_credit_notified_at = Column(DateTime(timezone=True), nullable=True)
    activated_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relaciones
    student = relationship("StudentProfile", back_populates="enrollments")
    teacher = relationship("TeacherProfile", back_populates="enrollments")
    package = relationship("Package", back_populates="enrollments", foreign_keys=[package_id])
    renewal_requested_package = relationship("Package", foreign_keys=[renewal_requested_package_id], viewonly=True)
    change_requested_package = relationship("Package", foreign_keys=[change_requested_package_id], viewonly=True)
    classes = relationship("Class", back_populates="enrollment")
    payment = relationship("Payment", back_populates="enrollment", uselist=False)
    cohort = relationship("GroupCohort", back_populates="enrollments")