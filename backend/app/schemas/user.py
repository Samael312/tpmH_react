from pydantic import BaseModel, EmailStr, field_validator, Field, computed_field
from typing import Optional, List
from datetime import datetime

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

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_password(cls, v):
        if len(v) < 8:
            raise ValueError("La contraseña debe tener al menos 8 caracteres")
        return v


