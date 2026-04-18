from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base


class GoogleCalendarToken(Base):
    """
    Token de OAuth2 de Google Calendar por profesor.
    Es completamente opcional — si no existe el sistema
    funciona igual sin sincronización.
    """
    __tablename__ = "google_google_calendar"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    teacher_id = Column(
        Integer,
        ForeignKey("teacher_profiles.id"),
        unique=True,
        nullable=False
    )

    # Tokens de OAuth2
    access_token = Column(Text, nullable=False)
    refresh_token = Column(Text, nullable=True)
    token_expiry = Column(DateTime(timezone=True), nullable=True)

    # ID del calendario donde se sincronizan las clases
    # Por defecto es "primary" (calendario principal)
    calendar_id = Column(String, default="primary")

    # El profesor puede desactivar la sync sin borrar el token
    is_active = Column(Boolean, default=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    user = relationship("User", back_populates="calendar_tokens")
    teacher = relationship("TeacherProfile", backref="google_calendar_token")