# app/routers/classes.py

import logging
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session
from app.core.email import (
    send_class_cancelled_email, 
    send_class_cancelled_teacher_email,
    send_class_no_show_email,
    send_class_rescheduled_student_email,
    send_class_rescheduled_teacher_email
)
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
    resolve_status_after_reschedule,
    update_enrollment_counter,
    finalize_past_classes,
    class_counts_towards_package,
    cancel_class_and_refund,
    validate_class_duration,
    get_business_rules,
)
from app.core.timezone import UTC, utc_now, format_local_datetime
from app.db.base import get_db
from app.models.class_ import Class, ClassType
from app.models.package import Enrollment, EnrollmentStatus
from app.models.student import StudentProfile
from app.models.teacher import TeacherProfile
from app.models.user import User
from app.schemas.classes import (
    BookTrialRequest,
    ClassListResponse,
    ClassResponse,
    RescheduleClassRequest,
    UpdateClassStatusRequest,
    UpdateMeetLinkRequest,
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
    student_ids = {c.student_id for c in classes if c.student_id is not None}
    group_class_ids = [c.id for c in classes if c.class_type == "group"]

    teachers = db.query(TeacherProfile).filter(TeacherProfile.id.in_(teacher_ids)).all()
    students = db.query(StudentProfile).filter(StudentProfile.id.in_(student_ids)).all()
    teacher_map = {t.id: t for t in teachers}
    student_map = {s.id: s for s in students}

    # Para clases grupales: nombres de compañeros vía ClassParticipant,
    # en un solo batch (evita N+1 por cada sesión grupal de la lista).
    participants_by_class: dict[int, list[str]] = {}
    if group_class_ids:
        from app.models.class_participant import ClassParticipant
        rows = (
            db.query(ClassParticipant, StudentProfile, User)
            .join(StudentProfile, ClassParticipant.student_id == StudentProfile.id)
            .join(User, StudentProfile.user_id == User.id)
            .filter(
                ClassParticipant.class_id.in_(group_class_ids),
                ClassParticipant.attendance_status != "cancelled",
            )
            .all()
        )
        for participant, student, user in rows:
            participants_by_class.setdefault(participant.class_id, []).append(
                f"{user.name} {user.surname}"
            )

    result = []
    for c in classes:
        teacher = teacher_map.get(c.teacher_id)
        student = student_map.get(c.student_id) if c.student_id else None
        teacher_user = teacher.user if teacher else None
        student_user = student.user if student else None

        data = ClassResponse.model_validate(c).model_dump()
        data["teacher_username"] = (
            teacher.user_username if teacher else None
        )
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
        data["teacher_timezone"] = teacher.timezone if teacher else data.get("teacher_timezone")
        data["student_timezone"] = student.timezone if student else data.get("student_timezone")
        
        data["teacher_phone"] = teacher_user.phone_number if teacher_user else None
        data["student_phone"] = student_user.phone_number if student_user else None
        data["student_avatar"] = (
            (student_user.avatar if student_user else None)
            or (student.profile_photo_url if student else None)
        )
        data["student_nationality"] = student_user.nationality if student_user else None

        if c.class_type == "group":
            names = participants_by_class.get(c.id, [])
            data["participant_count"] = len(names)
            data["participant_names"] = names

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


def _send_reschedule_emails_helper(class_: Class, old_start: datetime, changed_by: str):
    """Función de ayuda para enviar correos tras la reprogramación"""
    teacher_user = class_.teacher.user if class_.teacher else None
    teacher_name = f"{teacher_user.name} {teacher_user.surname}" if teacher_user else ""

    # Clases grupales: Class.student_id es NULL — recorrer cada participante
    # activo vía ClassParticipant en vez de asumir un solo estudiante.
    if class_.class_type == ClassType.group:
        student_names = []
        for participant in class_.participants:
            if participant.attendance_status == "cancelled":
                continue
            student = participant.student
            if student and student.user:
                student_names.append(f"{student.user.name} {student.user.surname}")
                send_class_rescheduled_student_email(
                    to_email=student.user.email,
                    student_name=student.user.name,
                    teacher_name=teacher_name,
                    old_start_local=format_local_datetime(old_start, student.timezone),
                    new_start_local=format_local_datetime(class_.start_time_utc, student.timezone),
                    changed_by=changed_by
                )
        if teacher_user and class_.teacher:
            send_class_rescheduled_teacher_email(
                to_email=teacher_user.email,
                teacher_name=teacher_user.name,
                student_name=f"tu grupo ({len(student_names)} alumno{'s' if len(student_names) != 1 else ''})",
                old_start_local=format_local_datetime(old_start, class_.teacher.timezone),
                new_start_local=format_local_datetime(class_.start_time_utc, class_.teacher.timezone),
                changed_by=changed_by
            )
        return

    student_user = class_.student.user if class_.student else None
    student_name = f"{student_user.name} {student_user.surname}" if student_user else ""

    if student_user and class_.student:
        send_class_rescheduled_student_email(
            to_email=student_user.email,
            student_name=student_user.name,
            teacher_name=teacher_name,
            old_start_local=format_local_datetime(old_start, class_.student.timezone),
            new_start_local=format_local_datetime(class_.start_time_utc, class_.student.timezone),
            changed_by=changed_by
        )
    
    if teacher_user and class_.teacher:
        send_class_rescheduled_teacher_email(
            to_email=teacher_user.email,
            teacher_name=teacher_user.name,
            student_name=student_name,
            old_start_local=format_local_datetime(old_start, class_.teacher.timezone),
            new_start_local=format_local_datetime(class_.start_time_utc, class_.teacher.timezone),
            changed_by=changed_by
        )

# ─── ESTUDIANTE ──────────────────────────────────────────────────────────────

@router.get("/my-classes", response_model=ClassListResponse)
def get_my_classes_student(
    include_history: bool = Query(False),
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    finalize_past_classes(db)
    now = utc_now()
    student_id = current_user.student_profile.id

    # Las clases individuales siguen filtrándose por Class.student_id; las
    # grupales no llevan ese campo (compartido entre varios alumnos), así
    # que se detectan vía ClassParticipant (ver models/class_participant.py).
    from app.models.class_participant import ClassParticipant
    group_class_ids = [
        row[0] for row in db.query(ClassParticipant.class_id).filter(
            ClassParticipant.student_id == student_id,
            ClassParticipant.attendance_status != "cancelled",
        ).all()
    ]

    query = db.query(Class).filter(
        or_(
            Class.student_id == student_id,
            Class.id.in_(group_class_ids) if group_class_ids else False,
        )
    )

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


@router.delete("/{class_id}/leave")
def leave_group_class(
    class_id: int,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    """
    El estudiante cancela SU participación en una sesión grupal puntual
    (Class con class_type='group'). No cancela la clase para los demás
    inscritos — solo libera su propio cupo (vía ClassParticipant), igual
    que hace release_cohort_seat al migrar de grupal a individual.

    Equivalente grupal de DELETE /{class_id} (cancelación individual):
    Class.student_id es NULL en clases grupales, así que no se puede
    resolver ni cancelar con _get_class_or_404 + cancel_class_and_refund,
    que asumen una relación 1:1 alumno-clase.
    """
    from app.models.class_participant import ClassParticipant

    student_id = current_user.student_profile.id

    class_ = db.query(Class).filter(
        Class.id == class_id,
        Class.class_type == ClassType.group,
    ).first()
    if not class_:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Clase grupal no encontrada")

    participant = db.query(ClassParticipant).filter(
        ClassParticipant.class_id == class_id,
        ClassParticipant.student_id == student_id,
        ClassParticipant.attendance_status != "cancelled",
    ).first()
    if not participant:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No estás inscrito en esta sesión")

    can_cancel, error_msg = can_cancel_class(class_, current_user.id, db)
    if not can_cancel:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_msg)

    participant.attendance_status = "cancelled"
    db.commit()

    teacher = db.query(TeacherProfile).filter(TeacherProfile.id == class_.teacher_id).first()
    if teacher and teacher.user:
        send_class_cancelled_teacher_email(
            to_email=teacher.user.email,
            teacher_name=teacher.user.name,
            student_name=f"{current_user.name} {current_user.surname}",
            class_start_local=format_local_datetime(class_.start_time_utc, teacher.timezone),
            cancelled_by="student",
        )

    return {"message": "Saliste de la clase grupal exitosamente"}


@router.delete("/{class_id}")
def cancel_class_student(
    class_id: int,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    class_ = _get_class_or_404(db, class_id, student_id=current_user.student_profile.id)

    can_cancel, error_msg = can_cancel_class(class_, current_user.id, db)
    if not can_cancel:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_msg)

    # El estudiante SÍ está sujeto a la penalización de 12h (aunque en la
    # práctica can_cancel_class ya bloqueó la cancelación tardía antes).
    cancel_class_and_refund(class_, db, apply_late_cancel_penalty=True)
    db.commit()

    teacher = db.query(TeacherProfile).filter(TeacherProfile.id == class_.teacher_id).first()
    if teacher and teacher.user:
        send_class_cancelled_teacher_email(
            to_email=teacher.user.email,
            teacher_name=teacher.user.name,
            student_name=f"{current_user.name} {current_user.surname}",
            class_start_local=format_local_datetime(class_.start_time_utc, teacher.timezone),
            cancelled_by="student",
        )

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

    can_reschedule, error_msg = can_reschedule_class(class_, role="student", db=db)
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

    old_start = class_.start_time_utc

    class_.start_time_utc = data.start_time_utc
    class_.end_time_utc = data.end_time_utc
    class_.day_of_week = DAYS_ES[data.start_time_utc.weekday()]
    # BUG fix: reagendar ya NO resetea el estado a 'pending'/'pending_trial'.
    # Esa reasignación venía del viejo flujo de "reservar y confirmar/pagar
    # después" para clases regulares, eliminado en BUG-04/12/18/19: una
    # clase regular 'confirmed' ya fue pagada y ya consumió un crédito del
    # paquete, así que reagendarla no debe devolverla a un estado de
    # "pendiente de pago" (confundía al estudiante y además el scheduler de
    # recordatorios de 24h solo avisa clases con status 'confirmed', por lo
    # que la clase dejaba de recibir el recordatorio). El estado se conserva
    # tal cual estaba; can_reschedule_class ya validó que es reagendable.
    # Excepción: 'finalized' → 'confirmed' (ver resolve_status_after_reschedule),
    # para que la clase reagendada a futuro vuelva a aparecer en "Próximas".
    class_.status = resolve_status_after_reschedule(class_)
    db.commit()
    db.refresh(class_)
    
    _send_reschedule_emails_helper(class_, old_start, changed_by="student")

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

    can_duration, duration_msg = validate_class_duration(data.duration_minutes, db)

    if not can_duration:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=duration_msg)

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

    # BUG-05/17 fix: el profesor puede cambiar libremente el estado de una
    # clase a completed/no_show/finalized, sin importar cuál era el estado
    # de origen, pero solo dentro de una ventana de 72h desde que la clase
    # terminó. Pasado ese plazo, el estado queda bloqueado.
    ALLOWED_MANUAL_TARGETS = {"completed", "no_show", "finalized"}
    if data.status in ALLOWED_MANUAL_TARGETS:
        if utc_now() - class_.end_time_utc > timedelta(hours=72):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Ya pasaron 72h desde el fin de la clase; el estado quedó bloqueado."
            )

    min_cancel_hours = get_business_rules(db)["min_cancel_hours"]

    old_status = class_.status
    # BUG-05 fix: usar la fecha real de la transición anterior (updated_at)
    # en vez de 'ahora', para no recalcular retroactivamente si una
    # cancelación contaba o no como tardía según cuándo ocurrió realmente.
    old_counts = class_counts_towards_package(
        old_status, class_.start_time_utc,
        reference_time=class_.updated_at,
        min_cancel_hours=min_cancel_hours,
    )

    class_.status = data.status
    new_counts = class_counts_towards_package(data.status, class_.start_time_utc, min_cancel_hours=min_cancel_hours)

    if data.notes:
        class_.notes = data.notes

    if class_.used_prepaid_credit and data.status in ["cancelled", "cancelled_by_teacher"]:
        enrollment = db.query(Enrollment).filter(Enrollment.id == class_.enrollment_id).first()
        if enrollment:
            enrollment.prepaid_unlimited_credits += 1
        class_.used_prepaid_credit = False
    elif class_.class_type == ClassType.regular and class_.enrollment_id:
        if new_counts and not old_counts:
            update_enrollment_counter(class_.enrollment_id, delta=1, db=db)
        elif old_counts and not new_counts:
            update_enrollment_counter(class_.enrollment_id, delta=-1, db=db)

    db.commit()
    db.refresh(class_)

    if data.status == "no_show":
        student_user = class_.student.user if class_.student else None
        if student_user:
            send_class_no_show_email(
                to_email=student_user.email,
                student_name=student_user.name,
                class_start_local=format_local_datetime(class_.start_time_utc, class_.student.timezone),
            )

    _sync_google_calendar_updated(class_, db)
    return _build_class_response(class_, db)


