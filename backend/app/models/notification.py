from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.db.base import Base


class Notification(Base):
    """
    Notificación persistente genérica para el panel de administración.
    No está atada a un solo usuario sino a un rol, para que cualquier
    superadmin o teacher_admin la vea (y el contador del sidebar sea
    consistente sin importar quién inició sesión).

    types usados actualmente:
      - "teacher_pending": nuevo profesor subió video / quedó pendiente de revisión
      - "teacher_appeal": el profesor presentó una apelación
      - "support_ticket": un student o teacher envió un ticket de soporte
    """
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)

    recipient_role = Column(String, nullable=False, default="staff")
    # "staff" cubre superadmin + teacher_admin. Se deja el campo por si en
    # el futuro se quiere segmentar (ej. solo superadmin).

    type = Column(String, nullable=False)
    title = Column(String, nullable=False)
    message = Column(String, nullable=True)

    related_teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=True)
    related_support_ticket_id = Column(Integer, ForeignKey("support_tickets.id"), nullable=True)

    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())