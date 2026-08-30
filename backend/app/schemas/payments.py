from pydantic import BaseModel, field_validator, Field
from typing import Optional, List
from datetime import datetime
from app.schemas.god_mode import GodModeActionBase


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
    default_commission_rate: float
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
    default_commission_rate: Optional[float] = None

# ─── Reserva y pago ─────────────────────────────────────────────────────────

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


class WithdrawalRequest(BaseModel):
    amount: float
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
    transaction_reference: Optional[str] = None
    # Regla de negocio 3.1 (downgrade sin créditos usados, Caso A): el
    # estudiante elige entre reembolso completo o ajuste por diferencia.
    # Se ignora fuera de ese caso puntual (package_change con 0 créditos
    # usados y el paquete nuevo es un downgrade).
    change_option: Optional[str] = None  # "full_refund" | "adjust_difference"

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
    amount: float
    payment_info: str  # datos de cobro (Zelle, IBAN, wallet, etc.)

    @field_validator("amount")
    @classmethod
    def validate_amount(cls, v):
        if v <= 0:
            raise ValueError("El monto debe ser mayor a 0")
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
    amount_total: Optional[float] = Field(None, gt=0)
    status: Optional[str] = None
    rejection_reason: Optional[str] = None
    transaction_id: Optional[str] = None

    @field_validator("status")
    @classmethod
    def validate_status(cls, v):
        if v is not None and v not in PAYMENT_STATUS_OPTIONS:
            raise ValueError(f"status debe ser uno de: {PAYMENT_STATUS_OPTIONS}")
        return v


class GodModeEditPaymentResponse(BaseModel):
    message: str
    payment: PaymentResponse

    class Config:
        from_attributes = True