@router.patch("/{class_id}/meet-link", response_model=ClassResponse)
def update_meet_link(
    class_id: int,
    data: UpdateMeetLinkRequest,
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db)
):
    """
    El profesor carga/edita manualmente el link de la videollamada.
    Campo 100% opcional: no bloquea ninguna otra acción sobre la clase.
    Solo se permite mientras la clase está 'confirmed' (mismo estado en
    el que ClassResponse se lo muestra al estudiante).
    """
    class_ = _get_class_or_404(db, class_id, teacher_id=current_user.teacher_profile.id)

    if class_.status != "confirmed":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "El link solo se puede cargar/editar mientras la clase está confirmada."
        )

    class_.meet_link = data.meet_link
    db.commit()
    db.refresh(class_)

    _sync_google_calendar_updated(class_, db)
    return _build_class_response(class_, db)


# ─── Profesor ────────────────────────────────────────────────────────
@router.delete("/teacher/{class_id}")
def cancel_class_teacher(
    class_id: int,
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db)
):
    """
    El profesor cancela una clase. El crédito SIEMPRE se le reembolsa
    al estudiante, sin importar la antelación — la penalización de 12h
    es exclusivamente para cancelaciones hechas por el propio estudiante.
    """
    class_ = _get_class_or_404(db, class_id, teacher_id=current_user.teacher_profile.id)

    if class_.status == "cancelled":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La clase ya se encuentra cancelada"
        )

    cancel_class_and_refund(class_, db, apply_late_cancel_penalty=False)
    db.commit()

    # Notificar al/los estudiante(s) (antes faltaba este email por completo).
    # En clases grupales Class.student_id es NULL — hay que recorrer cada
    # participante activo vía ClassParticipant en vez de un solo lookup.
    if class_.class_type == ClassType.group:
        for participant in class_.participants:
            if participant.attendance_status == "cancelled":
                continue
            student = db.query(StudentProfile).filter(
                StudentProfile.id == participant.student_id
            ).first()
            if student and student.user:
                send_class_cancelled_email(
                    to_email=student.user.email,
                    student_name=student.user.name,
                    class_start_local=format_local_datetime(class_.start_time_utc, student.timezone),
                    cancelled_by="teacher",
                    credit_returned=True,
                )
    else:
        student = db.query(StudentProfile).filter(StudentProfile.id == class_.student_id).first()
        if student and student.user:
            send_class_cancelled_email(
                to_email=student.user.email,
                student_name=student.user.name,
                class_start_local=format_local_datetime(class_.start_time_utc, student.timezone),
                cancelled_by="teacher",
                credit_returned=True,
            )

    _sync_google_calendar_cancelled(class_.teacher_id, class_.google_event_id, db)
    return {"message": "Clase cancelada por el profesor. El crédito ha sido reembolsado al estudiante."}


