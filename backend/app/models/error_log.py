from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from app.db.base import Base


class ErrorLog(Base):
    """
    Registro centralizado de errores de backend y frontend, para la
    pantalla de Logs de /admin.

    - Backend: se escribe automáticamente desde los exception handlers
      globales en app/main.py (ver app/core/error_log.py), tanto para
      excepciones no controladas (500) como para errores de negocio
      relevantes (4xx en rutas críticas: pagos, clases, cohortes,
      paquetes).
    - Frontend: se escribe cuando el cliente reporta un error a
      POST /api/v1/logs/frontend (crashes de React no controlados y
      fallos de llamadas a la API).

    No se expone edición ni borrado desde la API — es un log de
    solo-lectura, igual que GodModeAuditLog.
    """
    __tablename__ = "error_logs"

    id = Column(Integer, primary_key=True, index=True)

    # "backend" | "frontend"
    source = Column(String, nullable=False, index=True)
    # "error" | "warning"
    level = Column(String, nullable=False, index=True, default="error")

    message = Column(String, nullable=False)
    # Traceback completo (backend) o stack de JS (frontend). Nunca se
    # muestra en listados, solo al expandir el detalle en el admin.
    detail = Column(Text, nullable=True)

    # Pantalla/endpoint donde ocurrió: path del backend (ej.
    # "/api/v1/payments/123/confirm") o ruta del frontend (ej.
    # "/dashboard/schedule").
    screen = Column(String, nullable=True, index=True)
    method = Column(String, nullable=True)  # GET, POST, etc. (solo backend)
    status_code = Column(Integer, nullable=True)

    # Usuario al que le ocurrió el error, si estaba logueado.
    # Snapshot de nombre/rol por si el usuario cambia o se elimina más
    # adelante — igual que actor_role en GodModeAuditLog.
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    user_name = Column(String, nullable=True)
    user_role = Column(String, nullable=True)

    # Datos adicionales libres (query params, body relevante, user agent, etc.)
    extra_data = Column(JSONB, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
