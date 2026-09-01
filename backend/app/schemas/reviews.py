from pydantic import BaseModel, field_validator, model_validator, Field
from typing import Optional, List
from datetime import datetime
from app.schemas.god_mode import GodModeActionBase


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
    # NULL en reseñas legacy sin cuenta asociada en este sistema.
    student_id: Optional[int] = None
    rating: float
    comment: Optional[str]
    created_at: datetime

    # Datos del estudiante para mostrar en el perfil público. Para
    # reseñas legacy sin student_id, student_name refleja
    # legacy_student_name y student_username queda en None.
    student_name: Optional[str] = None
    student_username: Optional[str] = None

    # True si se cargó manualmente vía Modo Dios (migración de la
    # plataforma anterior) en vez de por el flujo normal del alumno.
    is_legacy: bool = False
    legacy_student_name: Optional[str] = None

    class Config:
        from_attributes = True


class GodModeCreateReviewRequest(GodModeActionBase):
    """
    Carga manual de una reseña ya existente en la plataforma anterior,
    hecha por un estudiante que en este sistema ya no está activo.

    Debes indicar exactamente una de estas dos identidades:
      - student_id: la cuenta del alumno todavía existe en este sistema
        (aunque esté inactiva o ya no tenga vínculo con el profesor).
      - legacy_student_name: la cuenta no existe acá — solo se guarda
        el nombre a mostrar, sin ligarla a ningún StudentProfile.

    review_date es opcional: si se indica, queda como la fecha "real"
    de la reseña (la que se muestra al público), útil para preservar
    la fecha original de la plataforma anterior en vez de la fecha en
    que se hace la carga.
    """
    teacher_id: int
    rating: float
    comment: Optional[str] = None
    student_id: Optional[int] = None
    legacy_student_name: Optional[str] = Field(None, min_length=2, max_length=150)
    review_date: Optional[datetime] = None

    @field_validator("rating")
    @classmethod
    def validate_rating(cls, v):
        if not 1.0 <= v <= 5.0:
            raise ValueError("El rating debe estar entre 1 y 5")
        return round(v * 2) / 2

    @model_validator(mode="after")
    def check_identity(self):
        if not self.student_id and not self.legacy_student_name:
            raise ValueError(
                "Debes indicar student_id (cuenta existente) o "
                "legacy_student_name (alumno sin cuenta en este sistema)."
            )
        if self.student_id and self.legacy_student_name:
            raise ValueError(
                "Indica solo uno: student_id o legacy_student_name, no ambos."
            )
        return self


class GodModeEditReviewRequest(GodModeActionBase):
    """
    Corrige una reseña ya cargada (legacy o no). No permite cambiar a
    qué alumno/nombre pertenece — si el vínculo está mal, es mejor
    eliminarla y volver a cargarla con 'Añadir reseña legacy'.
    """
    rating: Optional[float] = None
    comment: Optional[str] = None
    legacy_student_name: Optional[str] = Field(None, min_length=2, max_length=150)
    review_date: Optional[datetime] = None

    @field_validator("rating")
    @classmethod
    def validate_rating(cls, v):
        if v is None:
            return v
        if not 1.0 <= v <= 5.0:
            raise ValueError("El rating debe estar entre 1 y 5")
        return round(v * 2) / 2


class GodModeReviewActionResponse(BaseModel):
    message: str
    review: ReviewResponse


class TeacherRatingSummary(BaseModel):
    """Resumen de ratings para mostrar en el perfil público"""
    average_rating: float
    total_reviews: int
    rating_distribution: dict  # {"5": 10, "4": 5, "3": 2, "2": 0, "1": 1}