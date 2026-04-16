from pydantic import BaseModel, EmailStr
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
    """Vista del profesor para el superadmin"""
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

    class Config:
        from_attributes = True


class UpdateTeacherStatusRequest(BaseModel):
    status: str
    reason: Optional[str] = None  # Motivo si se rechaza


class UpdateCommissionRequest(BaseModel):
    commission_rate: float

    @classmethod
    def validate_rate(cls, v):
        if not 0.0 <= v <= 1.0:
            raise ValueError("La comisión debe estar entre 0.0 y 1.0 (0% - 100%)")
        return v


# ─── Gestión de usuarios ─────────────────────────────────────────────────────

class UserAdminResponse(BaseModel):
    """Vista de usuario para el superadmin"""
    id: int
    username: str
    email: str
    name: str
    surname: str
    role: str
    is_active: bool
    is_verified: bool
    created_at: datetime

    class Config:
        from_attributes = True


class UpdateUserStatusRequest(BaseModel):
    is_active: bool
    reason: Optional[str] = None

class AdminUserUpdate(BaseModel):
    role:            Optional[str]   = None
    status:          Optional[str]   = None
    package_name:    Optional[str]   = None
    price_per_class: Optional[float] = None