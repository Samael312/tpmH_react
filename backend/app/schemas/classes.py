from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import datetime
from app.schemas.god_mode import GodModeActionBase


# Pool fijo (no editable a mano) del que el superadmin puede elegir
# subconjuntos para clases regulares/paquetes, y un valor único para la
# duración de la clase de prueba. Ver core/class_logic.py::get_business_rules
# para los valores por defecto de duración de prueba y márgenes (buffers).
CLASS_DURATION_OPTIONS = [25, 50, 80, 110]

# Compatibilidad con código/imports existentes que aún usan este nombre.
ALLOWED_DURATIONS = CLASS_DURATION_OPTIONS

# Márgenes de preparación (minutos) que se descuentan del final "real" de la
# clase respecto al bloque que ocupa en la agenda del profesor. Son los
# defaults usados si PlatformConfig todavía no tiene fila — el valor
# efectivo siempre se lee de get_business_rules().
DEFAULT_BUFFER_MINUTES = {"trial": 5, "regular": 10, "group": 10}


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
        if v < 15 or v > 240:
            raise ValueError("Duración fuera de rango razonable (15-240 min)")
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
        if v < 15 or v > 240:
            raise ValueError(f"Duración inválida. Opciones: {ALLOWED_DURATIONS}")
        return v


class RescheduleClassRequest(BaseModel):
    start_time_utc: datetime
    end_time_utc: datetime
    day_of_week: Optional[str] = None


class UpdateClassStatusRequest(BaseModel):
    status: str
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


class UpdateMeetLinkRequest(BaseModel):
    """
    El profesor carga/edita manualmente el link de la videollamada de una
    clase. Es un campo opcional: la plataforma no genera ni requiere un
    meet_link para que la clase funcione. Solo se puede cargar/editar
    mientras la clase está 'confirmed' (mismo estado en el que se le
    muestra al estudiante, ver ClassResponse.model_post_init).
    """
    meet_link: Optional[str] = None

    @field_validator("meet_link")
    @classmethod
    def validate_meet_link(cls, v):
        if v is None:
            return v
        v = v.strip()
        if not v:
            return None
        if not (v.startswith("http://") or v.startswith("https://")):
            raise ValueError("El link debe ser una URL válida (http:// o https://)")
        return v


class ClassResponse(BaseModel):
    id: int
    enrollment_id: Optional[int]
    teacher_id: int
    teacher_username: Optional[str] = None
    student_id: Optional[int] = None
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
    # Clases grupales: NULL en clases individuales
    cohort_id: Optional[int] = None
    participant_count: Optional[int] = None
    participant_names: Optional[List[str]] = None

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


# ─── MODO DIOS ──────────────────────────────────────────────────────────

CLASS_STATUS_OPTIONS = [
    "pending", "pending_trial", "pending_payment", "confirmed",
    "completed", "cancelled", "no_show", "rescheduled", "finalized",
]


class GodModeCreateClassRequest(GodModeActionBase):
    """
    Crea una clase individual (regular o trial) para cualquier par
    profesor-alumno, sin pasar por los flujos normales de reserva.
    """
    teacher_id: int
    student_id: int
    start_time_utc: datetime
    duration_minutes: int
    class_type: str = "regular"
    subject: Optional[str] = None
    enrollment_id: Optional[int] = None
    status: str = "confirmed"
    notes: Optional[str] = None
    # None = sigue la regla normal (el estado inicial decide si consume);
    # True/False = el staff decide explícitamente, sin importar el estado.
    consume_credit: Optional[bool] = None
    # Si es True, se salta can_book_slot por completo (permite doble-booking
    # real). Por defecto False: igual se valida que no choque con otra
    # clase, para no crear inconsistencias por accidente.
    skip_conflict_check: bool = False

    @field_validator("class_type")
    @classmethod
    def validate_class_type(cls, v):
        if v not in ("regular", "trial"):
            raise ValueError("class_type debe ser 'regular' o 'trial' (las grupales se crean desde /cohorts)")
        return v

    @field_validator("duration_minutes")
    @classmethod
    def validate_duration_minutes(cls, v):
        if v < 15 or v > 240:
            raise ValueError("Duración fuera de rango razonable (15-240 min)")
        return v

    @field_validator("status")
    @classmethod
    def validate_status(cls, v):
        if v not in CLASS_STATUS_OPTIONS:
            raise ValueError(f"Estado inválido. Opciones: {CLASS_STATUS_OPTIONS}")
        return v


class GodModeRescheduleClassRequest(GodModeActionBase):
    start_time_utc: datetime
    duration_minutes: Optional[int] = None
    skip_conflict_check: bool = False


class GodModeForceStatusRequest(GodModeActionBase):
    status: str
    notes: Optional[str] = None

    @field_validator("status")
    @classmethod
    def validate_status(cls, v):
        if v not in CLASS_STATUS_OPTIONS:
            raise ValueError(f"Estado inválido. Opciones: {CLASS_STATUS_OPTIONS}")
        return v