from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timedelta

from app.db.base import get_db
from app.auth.dependencies import (
    get_current_user,
    get_current_teacher,
    get_current_student,
)
from app.models.user import User
from app.models.class_ import Class
from app.models.package import Enrollment
from app.models.student import StudentProfile
from app.models.teacher import TeacherProfile
from app.schemas.classes import (
    BookClassRequest,
    RescheduleClassRequest,
    UpdateClassStatusRequest,
    ClassResponse,
    ClassListResponse,
)
from app.core.timezone import utc_now, UTC
from app.core.class_logic import (
    can_book_slot,
    can_cancel_class,
    can_reschedule_class,
    update_enrollment_counter,
)

router = APIRouter()


# ─── ENDPOINTS DEL ESTUDIANTE ───────────────────────────────────────────────

@router.post(
    "/book",
    response_model=ClassResponse,
    status_code=status.HTTP_201_CREATED
)
def book_class(
    data: BookClassRequest,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    """
    El estudiante agenda una clase en un slot disponible.

    Proceso:
    1. Verifica que el enrollment existe y pertenece al estudiante
    2. Verifica que quedan clases en el paquete
    3. Verifica que el slot está disponible
    4. Crea la clase
    """

    # 1. Verificar enrollment
    enrollment = db.query(Enrollment).filter(
        Enrollment.id == data.enrollment_id,
        Enrollment.student_id == current_user.student_profile.id,
        Enrollment.status == "active"
    ).first()

    if not enrollment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Enrollment no encontrado o no activo"
        )

    # 2. Verificar que quedan clases
    if enrollment.classes_used >= enrollment.classes_total:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Has agotado todas las clases de este paquete"
        )

    # 3. Verificar disponibilidad del slot
    can_book, error_msg = can_book_slot(
        start_time_utc=data.start_time_utc,
        teacher_id=enrollment.teacher_id,
        student_id=current_user.student_profile.id,
        db=db
    )

    if not can_book:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=error_msg
        )

    # 4. Crear la clase
    new_class = Class(
        enrollment_id=enrollment.id,
        teacher_id=enrollment.teacher_id,
        student_id=current_user.student_profile.id,
        start_time_utc=data.start_time_utc,
        end_time_utc=data.end_time_utc,
        duration=data.duration_minutes,
        teacher_timezone=enrollment.teacher.user.teacher_profile.timezone,
        student_timezone=current_user.student_profile.timezone,
        status="pending"
    )

    db.add(new_class)
    db.commit()
    db.refresh(new_class)

    return new_class


@router.get(
    "/my-classes",
    response_model=ClassListResponse
)
def get_my_classes_student(
    include_history: bool = Query(False),
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    """
    Devuelve las clases del estudiante.
    Por defecto solo devuelve próximas clases.
    Con include_history=true devuelve también el historial.
    """
    now = utc_now()
    student_id = current_user.student_profile.id

    query = db.query(Class).filter(
        Class.student_id == student_id
    )

    if not include_history:
        # Solo clases activas o futuras
        query = query.filter(
            Class.status.in_(["pending", "confirmed"]),
            Class.start_time_utc >= now
        )
    
    all_classes = query.order_by(Class.start_time_utc).all()

    # Contadores
    upcoming = sum(
        1 for c in all_classes
        if c.status in ["pending", "confirmed"] and c.start_time_utc >= now
    )
    completed = sum(1 for c in all_classes if c.status == "completed")

    return ClassListResponse(
        classes=all_classes,
        total=len(all_classes),
        upcoming=upcoming,
        completed=completed
    )


@router.delete("/{class_id}")
def cancel_class_student(
    class_id: int,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    """
    El estudiante cancela una clase.
    Solo con 24h de antelación mínima.
    """
    class_ = db.query(Class).filter(
        Class.id == class_id,
        Class.student_id == current_user.student_profile.id
    ).first()

    if not class_:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Clase no encontrada"
        )

    can_cancel, error_msg = can_cancel_class(class_, current_user.id)
    if not can_cancel:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_msg
        )

    class_.status = "cancelled"
    db.commit()

    return {"message": "Clase cancelada correctamente"}


