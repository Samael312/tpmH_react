from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base

class Payment(Base):
    __tablename__ = "payments"

    id = Column(Integer, primary_key=True, index=True)
    enrollment_id = Column(Integer, ForeignKey("enrollments.id"), nullable=False)
    student_id = Column(Integer, ForeignKey("student_profiles.id"), nullable=False)
    teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=False)
    amount_total = Column(Float, nullable=False)
    amount_teacher = Column(Float, nullable=False)
    amount_platform = Column(Float, nullable=False)
    stripe_payment_id = Column(String, nullable=True)
    status = Column(String, default="pending")
    # pending, completed, refunded, failed
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relaciones
    enrollment = relationship("Enrollment", back_populates="payment")

class Withdrawal(Base):
    __tablename__ = "withdrawals"

    id = Column(Integer, primary_key=True, index=True)
    teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=False)
    amount = Column(Float, nullable=False)
    status = Column(String, default="pending")
    # pending, processing, completed, failed
    stripe_transfer_id = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())