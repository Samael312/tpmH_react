from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional

class GoogleAuthResponse(BaseModel):
    """Respuesta de /auth/google — puede ser un login exitoso o una señal de que falta completar el registro"""
    needs_registration: bool = False
    access_token: Optional[str] = None
    token_type: str = "bearer"
    role: Optional[str] = None
    name: Optional[str] = None
    username: Optional[str] = None
    email: Optional[EmailStr] = None
    surname: Optional[str] = None
    avatar: Optional[str] = None


class GoogleRegisterRequest(BaseModel):
    """El frontend reenvía el id_token (se revalida) junto con los datos que faltaban"""
    id_token: str
    username: str
    role: str  # obligatorio — el usuario lo elige en la pantalla intermedia (student|teacher)

    @field_validator("role")
    @classmethod
    def validate_role(cls, v):
        if v not in ("student", "teacher"):
            raise ValueError("El rol debe ser 'student' o 'teacher'")
        return v

    @field_validator("username")
    @classmethod
    def validate_username(cls, v):
        v = v.strip().lower()
        if not v:
            raise ValueError("El usuario no puede estar vacío")
        return v

class RegisterRequest(BaseModel):
    email: EmailStr
    username: str
    password: str
    name: str
    surname: str
    role: str = "student"

    @field_validator("username")
    @classmethod
    def validate_username(cls, v):
        v = v.strip().lower()
        if not v:
            raise ValueError("El usuario no puede estar vacío")
        return v

    @field_validator("role")
    @classmethod
    def validate_role(cls, v):
        if v not in ("student", "teacher"):
            raise ValueError("El rol debe ser 'student' o 'teacher'")
        return v

class LoginRequest(BaseModel):
    """Datos para hacer login"""
    login: str
    password: str

class TokenResponse(BaseModel):
    """Lo que devuelve el servidor al hacer login"""
    access_token: str
    token_type: str = "bearer"
    role: str
    name: str
    username: str

class GoogleAuthRequest(BaseModel):
    """Token que manda Google después del login"""
    id_token: str

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class ForgotUsernameRequest(BaseModel):
    email: EmailStr

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_password(cls, v):
        if len(v) < 8:
            raise ValueError("La contraseña debe tener al menos 8 caracteres")
        return v