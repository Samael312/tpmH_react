from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.db.base import Base


class RefreshToken(Base):
    """
    Refresh token de sesion (SEC-05). En la BD solo vive el hash SHA-256; el valor en claro esta unicamente
    en la cookie HttpOnly del navegador. Cada uso lo ROTA (el anterior queda revocado). Todos los tokens
    de una misma cadena de rotacion comparten `family_id`: si se reutiliza uno ya revocado (robo/replay)
    se revoca toda la familia.
    """
    __tablename__ = "refresh_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    token_hash = Column(String, unique=True, nullable=False, index=True)
    family_id = Column(String, nullable=False, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
