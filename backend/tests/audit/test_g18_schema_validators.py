"""Validadores de los esquemas Pydantic: cada regla se prueba con un valor válido y otro rechazado."""
import pytest
from pydantic import ValidationError

from app.schemas.classes import BookClassRequest, BookTrialRequest, UpdateMeetLinkRequest
from app.schemas.materials import MaterialCreate, MaterialUpdate
from app.schemas.packages import PackageCreate
from app.schemas.payments import (
    CreateManualGrantRequest, NotifyPaymentRequest, ProcessWithdrawalRequest, ResolveManualGrantRequest,
    ValidatePaymentRequest, WithdrawalRequest,
)
from app.schemas.support import CreateClassCorrectionRequest, CreateSupportTicketRequest, ResolveSupportTicketRequest
from app.schemas.system_catalog import UpdateBusinessRulesRequest
from app.schemas.teacher import UpdateTeacherProfileRequest, _short_str_list
from app.schemas.tts import TTSBatchRequest, TTSWordRequest

NOW = "2030-01-01T10:00:00Z"


def rejects(cls, field_hint=None, **kw):
    with pytest.raises(ValidationError) as e:
        cls(**kw)
    if field_hint:
        assert field_hint in str(e.value), str(e.value)


# ── reglas de negocio ────────────────────────────────────────────────────────────────────
def test_business_rules_validators():
    ok = UpdateBusinessRulesRequest(min_classes_before_package_change=0, allowed_class_durations=[25, 50], trial_duration_minutes=25,
                                    buffer_regular_minutes=10, meet_link_autogen_minutes=30)
    assert ok.allowed_class_durations == [25, 50]
    assert UpdateBusinessRulesRequest().min_classes_before_package_change is None
    rejects(UpdateBusinessRulesRequest, "negativo", min_classes_before_package_change=-1)
    rejects(UpdateBusinessRulesRequest, "al menos una", allowed_class_durations=[])
    rejects(UpdateBusinessRulesRequest, "allowed_package_durations", allowed_package_durations=[7])
    rejects(UpdateBusinessRulesRequest, "trial_duration_minutes", trial_duration_minutes=7)
    for f in ("buffer_trial_minutes", "buffer_regular_minutes", "buffer_group_minutes"):
        rejects(UpdateBusinessRulesRequest, "0 y 60", **{f: 61})
        rejects(UpdateBusinessRulesRequest, "0 y 60", **{f: -1})
    rejects(UpdateBusinessRulesRequest, "5 y 180", meet_link_autogen_minutes=4)
    rejects(UpdateBusinessRulesRequest, "5 y 180", meet_link_autogen_minutes=181)


# ── paquetes ─────────────────────────────────────────────────────────────────────────────
BASE = dict(name="P", subject="English", price=100.0, classes_count=4, price_per_class=25.0)


def test_package_validators():
    assert PackageCreate(**BASE).price_per_class == 25.0
    assert PackageCreate(name="U", subject="English", price=50.0, price_per_class=9.0).price_per_class is None  # ilimitado
    rejects(PackageCreate, "15-240", **{**BASE, "duration_minutes": 5})
    rejects(PackageCreate, "al menos 2", **{**BASE, "allow_installments": True, "installment_count": 1})
    rejects(PackageCreate, "al menos 1 clase", **{**BASE, "classes_count": 0})
    rejects(PackageCreate, "Tipo de descripción", **{**BASE, "description_type": "tabla"})
    rejects(PackageCreate, "manual", **{**BASE, "group_schedule_mode": "raro"})
    rejects(PackageCreate, "0 (Lunes)", **{**BASE, "group_recurring_days_of_week": [7]})
    rejects(PackageCreate, "HH:MM", **{**BASE, "group_recurring_time_local": "25:99"})
    assert PackageCreate(**{**BASE, "group_recurring_time_local": "18:30", "group_recurring_days_of_week": [0, 6]}).group_recurring_time_local == "18:30"
    assert PackageCreate(**{**BASE, "group_recurring_time_local": None}).group_recurring_time_local is None
    rejects(PackageCreate, "precio de una clase suelta", **{**BASE, "price_per_class": None})
    rejects(PackageCreate, "mayor que 0", **{**BASE, "price_per_class": 0})
    rejects(PackageCreate, "no coincide", **{**BASE, "price_per_class": 30.0})
    rejects(PackageCreate, "cuota debe ser mayor", **{**BASE, "allow_installments": True, "installment_count": 2, "installment_amount": 0})
    rejects(PackageCreate, "última cuota", **{**BASE, "allow_installments": True, "installment_count": 2, "installment_amount": 120.0})
    rejects(PackageCreate, "horario fijo", **{**BASE, "group_schedule_mode": "fixed"})
    assert PackageCreate(**{**BASE, "group_schedule_mode": "fixed", "group_recurring_days_of_week": [1], "group_recurring_time_local": "09:00"})


