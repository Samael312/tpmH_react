from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Index
from sqlalchemy.sql import func
from app.db.base import Base


class ManualGrantRequest(Base):
    """
    Solicitud de un profesor para dar un paquete GRATIS a un alumno (Fase 20, D5).
    El profesor ya no otorga directamente: pide, y el staff aprueba o rechaza (mismo patron que las
    apelaciones de video, ver teacher_appeal.py). Al aprobar se aplica el otorgamiento y queda en el
    registro de auditoria (God Mode); `payment_id` apunta al Payment manual ($0) resultante.
    """
    __tablename__ = "manual_grant_requests"
    __table_args__ = (Index("ix_manual_grant_requests_status", "status"),)

    id = Column(Integer, primary_key=True, index=True)
    teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("student_profiles.id"), nullable=False)
    enrollment_id = Column(Integer, ForeignKey("enrollments.id"), nullable=False, index=True)
    package_id = Column(Integer, ForeignKey("packages.id"), nullable=True)  # paquete destino al pedirlo

    reason = Column(Text, nullable=False)

    status = Column(String, default="pending", nullable=False)  # "pending" | "approved" | "rejected"
    rejection_reason = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    resolved_by = Column(Integer, nullable=True)  # user_id del staff que resolvio
    payment_id = Column(Integer, ForeignKey("payments.id"), nullable=True)
