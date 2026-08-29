from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Dict, Any

from app.db.base import get_db
from app.auth.dependencies import get_current_staff
from app.models.user import User
from app.models.system_catalog import SystemCatalog
from app.models.payment_config import PlatformConfig
from app.schemas.system_catalog import (
    SystemCatalogResponse,
    UpdateSystemCatalogRequest,
    BusinessRulesResponse,
    UpdateBusinessRulesRequest,
)
from app.schemas.classes import CLASS_DURATION_OPTIONS, DEFAULT_BUFFER_MINUTES

router = APIRouter()

# Estas keys son las únicas editables — cualquier otra queda bloqueada
# aunque alguien intente hacer PATCH directo por la API.
EDITABLE_KEYS = {
    "subjects", "languages", "skill_suggestions", "student_goals",
    "student_payment_methods", "withdrawal_methods",
    "material_categories", "material_levels",
    "theme_presets", "package_icon_options", "subject_theme_map",
}


@router.get("/", response_model=Dict[str, Any])
def get_all_catalogs(db: Session = Depends(get_db)):
    """
    Devuelve todos los catálogos como { key: value }.
    Público — lo consume cualquier pantalla (onboarding, perfil, etc.)
    sin requerir sesión de admin.
    """
    rows = db.query(SystemCatalog).all()
    return {r.key: r.value for r in rows}


@router.get("/admin", response_model=List[SystemCatalogResponse])
def list_catalogs_admin(
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """Vista completa (con label y updated_at) para la pantalla de configuración."""
    return db.query(SystemCatalog).order_by(SystemCatalog.label).all()


@router.get("/business-rules", response_model=BusinessRulesResponse)
def get_business_rules(db: Session = Depends(get_db)):
    """Público — el frontend lo necesita para validar duraciones/plazos sin sesión de admin."""
    config = db.query(PlatformConfig).first()
    if not config:
        config = PlatformConfig()
        db.add(config)
        db.commit()
        db.refresh(config)

    return BusinessRulesResponse(
        min_booking_hours=config.min_booking_hours or 1,
        min_cancel_hours=config.min_cancel_hours or 12,
        min_reschedule_hours_student=config.min_reschedule_hours_student or 12,
        allowed_class_durations=config.allowed_class_durations or [50, 80, 110],
        allowed_package_durations=config.allowed_package_durations or [50, 80, 110],
        low_credit_threshold=config.low_credit_threshold or 1,
        low_credit_renotify_days=config.low_credit_renotify_days or 6,
        trial_duration_minutes=config.trial_duration_minutes or 25,
        buffer_trial_minutes=(
            config.buffer_trial_minutes
            if config.buffer_trial_minutes is not None
            else DEFAULT_BUFFER_MINUTES["trial"]
        ),
        buffer_regular_minutes=(
            config.buffer_regular_minutes
            if config.buffer_regular_minutes is not None
            else DEFAULT_BUFFER_MINUTES["regular"]
        ),
        buffer_group_minutes=(
            config.buffer_group_minutes
            if config.buffer_group_minutes is not None
            else DEFAULT_BUFFER_MINUTES["group"]
        ),
    )


@router.patch("/business-rules", response_model=BusinessRulesResponse)
def update_business_rules(
    data: UpdateBusinessRulesRequest,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    config = db.query(PlatformConfig).first()
    if not config:
        config = PlatformConfig()
        db.add(config)
        db.flush()

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(config, field, value)

    db.commit()
    db.refresh(config)
    return get_business_rules(db)


# NOTA: las rutas con path fijo ("/business-rules") deben registrarse
# ANTES que "/{key}", porque FastAPI resuelve rutas en el orden en que
# se registran. Si "/{key}" va primero, intercepta "/business-rules"
# tratándolo como key="business-rules" y espera el body { value } en
# vez del payload de reglas de negocio, causando 422 en cada PATCH.
@router.patch("/{key}", response_model=SystemCatalogResponse)
def update_catalog(
    key: str,
    data: UpdateSystemCatalogRequest,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    if key not in EDITABLE_KEYS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"'{key}' no es un catálogo editable")

    catalog = db.query(SystemCatalog).filter(SystemCatalog.key == key).first()
    if not catalog:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Catálogo no encontrado")

    catalog.value = data.value
    db.commit()
    db.refresh(catalog)
    return catalog