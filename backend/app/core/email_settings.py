"""
Control de correos (Fase 7). Un solo punto de decision para `core/email.py::_send`.

- Cada plantilla `send_*` pertenece a UNA categoria (ver CATEGORIES / EMAIL_CATEGORY).
- Las categorias esenciales (verificar email, restablecer contrasena, recuperar usuario) nunca se apagan
  ni se pausan.
- El resto se puede apagar desde /admin/settings; por defecto todo esta encendido.
- Contador diario (UTC) en `email_log`: solo los "sent" cuentan para la cuota de Resend.
- Modo ahorro: al llegar a `email_auto_saver_percent` % del limite diario se pausan las categorias de
  probabilidad muy_alta y alta hasta el dia siguiente.
- La probabilidad es una ESTIMACION a partir del codigo, no una medicion.
"""
import logging
from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.timezone import utc_now
from app.models.email_log import EmailLog
from app.models.payment_config import PlatformConfig
from app.core.platform_config import get_platform_config  # Fase 14, E9: una lectura por petición

logger = logging.getLogger(__name__)

ESSENTIAL = "essential"

CATEGORIES: dict[str, dict] = {
    "class_reminders": {"label": "Recordatorios de clase", "probability": "muy_alta", "essential": False},
    "chat_messages": {"label": "Mensajes nuevos de chat", "probability": "muy_alta", "essential": False},
    "bookings": {"label": "Reservas y confirmaciones de clase", "probability": "alta", "essential": False},
    "cancellations": {"label": "Cancelaciones y reprogramaciones", "probability": "alta", "essential": False},
    "homework_materials": {"label": "Tareas y materiales", "probability": "alta", "essential": False},
    "admin_payments": {"label": "Avisos al admin: pagos pendientes", "probability": "media", "essential": False},
    "receipts": {"label": "Recibos y fallos de pago", "probability": "media", "essential": False},
    "welcome": {"label": "Bienvenida", "probability": "media", "essential": False},
    "admin_support_teachers": {"label": "Avisos al admin: soporte y profesores nuevos", "probability": "baja", "essential": False},
    "withdrawals": {"label": "Retiros", "probability": "baja", "essential": False},
    "package_expiring": {"label": "Paquete por vencer", "probability": "baja", "essential": False},
    "reviews": {"label": "Reseñas recibidas", "probability": "baja", "essential": False},
    "teacher_status_support": {"label": "Estado del profesor y respuestas de soporte", "probability": "baja", "essential": False},
    ESSENTIAL: {"label": "Esenciales (siempre activos)", "probability": "baja", "essential": True},
}

PAUSABLE_PROBABILITIES = ("muy_alta", "alta")

# plantilla -> categoria
EMAIL_CATEGORY: dict[str, str] = {
    "send_class_reminder_email": "class_reminders",
    "send_class_reminder_teacher_email": "class_reminders",
    "send_class_reminders_teacher_digest_email": "class_reminders",
    "send_new_chat_message_teacher_email": "chat_messages",
    "send_chat_digest_teacher_email": "chat_messages",
    "send_class_booking_confirmation": "bookings",
    "send_new_booking_teacher_email": "bookings",
    "send_class_confirmed_email": "bookings",
    "send_class_confirmed_teacher_email": "bookings",
    "send_class_cancelled_email": "cancellations",
    "send_class_cancelled_teacher_email": "cancellations",
    "send_class_rescheduled_student_email": "cancellations",
    "send_class_rescheduled_teacher_email": "cancellations",
    "send_class_no_show_email": "cancellations",
    "send_cohort_ended_email": "cancellations",
    "send_homework_submitted_email": "homework_materials",
    "send_homework_graded_email": "homework_materials",
    "send_material_assigned_email": "homework_materials",
    "send_admin_payment_pending_email": "admin_payments",
    "send_payment_receipt_email": "receipts",
    "send_payment_failed_email": "receipts",
    "send_welcome_email": "welcome",
    "send_admin_new_support_ticket_email": "admin_support_teachers",
    "send_admin_new_teacher_pending_email": "admin_support_teachers",
    "send_withdrawal_requested_teacher_email": "withdrawals",
    "send_admin_withdrawal_requested_email": "withdrawals",
    "send_withdrawal_processed_email": "withdrawals",
    "send_package_expiring_email": "package_expiring",
    "send_new_review_received_email": "reviews",
    "send_teacher_status_update_email": "teacher_status_support",
    "send_support_ticket_response_email": "teacher_status_support",
    "send_calendar_reauth_teacher_email": "teacher_status_support",
    "send_teacher_video_review_email": "teacher_status_support",
    "send_verification_email": ESSENTIAL,
    "send_password_reset_email": ESSENTIAL,
    "send_username_recovery_email": ESSENTIAL,
}

DEFAULT_DAILY_LIMIT = 100
DEFAULT_SAVER_PERCENT = 80


def today() -> date:
    return utc_now().date()


def _config(db: Session) -> PlatformConfig | None:
    return get_platform_config(db)


def get_limit(cfg: PlatformConfig | None) -> int:
    v = getattr(cfg, "email_daily_limit", None)
    return v if isinstance(v, int) and v > 0 else DEFAULT_DAILY_LIMIT


def get_saver_percent(cfg: PlatformConfig | None) -> int:
    v = getattr(cfg, "email_auto_saver_percent", None)
    return v if isinstance(v, int) and 1 <= v <= 100 else DEFAULT_SAVER_PERCENT


def is_category_enabled(cfg: PlatformConfig | None, category: str) -> bool:
    if CATEGORIES.get(category, {}).get("essential"):
        return True
    switches = getattr(cfg, "email_notifications", None) or {}
    return switches.get(category, True) is not False


def usage_today(db: Session) -> dict[str, dict[str, int]]:
    """{categoria: {sent, skipped, failed}} de hoy (UTC)."""
    rows = (
        db.query(EmailLog.category, EmailLog.outcome, func.count(EmailLog.id))
        .filter(EmailLog.day == today())
        .group_by(EmailLog.category, EmailLog.outcome)
        .all()
    )
    out: dict[str, dict[str, int]] = {}
    for category, outcome, n in rows:
        out.setdefault(category, {"sent": 0, "skipped": 0, "failed": 0})[outcome] = n
    return out


def sent_today(db: Session) -> int:
    return db.query(func.count(EmailLog.id)).filter(EmailLog.day == today(), EmailLog.outcome == "sent").scalar() or 0


def saver_active(cfg: PlatformConfig | None, sent: int) -> bool:
    """El modo ahorro esta pausando categorias ahora mismo."""
    if not getattr(cfg, "email_auto_saver_enabled", False):
        return False
    return sent * 100 >= get_limit(cfg) * get_saver_percent(cfg)


def decide(db: Session, category: str) -> tuple[bool, str | None]:
    """(enviar?, motivo si se omite). Las esenciales siempre salen."""
    if CATEGORIES.get(category, {}).get("essential"):
        return True, None
    cfg = _config(db)
    if not is_category_enabled(cfg, category):
        return False, "categoria_apagada"
    sent = sent_today(db)
    if sent >= get_limit(cfg):
        return False, "limite_diario"
    probability = CATEGORIES.get(category, {}).get("probability")
    if probability in PAUSABLE_PROBABILITIES and saver_active(cfg, sent):
        return False, "modo_ahorro"
    return True, None


def record(db: Session, category: str, outcome: str, reason: str | None = None) -> None:
    db.add(EmailLog(day=today(), category=category, outcome=outcome, reason=reason))
    db.commit()
