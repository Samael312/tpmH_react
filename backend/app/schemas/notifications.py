from pydantic import BaseModel, field_validator
from typing import Optional
from datetime import datetime


# ─── Notificaciones ──────────────────────────────────────────────────────────

class NotificationResponse(BaseModel):
    id: int
    type: str
    title: str
    message: Optional[str] = None
    related_teacher_id: Optional[int] = None
    is_read: bool
    created_at: datetime

    class Config:
        from_attributes = True


class UnreadCountResponse(BaseModel):
    unread_count: int


# ─── Apelaciones de profesores ───────────────────────────────────────────────

class CreateAppealRequest(BaseModel):
    message: str

    @field_validator("message")
    @classmethod
    def validate_message(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("El mensaje de la apelación no puede estar vacío")
        if len(v) > 2000:
            raise ValueError("El mensaje es demasiado largo (máx. 2000 caracteres)")
        return v


class ResolveAppealRequest(BaseModel):
    action: str  # "approve" | "reject"
    admin_response: Optional[str] = None

    @field_validator("action")
    @classmethod
    def validate_action(cls, v):
        if v not in ("approve", "reject"):
            raise ValueError("action debe ser 'approve' o 'reject'")
        return v


class TeacherAppealResponse(BaseModel):
    id: int
    teacher_id: int
    appeal_number: int
    message: str
    status: str
    admin_response: Optional[str] = None
    created_at: datetime
    resolved_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class TeacherAppealWithTeacherResponse(TeacherAppealResponse):
    """Usado en la bandeja de apelaciones del admin: incluye datos del profesor."""
    teacher_username: str
    teacher_name: str
    teacher_surname: str
    teacher_status: str