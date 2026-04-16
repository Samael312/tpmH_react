from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime

class UserBase(BaseModel):
    username: str
    name: str
    surname: str
    email: EmailStr
    role: str

class UserResponse(UserBase):
    id: int
    timezone: Optional[str]            = "UTC"
    goal: Optional[str]                = None
    preferred_payment_methods: Optional[List[str]] = []
    onboarding_completed: bool         = False
    avatar_url: Optional[str]          = None

    class Config:
        from_attributes = True

class UserUpdate(BaseModel):
    name:    Optional[str]      = None
    surname: Optional[str]      = None
    email:   Optional[EmailStr] = None
    onboarding_completed: Optional[bool] = None

class StudentProfileUpdate(BaseModel):
    timezone:                   Optional[str]       = None
    goal:                       Optional[str]       = None
    preferred_payment_methods:  Optional[List[str]] = None

class UserResponse(BaseModel):
    id: int
    username: str
    email: EmailStr
    name: str
    surname: str
    role: str
    avatar: Optional[str]
    is_active: bool
    is_verified: bool
    created_at: datetime

    class Config:
        from_attributes = True


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
    timezone: Optional[str] = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class StudentProfileResponse(BaseModel):
    id: int
    user_id: int
    timezone: Optional[str]
    goal: Optional[str]
    preferred_payment_methods: Optional[List[str]]
    created_at: datetime

    class Config:
        from_attributes = True