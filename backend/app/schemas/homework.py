from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import datetime


# ─── Tareas ─────────────────────────────────────────────────────────────────

class HomeworkCreate(BaseModel):
    title: str
    description: str
    due_date_utc: datetime
    student_ids: List[int]  # A quién se asigna


class HomeworkResponse(BaseModel):
    id: int
    teacher_id: int
    title: str
    description: str
    due_date_utc: datetime
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class HomeworkAssignmentResponse(BaseModel):
    """Lo que ve el estudiante de una tarea"""
    id: int
    homework_id: int
    student_id: int
    status: str
    submission: Optional[str]
    submitted_at: Optional[datetime]
    score: Optional[float]
    feedback: Optional[str]
    graded_at: Optional[datetime]
    assigned_at: datetime
    homework: HomeworkResponse

    class Config:
        from_attributes = True


class SubmitHomeworkRequest(BaseModel):
    """El estudiante envía su respuesta"""
    submission: str


class GradeHomeworkRequest(BaseModel):
    """El profesor califica una tarea"""
    score: float
    feedback: Optional[str] = None

    @field_validator("score")
    @classmethod
    def validate_score(cls, v):
        if not 0.0 <= v <= 10.0:
            raise ValueError("La nota debe estar entre 0 y 10")
        return v