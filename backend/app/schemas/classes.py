from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import datetime


class BookClassRequest(BaseModel):
    """
    El estudiante envía el slot elegido en UTC
    junto con el enrollment al que pertenece la clase.
    """
    enrollment_id: int
    start_time_utc: datetime
    end_time_utc: datetime
    duration_minutes: int

    @field_validator("end_time_utc")
    @classmethod
    def validate_end_after_start(cls, v, info):
        if "start_time_utc" in info.data and v <= info.data["start_time_utc"]:
            raise ValueError("end_time_utc debe ser posterior a start_time_utc")
        return v


class RescheduleClassRequest(BaseModel):
    """Nuevo horario para una clase existente"""
    start_time_utc: datetime
    end_time_utc: datetime


class UpdateClassStatusRequest(BaseModel):
    """Solo el profesor o superadmin pueden cambiar estados"""
    status: str

    @field_validator("status")
    @classmethod
    def validate_status(cls, v):
        allowed = ["pending", "confirmed", "completed", "cancelled", "no_show"]
        if v not in allowed:
            raise ValueError(f"Estado inválido. Opciones: {allowed}")
        return v


class ClassResponse(BaseModel):
    """
    Respuesta completa de una clase.
    El frontend convierte start/end UTC a zona local.
    """
    id: int
    enrollment_id: int
    teacher_id: int
    student_id: int
    start_time_utc: datetime
    end_time_utc: datetime
    duration_minutes: int
    teacher_timezone: Optional[str]
    student_timezone: Optional[str]
    status: str
    notes: Optional[str]
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


class ClassListResponse(BaseModel):
    """Lista de clases con metadata de paginación"""
    classes: List[ClassResponse]
    total: int
    upcoming: int
    completed: int