from pydantic import BaseModel, field_validator, model_validator, Field
from typing import Annotated, Optional, List
from datetime import datetime, timezone
from app.schemas.god_mode import GodModeActionBase


# Fase 20 (D1): ningun importe de entrada admite NaN/inf (NaN pasaba todas las comparaciones y dejaba el saldo en NaN).
FiniteFloat = Annotated[float, Field(allow_inf_nan=False)]


# ─── Configuración de pagos ──────────────────────────────────────────────────

class PaymentConfigResponse(BaseModel):
    paypal_enabled: bool
    binance_enabled: bool
    bank_transfer_enabled: bool
    mobile_payment_enabled: bool
    paypal_email: Optional[str]
    binance_address: Optional[str]
    binance_network: Optional[str]
    bank_transfer_details: Optional[str]
    mobile_payment_details: Optional[str]
    whatsapp_number: Optional[str]
    # None para quien no es staff (la comision por defecto no se expone a alumnos/profesores)
    default_commission_rate: Optional[float] = None
    has_any_method: bool

    class Config:
        from_attributes = True


class UpdatePaymentConfigRequest(BaseModel):
    paypal_enabled: Optional[bool] = None
    binance_enabled: Optional[bool] = None
    bank_transfer_enabled: Optional[bool] = None
    mobile_payment_enabled: Optional[bool] = None
    paypal_email: Optional[str] = None
    binance_address: Optional[str] = None
    binance_network: Optional[str] = None
    bank_transfer_details: Optional[str] = None
    mobile_payment_details: Optional[str] = None
    whatsapp_number: Optional[str] = None
    default_commission_rate: Optional[Annotated[float, Field(allow_inf_nan=False, ge=0.0, le=1.0)]] = None

# ─── Reserva y pago ─────────────────────────────────────────────────────────

MIN_WITHDRAWAL_AMOUNT = 10.0


class BookAndPayRequest(BaseModel):
    """
    Paso 1: El estudiante reserva un slot.
    No necesita pagar todavía — el slot queda en 'pending'.
    """
    enrollment_id: Optional[int] = None  
    teacher_username: Optional[str] = None
    start_time_utc: datetime
    end_time_utc: datetime
    duration_minutes: int
    subject: Optional[str] = None

    @field_validator("start_time_utc", "end_time_utc")
    @classmethod
    def require_timezone(cls, v):
        # AUD-08: un datetime sin zona (naive) revienta al compararlo con utc_now() (500).
        if v.tzinfo is None or v.tzinfo.utcoffset(v) is None:
            raise ValueError("La fecha debe incluir zona horaria (ej. 2026-01-01T10:00:00Z)")
        # Normaliza a UTC: con offset (+02:00) se guardaba la hora local sin convertir
        # y day_of_week se calculaba sobre la hora local.
        return v.astimezone(timezone.utc) 


# BUG-04/12: SubmitPaymentReceiptRequest y su endpoint /submit-receipt fueron
# eliminados (ya era código muerto, ningún cliente lo llamaba, y duplicaba el
# flujo de "clase suelta pendiente de pago" que también se eliminó).


class PaymentResponse(BaseModel):
    id: int
    class_id: Optional[int]
    student_id: int
    teacher_id: int
    amount_total: float
    amount_teacher: float
    amount_platform: float
    payment_method: str
    receipt_url: Optional[str]
    transaction_id: Optional[str]
    status: str
    created_at: datetime
    validated_at: Optional[datetime]

    class Config:
        from_attributes = True


# ─── Validación por admin ────────────────────────────────────────────────────

class ValidatePaymentRequest(BaseModel):
    """El admin aprueba o rechaza un comprobante"""
    action: str              # "approve" o "reject"
    # NOTA: el link de Meet ya no se pide/gestiona al validar un pago (ver
    # BUG-04/12 fix en payments.py). Se carga aparte, por el profesor, desde
    # PATCH /classes/{class_id}/meet-link — es un campo 100% opcional que no
    # bloquea ni afecta el flujo de aprobación de pagos.
    rejection_reason: Optional[str] = None  # Obligatorio si action=reject

    @field_validator("action")
    @classmethod
    def validate_action(cls, v):
        if v not in ["approve", "reject"]:
            raise ValueError("action debe ser 'approve' o 'reject'")
        return v


# ─── Wallet y retiros ────────────────────────────────────────────────────────

class WalletResponse(BaseModel):
    available_balance: float
    total_earned: float
    total_withdrawn: float

    class Config:
        from_attributes = True