@router.patch("/{class_id}/reschedule", response_model=ClassResponse)
def reschedule_class_student(
    class_id: int,
    data: RescheduleClassRequest,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    """
    El estudiante reagenda una clase a un nuevo horario.
    Solo con 24h de antelación mínima.
    """
    class_ = db.query(Class).filter(
        Class.id == class_id,
        Class.student_id == current_user.student_profile.id
    ).first()

    if not class_:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Clase no encontrada"
        )

    # Verificar que se puede reagendar
    can_reschedule, error_msg = can_reschedule_class(class_)
    if not can_reschedule:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_msg
        )

    # Verificar que el nuevo slot está disponible
    duration = int(
        (class_.end_time_utc - class_.start_time_utc).total_seconds() / 60
    )
    can_book, error_msg = can_book_slot(
        start_time_utc=data.start_time_utc,
        teacher_id=class_.teacher_id,
        student_id=current_user.student_profile.id,
        db=db,
        exclude_class_id=class_id  # Excluir la clase actual
    )

    if not can_book:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=error_msg
        )

    # Actualizar horario
    class_.start_time_utc = data.start_time_utc
    class_.end_time_utc = data.end_time_utc
    class_.status = "pending"  # Vuelve a pending tras reagendar

    db.commit()
    db.refresh(class_)

    return class_


# ─── ENDPOINTS DEL PROFESOR ─────────────────────────────────────────────────

@router.get(
    "/teacher/classes",
    response_model=ClassListResponse
)
def get_my_classes_teacher(
    date: Optional[str] = Query(None, description="Filtrar por fecha YYYY-MM-DD"),
    status_filter: Optional[str] = Query(None, description="Filtrar por estado"),
    include_history: bool = Query(False),
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db)
):
    """
    Devuelve las clases del profesor con filtros opcionales.
    """
    now = utc_now()
    teacher_id = current_user.teacher_profile.id

    query = db.query(Class).filter(Class.teacher_id == teacher_id)

    # Filtro por fecha
    if date:
        try:
            dt = datetime.strptime(date, "%Y-%m-%d")
            day_start = dt.replace(tzinfo=UTC)
            day_end = day_start + timedelta(days=1)
            query = query.filter(
                Class.start_time_utc >= day_start,
                Class.start_time_utc < day_end
            )
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Formato de fecha inválido. Usa YYYY-MM-DD"
            )

    # Filtro por estado
    if status_filter:
        query = query.filter(Class.status == status_filter)

    # Sin historial por defecto
    if not include_history:
        query = query.filter(
            Class.status.in_(["pending", "confirmed"]),
            Class.start_time_utc >= now
        )

    all_classes = query.order_by(Class.start_time_utc).all()

    upcoming = sum(
        1 for c in all_classes
        if c.status in ["pending", "confirmed"] and c.start_time_utc >= now
    )
    completed = sum(1 for c in all_classes if c.status == "completed")

    return ClassListResponse(
        classes=all_classes,
        total=len(all_classes),
        upcoming=upcoming,
        completed=completed
    )


@router.patch(
    "/{class_id}/status",
    response_model=ClassResponse
)
def update_class_status(
    class_id: int,
    data: UpdateClassStatusRequest,
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db)
):
    """
    El profesor actualiza el estado de una clase.
    Al marcar como 'completed' actualiza el contador del enrollment.
    """
    class_ = db.query(Class).filter(
        Class.id == class_id,
        Class.teacher_id == current_user.teacher_profile.id
    ).first()

    if not class_:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Clase no encontrada"
        )

    old_status = class_.status
    new_status = data.status

    class_.status = new_status

    # Si pasa a completada incrementamos el contador
    if new_status == "completed" and old_status != "completed":
        update_enrollment_counter(class_.enrollment_id, delta=1, db=db)

    # Si se deshace una completada decrementamos
    if old_status == "completed" and new_status != "completed":
        update_enrollment_counter(class_.enrollment_id, delta=-1, db=db)

    db.commit()
    db.refresh(class_)

    return class_


@router.patch(
    "/{class_id}/notes",
    response_model=ClassResponse
)
def add_class_notes(
    class_id: int,
    notes: str,
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db)
):
    """El profesor añade notas a una clase"""
    class_ = db.query(Class).filter(
        Class.id == class_id,
        Class.teacher_id == current_user.teacher_profile.id
    ).first()

    if not class_:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Clase no encontrada"
        )

    class_.notes = notes
    db.commit()
    db.refresh(class_)

    return class_