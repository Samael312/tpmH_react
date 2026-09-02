from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session
from typing import Optional
from datetime import datetime, timedelta, timezone

from app.db.base import get_db
from app.auth.dependencies import get_current_staff, get_current_user_optional
from app.models.user import User
from app.models.error_log import ErrorLog
from app.core.error_log import log_error
from app.schemas.logs import (
    FrontendErrorReportRequest,
    ErrorLogResponse,
    PaginatedErrorLogResponse,
    ErrorLogUserOption,
    ErrorLogStats,
)

router = APIRouter()


@router.post("/frontend", status_code=status.HTTP_204_NO_CONTENT)
def report_frontend_error(
    payload: FrontendErrorReportRequest,
    current_user: Optional[User] = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    """
    El frontend reporta acá los crashes de React no controlados y los
    fallos de llamadas a la API (4xx/5xx). No requiere estar logueado
    (puede ocurrir en /login o antes de cargar la sesión), pero si hay
    un usuario identificado por el token, queda asociado al log.
    """
    log_error(
        source="frontend",
        level=payload.level,
        message=payload.message,
        detail=payload.stack,
        screen=payload.screen,
        status_code=payload.status_code,
        user=current_user,
        extra=payload.extra,
        db=db,
    )
    return None


@router.get("", response_model=PaginatedErrorLogResponse)
def list_error_logs(
    source: Optional[str] = Query(None, pattern="^(backend|frontend)$"),
    level: Optional[str] = Query(None, pattern="^(error|warning)$"),
    screen: Optional[str] = Query(None, description="Búsqueda parcial sobre la pantalla/endpoint"),
    user_id: Optional[int] = None,
    user_name: Optional[str] = Query(None, description="Búsqueda parcial por nombre y apellido del usuario"),
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """Listado paginado para la pantalla de Logs en /admin (superadmin y teacher_admin)."""
    query = db.query(ErrorLog)

    if source:
        query = query.filter(ErrorLog.source == source)
    if level:
        query = query.filter(ErrorLog.level == level)
    if screen:
        query = query.filter(ErrorLog.screen.ilike(f"%{screen}%"))
    if user_id:
        query = query.filter(ErrorLog.user_id == user_id)
    if user_name:
        query = query.filter(ErrorLog.user_name.ilike(f"%{user_name}%"))
    if date_from:
        query = query.filter(ErrorLog.created_at >= date_from)
    if date_to:
        query = query.filter(ErrorLog.created_at <= date_to)

    total = query.count()
    items = (
        query.order_by(ErrorLog.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return PaginatedErrorLogResponse(
        items=[ErrorLogResponse.model_validate(i) for i in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/users", response_model=list[ErrorLogUserOption])
def list_error_log_users(
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """
    Usuarios que tienen al menos un error registrado, con su nombre y
    apellido vigentes (se busca en `users`, no en el snapshot guardado
    en el log, para que si el usuario cambió su nombre el filtro
    siempre muestre el actual). Alimenta el <select> del filtro por
    usuario en la pantalla de Logs.
    """
    rows = (
        db.query(User.id, User.name, User.surname)
        .join(ErrorLog, ErrorLog.user_id == User.id)
        .distinct()
        .order_by(User.name, User.surname)
        .all()
    )
    return [ErrorLogUserOption(id=r.id, name=f"{r.name} {r.surname}") for r in rows]


@router.get("/stats", response_model=ErrorLogStats)
def get_error_log_stats(
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """Contadores rápidos para las StatCards de la pantalla de Logs."""
    since = datetime.now(timezone.utc) - timedelta(hours=24)

    total = db.query(ErrorLog).count()
    errors = db.query(ErrorLog).filter(ErrorLog.level == "error").count()
    warnings = db.query(ErrorLog).filter(ErrorLog.level == "warning").count()
    backend = db.query(ErrorLog).filter(ErrorLog.source == "backend").count()
    frontend = db.query(ErrorLog).filter(ErrorLog.source == "frontend").count()
    last_24h = db.query(ErrorLog).filter(ErrorLog.created_at >= since).count()

    return ErrorLogStats(
        total=total,
        errors=errors,
        warnings=warnings,
        backend=backend,
        frontend=frontend,
        last_24h=last_24h,
    )
