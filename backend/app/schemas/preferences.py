from pydantic import BaseModel, field_validator
from typing import List
from datetime import datetime


class PreferenceSlotCreate(BaseModel):
    day_of_week: int        # 0-6
    start_time_local: str   # "09:00" en zona del estudiante
    end_time_local: str     # "17:00" en zona del estudiante

    @field_validator("day_of_week")
    @classmethod
    def validate_day(cls, v):
        if v not in range(7):
            raise ValueError("day_of_week debe ser 0-6")
        return v

    @field_validator("start_time_local", "end_time_local")
    @classmethod
    def validate_time(cls, v):
        from datetime import datetime
        try:
            datetime.strptime(v, "%H:%M")
        except ValueError:
            raise ValueError("Formato inválido. Usa HH:MM")
        return v


class SetPreferencesRequest(BaseModel):
    """
    Reemplaza todas las preferencias del estudiante.
    Se envía la zona horaria del estudiante para convertir a UTC.
    """
    timezone: str
    slots: List[PreferenceSlotCreate]


class PreferenceSlotResponse(BaseModel):
    id: int
    student_id: int
    day_of_week: int
    start_time_utc: str
    end_time_utc: str
    created_at: datetime

    class Config:
        from_attributes = True