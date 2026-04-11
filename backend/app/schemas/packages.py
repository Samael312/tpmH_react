from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import datetime


ALLOWED_DURATIONS = [30, 60]


class PackageCreate(BaseModel):
    name: str
    subject: str
    description: Optional[str] = None
    classes_count: int
    price: float
    duration_minutes: int = 60

    @field_validator("duration_minutes")
    @classmethod
    def validate_duration(cls, v):
        if v not in ALLOWED_DURATIONS:
            raise ValueError(f"Duración inválida. Opciones: {ALLOWED_DURATIONS}")
        return v

    @field_validator("classes_count")
    @classmethod
    def validate_classes(cls, v):
        if v < 1:
            raise ValueError("El paquete debe tener al menos 1 clase")
        return v

    @field_validator("price")
    @classmethod
    def validate_price(cls, v):
        if v <= 0:
            raise ValueError("El precio debe ser mayor que 0")
        return v


class PackageResponse(BaseModel):
    id: int
    teacher_id: int
    name: str
    subject: str
    description: Optional[str]
    classes_count: int
    price: float
    duration_minutes: int
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class EnrollmentResponse(BaseModel):
    id: int
    student_id: int
    package_id: int
    teacher_id: int
    classes_used: int
    classes_total: int
    status: str
    renewal_count: int
    created_at: datetime
    package: PackageResponse

    class Config:
        from_attributes = True


class RenewalRequest(BaseModel):
    """
    El estudiante solicita renovar su paquete.
    Puede repetir el mismo o cambiar a otro del mismo profesor.
    """
    current_enrollment_id: int
    new_package_id: int
    # Puede ser el mismo package_id (repetir) u otro (cambiar)