class RefundPaymentInfo(BaseModel):
    """
    Datos de destino para el reembolso, tal como los completa el estudiante
    en el modal de "Solicitar reembolso". El estudiante llena el/los campo(s)
    que tenga -- pero al menos uno es obligatorio (antes se podía enviar
    el formulario completamente vacío y el staff se quedaba sin ninguna
    forma de contactar al estudiante para coordinar la devolución).
    """
    bank_name: Optional[str] = None
    bank_account: Optional[str] = None
    account_holder: Optional[str] = None
    mobile_payment: Optional[str] = None
    paypal_or_zelle: Optional[str] = None
    other_notes: Optional[str] = None

    @model_validator(mode="after")
    def validate_at_least_one_field(self):
        if not any((v or "").strip() for v in (
            self.bank_name, self.bank_account, self.account_holder,
            self.mobile_payment, self.paypal_or_zelle, self.other_notes,
        )):
            raise ValueError(
                "Completa al menos un dato de contacto o de cuenta para poder procesar tu reembolso"
            )
        return self


class RequestRefundTeacherSuspendedRequest(BaseModel):
    enrollment_id: int
    # Correcciones Extra: obligatorio (con al menos 1 campo lleno, ver
    # RefundPaymentInfo) -- antes se podía enviar la solicitud sin ningún
    # dato de contacto para la devolución.
    payment_info: RefundPaymentInfo


class RequestRefundCohortCancelledRequest(BaseModel):
    enrollment_id: int
    payment_info: RefundPaymentInfo


class WithdrawalRequest(BaseModel):
    amount: FiniteFloat
    destination_method: str   # "paypal", "binance", "bank"
    destination_details: str  # email, wallet address, etc.

    @field_validator("amount")
    @classmethod
    def validate_amount(cls, v):
        if v < 10:
            raise ValueError("El monto mínimo de retiro es $10")
        return v


class WithdrawalResponse(BaseModel):
    id: int
    teacher_id: int
    amount: float
    status: str
    destination_method: Optional[str]
    destination_details: Optional[str] = None
    rejection_reason: Optional[str] = None
    reference: Optional[str] = None
    processed_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True

class NotifyPaymentRequest(BaseModel):
    type: str  # "package" | "renewal" | "package_change" | "unlimited_recharge"
    enrollment_id: Optional[int] = None
    package_id: Optional[int] =None
    class_id: Optional[int] = None
    installment_index: Optional[int] = None
    credits_requested: Optional[int] = None
    # Correcciones Extra: obligatorio salvo en los caminos donde termina
    # siendo un reembolso al estudiante (isRefund en el frontend) o un
    # cambio instantáneo sin costo -- ahí el frontend no lo manda y el
    # backend no lo exige (ver notify_payment).
    payment_method: Optional[str] = None
    transaction_reference: Optional[str] = None
    # Regla de negocio 3.1 (downgrade sin créditos usados, Caso A): el
    # estudiante elige entre reembolso completo o ajuste por diferencia.
    # Se ignora fuera de ese caso puntual (package_change con 0 créditos
    # usados y el paquete nuevo es un downgrade).
    change_option: Optional[str] = None  # "full_refund" | "adjust_difference"
    # Cuando la solicitud termina generando un reembolso (payment_type
    # "refund", ya sea completo o por diferencia), acá van los datos de a
    # dónde depositarle al estudiante — mismo modal que en
    # request-refund-teacher-suspended, todos los sub-campos opcionales.
    payment_info: Optional[RefundPaymentInfo] = None

    @field_validator("change_option")
    @classmethod
    def validate_change_option(cls, v):
        if v is not None and v not in ("full_refund", "adjust_difference"):
            raise ValueError("change_option debe ser 'full_refund' o 'adjust_difference'")
        return v

    @field_validator("type")
    @classmethod
    def validate_type(cls, v):
        # BUG-04/12: "single_class" fue eliminado — ver notify_payment().
        allowed = ("package", "renewal", "package_change", "unlimited_recharge")
        if v not in allowed:
            raise ValueError(f"type debe ser uno de: {allowed}")
        return v

    @field_validator("installment_index")
    @classmethod
    def validate_installment(cls, v):
        if v is not None and v < 1:
            raise ValueError("installment_index debe ser mayor a 0")
        return v


class WithdrawalRequestV2(BaseModel):
    amount: FiniteFloat
    payment_info: str  # datos de cobro (Zelle, IBAN, wallet, etc.)
    destination_method: Optional[str] = None  # "paypal" | "binance" | "bank" (informativo)

    @field_validator("amount")
    @classmethod
    def validate_amount(cls, v):
        if v <= 0:
            raise ValueError("El monto debe ser mayor a 0")
        # AUD-13: el minimo ($10) solo se aplicaba en la UI.
        if v < MIN_WITHDRAWAL_AMOUNT:
            raise ValueError(f"El retiro mínimo es de ${MIN_WITHDRAWAL_AMOUNT:.2f}")
        return v


