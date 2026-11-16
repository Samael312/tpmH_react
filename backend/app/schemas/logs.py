from typing import Any, Optional
from datetime import datetime
import json

from pydantic import BaseModel, Field, field_validator

# SEC-06: /logs/frontend es anonimo; sin topes cualquiera podia llenar la tabla con cargas de cientos de KB.
MAX_LOG_STACK_CHARS = 8000
MAX_LOG_EXTRA_JSON_CHARS = 4000


class FrontendErrorReportRequest(BaseModel):
    """
    Body que envía el frontend al reportar un error (crash de React no
    controlado o fallo de una llamada a la API).
    """
    message: str = Field(..., min_length=1, max_length=2000)
    stack: Optional[str] = Field(None, max_length=MAX_LOG_STACK_CHARS)
    screen: str = Field(..., max_length=300, description="Ruta del frontend donde ocurrió, ej. /dashboard/schedule")
    level: str = Field("error", pattern="^(error|warning)$")
    status_code: Optional[int] = Field(None, ge=0, le=599)
    extra: Optional[dict[str, Any]] = None

    @field_validator("extra")
    @classmethod
    def limit_extra_size(cls, v):
        if v is not None and len(json.dumps(v, default=str)) > MAX_LOG_EXTRA_JSON_CHARS:
            raise ValueError(f"extra supera {MAX_LOG_EXTRA_JSON_CHARS} caracteres")
        return v


class ErrorLogResponse(BaseModel):
    id: int
    source: str
    level: str
    message: str
    detail: Optional[str] = None
    screen: Optional[str] = None
    method: Optional[str] = None
    status_code: Optional[int] = None
    user_id: Optional[int] = None
    user_name: Optional[str] = None
    user_role: Optional[str] = None
    extra_data: Optional[dict[str, Any]] = None
    created_at: datetime

    class Config:
        from_attributes = True


class PaginatedErrorLogResponse(BaseModel):
    items: list[ErrorLogResponse]
    total: int
    page: int
    page_size: int


class ErrorLogUserOption(BaseModel):
    """Un usuario real (nombre y apellido vigentes) que aparece en al menos
    un log, para poblar el <select> del filtro en vez de texto libre."""
    id: int
    name: str


class ErrorLogStats(BaseModel):
    total: int
    errors: int
    warnings: int
    backend: int
    frontend: int
    security: int
    last_24h: int
