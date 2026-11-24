from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import datetime


# ─── Materiales ─────────────────────────────────────────────────────────────

MATERIAL_CATEGORIES = ["grammar", "vocabulary", "reading", "exercises", "other"]
MATERIAL_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]
MAX_TITLE = 200
MAX_DESCRIPTION = 2000


def check_material_category(v):
    if v not in MATERIAL_CATEGORIES:
        raise ValueError(f"Categoría inválida. Opciones: {MATERIAL_CATEGORIES}")
    return v


def check_material_level(v):
    if v is None or v == "":
        return None
    if v not in MATERIAL_LEVELS:
        raise ValueError(f"Nivel inválido. Opciones: {MATERIAL_LEVELS}")
    return v


class MaterialCreate(BaseModel):
    title: str
    description: Optional[str] = None
    category: str
    level: Optional[str] = None
    vocabulary_words: Optional[List[str]] = None

    @field_validator("category")
    @classmethod
    def validate_category(cls, v):
        return check_material_category(v)

    @field_validator("level")
    @classmethod
    def validate_level(cls, v):
        return check_material_level(v)

    @field_validator("title")
    @classmethod
    def validate_title(cls, v):
        v = v.strip()
        if not v or len(v) > MAX_TITLE:
            raise ValueError(f"El título es obligatorio (máx. {MAX_TITLE} caracteres)")
        return v

    @field_validator("description")
    @classmethod
    def validate_description(cls, v):
        if v is not None and len(v) > MAX_DESCRIPTION:
            raise ValueError(f"La descripción es demasiado larga (máx. {MAX_DESCRIPTION} caracteres)")
        return v


class MaterialResponse(BaseModel):
    id: int
    teacher_id: int
    title: str
    description: Optional[str]
    category: str
    level: Optional[str]
    file_url: Optional[str]
    file_type: Optional[str]
    file_size: Optional[int] = None
    vocabulary_words: Optional[List[str]]
    language: Optional[str] = None  # idioma del vocabulario (catálogo); nulo en los antiguos
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class AssignMaterialRequest(BaseModel):
    """
    Asignar un material a uno o varios estudiantes individuales y/o a una
    cohorte grupal completa (cohort_id). Si se pasa cohort_id, el material
    se asigna a todos los integrantes activos de esa cohorte además de los
    student_ids indicados explícitamente (unión de ambos, sin duplicados).
    Al menos uno de los dos debe tener contenido.
    """
    student_ids: List[int] = []
    cohort_id: Optional[int] = None


class MaterialAssignmentResponse(BaseModel):
    id: int
    material_id: int
    student_id: int
    progress: str
    assigned_at: datetime
    completed_at: Optional[datetime]
    material: MaterialResponse

    class Config:
        from_attributes = True


class UpdateProgressRequest(BaseModel):
    progress: str

    @field_validator("progress")
    @classmethod
    def validate_progress(cls, v):
        allowed = ["not_started", "in_progress", "completed"]
        if v not in allowed:
            raise ValueError(f"Estado inválido. Opciones: {allowed}")
        return v

class MaterialUpdate(BaseModel):
    """
    Edición de los datos de un material ya existente.
    Todos los campos son opcionales porque es un PATCH parcial.
    No permite reemplazar el archivo — para eso se sube un material nuevo.
    """
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    level: Optional[str] = None
 
    @field_validator("title")
    @classmethod
    def validate_title(cls, v):
        if v is not None and (not v.strip() or len(v.strip()) > MAX_TITLE):
            raise ValueError(f"El título no puede estar vacío ni pasar de {MAX_TITLE} caracteres")
        return v.strip() if v is not None else v

    @field_validator("description")
    @classmethod
    def validate_description(cls, v):
        if v is not None and len(v) > MAX_DESCRIPTION:
            raise ValueError(f"La descripción es demasiado larga (máx. {MAX_DESCRIPTION} caracteres)")
        return v

    @field_validator("category")
    @classmethod
    def validate_category(cls, v):
        return None if v is None else check_material_category(v)

    @field_validator("level")
    @classmethod
    def validate_level(cls, v):
        return check_material_level(v)