import logging
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth.dependencies import (
    get_current_student,
    get_current_staff,
    get_current_teacher_or_teacher_admin,
)
from app.core.calendar_sync import (
    sync_class_cancelled,
    sync_class_created,
    sync_class_updated,
)
from app.core.class_logic import (
    can_book_slot,
    can_cancel_class,
    can_reschedule_class,
    update_enrollment_counter,
    finalize_past_classes,
    class_counts_towards_package
)
from app.core.timezone import UTC, utc_now
from app.db.base import get_db
from app.models.class_ import Class, ClassType
from app.models.package import Enrollment, EnrollmentStatus
from app.models.student import StudentProfile
from app.models.teacher import TeacherProfile
from app.models.user import User
from app.schemas.classes import (
    BookClassRequest,
    BookTrialRequest,
    ClassListResponse,
    ClassResponse,
    RescheduleClassRequest,
    UpdateClassStatusRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter()

UPCOMING_STATUSES = ["pending", "pending_trial", "pending_payment", "confirmed"]
DAYS_ES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]

# ─── HELPER FUNCTIONS ─────────────────────────────────────────────────────────

def _get_class_or_404(
    db: Session,
    class_id: int,
    student_id: Optional[int] = None,
    teacher_id: Optional[int] = None
) -> Class:
    query = db.query(Class).filter(Class.id == class_id)

    if student_id is not None:
        query = query.filter(Class.student_id == student_id)
    if teacher_id is not None:
        query = query.filter(Class.teacher_id == teacher_id)

    class_ = query.first()
    if not class_:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Clase no encontrada"
        )
    return class_


def _build_class_responses(classes: list[Class], db: Session) -> list[ClassResponse]:
    """
    Convierte una lista de Class (ORM) en ClassResponse enriquecidos con
    nombre/avatar del profesor y del estudiante. Batch-query para no hacer
    N+1 consultas.
    """
    if not classes:
        return []

    teacher_ids = {c.teacher_id for c in classes}
    student_ids = {c.student_id for c in classes}

    teachers = db.query(TeacherProfile).filter(TeacherProfile.id.in_(teacher_ids)).all()
    students = db.query(StudentProfile).filter(StudentProfile.id.in_(student_ids)).all()
    teacher_map = {t.id: t for t in teachers}
    student_map = {s.id: s for s in students}

    result = []
    for c in classes:
        teacher = teacher_map.get(c.teacher_id)
        student = student_map.get(c.student_id)
        teacher_user = teacher.user if teacher else None
        student_user = student.user if student else None

        data = ClassResponse.model_validate(c).model_dump()
        data["teacher_name"] = (
            f"{teacher_user.name} {teacher_user.surname}" if teacher_user else None
        )
        data["teacher_avatar"] = (
            (teacher_user.avatar if teacher_user else None)
            or (teacher.profile_photo_url if teacher else None)
        )
        data["teacher_nationality"] = teacher_user.nationality if teacher_user else None  
        data["student_name"] = (
            f"{student_user.name} {student_user.surname}" if student_user else None
        )
        
        data["student_avatar"] = (
            (student_user.avatar if student_user else None)
            or (student.profile_photo_url if student else None)
        )
        data["student_nationality"] = student_user.nationality if student_user else None
        result.append(ClassResponse(**data))

    return result


def _build_class_response(class_: Class, db: Session) -> ClassResponse:
    """Versión de un solo elemento de _build_class_responses."""
    return _build_class_responses([class_], db)[0]


def _sync_google_calendar_created(new_class: Class, db: Session) -> None:
    try:
        event_id = sync_class_created(new_class, db)
        if event_id:
            new_class.google_event_id = event_id
            db.commit()
    except Exception as e:
        logger.error(f"Error al sincronizar Google Calendar (creación): {e}")


def _sync_google_calendar_updated(class_: Class, db: Session) -> None:
    try:
        sync_class_updated(class_, class_.google_event_id, db)
    except Exception as e:
        logger.error(f"Error al sincronizar Google Calendar (actualización): {e}")


