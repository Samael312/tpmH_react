from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base
import enum
from sqlalchemy.dialects.postgresql import JSONB


class EnrollmentStatus(str, enum.Enum):
    active    = "active"
    completed = "completed"   # Todas las clases usadas
    cancelled = "cancelled"
    # pending_renewal → estudiante solicitó renovar, esperando pago del staff
    pending_renewal = "pending_renewal"
    pending_package_change = "pending_package_change"


class Package(Base):
    __tablename__ = "packages"

    id = Column(Integer, primary_key=True, index=True)
    teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=False)

    name = Column(String, nullable=False)
    subject = Column(String, nullable=False)
    # "Inglés", "Francés", "Guitarra", "Matemáticas", etc.

    description = Column(String, nullable=True)
    classes_count = Column(Integer, nullable=True)
    price = Column(Float, nullable=False)
    duration_minutes = Column(Integer, default=60)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    icon = Column(String, nullable=True, default="📦")
    color = Column(String, nullable=True, default="#ec4899")
    description_type = Column(String, default="paragraph")  # "paragraph" | "list"
    description_items = Column(JSONB, nullable=True)  # ["Punto 1", "Punto 2", ...]





    teacher = relationship("TeacherProfile", back_populates="packages")

    # Explícito: solo enrollments donde package_id apunta a este paquete
    # (no confundir con renewal_requested_package_id, que es otra FK
    # hacia esta misma tabla usada para las solicitudes de renovación).
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

    status = Column(Enum(EnrollmentStatus),default=EnrollmentStatus.active)

    # Renovación
    renewal_count = Column(Integer, default=0)
    previous_enrollment_id = Column(Integer, ForeignKey("enrollments.id"), nullable=True)
    renewal_requested_package_id = Column(Integer, ForeignKey("packages.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    student = relationship("StudentProfile", back_populates="enrollments")
    change_requested_package_id = Column(Integer, ForeignKey("packages.id"), nullable=True)


    package = relationship("Package", back_populates="enrollments",foreign_keys=[package_id],)
    renewal_requested_package = relationship("Package", foreign_keys=[renewal_requested_package_id], viewonly=True,)
    change_requested_package = relationship("Package", foreign_keys=[change_requested_package_id],viewonly=True,)
    classes = relationship("Class", back_populates="enrollment")
    payment = relationship("Payment", back_populates="enrollment", uselist=False)
    teacher = relationship("TeacherProfile", back_populates="enrollments")