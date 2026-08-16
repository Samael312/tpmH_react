from sqlalchemy import Column, Integer, String, Boolean, Float, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.db.base import Base

class PlatformConfig(Base):
    """
    Configuración global de la plataforma.
    Un solo registro — se actualiza, nunca se crea otro.
    """
    __tablename__ = "platform_config"

    id = Column(Integer, primary_key=True, index=True)

    # Single-tenant: ID del profesor featured
    # None = modo multi-tenant (selección de profesor)
    # int  = modo single-tenant (profesor fijo)
    featured_teacher_id = Column(
        Integer,
        ForeignKey("teacher_profiles.id"),
        nullable=True
    )

    # Nombre de la plataforma (personalizable)
    platform_name = Column(String, default="TPMH")
    platform_tagline = Column(String, nullable=True)

    # Modo de la plataforma
    is_single_tenant = Column(Boolean, default=True)
    # True  → un solo profesor featured, flujo directo
    # False → múltiples profesores, flujo con selección

    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

# backend/app/models/payment_config.py
class PaymentConfig(Base):
    __tablename__ = "payment_config"

    id = Column(Integer, primary_key=True, index=True)

    # Métodos habilitados
    paypal_enabled = Column(Boolean, default=True)
    binance_enabled = Column(Boolean, default=True)
    bank_transfer_enabled = Column(Boolean, default=False)
    mobile_payment_enabled = Column(Boolean, default=False)

    # Datos de pago del admin
    paypal_email = Column(String, nullable=True)
    binance_address = Column(String, nullable=True)
    binance_network = Column(String, default="USDT TRC20")
    bank_transfer_details = Column(String, nullable=True)   # banco, titular, cuenta, IBAN...
    mobile_payment_details = Column(String, nullable=True)  # teléfono, cédula/DNI, banco

    whatsapp_number = Column(String, nullable=True)
    default_commission_rate = Column(Float, default=0.15)

    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    updated_by = Column(Integer, nullable=True)