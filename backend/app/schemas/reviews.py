from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import datetime


class CreateReviewRequest(BaseModel):
    rating: float
    comment: Optional[str] = None

    @field_validator("rating")
    @classmethod
    def validate_rating(cls, v):
        if not 1.0 <= v <= 5.0:
            raise ValueError("El rating debe estar entre 1 y 5")
        # Redondeamos a medios puntos: 1, 1.5, 2, 2.5...
        return round(v * 2) / 2


class ReviewResponse(BaseModel):
    id: int
    teacher_id: int
    student_id: int
    rating: float
    comment: Optional[str]
    created_at: datetime

    # Datos del estudiante para mostrar en el perfil público
    student_name: Optional[str] = None
    student_username: Optional[str] = None

    class Config:
        from_attributes = True


class TeacherRatingSummary(BaseModel):
    """Resumen de ratings para mostrar en el perfil público"""
    average_rating: float
    total_reviews: int
    rating_distribution: dict  # {"5": 10, "4": 5, "3": 2, "2": 0, "1": 1}