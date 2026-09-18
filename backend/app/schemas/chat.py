# app/schemas/chat.py
from pydantic import BaseModel, Field, field_validator
from typing import Optional, Literal
from datetime import datetime


class SendMessageRequest(BaseModel):
    content: str
    # Idempotencia del reintento por REST — ver models/chat.py::ChatMessage.client_id.
    client_id: Optional[str] = Field(None, max_length=64)

    @field_validator("content")
    @classmethod
    def validate_content(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("El mensaje no puede estar vacío")
        if len(v) > 4000:
            raise ValueError("Mensaje demasiado largo (máx. 4000 caracteres)")
        return v


class ChatUserSummary(BaseModel):
    username: str
    name: str
    avatar: Optional[str] = None


class ChatMessageResponse(BaseModel):
    id: int
    conversation_id: int
    sender_id: int
    sender_username: str
    content: str
    created_at: datetime
    # None = todavía no le llegó a ningún destinatario conectado (1 check
    # en el frontend). Con valor = ya le llegó a alguien (2 checks).
    delivered_at: Optional[datetime] = None
    client_id: Optional[str] = None

    class Config:
        from_attributes = True


class ChatConversationResponse(BaseModel):
    id: int
    conversation_type: Literal["direct", "group"]
    # Para "direct": la otra persona. Para "group": nombre de la cohorte.
    title: str
    subtitle: Optional[str] = None
    avatar: Optional[str] = None
    other_username: Optional[str] = None  # solo direct
    cohort_id: Optional[int] = None       # solo group
    last_message_preview: Optional[str] = None
    last_message_at: Optional[datetime] = None
    unread_count: int = 0


# N5: vista de auditoría (superadmin/teacher_admin) — a diferencia de
# ChatConversationResponse, no es "relativa" a un usuario (no hay
# other_username/unread_count, que dependen de quién mira), sino la
# ficha objetiva de la conversación: quiénes son las dos partes.
class ChatConversationAdminResponse(BaseModel):
    id: int
    conversation_type: Literal["direct", "group"]
    title: str
    subtitle: Optional[str] = None
    teacher_username: Optional[str] = None
    teacher_name: Optional[str] = None
    student_username: Optional[str] = None  # solo direct
    student_name: Optional[str] = None      # solo direct
    cohort_id: Optional[int] = None         # solo group
    last_message_preview: Optional[str] = None
    last_message_at: Optional[datetime] = None
    message_count: int = 0


class UnreadCountResponse(BaseModel):
    unread_count: int
