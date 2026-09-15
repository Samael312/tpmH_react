from pydantic import BaseModel, field_validator, model_validator, Field
from typing import Optional, List
from datetime import datetime
from app.schemas.god_mode import GodModeActionBase

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
    # Correcciones Extra (informe D1-D14, decisión de negocio confirmada):
    # precio de una clase suelta, obligatorio para paquetes finitos y
    # validado contra `price` (ver validate_price_per_class más abajo).
    # No aplica a paquetes ilimitados (classes_count=None).
    price_per_class: Optional[float] = None
    duration_minutes: int = 50
    allow_installments: bool = False
    installment_count: Optional[int] = None
    installment_amount: Optional[float] = None
    # BUG: estos 3 campos nunca estuvieron declarados acá, así que Pydantic
    # los descartaba en silencio del payload — el toggle "grupal" del
    # formulario nunca llegaba a guardarse, el paquete quedaba is_group=False
    # sin importar lo que mandara el frontend. Por eso no aparecía el badge
    # "Grupal" en la tarjeta ni el creador de cohortes lo reconocía como
    # paquete grupal disponible.
    is_group: bool = False
    min_students: Optional[int] = None
    max_students: Optional[int] = None
    # D14: horario de las sesiones para un paquete grupal (decisión de
    # negocio confirmada: deben existir las dos opciones). "manual"
    # (default) = comportamiento de siempre, el profesor agenda cada
    # sesión a mano. "fixed" = patrón semanal recurrente -- requiere
    # group_recurring_days_of_week + group_recurring_time_local.
    group_schedule_mode: str = "manual"
    group_recurring_days_of_week: Optional[List[int]] = None
    group_recurring_time_local: Optional[str] = None

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

    @field_validator("group_schedule_mode")
    @classmethod
    def validate_group_schedule_mode(cls, v):
        if v not in ("manual", "fixed"):
            raise ValueError("group_schedule_mode debe ser 'manual' o 'fixed'")
        return v

    @field_validator("group_recurring_days_of_week")
    @classmethod
    def validate_recurring_days(cls, v):
        if v is not None and any(d < 0 or d > 6 for d in v):
            raise ValueError("Los días deben ser 0 (Lunes) a 6 (Domingo)")
        return v

    @field_validator("group_recurring_time_local")
    @classmethod
    def validate_recurring_time(cls, v):
        if v is None:
            return v
        import re
        if not re.match(r"^([01]\d|2[0-3]):[0-5]\d$", v):
            raise ValueError("group_recurring_time_local debe tener formato HH:MM")
        return v

    @model_validator(mode="after")
    def validate_price_per_class(self):
        # Correcciones Extra (decisión de negocio confirmada): obligatorio
        # y debe coincidir exactamente (redondeado a centavos) con el
        # precio total -- price_per_class * classes_count == price. Los
        # paquetes ilimitados no tienen un precio por clase fijo, así que
        # se ignora cualquier valor recibido en vez de exigirlo.
        if self.classes_count is None:
            self.price_per_class = None
            return self
        if self.price_per_class is None:
            raise ValueError(
                "Debes indicar el precio de una clase suelta de este paquete (price_per_class)"
            )
        if self.price_per_class <= 0:
            raise ValueError("El precio de clase unitaria debe ser mayor que 0")
        expected_total = round(self.price_per_class * self.classes_count, 2)
        if abs(expected_total - round(self.price, 2)) > 0.01:
            raise ValueError(
                f"El precio de clase unitaria (${self.price_per_class:.2f}) no coincide con el precio "
                f"total: {self.classes_count} × ${self.price_per_class:.2f} = ${expected_total:.2f}, "
                f"pero el precio del paquete es ${self.price:.2f}. Ajusta uno de los dos."
            )
        return self

    @model_validator(mode="after")
    def validate_fixed_schedule_complete(self):
        # D14: si se eligió horario fijo, el patrón (días + hora) es
        # obligatorio -- de lo contrario no habría nada que usar para
        # generar las sesiones al cerrar el grupo.
        if self.group_schedule_mode == "fixed":
            if not self.group_recurring_days_of_week or not self.group_recurring_time_local:
                raise ValueError(
                    "Un paquete con horario fijo necesita al menos un día de la semana y una hora configurados"
                )
        return self


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
    price_per_class: Optional[float] = None
    duration_minutes: int
    allow_installments: bool = False
    installment_count: Optional[int] = None
    installment_amount: Optional[float] = None
    is_active: bool
    created_at: datetime
    is_group: bool = False
    min_students: Optional[int] = None
    max_students: Optional[int] = None
    group_schedule_mode: str = "manual"
    group_recurring_days_of_week: Optional[List[int]] = None
    group_recurring_time_local: Optional[str] = None

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
    teacher_status: Optional[str] = None
    teacher_avatar: Optional[str] = None
    cohort_id: Optional[int] = None
    cohort_status: Optional[str] = None       # "filling" | "confirmed" | ... (solo si cohort_id)
    cohort_start_date: Optional[datetime] = None
    cohort_current_students: Optional[int] = None
    cohort_max_students: Optional[int] = None
    credit_balance_usd: Optional[float] = None
    # True si hay un Payment payment_type="unlimited_recharge" en
    # pending_review para este enrollment — se usa en el dashboard para
    # mostrar "recarga en revisión" en vez de dejar ver 0 créditos sin
    # ninguna explicación mientras el staff todavía no la aprueba.
    has_pending_recharge: Optional[bool] = False

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


class GodModeEnrollmentAdjustRequest(GodModeActionBase):
    """
    Ajuste directo de los contadores de un enrollment, saltándose el
    flujo normal de pagos/renovación. Todos los campos son opcionales:
    solo se tocan los que vengan seteados (no se pisa el resto).
    """
    unlocked_credits: Optional[int] = Field(None, ge=0)
    classes_used: Optional[int] = Field(None, ge=0)
    classes_total: Optional[int] = Field(None, ge=0)
    prepaid_unlimited_credits: Optional[int] = Field(None, ge=0)
    installments_paid: Optional[int] = Field(None, ge=0)
    payment_status: Optional[str] = None
    status: Optional[str] = None

    @field_validator("payment_status")
    @classmethod
    def validate_payment_status(cls, v):
        if v is not None and v not in ("unpaid", "partially_paid", "paid"):
            raise ValueError("payment_status debe ser: unpaid, partially_paid o paid")
        return v

    @field_validator("status")
    @classmethod
    def validate_status(cls, v):
        allowed = {"active", "completed", "cancelled", "pending_renewal", "pending_package_change"}
        if v is not None and v not in allowed:
            raise ValueError(f"status debe ser uno de: {sorted(allowed)}")
        return v


class GodModeChangePackageRequest(GodModeActionBase):
    """
    Cambia el paquete de un enrollment de forma instantánea, sin pasar
    por request-package-change ni por ningún pago. Pensado para casos
    donde el staff ya validó el pago por fuera del sistema (WhatsApp,
    transferencia manual sin comprobante subido, etc.).
    """
    new_package_id: int
    reset_classes_used: bool = False


class GodModeEnrollmentResponse(BaseModel):
    message: str
    enrollment: EnrollmentResponse

    class Config:
        from_attributes = True


class PackageChangeApprovalResponse(BaseModel):
    message: str
    enrollment_id: int
    package: str
    classes_total: Optional[int]
    classes_used: int
