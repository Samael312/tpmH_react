"""
Retencion de tablas que crecen sin limite (Fase 5): `error_logs` (el frontend y los errores 5xx escriben aqui)
y `email_log` (una fila por correo). Un job diario (core/scheduler.py) borra lo mas viejo.
0 o un valor negativo desactiva la purga de esa tabla.
"""
import os
from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.timezone import utc_now
from app.models.email_log import EmailLog
from app.models.error_log import ErrorLog

ERROR_LOG_RETENTION_DAYS = int(os.getenv("ERROR_LOG_RETENTION_DAYS", "30"))
EMAIL_LOG_RETENTION_DAYS = int(os.getenv("EMAIL_LOG_RETENTION_DAYS", "60"))


def purge_error_logs(db: Session, days: int = ERROR_LOG_RETENTION_DAYS) -> int:
    """Borra los registros de error mas viejos que `days` dias. Devuelve cuantos borro."""
    if days <= 0:
        return 0
    cutoff = utc_now() - timedelta(days=days)
    n = db.query(ErrorLog).filter(ErrorLog.created_at < cutoff).delete(synchronize_session=False)
    db.commit()
    return n


def purge_email_log(db: Session, days: int = EMAIL_LOG_RETENTION_DAYS) -> int:
    """Borra las filas de `email_log` mas viejas que `days` dias (el contador diario solo usa las de hoy)."""
    if days <= 0:
        return 0
    cutoff = utc_now() - timedelta(days=days)
    n = db.query(EmailLog).filter(EmailLog.created_at < cutoff).delete(synchronize_session=False)
    db.commit()
    return n
