from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base


class Review(Base):
    """
    Reseña de un estudiante sobre un profesor.
    Solo pueden dejar reseña estudiantes que han tenido
    al menos una clase completada con ese profesor.
    """
    __tablename__ = "reviews"

    id = Column(Integer, primary_key=True, index=True)
    teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=False)
    student_id = Column(Integer, ForeignKey("student_profiles.id"), nullable=False)

    rating = Column(Float, nullable=False)       # 1.0 - 5.0
    comment = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relaciones
    teacher = relationship("TeacherProfile", backref="reviews")
    student = relationship("StudentProfile", backref="reviews")