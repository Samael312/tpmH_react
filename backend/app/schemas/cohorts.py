from pydantic import BaseModel, field_validator
from typing import Optional
from datetime import datetime


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
    duration_minutes: int = 60


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
