from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base

class Package(Base):
    __tablename__ = "packages"

    id = Column(Integer, primary_key=True, index=True)
    teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=False)
    name = Column(String, nullable=False, unique=True)
    classes_count = Column(Integer, nullable=False)
    price = Column(Float, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relaciones
    teacher = relationship("TeacherProfile", back_populates="packages")
    enrollments = relationship("Enrollment", back_populates="package")

class Enrollment(Base):
    __tablename__ = "enrollments"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("student_profiles.id"), nullable=False)
    teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=False)
    package_id = Column(Integer, ForeignKey("packages.id"), nullable=False)
    classes_used = Column(Integer, default=0)
    classes_total = Column(Integer, nullable=False)
    status = Column(String, default="active")  # active, completed, cancelled
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relaciones
    student = relationship("StudentProfile", back_populates="enrollments")
    package = relationship("Package", back_populates="enrollments")
    classes = relationship("Class", back_populates="enrollment")
    payment = relationship("Payment", back_populates="enrollment", uselist=False)