# ── pagos ────────────────────────────────────────────────────────────────────────────────
def test_payment_validators():
    assert ValidatePaymentRequest(action="approve").action == "approve"
    rejects(ValidatePaymentRequest, "approve", action="otro")
    assert WithdrawalRequest(amount=10, destination_method="paypal", destination_details="a@b.c").amount == 10
    rejects(WithdrawalRequest, "mínimo", amount=9.99, destination_method="paypal", destination_details="x")
    assert ProcessWithdrawalRequest(action="complete").action == "complete"
    rejects(ProcessWithdrawalRequest, "complete", action="x")
    assert ResolveManualGrantRequest(action="reject").action == "reject"
    rejects(ResolveManualGrantRequest, "approve", action="x")
    assert CreateManualGrantRequest(enrollment_id=1, reason="  motivo claro  ").reason == "motivo claro"
    rejects(CreateManualGrantRequest, "mínimo 5", enrollment_id=1, reason="no")
    rejects(CreateManualGrantRequest, "demasiado largo", enrollment_id=1, reason="x" * 1001)
    ok = NotifyPaymentRequest(type="package", change_option="full_refund", installment_index=1)
    assert ok.change_option == "full_refund"
    rejects(NotifyPaymentRequest, "change_option", type="package", change_option="otro")
    rejects(NotifyPaymentRequest, "type debe", type="single_class")
    rejects(NotifyPaymentRequest, "installment_index", type="package", installment_index=0)


# ── TTS ──────────────────────────────────────────────────────────────────────────────────
def test_tts_validators():
    assert TTSWordRequest(word="  hola ").word == "hola"
    rejects(TTSWordRequest, "vacía", word="   ")
    rejects(TTSWordRequest, "larga", word="x" * 101)
    rejects(TTSWordRequest, "Voz inválida", word="a", voice="robot")
    rejects(TTSWordRequest, "velocidad", word="a", speed=5.0)
    assert TTSBatchRequest(words=["a", "b"]).words == ["a", "b"]
    rejects(TTSBatchRequest, "vacía", words=[])
    rejects(TTSBatchRequest, "Máximo", words=["a"] * 51)


# ── clases ───────────────────────────────────────────────────────────────────────────────
def test_class_schema_validators():
    rejects(BookClassRequest, "15-240", enrollment_id=1, start_time_utc=NOW, end_time_utc=NOW, duration_minutes=5)
    rejects(BookTrialRequest, "Duración inválida", teacher_username="t", student_id=1, start_time_utc=NOW, end_time_utc=NOW, subject="x", duration_minutes=500)
    assert UpdateMeetLinkRequest(meet_link="  ").meet_link is None
    assert UpdateMeetLinkRequest(meet_link=None).meet_link is None
    assert UpdateMeetLinkRequest(meet_link=" https://meet.google.com/a ").meet_link == "https://meet.google.com/a"
    rejects(UpdateMeetLinkRequest, meet_link="ftp://x")


# ── perfil de profesor ───────────────────────────────────────────────────────────────────
def test_teacher_profile_validators():
    ok = UpdateTeacherProfileRequest(certificates=None, gallery=None, social_links=None, theme_color=None)
    assert ok.theme_color is None
    assert _short_str_list(None, "skills") is None
    rejects(UpdateTeacherProfileRequest, "Certificado con demasiados", certificates=[{str(i): "x" for i in range(11)}])
    rejects(UpdateTeacherProfileRequest, "Máximo", certificates=[{"a": "b"}] * 21)
    rejects(UpdateTeacherProfileRequest, "no válidos", certificates=[{"a": "x" * 201}])
    rejects(UpdateTeacherProfileRequest, "Máximo", gallery=["https://res.cloudinary.com/x.png"] * 13)
    rejects(UpdateTeacherProfileRequest, "Máximo", social_links={str(i): "https://x.com" for i in range(11)})
    rejects(UpdateTeacherProfileRequest, "demasiado largo", social_links={"a": "https://x.com/" + "y" * 300})
    rejects(UpdateTeacherProfileRequest, "http", social_links={"a": "javascript:alert(1)"})
    rejects(UpdateTeacherProfileRequest, "#RRGGBB", theme_color="rojo")
    assert UpdateTeacherProfileRequest(theme_color="#aabbcc", social_links={"web": "https://x.com", "ig": "@usuario"}).theme_color == "#aabbcc"


# ── soporte y materiales ─────────────────────────────────────────────────────────────────
def test_support_validators():
    rejects(CreateSupportTicketRequest, "category", category="raro", subject="a", message="b")
    rejects(CreateSupportTicketRequest, "asunto no puede", subject="  ", message="b")
    rejects(CreateSupportTicketRequest, "asunto es demasiado", subject="x" * 151, message="b")
    rejects(CreateSupportTicketRequest, "mensaje no puede", subject="a", message=" ")
    rejects(CreateSupportTicketRequest, "mensaje es demasiado", subject="a", message="x" * 2001)
    rejects(CreateClassCorrectionRequest, "demasiado largo", class_id=1, requested_status="completed", reason="x" * 2001)
    rejects(CreateClassCorrectionRequest, "mínimo 10", class_id=1, requested_status="completed", reason="corta")
    rejects(ResolveSupportTicketRequest, "vacía", admin_response="  ")
    rejects(ResolveSupportTicketRequest, "demasiado larga", admin_response="x" * 2001)


def test_material_validators():
    rejects(MaterialCreate, "descripción", title="t", file_url="http://x", file_type="pdf", description="x" * 2001)
    assert MaterialUpdate(title=" Nuevo ", description="ok").title == "Nuevo"
    assert MaterialUpdate().title is None
    rejects(MaterialUpdate, "título", title="  ")
    rejects(MaterialUpdate, "descripción", description="x" * 2001)