@router.patch("/teacher/{class_id}/reschedule", response_model=ClassResponse)
def reschedule_class_teacher(
    class_id: int,
    data: RescheduleClassRequest,
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db)
):
    class_ = _get_class_or_404(db, class_id, teacher_id=current_user.teacher_profile.id)

    can_reschedule, error_msg = can_reschedule_class(class_, role="teacher", db=db)
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

    old_start = class_.start_time_utc

    class_.start_time_utc = data.start_time_utc
    class_.end_time_utc = data.end_time_utc
    class_.day_of_week = DAYS_ES[data.start_time_utc.weekday()]
    # BUG fix: ver comentario equivalente en reschedule_class_student. El
    # profesor tampoco debe poder "desconfirmar" una clase ya paga/confirmada
    # por el simple hecho de reagendarla. Excepción: 'finalized' → 'confirmed'.
    class_.status = resolve_status_after_reschedule(class_)
    db.commit()
    db.refresh(class_)

    _send_reschedule_emails_helper(class_, old_start, changed_by="teacher")

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
    
    old_start = class_.start_time_utc

    class_.start_time_utc = data.start_time_utc
    class_.end_time_utc = data.end_time_utc
    class_.day_of_week = DAYS_ES[data.start_time_utc.weekday()]
    # BUG fix: ver comentario equivalente en reschedule_class_student.
    # Excepción: 'finalized' → 'confirmed'.
    class_.status = resolve_status_after_reschedule(class_)
    db.commit()
    db.refresh(class_)

    _send_reschedule_emails_helper(class_, old_start, changed_by="admin")

    _sync_google_calendar_updated(class_, db)
    return _build_class_response(class_, db)


