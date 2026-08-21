from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base


class TeacherAppeal(Base):
    """
    Apelación de un profesor a un rechazo de su perfil.
    Máximo 2 apelaciones por ciclo de rechazo (TeacherProfile.appeal_count).
    Texto libre — el profesor explica por qué considera injusto el rechazo.
    """
    __tablename__ = "teacher_appeals"

    id = Column(Integer, primary_key=True, index=True)
    teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=False)

    appeal_number = Column(Integer, nullable=False)  # 1 o 2 dentro del ciclo actual
    message = Column(Text, nullable=False)

    status = Column(String, default="pending")  # "pending" | "approved" | "rejected"
    admin_response = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    resolved_by = Column(Integer, nullable=True)  # user_id del admin que resolvió

    teacher = relationship("TeacherProfile", back_populates="appeals")