def _sync_google_calendar_cancelled(teacher_id: int, event_id: Optional[str], db: Session) -> None:
    if not event_id:
        return
    try:
        sync_class_cancelled(teacher_id, event_id, db)
    except Exception as e:
        logger.error(f"Error al sincronizar Google Calendar (cancelación): {e}")


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
    student_id = current_user.student_profile.id

    enrollment = db.query(Enrollment).filter(
        Enrollment.id == data.enrollment_id,
        Enrollment.student_id == student_id,
        Enrollment.status == EnrollmentStatus.active
    ).first()

    if not enrollment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Enrollment no encontrado o no activo"
        )

    if enrollment.classes_total is not None and enrollment.classes_used >= enrollment.classes_total:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Has agotado todas las clases de este paquete. "
                "Solicita una renovación desde tu dashboard."
    )

    can_book, error_msg = can_book_slot(
        start_time_utc=data.start_time_utc,
        teacher_id=enrollment.teacher_id,
        student_id=student_id,
        db=db
    )

    if not can_book:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=error_msg
        )

    teacher_tz = getattr(enrollment.teacher, "timezone", None) if enrollment.teacher else None
    day_of_week = DAYS_ES[data.start_time_utc.weekday()]

    new_class = Class(
        enrollment_id=enrollment.id,
        teacher_id=enrollment.teacher_id,
        student_id=student_id,
        class_type=ClassType.regular,
        subject=enrollment.package.subject,
        start_time_utc=data.start_time_utc,
        end_time_utc=data.end_time_utc,
        duration=data.duration_minutes,
        teacher_timezone=teacher_tz,
        student_timezone=current_user.student_profile.timezone,
        status="pending",
        day_of_week=day_of_week
    )

    db.add(new_class)
    db.commit()
    db.refresh(new_class)

    _sync_google_calendar_created(new_class, db)
    return _build_class_response(new_class, db)


@router.get("/my-classes", response_model=ClassListResponse)
def get_my_classes_student(
    include_history: bool = Query(False),
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    finalize_past_classes(db)
    now = utc_now()
    student_id = current_user.student_profile.id

    query = db.query(Class).filter(Class.student_id == student_id)

    if not include_history:
        query = query.filter(
            Class.status.in_(UPCOMING_STATUSES),
            Class.start_time_utc >= now
        )

    all_classes = query.order_by(Class.start_time_utc).all()

    upcoming = sum(
        1 for c in all_classes
        if c.status in UPCOMING_STATUSES and c.start_time_utc >= now
    )
    completed = sum(1 for c in all_classes if c.status in ("completed", "finalized"))

    return ClassListResponse(
        classes=_build_class_responses(all_classes, db),
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
    class_ = _get_class_or_404(db, class_id, student_id=current_user.student_profile.id)

    can_cancel, error_msg = can_cancel_class(class_, current_user.id)
    if not can_cancel:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_msg
        )

    class_.status = "cancelled"
    db.commit()

    _sync_google_calendar_cancelled(class_.teacher_id, class_.google_event_id, db)
    return {"message": "Clase cancelada exitosamente"}


@router.patch("/{class_id}/reschedule", response_model=ClassResponse)
def reschedule_class_student(
    class_id: int,
    data: RescheduleClassRequest,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    student_id = current_user.student_profile.id
    class_ = _get_class_or_404(db, class_id, student_id=student_id)

    can_reschedule, error_msg = can_reschedule_class(class_, role="student")
    if not can_reschedule:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_msg
        )

    can_book, error_msg = can_book_slot(
        start_time_utc=data.start_time_utc,
        teacher_id=class_.teacher_id,
        student_id=student_id,
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
    class_.status = "pending_trial" if class_.class_type == ClassType.trial else "pending"
    db.commit()
    db.refresh(class_)

    _sync_google_calendar_updated(class_, db)
    return _build_class_response(class_, db)


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

    day_of_week = DAYS_ES[data.start_time_utc.weekday()]

    trial_class = Class(
        enrollment_id=None,
        teacher_id=teacher.id,
        student_id=data.student_id,
        class_type=ClassType.trial,
        subject=data.subject,
        start_time_utc=data.start_time_utc,
        end_time_utc=data.end_time_utc,
        duration=data.duration_minutes,
        teacher_timezone=teacher.timezone,
        student_timezone=student.timezone,
        status="pending_trial",
        day_of_week=day_of_week
    )

    db.add(trial_class)
    db.commit()
    db.refresh(trial_class)

    _sync_google_calendar_created(trial_class, db)
    return _build_class_response(trial_class, db)


# ─── STAFF / PROFESOR — Gestión ──────────────────────────────────────────────

@router.get("/teacher/classes", response_model=ClassListResponse)
def get_my_classes_teacher(
    date: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None),
    class_type: Optional[str] = Query(None),
    subject: Optional[str] = Query(None),
    include_history: bool = Query(False),
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db)
):
    finalize_past_classes(db)
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
                detail="Formato de fecha inválido (debe ser YYYY-MM-DD)"
            )

    if status_filter:
        query = query.filter(Class.status == status_filter)

    if class_type:
        query = query.filter(Class.class_type == class_type)

    if subject:
        query = query.filter(Class.subject == subject)

    if not include_history:
        query = query.filter(
            Class.status.in_(UPCOMING_STATUSES),
            Class.start_time_utc >= now
        )

    all_classes = query.order_by(Class.start_time_utc).all()
    upcoming = sum(
        1 for c in all_classes
        if c.status in UPCOMING_STATUSES and c.start_time_utc >= now
    )
    completed = sum(1 for c in all_classes if c.status == "completed")

    return ClassListResponse(
        classes=_build_class_responses(all_classes, db),
        total=len(all_classes),
        upcoming=upcoming,
        completed=completed
    )


