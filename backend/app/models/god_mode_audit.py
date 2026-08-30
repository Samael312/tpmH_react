from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import JSONB
from app.db.base import Base


class GodModeAuditLog(Base):
    """
    Registro inmutable de cada acción ejecutada mediante el Modo Dios
    (superadmin o teacher_admin operando fuera de las reglas normales
    de negocio: créditos, paquetes, cohortes, clases, pagos, etc.).

    Este log es la base de todas las demás capacidades del Modo Dios:
    ninguna acción de Modo Dios debería poder ejecutarse sin pasar por
    `log_god_mode_action()` antes del commit.

    No se expone edición ni borrado de estos registros desde la API;
    es un log de solo-lectura por diseño (accountability).
    """
    __tablename__ = "god_mode_audit_logs"

    id = Column(Integer, primary_key=True, index=True)

    actor_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    # Snapshot del rol en el momento de la acción (superadmin | teacher_admin).
    # No confiar únicamente en users.role a futuro, por si el rol cambia.
    actor_role = Column(String, nullable=False)

    # Ej: "class.force_status", "enrollment.adjust_credits",
    # "cohort.move_student", "payment.edit_amount"
    action = Column(String, nullable=False, index=True)

    # Ej: "class", "enrollment", "cohort", "payment", "student_teacher_link"
    entity_type = Column(String, nullable=False, index=True)
    entity_id = Column(Integer, nullable=False, index=True)

    # Motivo obligatorio escrito por quien ejecuta la acción.
    reason = Column(String, nullable=False)

    # Snapshot de los campos relevantes antes/después del cambio,
    # para poder reconstruir qué pasó sin depender de otras tablas.
    before_data = Column(JSONB, nullable=True)
    after_data = Column(JSONB, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
