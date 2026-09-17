# app/models/chat.py
#
# N1 — Chat interno. Dos tipos de conversación:
#   - "direct": 1:1 entre un student y un teacher. Se puede abrir en dos
#     situaciones distintas — ver core/chat.py::get_direct_conversation_or_404:
#       1) Ya vinculados: la fuente de verdad del vínculo NO es
#          StudentTeacherLink (esa tabla queda vacía en modo single-tenant
#          — ver su propio docstring y endpoints/payments.py::
#          _ensure_teacher_linked, que hace return inmediato si
#          is_single_tenant). La fuente que SÍ se puebla en ambos modos es
#          TeacherProfile.students (JSONB), actualizada por
#          core/teacher_students.py::link_student_to_teacher tanto en
#          checkout multi-tenant como en single-tenant
#          (payments.py::_sync_student_teacher_username).
#       2) Todavía NO vinculados (a propósito): un estudiante puede
#          escribirle a cualquier profesor con status "approved" ANTES de
#          elegirlo (ej. desde su perfil público) — la conversación se
#          crea igual, solo que sin que TeacherProfile.students se toque.
#          Un profesor, en cambio, solo puede abrir/participar de
#          conversaciones con estudiantes YA vinculados a él.
#     Una vez creada la fila en chat_conversations, assert_participant()
#     autoriza contra sus student_id/teacher_id directamente — no vuelve
#     a mirar el vínculo, así que sigue siendo válida aunque el vínculo
#     cambie después.
#   - "group": 1 conversación por GroupCohort, con el profesor de la
#     cohorte y todos los estudiantes con Enrollment activo en ella
#     (Enrollment.teacher_id / cohort_id son directos, no dependen del
#     modo de tenant).
#
# El historial se purga según PlatformConfig.chat_retention_days (job en
# core/scheduler.py::purge_old_chat_messages). El toggle
# PlatformConfig.chat_enabled bloquea tanto el acceso REST/WS como el UI.

import enum
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, ForeignKey, Enum,
    UniqueConstraint, Index,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base


class ChatConversationType(str, enum.Enum):
    direct = "direct"
    group = "group"


class ChatConversation(Base):
    __tablename__ = "chat_conversations"

    id = Column(Integer, primary_key=True, index=True)
    conversation_type = Column(Enum(ChatConversationType), nullable=False)

    teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=False)

    # Solo para conversation_type == "direct"
    student_id = Column(Integer, ForeignKey("student_profiles.id"), nullable=True)

    # Solo para conversation_type == "group" — unique porque hay exactamente
    # una conversación por cohorte.
    cohort_id = Column(Integer, ForeignKey("group_cohorts.id"), nullable=True, unique=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Desnormalizado para listar conversaciones ordenadas sin JOIN a
    # messages en cada request (mismo patrón que god_mode_audit / support).
    last_message_at = Column(DateTime(timezone=True), nullable=True)
    last_message_preview = Column(String, nullable=True)

    # Última vez que se le mandó el email de "nuevo mensaje" al profesor
    # por esta conversación — determina la ventana de reactivación
    # (PlatformConfig.chat_reactivation_hours).
    teacher_last_notified_at = Column(DateTime(timezone=True), nullable=True)

    teacher = relationship("TeacherProfile", backref="chat_conversations")
    student = relationship("StudentProfile", backref="chat_conversations")
    cohort = relationship("GroupCohort", backref="chat_conversation", uselist=False)

    messages = relationship(
        "ChatMessage", back_populates="conversation",
        cascade="all, delete-orphan", order_by="ChatMessage.created_at",
    )
    read_states = relationship(
        "ChatReadState", back_populates="conversation", cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint("teacher_id", "student_id", name="uq_chat_direct_conversation"),
        Index("ix_chat_conversations_last_message_at", "last_message_at"),
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(Integer, ForeignKey("chat_conversations.id", ondelete="CASCADE"), nullable=False)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    conversation = relationship("ChatConversation", back_populates="messages")
    sender = relationship("User")

    __table_args__ = (
        Index("ix_chat_messages_conversation_created", "conversation_id", "created_at"),
    )


class ChatReadState(Base):
    """
    Último instante leído por CADA participante de una conversación
    (necesario para grupos: cada alumno tiene su propio last_read_at).
    """
    __tablename__ = "chat_read_states"

    conversation_id = Column(Integer, ForeignKey("chat_conversations.id", ondelete="CASCADE"), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    last_read_at = Column(DateTime(timezone=True), nullable=True)

    conversation = relationship("ChatConversation", back_populates="read_states")