@router.patch("/{class_id}/status", response_model=ClassResponse)
def update_class_status(
    class_id: int,
    data: UpdateClassStatusRequest,
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db)
):
    class_ = _get_class_or_404(db, class_id, teacher_id=current_user.teacher_profile.id)

    old_status = class_.status
    old_counts = class_counts_towards_package(old_status, class_.start_time_utc)

    class_.status = data.status
    new_counts = class_counts_towards_package(data.status, class_.start_time_utc)

    if data.notes:
        class_.notes = data.notes

    if class_.class_type == ClassType.regular and class_.enrollment_id:
        if new_counts and not old_counts:
            update_enrollment_counter(class_.enrollment_id, delta=1, db=db)
        elif old_counts and not new_counts:
            update_enrollment_counter(class_.enrollment_id, delta=-1, db=db)

    db.commit()
    db.refresh(class_)

    _sync_google_calendar_updated(class_, db)
    return _build_class_response(class_, db)


@router.patch("/teacher/{class_id}/reschedule", response_model=ClassResponse)
def reschedule_class_teacher(
    class_id: int,
    data: RescheduleClassRequest,
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db)
):
    class_ = _get_class_or_404(db, class_id, teacher_id=current_user.teacher_profile.id)

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
    class_.day_of_week = DAYS_ES[data.start_time_utc.weekday()]
    class_.status = "pending_trial" if class_.class_type == ClassType.trial else "pending"
    db.commit()
    db.refresh(class_)

    _sync_google_calendar_updated(class_, db)
    return _build_class_response(class_, db)


@router.patch("/admin/{class_id}/reschedule", response_model=ClassResponse)
def reschedule_class_admin(
    class_id: int,
    data: RescheduleClassRequest,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db)
):
    class_ = _get_class_or_404(db, class_id)

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
    class_.status = "pending_trial" if class_.class_type == ClassType.trial else "pending"
    db.commit()
    db.refresh(class_)

    _sync_google_calendar_updated(class_, db)
    return _build_class_response(class_, db)