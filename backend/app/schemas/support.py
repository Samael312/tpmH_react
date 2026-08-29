from pydantic import BaseModel, field_validator
from typing import Optional
from datetime import datetime


# ─── Creación de ticket (student / teacher) ──────────────────────────────────

class CreateSupportTicketRequest(BaseModel):
    category: str = "question"  # "bug" | "error" | "question" | "other"
    subject: str
    message: str
    screen_context: Optional[str] = None

    @field_validator("category")
    @classmethod
    def validate_category(cls, v):
        if v not in ("bug", "error", "question", "other"):
            raise ValueError("category debe ser 'bug', 'error', 'question' u 'other'")
        return v

    @field_validator("subject")
    @classmethod
    def validate_subject(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("El asunto no puede estar vacío")
        if len(v) > 150:
            raise ValueError("El asunto es demasiado largo (máx. 150 caracteres)")
        return v

    @field_validator("message")
    @classmethod
    def validate_message(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("El mensaje no puede estar vacío")
        if len(v) > 2000:
            raise ValueError("El mensaje es demasiado largo (máx. 2000 caracteres)")
        return v


class SupportTicketResponse(BaseModel):
    """Vista del propio usuario sobre sus tickets (bandeja 'Mi soporte')."""
    id: int
    category: str
    subject: str
    message: str
    screen_context: Optional[str] = None
    status: str
    admin_response: Optional[str] = None
    created_at: datetime
    resolved_at: Optional[datetime] = None
    user_notified_seen: bool

    class Config:
        from_attributes = True


class UnreadSupportCountResponse(BaseModel):
    unread_count: int


# ─── Bandeja del staff (superadmin + teacher_admin) ─────────────────────────

class ResolveSupportTicketRequest(BaseModel):
    admin_response: str

    @field_validator("admin_response")
    @classmethod
    def validate_admin_response(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("La respuesta no puede estar vacía")
        if len(v) > 2000:
            raise ValueError("La respuesta es demasiado larga (máx. 2000 caracteres)")
        return v


class SupportTicketWithUserResponse(SupportTicketResponse):
    """Usado en la bandeja de soporte del admin: incluye datos del remitente."""
    user_id: int
    user_name: str
    user_surname: str
    user_username: str
    user_email: str
    user_role: str
