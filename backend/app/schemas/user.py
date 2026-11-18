from pydantic import BaseModel, EmailStr, field_validator, Field, computed_field
from typing import Any, Optional, List
from datetime import datetime
from app.core.spoken_languages import read_spoken_languages


class SpokenLanguageItem(BaseModel):
    """Idioma que habla el usuario y su nivel (native|fluent|intermediate|basic; nulo en datos antiguos)."""
    language: str
    level: Optional[str] = None

# --- BASE ---
class UserBase(BaseModel):
    username: str
    name: str
    surname: str
    phone_number: str
    email: EmailStr
    role: str

# --- RESPUESTAS ---
# Hemos fusionado los dos UserResponse en uno solo que hereda de UserBase
class UserResponse(UserBase):
    id: int
    avatar: Optional[str] = None
    is_active: bool
    is_verified: bool
    created_at: datetime

    phone_number: Optional[str] = None
    nationality: Optional[str] = None
    onboarding_completed: bool = False
    spoken_languages: List[SpokenLanguageItem] = []

    @field_validator("spoken_languages", mode="before")
    @classmethod
    def _coerce_spoken(cls, v):
        return read_spoken_languages(v)

    # Se usa únicamente para calcular is_google_account (abajo); no se
    # expone el id de Google en sí en la respuesta (exclude=True).
    google_id: Optional[str] = Field(default=None, exclude=True)

    class Config:
        from_attributes = True

    @computed_field
    @property
    def is_google_account(self) -> bool:
        """
        True si el usuario se registró/vinculó con Google. El frontend usa
        esto para bloquear la edición del email: ese email viene de la
        cuenta de Google y cambiarlo aquí lo desincronizaría del login.
        """
        return bool(self.google_id)

class StudentProfileResponse(BaseModel):
    id: int
    user_id: int
    timezone: Optional[str] = None
    goal: Optional[str] = None
    phone_number: Optional[str] = None
    preferred_payment_methods: Optional[List[str]] = []
    teacher_username: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


# --- PETICIONES (REQUESTS / UPDATES) ---
class UserUpdate(BaseModel):
    name: Optional[str] = None
    surname: Optional[str] = None
    phone_number: Optional[str] = None
    email: Optional[EmailStr] = None
    nationality: Optional[str] = None
    onboarding_completed: Optional[bool] = None

class StudentProfileUpdate(BaseModel):
    timezone: Optional[str] = None
    goal: Optional[str] = None
    phone_number: Optional[str] = None
    preferred_payment_methods: Optional[List[str]] = None
    nationality: Optional[str] = None

class UpdateProfileRequest(BaseModel):
    """
    Todos los campos son opcionales porque es PATCH.
    Solo se actualizan los que se envían.
    """
    username: Optional[str] = None
    email: Optional[EmailStr] = None
    name: Optional[str] = None
    surname: Optional[str] = None
    avatar: Optional[str] = None
    phone_number: Optional[str] = None
    timezone: Optional[str] = None
    nationality: Optional[str] = None
    onboarding_completed: Optional[bool] = None
    # Fase 8: se valida contra el catalogo `spoken_languages` en el endpoint (core/spoken_languages.py)
    spoken_languages: Optional[List[Any]] = None

class DeleteAccountRequest(BaseModel):
    """
    SEC-06: borrar la cuenta exige re-autenticarse (un token robado ya no basta para anonimizarla).
    `password` es obligatoria si la cuenta tiene contrasena; las cuentas solo-Google confirman con su usuario.
    """
    password: Optional[str] = None
    confirm_username: str


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str = Field(max_length=128)

    @field_validator("new_password")
    @classmethod
    def validate_password(cls, v):
        if len(v) < 8:
            raise ValueError("La contraseña debe tener al menos 8 caracteres")
        return v


