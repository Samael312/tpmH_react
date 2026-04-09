from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base


class Payment(Base):
    """
    Registro de pago manual con comprobante.
    El dinero va a la cuenta del admin — aquí solo se rastrea.
    """
    __tablename__ = "payments"

    id = Column(Integer, primary_key=True, index=True)
    enrollment_id = Column(Integer, ForeignKey("enrollments.id"), nullable=True)
    class_id = Column(Integer, ForeignKey("classes.id"), nullable=True)
    student_id = Column(Integer, ForeignKey("student_profiles.id"), nullable=False)
    teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=False)

    # Montos
    amount_total = Column(Float, nullable=False)
    amount_teacher = Column(Float, nullable=False)   # después de comisión
    amount_platform = Column(Float, nullable=False)  # comisión

    # Método de pago usado
    payment_method = Column(String, nullable=False)
    # "paypal", "binance", "other"

    # Comprobante subido por el estudiante
    receipt_url = Column(String, nullable=True)      # URL de Cloudinary
    receipt_public_id = Column(String, nullable=True)
    transaction_id = Column(String, nullable=True)   # ID de transacción externo

    # Estado del pago
    status = Column(String, default="pending_review")
    # pending_review → under_review → approved → rejected

    # Quién validó el pago (admin o professor_admin)
    validated_by = Column(Integer, nullable=True)    # user_id
    validated_at = Column(DateTime(timezone=True), nullable=True)
    rejection_reason = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    enrollment = relationship("Enrollment", backref="payments")


class TeacherWallet(Base):
    """
    Billetera virtual del profesor.
    Un registro por profesor — se actualiza con cada pago validado.
    """
    __tablename__ = "teacher_wallets"

    id = Column(Integer, primary_key=True, index=True)
    teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), unique=True)

    available_balance = Column(Float, default=0.0)
    total_earned = Column(Float, default=0.0)
    total_withdrawn = Column(Float, default=0.0)

    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    teacher = relationship("TeacherProfile", backref="wallet", uselist=False)


class Withdrawal(Base):
    """
    Solicitud de retiro del profesor.
    El admin la procesa manualmente.
    """
    __tablename__ = "withdrawals"

    id = Column(Integer, primary_key=True, index=True)
    teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=False)

    amount = Column(Float, nullable=False)
    status = Column(String, default="pending")
    # pending → processing → completed → rejected

    # Datos de destino (el profesor los proporciona al solicitar)
    destination_method = Column(String, nullable=True)
    # "paypal", "binance", "bank"
    destination_details = Column(String, nullable=True)
    # email de PayPal, wallet de Binance, etc.

    # Procesado por admin
    processed_by = Column(Integer, nullable=True)
    processed_at = Column(DateTime(timezone=True), nullable=True)
    rejection_reason = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())