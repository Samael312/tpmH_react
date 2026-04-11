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

class PaymentConfig(Base):
    """
    Configuración global de métodos de pago.
    Solo el superadmin y professor_admin pueden modificarla.
    Solo debe existir UN registro — se actualiza, nunca se crea otro.
    """
    __tablename__ = "payment_config"

    id = Column(Integer, primary_key=True, index=True)

    # Métodos habilitados
    paypal_enabled = Column(Boolean, default=True)
    binance_enabled = Column(Boolean, default=True)

    # Datos de pago del admin (donde el estudiante debe transferir)
    paypal_email = Column(String, nullable=True)
    binance_address = Column(String, nullable=True)
    binance_network = Column(String, default="USDT TRC20")

    # Contacto de fallback si no hay métodos habilitados
    whatsapp_number = Column(String, nullable=True)

    # Comisión global por defecto para nuevos profesores
    default_commission_rate = Column(Float, default=0.15)

    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    updated_by = Column(Integer, nullable=True)  # user_id del admin