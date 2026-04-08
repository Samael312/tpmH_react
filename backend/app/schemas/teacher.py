from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime


class TeacherPublicResponse(BaseModel):
    """
    Lo que ve cualquier visitante del perfil de un profesor.
    No incluye datos sensibles como balance o stripe_account_id.
    """
    id: int
    user_username: str
    bio: Optional[str]
    title: Optional[str]
    timezone: Optional[str]
    languages: Optional[List[str]]
    skills: Optional[List[str]]
    certificates: Optional[List[Dict[str, Any]]]
    gallery: Optional[List[str]]
    social_links: Optional[Dict[str, str]]
    status: str

    class Config:
        from_attributes = True


class TeacherProfileResponse(TeacherPublicResponse):
    """
    Perfil completo — solo lo ve el propio profesor y el superadmin.
    Hereda TeacherPublicResponse y añade campos privados.
    """
    commission_rate: float
    balance: float
    stripe_account_id: Optional[str]
    created_at: datetime


class UpdateTeacherProfileRequest(BaseModel):
    """Todos opcionales porque es PATCH"""
    bio: Optional[str] = None
    title: Optional[str] = None
    timezone: Optional[str] = None
    languages: Optional[List[str]] = None
    skills: Optional[List[str]] = None
    certificates: Optional[List[Dict[str, Any]]] = None
    gallery: Optional[List[str]] = None
    social_links: Optional[Dict[str, str]] = None