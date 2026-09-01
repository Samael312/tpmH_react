"""
Helper central para registrar errores (backend y frontend) en la tabla
error_logs, consumida por la pantalla de Logs de /admin.

Se usa desde:
  - app/main.py: exception handlers globales (excepciones no controladas
    y errores de negocio relevantes en rutas críticas).
  - app/api/v1/endpoints/logs.py: endpoint POST /logs/frontend, donde el
    propio cliente reporta un error.

Nunca debe romper el flujo normal de la request: cualquier fallo al
loguear se ignora silenciosamente (no queremos que un error al guardar
el log tape el error original, ni que tumbe una response que de otra
forma hubiera sido válida).
"""
from typing import Any, Optional
import logging

from sqlalchemy.orm import Session
from starlette.requests import Request

from app.db.base import SessionLocal
from app.models.error_log import ErrorLog
from app.models.user import User
from app.auth.jwt import decode_access_token

logger = logging.getLogger("app.error_log")

# Rutas de backend consideradas "de negocio crítico": un 4xx en estos
# prefijos (pagos, clases, cohortes, paquetes) queda registrado como
# advertencia porque suele indicar un problema real (reserva rechazada,
# pago inconsistente, cupo agotado), a diferencia de un 404/401 genérico
# en cualquier otro endpoint.
CRITICAL_PATH_PREFIXES = (
    "/api/v1/payments",
    "/api/v1/classes",
    "/api/v1/cohorts",
    "/api/v1/packages",
)

# Status codes que no vale la pena registrar aunque caigan en una ruta
# crítica: son parte del flujo normal (sesión vencida) y ensuciarían el
# log sin aportar nada accionable.
IGNORED_STATUS_CODES = {401}


def is_reportable_business_error(path: str, status_code: int) -> bool:
    if status_code < 400 or status_code in IGNORED_STATUS_CODES:
        return False
    return any(path.startswith(prefix) for prefix in CRITICAL_PATH_PREFIXES)


def get_user_from_request(db: Session, request: Request) -> Optional[User]:
    """
    Intenta identificar al usuario logueado a partir del header
    Authorization, sin lanzar nunca una excepción (se usa dentro de
    exception handlers, donde las Depends normales no corren).
    """
    try:
        auth_header = request.headers.get("authorization") or request.headers.get("Authorization")
        if not auth_header or not auth_header.lower().startswith("bearer "):
            return None
        token = auth_header.split(" ", 1)[1].strip()
        payload = decode_access_token(token)
        if not payload:
            return None
        return db.query(User).filter(User.id == int(payload["sub"])).first()
    except Exception:
        return None


def log_error(
    source: str,
    level: str,
    message: str,
    detail: Optional[str] = None,
    screen: Optional[str] = None,
    method: Optional[str] = None,
    status_code: Optional[int] = None,
    user: Optional[User] = None,
    extra: Optional[dict[str, Any]] = None,
    db: Optional[Session] = None,
) -> None:
    """
    Guarda un ErrorLog. Si no se pasa `db`, abre y cierra una sesión
    propia (necesario desde los exception handlers globales, donde no
    hay una sesión de request disponible vía Depends).
    """
    own_session = db is None
    session = db or SessionLocal()
    try:
        entry = ErrorLog(
            source=source,
            level=level,
            message=(message or "")[:2000],
            detail=detail,
            screen=screen,
            method=method,
            status_code=status_code,
            user_id=user.id if user else None,
            user_name=f"{user.name} {user.surname}" if user else None,
            user_role=(user.role.value if hasattr(user.role, "value") else str(user.role)) if user else None,
            extra_data=extra,
        )
        session.add(entry)
        session.commit()
    except Exception:
        # Si falla el logging de errores, no queremos que eso genere
        # un segundo error que tape al original — solo lo dejamos en
        # el logger estándar de Python para no perder rastro del todo.
        logger.exception("No se pudo guardar el ErrorLog en la base de datos")
        if own_session:
            session.rollback()
    finally:
        if own_session:
            session.close()