# ─── Admin/Staff ─────────────────────────────────────────────────────

@router.delete("/admin/{class_id}")
def cancel_class_admin(
    class_id: int,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db)
):
    """
    El staff/admin cancela una clase. El crédito SIEMPRE se reembolsa,
    igual que en la cancelación del profesor.
    """
    class_ = _get_class_or_404(db, class_id)

    if class_.status == "cancelled":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La clase ya se encuentra cancelada"
        )

    cancel_class_and_refund(class_, db, apply_late_cancel_penalty=False)
    db.commit()

    student = db.query(StudentProfile).filter(StudentProfile.id == class_.student_id).first()
    teacher = db.query(TeacherProfile).filter(TeacherProfile.id == class_.teacher_id).first()

    if student and student.user:
        teacher_name = f"{teacher.user.name} {teacher.user.surname}" if teacher and teacher.user else "Profesor"
        send_class_cancelled_email(
            to_email=student.user.email,
            student_name=student.user.name,
            class_start_local=format_local_datetime(class_.start_time_utc, student.timezone),
            cancelled_by="staff",
            credit_returned=True,
        )

    if teacher and teacher.user:
        student_name = f"{student.user.name} {student.user.surname}" if student and student.user else "Estudiante"
        send_class_cancelled_teacher_email(
            to_email=teacher.user.email,
            teacher_name=teacher.user.name,
            student_name=student_name,
            class_start_local=format_local_datetime(class_.start_time_utc, teacher.timezone),
            cancelled_by="staff",
        )

    _sync_google_calendar_cancelled(class_.teacher_id, class_.google_event_id, db)
    return {"message": "Clase cancelada por administración. Crédito reembolsado."}