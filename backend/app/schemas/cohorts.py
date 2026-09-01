from pydantic import BaseModel, field_validator
from typing import Optional
from datetime import datetime
from app.schemas.god_mode import GodModeActionBase


class CohortCreate(BaseModel):
    """El profesor abre una nueva cohorte para un paquete grupal existente."""
    package_id: int
    min_students: int
    max_students: int

    @field_validator("min_students")
    @classmethod
    def validate_min(cls, v):
        if v < 1:
            raise ValueError("El mínimo debe ser al menos 1 alumno")
        return v

    @field_validator("max_students")
    @classmethod
    def validate_max(cls, v, info):
        min_students = info.data.get("min_students")
        if v < 1:
            raise ValueError("El máximo debe ser al menos 1 alumno")
        if min_students is not None and v < min_students:
            raise ValueError("El máximo no puede ser menor que el mínimo")
        return v


class CohortCloseRequest(BaseModel):
    """El profesor cierra la cohorte con los integrantes actuales."""
    start_date: datetime


class CohortResponse(BaseModel):
    id: int
    package_id: int
    package_name: Optional[str] = None
    teacher_id: int
    start_date: Optional[datetime] = None
    status: str
    min_students: int
    max_students: int
    current_students: int
    created_at: datetime
    closed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class GroupEnrollRequest(BaseModel):
    """El estudiante se inscribe a una cohorte abierta (status='filling')."""
    cohort_id: int
    # Igual que en /payments/notify-payment: referencia del comprobante de
    # pago (últimos dígitos, ID de transacción, etc). Antes este endpoint
    # no lo pedía en absoluto — el Payment quedaba pending_review sin
    # ningún dato que el profesor pudiera verificar contra su comprobante.
    transaction_reference: Optional[str] = None


# ─── MODO DIOS ──────────────────────────────────────────────────────────


class GodModeMoveCohortRequest(GodModeActionBase):
    """
    Mueve el enrollment de un alumno a otra cohorte (o lo convierte a
    individual si new_cohort_id es None). `force=True` salta la
    validación de cupo disponible en la cohorte destino.
    """
    new_cohort_id: Optional[int] = None
    force: bool = False
    reset_classes_used: bool = False


class GodModeCohortEditRequest(GodModeActionBase):
    """Edita min/max de una cohorte ya creada, o fuerza su fecha de inicio."""
    min_students: Optional[int] = None
    max_students: Optional[int] = None
    start_date: Optional[datetime] = None

    @field_validator("min_students", "max_students")
    @classmethod
    def validate_positive(cls, v):
        if v is not None and v < 1:
            raise ValueError("Debe ser al menos 1")
        return v


class GodModeCohortReopenRequest(GodModeActionBase):
    """Reabre una cohorte cancelada/completada. new_status debe ser 'filling' o 'confirmed'."""
    new_status: str = "filling"

    @field_validator("new_status")
    @classmethod
    def validate_new_status(cls, v):
        if v not in ("filling", "confirmed"):
            raise ValueError("new_status debe ser 'filling' o 'confirmed'")
        return v


class GodModeCohortActionResponse(BaseModel):
    message: str
    cohort: CohortResponse

    class Config:
        from_attributes = True


class GodModeMoveCohortResponse(BaseModel):
    message: str

    class Config:
        from_attributes = True


class GroupToIndividualMigrationRequest(BaseModel):
    """
    El estudiante solicita migrar de un enrollment grupal a un paquete
    individual del mismo profesor. Reutiliza el mismo mecanismo de
    equivalencia por valor que un cambio de paquete normal.
    """
    current_enrollment_id: int
    new_package_id: int


class GroupSessionCreate(BaseModel):
    """El profesor agenda una sesión concreta dentro de una cohorte ya confirmada."""
    start_time_utc: datetime
    duration_minutes: int = 50


class GroupSessionResponse(BaseModel):
    id: int
    cohort_id: int
    start_time_utc: datetime
    end_time_utc: datetime
    duration: int
    status: str
    participant_count: int

    class Config:
        from_attributes = True


class CohortMemberResponse(BaseModel):
    """
    Un alumno inscrito en la cohorte (aplica también mientras está
    'filling', antes de que exista ninguna sesión/Class agendada — a
    diferencia de SessionParticipantResponse, que solo existe una vez
    que hay sesiones creadas). Se usa para que el profesor vea en vivo
    quién se va uniendo al grupo a medida que se llena.
    """
    enrollment_id: int
    student_id: int
    student_name: str
    student_avatar: Optional[str] = None
    payment_status: str
    joined_at: datetime

    class Config:
        from_attributes = True


class SessionParticipantResponse(BaseModel):
    """Un integrante de una sesión grupal puntual, con su asistencia."""
    student_id: int
    student_name: str
    attendance_status: str  # "confirmed" | "no_show" | "cancelled"

    class Config:
        from_attributes = True


class MarkAttendanceRequest(BaseModel):
    attendance_status: str  # "confirmed" (asistió) | "no_show" (no asistió)


class MigrationQuoteResponse(BaseModel):
    """
    Vista previa de la equivalencia antes de confirmar la migración —
    para el modal de "resumen amigable" del panel de espera.
    """
    classes_remaining_in_group: int
    remaining_value_usd: float
    new_package_name: str
    new_package_price: float
    difference_usd: float  # positivo = debe pagar diferencia, negativo = saldo a favor, 0 = instantáneo
    is_instant: bool
