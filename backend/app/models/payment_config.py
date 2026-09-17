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
    platform_name = Column(String, default="TPM")
    platform_tagline = Column(String, nullable=True)
    # Contenido editable del landing (mini-CMS, ver N3). Estructura completa
    # en app.core.platform_config.LANDING_CONTENT_DEFAULTS — acá solo se
    # guardan los campos que el admin sobreescribió; el resto se completa
    # con esos defaults en serialize_platform_config().
    landing_content = Column(JSONB, nullable=True)
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

    # Interruptor global: oculta el botón de WhatsApp de TODOS los
    # profesores en el frontend (preview, ClassCard), sin importar qué
    # cada uno haya cargado en su propio social_links.whatsapp.
    show_teacher_whatsapp = Column(Boolean, default=True, server_default="true")

    # D7: mínimo de clases YA COMPLETADAS que un estudiante debe tener en
    # su paquete actual antes de poder pedir un cambio de paquete (sube o
    # baja, aplica a ambos sentidos — decisión de negocio confirmada).
    # 0 = sin restricción (comportamiento de siempre). Ver
    # core/class_logic.py::get_business_rules y el chequeo en
    # payments.py::notify_payment (rama package_change).
    min_classes_before_package_change = Column(Integer, default=0, server_default="0")

    # ─── N1/N2: Chat interno (student <-> teacher) ───
    # Interruptor global. En False: oculta el acceso en navbar/widget del
    # frontend Y bloquea a nivel backend (REST + WS) el envío/lectura de
    # mensajes, para evitar que alguien lo esquive pegando la URL o
    # abriendo el socket directo.
    chat_enabled = Column(Boolean, default=True, server_default="true")
    # Días de retención del historial antes de purgarse (job en
    # core/scheduler.py::purge_old_chat_messages). 0 = sin límite.
    chat_retention_days = Column(Integer, default=90, server_default="90")
    # Ventana de inactividad (en horas) tras la cual un nuevo mensaje del
    # estudiante vuelve a disparar el email de aviso al profesor.
    chat_reactivation_hours = Column(Integer, default=24, server_default="24")

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