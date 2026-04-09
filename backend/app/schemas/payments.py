from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import datetime


# ─── Configuración de pagos ──────────────────────────────────────────────────

class PaymentConfigResponse(BaseModel):
    paypal_enabled: bool
    binance_enabled: bool
    paypal_email: Optional[str]
    binance_address: Optional[str]
    binance_network: Optional[str]
    whatsapp_number: Optional[str]
    has_any_method: bool  # False = mostrar solo WhatsApp

    class Config:
        from_attributes = True


class UpdatePaymentConfigRequest(BaseModel):
    paypal_enabled: Optional[bool] = None
    binance_enabled: Optional[bool] = None
    paypal_email: Optional[str] = None
    binance_address: Optional[str] = None
    binance_network: Optional[str] = None
    whatsapp_number: Optional[str] = None
    default_commission_rate: Optional[float] = None


# ─── Reserva y pago ─────────────────────────────────────────────────────────

class BookAndPayRequest(BaseModel):
    """
    Paso 1: El estudiante reserva un slot.
    No necesita pagar todavía — el slot queda en 'pending'.
    """
    enrollment_id: int
    start_time_utc: datetime
    end_time_utc: datetime
    duration_minutes: int


class SubmitPaymentReceiptRequest(BaseModel):
    """
    Paso 2: El estudiante sube el comprobante.
    El slot pasa a 'pending_payment' y se bloquea.
    """
    class_id: int
    payment_method: str      # "paypal" o "binance"
    transaction_id: str      # ID de transacción externo
    receipt_url: str         # URL de Cloudinary (el frontend sube el archivo)
    receipt_public_id: str   # Para poder borrarlo si se rechaza
    amount: float


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
    meet_link: Optional[str] = None       # Obligatorio si action=approve
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