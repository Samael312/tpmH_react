from sqlalchemy import Column, Integer, String, Boolean, Float, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.db.base import Base
from sqlalchemy.dialects.postgresql import JSONB
from app.schemas.classes import CLASS_DURATION_OPTIONS, DEFAULT_BUFFER_MINUTES

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
    featured_teacher_id = Column(Integer,ForeignKey("teacher_profiles.id"),nullable=True)
    # Nombre de la plataforma (personalizable)
    platform_name = Column(String, default="TPMH")
    platform_tagline = Column(String, nullable=True)
    # Modo de la plataforma
    is_single_tenant = Column(Boolean, default=True)
    # True  → un solo profesor featured, flujo directo
    # False → múltiples profesores, flujo con selección
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    # ─── Reglas de negocio configurables ───
    min_booking_hours = Column(Integer, default=1)
    min_cancel_hours = Column(Integer, default=12)
    min_reschedule_hours_student = Column(Integer, default=12)
    # Subconjuntos elegibles por el superadmin del pool fijo
    # CLASS_DURATION_OPTIONS = [25, 50, 80, 110]. Nunca se guarda un valor
    # fuera de ese pool (validado en endpoints/system_catalogs.py).
    allowed_class_durations = Column(JSONB, default=lambda: [50, 80, 110])
    allowed_package_durations = Column(JSONB, default=lambda: [50, 80, 110])
    low_credit_threshold = Column(Integer, default=1)
    low_credit_renotify_days = Column(Integer, default=6)

    # ─── Duración de la clase de prueba y márgenes de preparación ───
    # trial_duration_minutes: valor único, elegido del mismo pool
    # CLASS_DURATION_OPTIONS (hoy 25, pero editable a futuro).
    trial_duration_minutes = Column(Integer, default=25)
    # Minutos que se descuentan del final "real" de la clase respecto al
    # bloque que ocupa en la agenda del profesor, según el tipo de clase.
    buffer_trial_minutes = Column(Integer, default=lambda: DEFAULT_BUFFER_MINUTES["trial"])
    buffer_regular_minutes = Column(Integer, default=lambda: DEFAULT_BUFFER_MINUTES["regular"])
    buffer_group_minutes = Column(Integer, default=lambda: DEFAULT_BUFFER_MINUTES["group"])

    # Minutos antes del inicio de la clase en los que el job automático
    # (core/scheduler.py::generate_upcoming_meet_links) genera el Meet
    # link si todavía no tiene uno asignado. Ver core/class_logic.py.
    meet_link_autogen_minutes = Column(Integer, default=30)

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