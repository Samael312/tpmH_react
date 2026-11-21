import re
from zoneinfo import ZoneInfo
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime
from pydantic import field_validator
from app.core.spoken_languages import read_spoken_languages
from app.schemas.user import SpokenLanguageItem
from app.schemas.validators import check_cloudinary_url


class TeacherPublicResponse(BaseModel):
    """
    Lo que ve cualquier visitante del perfil de un profesor.
    No incluye datos sensibles como balance o stripe_account_id.
    """
    id: int
    user_username: str
    name: Optional[str] = None
    surname: Optional[str] = None
    nationality: Optional[str] = None
    bio: Optional[str]
    title: Optional[str]
    timezone: Optional[str]
    languages: Optional[List[str]]
    subjects: Optional[List[str]]
    skills: Optional[List[str]]
    certificates: Optional[List[Dict[str, Any]]]
    gallery: Optional[List[str]]
    social_links: Optional[Dict[str, str]]
    status: str
    profile_photo_url: Optional[str] = None
    video_url: Optional[str] = None
    theme_color: Optional[str] = "#ec4899"
    # Fase 8: idiomas que HABLA (viven en User; distintos de `languages`, los que ensena)
    spoken_languages: List[SpokenLanguageItem] = []

    @field_validator("spoken_languages", mode="before")
    @classmethod
    def _coerce_spoken(cls, v):
        return read_spoken_languages(v)

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
    video_public_id: Optional[str] = None
    video_pending_rejection_reason: Optional[str] = None
    video_pending_appeal_used: bool = False
    video_pending_url: Optional[str] = None  # Fase 23: video nuevo en revision (solo el propio profesor/staff)

    # ─── Retroalimentación de rechazo / apelaciones ───
    rejection_reason: Optional[str] = None
    rejection_feedback_seen: bool = True
    appeal_count: int = 0
    appeal_exhausted: bool = False

MAX_BIO = 2000
MAX_TITLE = 150
MAX_LIST_ITEMS = 30
MAX_ITEM_CHARS = 60
MAX_CERTIFICATES = 20
MAX_GALLERY = 12
MAX_SOCIAL_LINKS = 10
_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def _short_str_list(v, what):
    if v is None:
        return v
    if len(v) > MAX_LIST_ITEMS:
        raise ValueError(f"{what}: máximo {MAX_LIST_ITEMS} elementos")
    out = []
    for item in v:
        item = item.strip()
        if not item or len(item) > MAX_ITEM_CHARS:
            raise ValueError(f"{what}: cada elemento debe tener entre 1 y {MAX_ITEM_CHARS} caracteres")
        out.append(item)
    return out


class UpdateTeacherProfileRequest(BaseModel):
    """Todos opcionales porque es PATCH. Validación de TE-13 (Fase 21): tamaños, formato y hosts permitidos."""
    bio: Optional[str] = None
    title: Optional[str] = None
    timezone: Optional[str] = None
    subjects: Optional[List[str]] = None
    languages: Optional[List[str]] = None
    skills: Optional[List[str]] = None
    certificates: Optional[List[Dict[str, Any]]] = None
    gallery: Optional[List[str]] = None
    social_links: Optional[Dict[str, str]] = None
    theme_color: Optional[str] = None

    @field_validator("bio")
    @classmethod
    def _bio(cls, v):
        if v is not None and len(v) > MAX_BIO:
            raise ValueError(f"La biografía es demasiado larga (máx. {MAX_BIO} caracteres)")
        return v

    @field_validator("title")
    @classmethod
    def _title(cls, v):
        if v is not None and len(v) > MAX_TITLE:
            raise ValueError(f"El título es demasiado largo (máx. {MAX_TITLE} caracteres)")
        return v

    @field_validator("timezone")
    @classmethod
    def _timezone(cls, v):
        # Fase 27 (Z3): omitir el campo vale (PATCH), pero un null/vacio explicito NUNCA se guarda:
        # dejaba la zona en NULL y el siguiente cambio de zona se saltaba el recalculo del horario.
        if v is None or not str(v).strip():
            raise ValueError("La zona horaria no puede estar vacía")
        v = v.strip()
        try:
            ZoneInfo(v)
        except Exception:
            raise ValueError("Zona horaria no válida")
        return v

    @field_validator("subjects", "languages", "skills")
    @classmethod
    def _lists(cls, v, info):
        return _short_str_list(v, info.field_name)

    @field_validator("certificates")
    @classmethod
    def _certificates(cls, v):
        if v is None:
            return v
        if len(v) > MAX_CERTIFICATES:
            raise ValueError(f"Máximo {MAX_CERTIFICATES} certificados")
        for cert in v:
            if len(cert) > 10:
                raise ValueError("Certificado con demasiados campos")
            for key, val in cert.items():
                if len(str(key)) > 40 or not isinstance(val, (str, int, float, bool, type(None))) or len(str(val)) > 200:
                    raise ValueError("Certificado con campos no válidos o demasiado largos")
        return v

    @field_validator("gallery")
    @classmethod
    def _gallery(cls, v):
        if v is None:
            return v
        if len(v) > MAX_GALLERY:
            raise ValueError(f"Máximo {MAX_GALLERY} imágenes en la galería")
        return [check_cloudinary_url(u) for u in v if u]

    @field_validator("social_links")
    @classmethod
    def _social_links(cls, v):
        if v is None:
            return v
        if len(v) > MAX_SOCIAL_LINKS:
            raise ValueError(f"Máximo {MAX_SOCIAL_LINKS} enlaces")
        for key, val in v.items():
            if len(key) > 30 or len(val) > 300:
                raise ValueError("Enlace demasiado largo")
            # un valor con esquema (algo:) solo puede ser http/https: nada de javascript:, data:, etc.
            if re.match(r"^\s*[a-zA-Z][a-zA-Z0-9+.-]*:", val) and not re.match(r"^\s*https?://", val, re.I):
                raise ValueError("Los enlaces deben empezar por http:// o https://")
        return v

    @field_validator("theme_color")
    @classmethod
    def _theme_color(cls, v):
        if v is None:
            return v
        if not _COLOR_RE.match(v):
            raise ValueError("El color debe tener el formato #RRGGBB")
        return v
