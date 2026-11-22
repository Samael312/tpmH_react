from pydantic import BaseModel, Field, field_validator
from typing import Optional, List
from datetime import datetime


# ─── Métricas globales ───────────────────────────────────────────────────────

class PlatformStatsResponse(BaseModel):
    """
    KPIs globales de la plataforma.
    Lo primero que ve el superadmin al entrar.
    """
    # Usuarios
    total_users: int
    total_students: int
    total_teachers: int
    total_teachers_pending: int     # Profesores esperando aprobación
    total_teachers_approved: int

    # Clases
    total_classes: int
    classes_this_month: int
    classes_completed: int
    classes_cancelled: int

    # Finanzas
    total_revenue: float            # Total cobrado a estudiantes
    total_paid_to_teachers: float   # Total pagado a profesores
    total_platform_earnings: float  # Comisiones de la plataforma
    pending_withdrawals: float      # Retiros pendientes de procesar

    # Actividad reciente
    new_users_this_week: int
    new_classes_this_week: int


# ─── Gestión de profesores ───────────────────────────────────────────────────

class TeacherAdminResponse(BaseModel):
    id: int
    user_id: int
    username: str
    name: str
    surname: str
    email: str
    status: str
    commission_rate: float
    balance: float
    total_classes: int
    total_students: int
    created_at: datetime
    video_url: Optional[str] = None
    video_pending_url: Optional[str] = None
    video_pending_rejection_reason: Optional[str] = None
    theme_color: Optional[str] = None
    profile_photo_url: Optional[str] = None
    phone_number: Optional[str] = None
    nationality: Optional[str] = None
    rejection_reason: Optional[str] = None
    appeal_count: int = 0
    appeal_exhausted: bool = False
    has_pending_appeal: bool = False  # calculado en el endpoint, no es columna directa

    class Config:
        from_attributes = True


class UpdateTeacherStatusRequest(BaseModel):
    status: str
    reason: Optional[str] = None  # Motivo si se rechaza


class UpdateCommissionRequest(BaseModel):
    commission_rate: float = Field(..., allow_inf_nan=False, ge=0.0, le=1.0)


# ─── Gestión de usuarios ─────────────────────────────────────────────────────

class UserAdminResponse(BaseModel):
    """Vista de usuario para el superadmin"""
    id: int
    username: str
    email: str
    name: str
    surname: str
    phone_number: Optional[str] = None
    nationality: Optional[str] = None
    role: str
    is_active: bool
    is_verified: bool
    is_banned: bool = False
    ban_reason: Optional[str] = None
    banned_at: Optional[datetime] = None
    created_at: datetime
 
    class Config:
        from_attributes = True


class PaginatedUsersResponse(BaseModel):
    """BUG-10 fix: envuelve la lista de usuarios con el total real, para
    poder paginar de verdad en la UI de edición masiva del admin."""
    total: int
    users: List[UserAdminResponse]
    # Fase 14, E6: cuántos del total (mismos filtros) están activos, para que la pantalla no tenga que
    # descargarlos todos para contarlos.
    active_count: Optional[int] = None


class UpdateUserStatusRequest(BaseModel):
    is_active: bool
    reason: Optional[str] = None


class AdminUserUpdate(BaseModel):
    role: Optional[str] = None
    is_active: Optional[bool] = None
    phone_number: Optional[str] = None
    nationality: Optional[str] = None

class BanStudentRequest(BaseModel):
    reason: str
 
    @field_validator("reason")
    @classmethod
    def validate_reason(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("Debes indicar el motivo del baneo")
        return v