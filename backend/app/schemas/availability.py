from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import datetime


# ─── Horario Semanal ────────────────────────────────────────────────────────

class WeeklySlotCreate(BaseModel):
    """
    Un bloque de disponibilidad semanal.
    El profesor envía su hora LOCAL y el backend
    la convierte a UTC antes de guardar.
    """
    day_of_week: int           # 0=Lunes ... 6=Domingo
    start_time_local: str      # "09:00" en zona del profesor
    end_time_local: str        # "18:00" en zona del profesor
    is_available: bool = True

    @field_validator("day_of_week")
    @classmethod
    def validate_day(cls, v):
        if v not in range(7):
            raise ValueError("day_of_week debe ser 0-6")
        return v

    @field_validator("start_time_local", "end_time_local")
    @classmethod
    def validate_time_format(cls, v):
        try:
            datetime.strptime(v, "%H:%M")
        except ValueError:
            raise ValueError("Formato de hora inválido. Usa HH:MM")
        return v


class SetWeeklyAvailabilityRequest(BaseModel):
    """
    Reemplaza toda la disponibilidad semanal.
    Se envía la zona horaria del profesor para la conversión.
    """
    timezone: str
    slots: List[WeeklySlotCreate]


class WeeklySlotResponse(BaseModel):
    id: int
    teacher_id: int
    day_of_week: int          # día real en UTC (para lógica de reservas)
    local_day_of_week: int    # día que el profesor eligió en su calendario (para mostrar en UI)
    start_time_utc: str    # "13:00" UTC
    end_time_utc: str      # "22:00" UTC
    is_available: bool

    class Config:
        from_attributes = True


# ─── Excepciones ────────────────────────────────────────────────────────────
class ExceptionCreate(BaseModel):
    """
    Excepción puntual sobre la disponibilidad semanal.
    El profesor envía fecha (o rango) + hora LOCAL + su timezone;
    el backend convierte a UTC (evita ambigüedad de DST al usar la fecha real).
    """
    date: str                     # "2025-08-17" (fecha de inicio si es rango)
    end_date: Optional[str] = None  # "2025-08-21" — si se envía, aplica a todo el rango inclusive
    timezone: str
    is_full_day: bool = False
    start_time_local: Optional[str] = None   # requerido si is_full_day=False
    end_time_local: Optional[str] = None
    is_available: bool = True     # False = bloquea, True = disponibilidad extra
    reason: Optional[str] = None

    @field_validator("start_time_local", "end_time_local")
    @classmethod
    def validate_time_format(cls, v):
        if v is None:
            return v
        try:
            datetime.strptime(v, "%H:%M")
        except ValueError:
            raise ValueError("Formato de hora inválido. Usa HH:MM")
        return v


class ExceptionResponse(BaseModel):
    id: int
    teacher_id: int
    start_time_utc: datetime
    end_time_utc: datetime
    is_available: bool
    reason: Optional[str]
    is_full_day: bool

    class Config:
        from_attributes = True


# ─── Slots disponibles (vista estudiante) ───────────────────────────────────

class AvailableSlotResponse(BaseModel):
    """
    Un slot disponible en UTC.
    El frontend convierte a zona local del usuario para mostrar.
    """
    start_time_utc: datetime    # "2025-04-14T13:00:00Z"
    end_time_utc: datetime      # "2025-04-14T14:00:00Z" — fin REAL de la clase (sin margen)
    duration_minutes: int       # duración real de la clase
    is_past: bool = False       # True SOLO si el slot ya ocurrió de verdad (start < ahora)
    # True si el slot todavía no pasó, pero cae dentro del margen mínimo de
    # antelación configurado (min_booking_hours) — es un horario futuro,
    # simplemente demasiado próximo para reservarlo. Distinto de is_past:
    # el frontend no debe mostrar "Pasado" para esto (BUG: antes se
    # marcaban como "Pasado" horarios futuros, confundiendo al estudiante).
    too_soon: bool = False
    is_preferred: bool = False   # True si el slot coincide con la preferencia del estudiante
    is_available: bool = True      # True si el slot está disponible para reservar
    # Margen de preparación (minutos) que este slot reserva después de
    # end_time_utc para que el profesor se prepare para la siguiente clase.
    buffer_minutes: int = 0
    # Fin real de la clase + buffer_minutes — hasta cuándo queda ocupada
    # la agenda del profesor por este bloque. Informativo para el
    # frontend (mensaje al estudiante); NO es lo que se guarda como
    # Class.end_time_utc.
    block_end_time_utc: datetime

class PreferenceDraft(BaseModel):
    day_of_week: int
    start_time_local: str
    end_time_local: str

class UpdatePreferencesRequest(BaseModel):
    preferences: List[PreferenceDraft]