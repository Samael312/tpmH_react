from pydantic import BaseModel, EmailStr

class RegisterRequest(BaseModel):
    """Datos necesarios para registrarse"""
    email: EmailStr        # Valida que sea un email real
    username: str         # Nuevo campo para el nombre de usuario
    password: str
    name: str
    surname: str
    role: str = "student"  # Por defecto es estudiante

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