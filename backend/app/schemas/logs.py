from typing import Any, Optional
from datetime import datetime
from pydantic import BaseModel, Field


class FrontendErrorReportRequest(BaseModel):
    """
    Body que envía el frontend al reportar un error (crash de React no
    controlado o fallo de una llamada a la API).
    """
    message: str = Field(..., min_length=1, max_length=2000)
    stack: Optional[str] = None
    screen: str = Field(..., description="Ruta del frontend donde ocurrió, ej. /dashboard/schedule")
    level: str = Field("error", pattern="^(error|warning)$")
    status_code: Optional[int] = None
    extra: Optional[dict[str, Any]] = None


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