class ProcessWithdrawalRequest(BaseModel):
    action: str  # "complete" | "reject"
    reference: Optional[str] = None
    rejection_reason: Optional[str] = None

    @field_validator("action")
    @classmethod
    def validate_action(cls, v):
        if v not in ("complete", "reject"):
            raise ValueError("action debe ser 'complete' o 'reject'")
        return v


# ─── MODO DIOS ──────────────────────────────────────────────────────────

PAYMENT_STATUS_OPTIONS = ["pending_review", "under_review", "approved", "rejected"]


class GodModeEditPaymentRequest(GodModeActionBase):
    """
    Edita un Payment ya registrado. Si el pago ya estaba 'approved' y se
    cambia el monto, o si se cambia el status hacia/desde 'approved', el
    endpoint ajusta el saldo de la billetera del profesor para que no
    quede desincronizado con lo que realmente se le acreditó.
    """
    amount_total: Optional[float] = Field(None, gt=0, allow_inf_nan=False)
    status: Optional[str] = None
    rejection_reason: Optional[str] = None
    transaction_id: Optional[str] = None

    @field_validator("status")
    @classmethod
    def validate_status(cls, v):
        if v is not None and v not in PAYMENT_STATUS_OPTIONS:
            raise ValueError(f"status debe ser uno de: {PAYMENT_STATUS_OPTIONS}")
        return v


class GodModeCreatePaymentRequest(GodModeActionBase):
    """
    Crea un Payment desde cero — para un pago que se hizo por fuera del
    sistema (transferencia, efectivo, WhatsApp) y nunca quedó registrado.
    A diferencia de /payments/manual-grant, esto NO activa ni modifica
    ningún enrollment por su cuenta; solo registra el pago. Si además
    hay que activar un paquete o sumar créditos, usa por separado
    "Ajustar créditos" o "Cambiar de paquete".
    """
    teacher_id: int
    student_id: int
    enrollment_id: Optional[int] = None
    amount_total: float = Field(..., gt=0, allow_inf_nan=False)
    payment_method: str
    payment_type: str = "package"
    status: str = "approved"
    transaction_id: Optional[str] = None
    # No genera comisión ni mueve la billetera del profesor, sin importar
    # el monto — para casos como becas, cortesías, o correcciones donde
    # el profesor no debe recibir ese dinero.
    is_manual_grant: bool = False

    @field_validator("status")
    @classmethod
    def validate_create_status(cls, v):
        if v not in PAYMENT_STATUS_OPTIONS:
            raise ValueError(f"status debe ser uno de: {PAYMENT_STATUS_OPTIONS}")
        return v

    @field_validator("payment_type")
    @classmethod
    def validate_payment_type(cls, v):
        allowed = ("package", "single_class", "unlimited_recharge", "manual")
        if v not in allowed:
            raise ValueError(f"payment_type debe ser uno de: {allowed}")
        return v


class GodModeEditPaymentResponse(BaseModel):
    message: str
    payment: PaymentResponse

    class Config:
        from_attributes = True


# ─── Solicitudes de otorgamiento manual (Fase 20, D5) ───────────────────────

class CreateManualGrantRequest(BaseModel):
    enrollment_id: int
    reason: str

    @field_validator("reason")
    @classmethod
    def validate_reason(cls, v):
        v = (v or "").strip()
        if len(v) < 5:
            raise ValueError("Explica el motivo (mínimo 5 caracteres)")
        if len(v) > 1000:
            raise ValueError("El motivo es demasiado largo (máx. 1000 caracteres)")
        return v


class ResolveManualGrantRequest(BaseModel):
    action: str  # "approve" | "reject"
    rejection_reason: Optional[str] = None

    @field_validator("action")
    @classmethod
    def validate_action(cls, v):
        if v not in ("approve", "reject"):
            raise ValueError("action debe ser 'approve' o 'reject'")
        return v


class ManualGrantRequestResponse(BaseModel):
    id: int
    teacher_id: int
    student_id: int
    enrollment_id: int
    package_id: Optional[int] = None
    reason: str
    status: str
    rejection_reason: Optional[str] = None
    created_at: datetime
    resolved_at: Optional[datetime] = None
    teacher_name: Optional[str] = None
    student_name: Optional[str] = None
    package_name: Optional[str] = None

    class Config:
        from_attributes = True
