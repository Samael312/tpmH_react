from sqlalchemy import Column, Integer, String, Float, DateTime, Enum, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import JSONB
import enum
from app.db.base import Base

class TeacherStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"
    suspended = "suspended"

class TeacherProfile(Base):
    __tablename__ = "teacher_profiles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    bio = Column(String, nullable=True)
    title = Column(String, nullable=True)
    timezone = Column(String, default="UTC")
    languages = Column(JSONB, default=list)
    skills = Column(JSONB, default=list)
    certificates = Column(JSONB, default=list)
    gallery = Column(JSONB, default=list)
    social_links = Column(JSONB, default=dict)
    status = Column(Enum(TeacherStatus), default=TeacherStatus.pending)
    commission_rate = Column(Float, default=0.15)  # 15% por defecto
    balance = Column(Float, default=0.0)           # Ganancias acumuladas
    stripe_account_id = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relaciones
    user = relationship("User", back_populates="teacher_profile")
    packages = relationship("Package", back_populates="teacher")
    availability = relationship("TeacherAvailability", back_populates="teacher")
    availability_exceptions = relationship("TeacherAvailabilityException", back_populates="teacher")