import enum
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base


class SupportCategory(str, enum.Enum):
    bug = "bug"
    error = "error"
    question = "question"
    other = "other"


class SupportTicketStatus(str, enum.Enum):
    pending = "pending"
    answered = "answered"


class SupportTicket(Base):
    """
    Ticket de soporte enviado por un student o teacher: bug, error o duda
    que Chipi (el asistente IA) no pudo resolver.

    Flujo simple tipo TeacherAppeal: 1 mensaje del usuario → 1 respuesta
    final del staff (superadmin o teacher_admin), que cierra el ticket
    (status pasa a "answered"). No es un hilo de chat continuo.

    `user_notified_seen` controla el aviso/badge en el dashboard del
    usuario tras recibir respuesta (se resetea a False al responder y se
    marca True cuando el usuario abre/revisa el ticket respondido).
    """
    __tablename__ = "support_tickets"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    category = Column(Enum(SupportCategory, name="supportcategory"), nullable=False, default=SupportCategory.question)
    subject = Column(String, nullable=False)
    message = Column(Text, nullable=False)

    # screen_name de Chipi si el ticket se originó desde el widget (contexto)
    screen_context = Column(String, nullable=True)

    status = Column(Enum(SupportTicketStatus, name="supportticketstatus"), nullable=False, default=SupportTicketStatus.pending)
    admin_response = Column(Text, nullable=True)

    resolved_at = Column(DateTime(timezone=True), nullable=True)
    resolved_by = Column(Integer, nullable=True)  # user_id del staff que respondió

    user_notified_seen = Column(Boolean, default=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User")
