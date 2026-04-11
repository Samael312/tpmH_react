from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base
import enum


class EnrollmentStatus(str, enum.Enum):
    active    = "active"
    completed = "completed"   # Todas las clases usadas
    cancelled = "cancelled"
    # pending_renewal → estudiante solicitó renovar, esperando pago del staff
    pending_renewal = "pending_renewal"


class Package(Base):
    __tablename__ = "packages"

    id = Column(Integer, primary_key=True, index=True)
    teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=False)

    name = Column(String, nullable=False)
    subject = Column(String, nullable=False)
    # "Inglés", "Francés", "Guitarra", "Matemáticas", etc.

    description = Column(String, nullable=True)
    classes_count = Column(Integer, nullable=False)
    price = Column(Float, nullable=False)
    duration_minutes = Column(Integer, default=60)
    # Duración estándar de cada clase en este paquete: 30, 60 o 90

    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    teacher = relationship("TeacherProfile", back_populates="packages")
    enrollments = relationship("Enrollment", back_populates="package")


class Enrollment(Base):
    __tablename__ = "enrollments"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("student_profiles.id"), nullable=False)
    package_id = Column(Integer, ForeignKey("packages.id"), nullable=False)
    teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=False)

    classes_used = Column(Integer, default=0)
    classes_total = Column(Integer, nullable=False)

    status = Column(
        Enum(EnrollmentStatus),
        default=EnrollmentStatus.active
    )

    # Renovación
    renewal_count = Column(Integer, default=0)
    # Cuántas veces ha renovado este paquete el estudiante
    previous_enrollment_id = Column(
        Integer, ForeignKey("enrollments.id"), nullable=True
    )
    # Referencia al enrollment anterior para historial de renovaciones

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    student = relationship("StudentProfile", back_populates="enrollments")
    package = relationship("Package", back_populates="enrollments")
    classes = relationship("Class", back_populates="enrollment")
    payment = relationship("Payment", back_populates="enrollment", uselist=False)