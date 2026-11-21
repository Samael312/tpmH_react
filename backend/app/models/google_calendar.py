from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text, Index, text
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
    __table_args__ = (
        # Una cuenta de Google solo puede estar conectada a UN profesor.
        Index("uq_google_calendar_account_sub", "google_account_sub", unique=True,
              postgresql_where=text("google_account_sub IS NOT NULL"),
              sqlite_where=text("google_account_sub IS NOT NULL")),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    teacher_id = Column(
        Integer,
        ForeignKey("teacher_profiles.id"),
        unique=True,
        nullable=False
    )

    access_token = Column(Text, nullable=False)
    refresh_token = Column(Text, nullable=True)
    token_expiry = Column(DateTime(timezone=True), nullable=True)

    # Siempre "primary" (calendario principal de la cuenta conectada). Antes se guardaba el email de la plataforma.
    calendar_id = Column(String, default="primary")
    # Identidad de la cuenta de Google conectada (claims `sub`/`email` del id_token del OAuth)
    google_account_sub = Column(String, nullable=True)
    google_account_email = Column(String, nullable=True)

    # El profesor puede desactivar la sync sin borrar el token
    is_active = Column(Boolean, default=True)

    # ─── Salud de la conexión ───
    # True cuando Google rechazó el refresh_token (revocado/expirado) y
    # el profesor debe reconectar manualmente. La sync automática se
    # salta cualquier token con needs_reauth=True.
    needs_reauth = Column(Boolean, default=False)
    last_synced_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    user = relationship("User", back_populates="calendar_tokens")
    teacher = relationship("TeacherProfile", backref="google_calendar_token")