# app/schemas/chat.py
from pydantic import BaseModel, field_validator
from typing import Optional, Literal
from datetime import datetime


class SendMessageRequest(BaseModel):
    content: str

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


class UnreadCountResponse(BaseModel):
    unread_count: int
