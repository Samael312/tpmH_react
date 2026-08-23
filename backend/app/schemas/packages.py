from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import datetime
from app.schemas.classes import ALLOWED_DURATIONS

ALLOWED_DESCRIPTION_TYPES = ["paragraph", "list"]


class PackageCreate(BaseModel):
    name: str
    subject: str
    description: Optional[str] = None
    description_type: str = "paragraph"
    description_items: Optional[List[str]] = None
    icon: Optional[str] = "📦"
    color: Optional[str] = "#ec4899"
    classes_count: Optional[int] = None
    price: float
    duration_minutes: int = 60
    allow_installments: bool = False
    installment_count: Optional[int] = None
    installment_amount: Optional[float] = None

    @field_validator("duration_minutes")
    @classmethod
    def validate_duration_minutes(cls, v):
        if v < 15 or v > 240:
            raise ValueError("Duración fuera de rango razonable (15-240 min)")
        return v

    @field_validator("installment_count")
    @classmethod
    def validate_installments(cls, v, info):
        if info.data.get("allow_installments") and (v is None or v < 2):
            raise ValueError("Si permites cuotas, installment_count debe ser al menos 2")
        return v

    @field_validator("classes_count")
    @classmethod
    def validate_classes(cls, v):
        if v is not None and v < 1:
            raise ValueError("El paquete debe tener al menos 1 clase, o dejarlo vacío para ilimitadas")
        return v

    @field_validator("price")
    @classmethod
    def validate_price(cls, v):
        if v <= 0:
            raise ValueError("El precio debe ser mayor que 0")
        return v

    @field_validator("description_type")
    @classmethod
    def validate_description_type(cls, v):
        if v not in ALLOWED_DESCRIPTION_TYPES:
            raise ValueError(f"Tipo de descripción inválido. Opciones: {ALLOWED_DESCRIPTION_TYPES}")
        return v


class PackageResponse(BaseModel):
    id: int
    teacher_id: int
    name: str
    subject: str
    description: Optional[str]
    description_type: str = "paragraph"
    description_items: Optional[List[str]] = None
    icon: Optional[str] = "📦"
    color: Optional[str] = "#ec4899"
    classes_count: Optional[int]
    price: float
    duration_minutes: int
    allow_installments: bool = False
    installment_count: Optional[int] = None
    installment_amount: Optional[float] = None
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class EnrollmentResponse(BaseModel):
    id: int
    student_id: int
    package_id: int
    teacher_id: int
    classes_used: int
    classes_total: Optional[int]
    status: str
    payment_status: Optional[str] = None
    installments_paid: Optional[int] = 0
    paid_via_installments: Optional[bool] = False
    unlocked_credits: Optional[int] = 0
    prepaid_unlimited_credits: Optional[int] = 0
    available_credits: Optional[int] = None
    activated_at: Optional[datetime] = None
    renewal_count: int
    created_at: datetime
    package: PackageResponse
    teacher_name: Optional[str] = None
    teacher_username: Optional[str] = None
    teacher_avatar: Optional[str] = None

    class Config:
        from_attributes = True


class RenewalRequest(BaseModel):
    """
    El estudiante solicita renovar su paquete.
    Puede repetir el mismo o cambiar a otro del mismo profesor.
    """
    current_enrollment_id: int
    new_package_id: int


class EnrollmentComplianceResponse(BaseModel):
    """
    Vista de seguimiento de cumplimiento para el profesor:
    cuántas clases del paquete se han completado, no-show o cancelado tarde.
    """
    id: int
    student_id: int
    student_username: str
    student_name: str
    package_id: int
    package_name: str
    classes_used: int
    classes_total: Optional[int]
    available_credits: Optional[int] = None
    status: str
    completed_count: int
    no_show_count: int
    cancelled_late_count: int
    renewal_requested_package_name: Optional[str] = None
    change_requested_package_name: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class PackageChangeRequest(BaseModel):
    """
    El estudiante solicita cambiar de paquete (mismo profesor) mientras
    el paquete actual sigue activo (no agotado).
    """
    current_enrollment_id: int
    new_package_id: int


class PackageChangeApprovalResponse(BaseModel):
    message: str
    enrollment_id: int
    package: str
    classes_total: Optional[int]
    classes_used: int