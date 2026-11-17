from sqlalchemy import Column, Integer, String, Date, DateTime
from sqlalchemy.sql import func
from app.db.base import Base


class EmailLog(Base):
    """
    Una fila por correo que intentó salir por `core/email.py::_send` (Fase 7).
    Alimenta el contador diario contra la cuota de Resend y el modo ahorro.

    - day: fecha UTC del intento (el contador se reinicia a las 00:00 UTC).
    - outcome: "sent" (cuenta para la cuota) | "skipped" (apagado, ahorro o cuota; no cuenta)
               | "failed" (Resend devolvio error).
    """
    __tablename__ = "email_log"

    id = Column(Integer, primary_key=True, index=True)
    day = Column(Date, nullable=False, index=True)
    category = Column(String, nullable=False)
    outcome = Column(String, nullable=False)
    reason = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
