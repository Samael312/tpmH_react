from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime

from app.db.base import get_db
from app.auth.dependencies import get_current_teacher, get_current_student
from app.models.user import User
from app.models.homework import Homework, HomeworkAssignment
from app.models.student import StudentProfile
from app.core.timezone import utc_now
from app.schemas.homework import (
    HomeworkCreate,
    HomeworkResponse,
    HomeworkAssignmentResponse,
    SubmitHomeworkRequest,
    GradeHomeworkRequest,
)

router = APIRouter()


# ─── ENDPOINTS DEL PROFESOR ─────────────────────────────────────────────────

@router.post(
    "/",
    response_model=HomeworkResponse,
    status_code=status.HTTP_201_CREATED
)
def create_homework(
    data: HomeworkCreate,
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db)
):
    """
    El profesor crea una tarea y la asigna a estudiantes.
    Todo en una sola llamada.
    """

    # Crear la tarea
    homework = Homework(
        teacher_id=current_user.teacher_profile.id,
        title=data.title,
        description=data.description,
        due_date_utc=data.due_date_utc,
    )
    db.add(homework)
    db.flush()  # Obtener id antes del commit

    # Asignar a los estudiantes
    assigned_count = 0
    for student_id in data.student_ids:
        student = db.query(StudentProfile).filter(
            StudentProfile.id == student_id
        ).first()

        if not student:
            continue

        assignment = HomeworkAssignment(
            homework_id=homework.id,
            student_id=student_id,
        )
        db.add(assignment)
        assigned_count += 1

    db.commit()
    db.refresh(homework)

    return homework


@router.get(
    "/my-homework",
    response_model=List[HomeworkResponse]
)
def get_my_homework_teacher(
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db)
):
    """Devuelve todas las tareas creadas por el profesor"""
    return db.query(Homework).filter(
        Homework.teacher_id == current_user.teacher_profile.id,
        Homework.is_active == True
    ).order_by(Homework.due_date_utc.desc()).all()


@router.get(
    "/{homework_id}/submissions",
    response_model=List[HomeworkAssignmentResponse]
)
def get_homework_submissions(
    homework_id: int,
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db)
):
    """El profesor ve todas las entregas de una tarea"""
    homework = db.query(Homework).filter(
        Homework.id == homework_id,
        Homework.teacher_id == current_user.teacher_profile.id
    ).first()

    if not homework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tarea no encontrada"
        )

    return db.query(HomeworkAssignment).filter(
        HomeworkAssignment.homework_id == homework_id
    ).all()


@router.patch(
    "/{homework_id}/submissions/{assignment_id}/grade"
)
def grade_homework(
    homework_id: int,
    assignment_id: int,
    data: GradeHomeworkRequest,
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db)
):
    """El profesor califica una entrega"""
    assignment = db.query(HomeworkAssignment).filter(
        HomeworkAssignment.id == assignment_id,
        HomeworkAssignment.homework_id == homework_id,
    ).first()

    if not assignment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Entrega no encontrada"
        )

    # Verificar que la tarea pertenece al profesor
    homework = db.query(Homework).filter(
        Homework.id == homework_id,
        Homework.teacher_id == current_user.teacher_profile.id
    ).first()

    if not homework:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permiso para calificar esta tarea"
        )

    assignment.score = data.score
    assignment.feedback = data.feedback
    assignment.status = "graded"
    assignment.graded_at = utc_now()

    db.commit()

    return {"message": "Tarea calificada correctamente", "score": data.score}


# ─── ENDPOINTS DEL ESTUDIANTE ───────────────────────────────────────────────

@router.get(
    "/student/my-homework",
    response_model=List[HomeworkAssignmentResponse]
)
def get_my_homework_student(
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    """
    Devuelve todas las tareas del estudiante.
    Incluye tareas pendientes e historial.
    """
    return db.query(HomeworkAssignment).filter(
        HomeworkAssignment.student_id == current_user.student_profile.id
    ).join(Homework).filter(
        Homework.is_active == True
    ).order_by(Homework.due_date_utc.asc()).all()


@router.post(
    "/student/{assignment_id}/submit"
)
def submit_homework(
    assignment_id: int,
    data: SubmitHomeworkRequest,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    """El estudiante entrega una tarea"""
    assignment = db.query(HomeworkAssignment).filter(
        HomeworkAssignment.id == assignment_id,
        HomeworkAssignment.student_id == current_user.student_profile.id
    ).first()

    if not assignment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tarea no encontrada"
        )

    if assignment.status == "graded":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Esta tarea ya fue calificada y no puede modificarse"
        )

    # Verificar que no pasó la fecha límite
    homework = assignment.homework
    if utc_now() > homework.due_date_utc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La fecha límite de esta tarea ya pasó"
        )

    assignment.submission = data.submission
    assignment.status = "submitted"
    assignment.submitted_at = utc_now()

    db.commit()

    return {"message": "Tarea entregada correctamente"}