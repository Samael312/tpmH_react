from typing import Any, Optional
from datetime import datetime
from pydantic import BaseModel, Field


class GodModeActionBase(BaseModel):
    """
    Mixin base que deben extender todos los request bodies de acciones
    del Modo Dios (ajustar créditos, forzar estado, mover cohorte, etc.).
    Obliga a que quien ejecuta la acción escriba un motivo.
    """
    reason: str = Field(..., min_length=5, max_length=500)


class GodModeAuditLogResponse(BaseModel):
    id: int
    actor_user_id: int
    actor_name: Optional[str] = None
    actor_role: str
    action: str
    entity_type: str
    entity_id: int
    reason: str
    before_data: Optional[dict[str, Any]] = None
    after_data: Optional[dict[str, Any]] = None
    created_at: datetime

    class Config:
        from_attributes = True


class GodModeTransferStudentRequest(GodModeActionBase):
    """
    Transfiere a un alumno de un profesor a otro: crea el vínculo con el
    profesor destino, reasigna sus enrollments individuales activos y sus
    clases futuras (no completadas/canceladas) al nuevo profesor.

    OJO: los enrollments reasignados quedan apuntando a un package_id que
    pertenece al profesor ANTERIOR (los paquetes son propiedad de cada
    profesor). Hay que seguir con
    PATCH /god-mode/enrollments/{id}/adjust o
    POST /god-mode/enrollments/{id}/change-package
    para asignarle un paquete válido del nuevo profesor.

    No toca enrollments/clases de cohortes (grupales) — esas se mueven
    con las herramientas de cohortes.
    """
    from_teacher_id: int
    to_teacher_id: int
    remove_old_link: bool = False


class GodModeTransferStudentResponse(BaseModel):
    message: str
    enrollments_transferred: int
    future_classes_transferred: int


class PaginatedGodModeAuditLogResponse(BaseModel):
    items: list[GodModeAuditLogResponse]
    total: int
    page: int
    page_size: int
