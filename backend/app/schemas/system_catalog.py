from pydantic import BaseModel, field_validator
from typing import Any, Optional, List
from datetime import datetime
from app.schemas.classes import CLASS_DURATION_OPTIONS


class SystemCatalogResponse(BaseModel):
    key: str
    label: str
    value: Any
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class UpdateSystemCatalogRequest(BaseModel):
    value: Any


class BusinessRulesResponse(BaseModel):
    min_booking_hours: int
    min_cancel_hours: int
    min_reschedule_hours_student: int
    allowed_class_durations: List[int]
    allowed_package_durations: List[int]
    low_credit_threshold: int
    low_credit_renotify_days: int
    # Duración única de la clase de prueba y márgenes de preparación
    # (minutos) por tipo de clase. Ver core/class_logic.py::get_business_rules.
    trial_duration_minutes: int
    buffer_trial_minutes: int
    buffer_regular_minutes: int
    buffer_group_minutes: int
    # Minutos antes del inicio de la clase en los que se auto-genera el
    # Meet link si todavía no tiene uno (ver core/scheduler.py).
    meet_link_autogen_minutes: int


class UpdateBusinessRulesRequest(BaseModel):
    min_booking_hours: Optional[int] = None
    min_cancel_hours: Optional[int] = None
    min_reschedule_hours_student: Optional[int] = None
    allowed_class_durations: Optional[List[int]] = None
    allowed_package_durations: Optional[List[int]] = None
    low_credit_threshold: Optional[int] = None
    low_credit_renotify_days: Optional[int] = None
    trial_duration_minutes: Optional[int] = None
    buffer_trial_minutes: Optional[int] = None
    buffer_regular_minutes: Optional[int] = None
    buffer_group_minutes: Optional[int] = None
    meet_link_autogen_minutes: Optional[int] = None

    @field_validator("allowed_class_durations", "allowed_package_durations")
    @classmethod
    def validate_durations_subset(cls, v):
        if v is None:
            return v
        if not v:
            raise ValueError("Debes dejar al menos una duración habilitada")
        invalid = [d for d in v if d not in CLASS_DURATION_OPTIONS]
        if invalid:
            raise ValueError(
                f"Duraciones inválidas: {invalid}. Opciones permitidas: {CLASS_DURATION_OPTIONS}"
            )
        return v

    @field_validator("trial_duration_minutes")
    @classmethod
    def validate_trial_duration(cls, v):
        if v is None:
            return v
        if v not in CLASS_DURATION_OPTIONS:
            raise ValueError(
                f"Duración de prueba inválida. Opciones permitidas: {CLASS_DURATION_OPTIONS}"
            )
        return v

    @field_validator("buffer_trial_minutes", "buffer_regular_minutes", "buffer_group_minutes")
    @classmethod
    def validate_buffer(cls, v):
        if v is None:
            return v
        if v < 0 or v > 60:
            raise ValueError("El margen debe estar entre 0 y 60 minutos")
        return v

    @field_validator("meet_link_autogen_minutes")
    @classmethod
    def validate_meet_link_autogen_minutes(cls, v):
        if v is None:
            return v
        if v < 5 or v > 180:
            raise ValueError("Los minutos de autogeneración del link deben estar entre 5 y 180")
        return v