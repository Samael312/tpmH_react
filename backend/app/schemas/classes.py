from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import datetime


ALLOWED_DURATIONS = [30, 60, 90]


class BookClassRequest(BaseModel):
    """
    Reserva de clase regular.
    Requiere enrollment activo.
    """
    enrollment_id: int
    start_time_utc: datetime
    end_time_utc: datetime
    day_of_week: Optional[str] = None
    duration_minutes: int

    @field_validator("duration_minutes")
    @classmethod
    def validate_duration(cls, v):
        if v not in ALLOWED_DURATIONS:
            raise ValueError(f"Duración inválida. Opciones: {ALLOWED_DURATIONS}")
        return v


class BookTrialRequest(BaseModel):
    """
    Reserva de clase de prueba.
    No requiere enrollment — el staff la ofrece.
    """
    teacher_username: str
    student_id: int          # El staff elige al estudiante
    start_time_utc: datetime
    end_time_utc: datetime
    day_of_week: Optional[str] = None
    subject: str
    duration_minutes: int = 30   # Las trials son 30min por defecto

    @field_validator("duration_minutes")
    @classmethod
    def validate_duration(cls, v):
        if v not in ALLOWED_DURATIONS:
            raise ValueError(f"Duración inválida. Opciones: {ALLOWED_DURATIONS}")
        return v


class RescheduleClassRequest(BaseModel):
    start_time_utc: datetime
    end_time_utc: datetime
    day_of_week: Optional[str] = None


class UpdateClassStatusRequest(BaseModel):
    status: str
    meet_link: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("status")
    @classmethod
    def validate_status(cls, v):
        allowed = [
            "pending", "pending_trial", "pending_payment", "confirmed",
            "completed", "cancelled", "no_show", "rescheduled", "finalized"
        ]
        if v not in allowed:
            raise ValueError(f"Estado inválido. Opciones: {allowed}")
        return v


class ClassResponse(BaseModel):
    id: int
    enrollment_id: Optional[int]
    teacher_id: int
    student_id: int
    class_type: str
    subject: Optional[str]
    start_time_utc: datetime
    end_time_utc: datetime
    day_of_week: Optional[str]
    duration_minutes: int
    status: str
    # Meet link solo se incluye si la clase está confirmed
    meet_link: Optional[str] = None
    notes: Optional[str]
    teacher_timezone: Optional[str]
    student_timezone: Optional[str]
    created_at: datetime
    teacher_nationality: Optional[str] = None
    student_nationality: Optional[str] = None
    teacher_phone: Optional[str] = None
    teacher_name: Optional[str] = None
    teacher_avatar: Optional[str] = None
    student_name: Optional[str] = None
    student_avatar: Optional[str] = None
    student_phone: Optional[str] = None 

    class Config:
        from_attributes = True

    def model_post_init(self, __context):
        # Ocultar meet_link si la clase no está confirmed
        if self.status not in ["confirmed", "completed", "finalized"]:
            self.meet_link = None


class ClassListResponse(BaseModel):
    classes: List[ClassResponse]
    total: int
    upcoming: int
    completed: int