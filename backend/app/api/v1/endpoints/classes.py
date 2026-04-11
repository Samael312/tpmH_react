from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timedelta

from app.db.base import get_db
from app.auth.dependencies import (
    get_current_user,
    get_current_teacher_or_professor_admin,
    get_current_student,
    get_current_staff,
)
from app.models.user import User
from app.models.class_ import Class, ClassType
from app.models.package import Enrollment, EnrollmentStatus
from app.models.student import StudentProfile
from app.models.teacher import TeacherProfile
from app.schemas.classes import (
    BookClassRequest,
    BookTrialRequest,
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


# ─── ESTUDIANTE ──────────────────────────────────────────────────────────────

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
    Reserva una clase regular.
    El slot queda en 'pending' y BLOQUEA el calendario
    inmediatamente — nadie más puede reservar ese horario.
    """
    enrollment = db.query(Enrollment).filter(
        Enrollment.id == data.enrollment_id,
        Enrollment.student_id == current_user.student_profile.id,
        Enrollment.status == EnrollmentStatus.active
    ).first()

    if not enrollment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Enrollment no encontrado o no activo"
        )

    if enrollment.classes_used >= enrollment.classes_total:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Has agotado todas las clases de este paquete. "
                   "Solicita una renovación desde tu dashboard."
        )

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

    new_class = Class(
        enrollment_id=enrollment.id,
        teacher_id=enrollment.teacher_id,
        student_id=current_user.student_profile.id,
        class_type=ClassType.regular,
        subject=enrollment.package.subject,
        start_time_utc=data.start_time_utc,
        end_time_utc=data.end_time_utc,
        duration=data.duration_minutes,
        teacher_timezone=enrollment.teacher.timezone
            if hasattr(enrollment.teacher, 'timezone') else None,
        student_timezone=current_user.student_profile.timezone,
        status="pending"
    )

    db.add(new_class)
    db.commit()
    db.refresh(new_class)
    return new_class


@router.get("/my-classes", response_model=ClassListResponse)
def get_my_classes_student(
    include_history: bool = Query(False),
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    """Clases del estudiante — próximas e historial"""
    now = utc_now()
    student_id = current_user.student_profile.id

    query = db.query(Class).filter(Class.student_id == student_id)

    if not include_history:
        query = query.filter(
            Class.status.in_([
                "pending", "pending_payment", "confirmed"
            ]),
            Class.start_time_utc >= now
        )

    all_classes = query.order_by(Class.start_time_utc).all()

    upcoming = sum(
        1 for c in all_classes
        if c.status in ["pending", "pending_payment", "confirmed"]
        and c.start_time_utc >= now
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
    """Cancelar clase — mínimo 12h de antelación"""
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
    return {"message": "Clase cancelada"}


@router.patch("/{class_id}/reschedule", response_model=ClassResponse)
def reschedule_class_student(
    class_id: int,
    data: RescheduleClassRequest,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    """Reagendar clase — mínimo 12h de antelación"""
    class_ = db.query(Class).filter(
        Class.id == class_id,
        Class.student_id == current_user.student_profile.id
    ).first()

    if not class_:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Clase no encontrada"
        )

    can_reschedule, error_msg = can_reschedule_class(class_, role="student")
    if not can_reschedule:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_msg
        )

    can_book, error_msg = can_book_slot(
        start_time_utc=data.start_time_utc,
        teacher_id=class_.teacher_id,
        student_id=current_user.student_profile.id,
        db=db,
        exclude_class_id=class_id
    )

    if not can_book:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=error_msg
        )

    class_.start_time_utc = data.start_time_utc
    class_.end_time_utc = data.end_time_utc
    class_.status = "pending"
    db.commit()
    db.refresh(class_)
    return class_


# ─── STAFF — Clase de prueba ─────────────────────────────────────────────────

@router.post(
    "/trial",
    response_model=ClassResponse,
    status_code=status.HTTP_201_CREATED
)
def book_trial_class(
    data: BookTrialRequest,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db)
):
    """
    El staff crea una clase de prueba para un estudiante.
    Las clases trial:
    - No requieren enrollment
    - No consumen clases del paquete
    - Son de 30min por defecto
    - El staff decide a quién ofrecerlas
    """
    teacher = db.query(TeacherProfile).filter(
        TeacherProfile.user_username == data.teacher_username
    ).first()

    if not teacher:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profesor no encontrado"
        )

    student = db.query(StudentProfile).filter(
        StudentProfile.id == data.student_id
    ).first()

    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Estudiante no encontrado"
        )

    can_book, error_msg = can_book_slot(
        start_time_utc=data.start_time_utc,
        teacher_id=teacher.id,
        student_id=data.student_id,
        db=db
    )

    if not can_book:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=error_msg
        )

    trial_class = Class(
        enrollment_id=None,          # Sin enrollment
        teacher_id=teacher.id,
        student_id=data.student_id,
        class_type=ClassType.trial,
        subject=data.subject,
        start_time_utc=data.start_time_utc,
        end_time_utc=data.end_time_utc,
        duration=data.duration_minutes,
        teacher_timezone=teacher.timezone,
        student_timezone=student.timezone,
        status="pending"
    )

    db.add(trial_class)
    db.commit()
    db.refresh(trial_class)
    return trial_class


# ─── STAFF / PROFESOR — Gestión ──────────────────────────────────────────────

@router.get("/teacher/classes", response_model=ClassListResponse)
def get_my_classes_teacher(
    date: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None),
    class_type: Optional[str] = Query(None),
    subject: Optional[str] = Query(None),
    include_history: bool = Query(False),
    current_user: User = Depends(get_current_teacher_or_professor_admin),
    db: Session = Depends(get_db)
):
    """Clases del profesor con filtros"""
    now = utc_now()
    teacher_id = current_user.teacher_profile.id

    query = db.query(Class).filter(Class.teacher_id == teacher_id)

    if date:
        try:
            dt = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=UTC)
            day_end = dt + timedelta(days=1)
            query = query.filter(
                Class.start_time_utc >= dt,
                Class.start_time_utc < day_end
            )
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Formato de fecha inválido"
            )

    if status_filter:
        query = query.filter(Class.status == status_filter)

    if class_type:
        query = query.filter(Class.class_type == class_type)

    if subject:
        query = query.filter(Class.subject == subject)

    if not include_history:
        query = query.filter(
            Class.status.in_(["pending", "pending_payment", "confirmed"]),
            Class.start_time_utc >= now
        )

    all_classes = query.order_by(Class.start_time_utc).all()
    upcoming = sum(
        1 for c in all_classes
        if c.status in ["pending", "pending_payment", "confirmed"]
        and c.start_time_utc >= now
    )
    completed = sum(1 for c in all_classes if c.status == "completed")

    return ClassListResponse(
        classes=all_classes,
        total=len(all_classes),
        upcoming=upcoming,
        completed=completed
    )


@router.patch("/{class_id}/status", response_model=ClassResponse)
def update_class_status(
    class_id: int,
    data: UpdateClassStatusRequest,
    current_user: User = Depends(get_current_teacher_or_professor_admin),
    db: Session = Depends(get_db)
):
    """
    El profesor actualiza el estado de una clase.
    Al marcar como 'completed':
    - Se actualiza el contador del enrollment
    - Solo si es clase regular (trial no cuenta)
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
    class_.status = data.status

    if data.notes:
        class_.notes = data.notes

    # Solo las clases regular consumen del paquete
    if class_.class_type == ClassType.regular:
        if data.status == "completed" and old_status != "completed":
            update_enrollment_counter(class_.enrollment_id, delta=1, db=db)
        elif old_status == "completed" and data.status != "completed":
            update_enrollment_counter(class_.enrollment_id, delta=-1, db=db)

    db.commit()
    db.refresh(class_)
    return class_


@router.patch("/teacher/{class_id}/reschedule", response_model=ClassResponse)
def reschedule_class_teacher(
    class_id: int,
    data: RescheduleClassRequest,
    current_user: User = Depends(get_current_teacher_or_professor_admin),
    db: Session = Depends(get_db)
):
    """El profesor reagenda sin restricción de tiempo"""
    class_ = db.query(Class).filter(
        Class.id == class_id,
        Class.teacher_id == current_user.teacher_profile.id
    ).first()

    if not class_:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Clase no encontrada"
        )

    can_reschedule, error_msg = can_reschedule_class(class_, role="teacher")
    if not can_reschedule:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_msg
        )

    can_book, error_msg = can_book_slot(
        start_time_utc=data.start_time_utc,
        teacher_id=class_.teacher_id,
        student_id=class_.student_id,
        db=db,
        exclude_class_id=class_id
    )

    if not can_book:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=error_msg
        )

    class_.start_time_utc = data.start_time_utc
    class_.end_time_utc = data.end_time_utc
    class_.status = "pending"
    db.commit()
    db.refresh(class_)
    return class_


@router.patch("/admin/{class_id}/reschedule", response_model=ClassResponse)
def reschedule_class_admin(
    class_id: int,
    data: RescheduleClassRequest,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db)
):
    """El staff reagenda cualquier clase sin restricciones"""
    class_ = db.query(Class).filter(Class.id == class_id).first()

    if not class_:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Clase no encontrada"
        )

    can_book, error_msg = can_book_slot(
        start_time_utc=data.start_time_utc,
        teacher_id=class_.teacher_id,
        student_id=class_.student_id,
        db=db,
        exclude_class_id=class_id
    )

    if not can_book:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=error_msg
        )

    class_.start_time_utc = data.start_time_utc
    class_.end_time_utc = data.end_time_utc
    class_.status = "pending"
    db.commit()
    db.refresh(class_)
    return class_