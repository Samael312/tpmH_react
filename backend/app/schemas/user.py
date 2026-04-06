from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime

class UserResponse(BaseModel):
    """Datos del usuario que devuelve la API (nunca el password)"""
    id: int
    email: EmailStr
    name: str
    surname: str
    role: str
    avatar: Optional[str]
    is_active: bool
    is_verified: bool
    created_at: datetime

    class Config:
        from_attributes = True  # Permite convertir objetos SQLAlchemy a JSON