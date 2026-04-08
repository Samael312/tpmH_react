from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import datetime


# ─── Materiales ─────────────────────────────────────────────────────────────

class MaterialCreate(BaseModel):
    title: str
    description: Optional[str] = None
    category: str
    level: Optional[str] = None
    vocabulary_words: Optional[List[str]] = None

    @field_validator("category")
    @classmethod
    def validate_category(cls, v):
        allowed = ["grammar", "vocabulary", "reading", "exercises", "other"]
        if v not in allowed:
            raise ValueError(f"Categoría inválida. Opciones: {allowed}")
        return v

    @field_validator("level")
    @classmethod
    def validate_level(cls, v):
        if v is None:
            return v
        allowed = ["A1", "A2", "B1", "B2", "C1", "C2"]
        if v not in allowed:
            raise ValueError(f"Nivel inválido. Opciones: {allowed}")
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
    vocabulary_words: Optional[List[str]]
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class AssignMaterialRequest(BaseModel):
    """Asignar un material a uno o varios estudiantes"""
    student_ids: List[int]


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