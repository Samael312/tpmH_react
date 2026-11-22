# app/routers/classes.py

import logging
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from app.core.pagination import Pagination
from sqlalchemy import and_, case, func, or_
from sqlalchemy.orm import Session, joinedload
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
    require_superadmin,
    get_current_teacher_or_teacher_admin,
)
from app.core.calendar_sync import (
    sync_class_cancelled,
    sync_class_created,
    sync_class_updated,
)
from app.core.class_logic import (
    can_book_slot,
    lock_booking_rows,
    lock_class_row,
    can_cancel_class,
    can_reschedule_class,
    apply_reschedule_status,
    validate_class_status_transition,
    update_enrollment_counter,
    class_counts_towards_package,
    cancel_class_and_refund,
    get_business_rules,
    get_buffer_minutes_for_type,
    sync_student_lifetime_class_counter,
)
from app.core.timezone import UTC, utc_now, format_local_datetime
from app.db.base import get_db
from app.models.class_ import Class, ClassType, MAX_STUDENT_RESCHEDULES
from app.models.package import Enrollment
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


def _reject_if_external(class_: Class) -> None:
    """
    Las clases class_type=="external" (importadas del Google Calendar del
    profesor, ej. Preply — ver core/google_calendar.py::
    import_external_classes_for_teacher) son de solo lectura: existen
    únicamente para reflejar el itinerario completo del profesor, no
    para gestionarse desde acá. Cualquier intento de reagendar/cancelar/
    cambiar estado/editar el meet_link se rechaza acá — la UI ya oculta
    esas acciones (ver ClassCard.tsx), esto es la validación de respaldo
    del lado del servidor.
    """
    if class_.class_type == ClassType.external:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Esta clase se importó automáticamente desde Google Calendar "
                f"({class_.external_source or 'externa'}) y es de solo lectura: "
                "no se puede reagendar, cancelar ni editar desde la plataforma."
            ),
        )


def _class_counters(query, now, completed_statuses: tuple[str, ...]) -> tuple[int, int, int]:
    """
    (total, proximas, completadas) de la consulta YA filtrada, en una sola agregacion SQL.
    Antes se cargaban todas las clases en memoria solo para contarlas; ahora la BD cuenta y la pagina pide solo sus filas.
    """
    total, upcoming, completed = query.order_by(None).with_entities(
        func.count(Class.id),
        func.coalesce(func.sum(case((and_(Class.status.in_(UPCOMING_STATUSES), Class.end_time_utc > now), 1), else_=0)), 0),
        func.coalesce(func.sum(case((Class.status.in_(completed_statuses), 1), else_=0)), 0),
    ).one()
    return int(total or 0), int(upcoming or 0), int(completed or 0)



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

    teachers = db.query(TeacherProfile).options(joinedload(TeacherProfile.user)).filter(
        TeacherProfile.id.in_(teacher_ids)
    ).all()
    students = db.query(StudentProfile).options(joinedload(StudentProfile.user)).filter(
        StudentProfile.id.in_(student_ids)
    ).all()
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
    response: Response,
    page: Pagination = Depends(),
    include_history: bool = Query(False),
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    now = utc_now()
    student_id = current_user.student_profile.id

    # Las clases individuales siguen filtrándose por Class.student_id; las
    # grupales no llevan ese campo (compartido entre varios alumnos), así
    # que se detectan vía ClassParticipant (ver models/class_participant.py).
    from app.models.class_participant import ClassParticipant
    group_class_ids = db.query(ClassParticipant.class_id).filter(
        ClassParticipant.student_id == student_id,
        ClassParticipant.attendance_status != "cancelled",
    )

    query = db.query(Class).filter(
        or_(
            Class.student_id == student_id,
            Class.id.in_(group_class_ids),
        )
    )

    if not include_history:
        query = query.filter(
            Class.status.in_(UPCOMING_STATUSES),
            # Por el FIN, no por el inicio: una clase en curso sigue en "proximas" (con su enlace de Meet)
            # hasta que termina. Antes desaparecia del dashboard justo al empezar.
            Class.end_time_utc > now
        )

    # Los contadores son de TODAS las clases; solo se cargan y serializan las de la pagina pedida.
    total, upcoming, completed = _class_counters(query, now, ("completed", "finalized"))
    page_classes = query.order_by(Class.start_time_utc, Class.id).offset(page.offset).limit(page.limit).all()

    response.headers["X-Total-Count"] = str(total)
    return ClassListResponse(
        classes=_build_class_responses(page_classes, db),
        total=total,
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
    class_ = lock_class_row(db, class_id)  # una cancelacion concurrente no puede devolver el credito dos veces

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
    class_ = lock_class_row(db, class_id)  # Fase 22: leer el estado fresco y serializar contra cancelar/marcar

    can_reschedule, error_msg = can_reschedule_class(class_, role="student", db=db)
    if not can_reschedule:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_msg
        )

    # Fase 25 (m2): tope de reagendados del alumno por clase (el profesor/admin no cuentan)
    if (class_.student_reschedule_count or 0) >= MAX_STUDENT_RESCHEDULES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Ya reagendaste esta clase {MAX_STUDENT_RESCHEDULES} veces (el máximo). "
                "Contacta a tu profesor para moverla o cancélala con al menos "
                "12 h de antelación."
            ),
        )

    lock_booking_rows(db, class_.teacher_id, student_id)
    can_book, error_msg = can_book_slot(
        start_time_utc=data.start_time_utc,
        teacher_id=class_.teacher_id,
        student_id=student_id,
        # D5 fix: fin ocupado real del candidato (misma duración+margen de
        # la clase existente, que no cambian al reagendar).
        end_time_utc=data.start_time_utc + timedelta(minutes=class_.duration + (class_.buffer_minutes or 0)),
        db=db,
        exclude_class_id=class_id,
        enforce_availability=True,  # AUD-06
    )

    if not can_book:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=error_msg
        )

    old_start = class_.start_time_utc

    class_.student_reschedule_count = (class_.student_reschedule_count or 0) + 1
    class_.start_time_utc = data.start_time_utc
    class_.end_time_utc = data.start_time_utc + timedelta(minutes=class_.duration)
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
    apply_reschedule_status(class_, db)  # Fase 22 (TE-02): un no_show reagendado devuelve el credito ya contado
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

    # La duración de la clase de prueba NO es una elección libre del staff
    # (a diferencia de una clase regular): es un valor único configurado
    # por el superadmin (rules["trial_duration_minutes"]). Se ignora
    # data.duration_minutes / data.end_time_utc y se recalcula acá, igual
    # que en el flujo de reserva del estudiante (payments.py::book_class).
    rules = get_business_rules(db)
    trial_duration = rules["trial_duration_minutes"]
    trial_buffer = get_buffer_minutes_for_type(ClassType.trial, db)

    can_book, error_msg = can_book_slot(
        start_time_utc=data.start_time_utc,
        teacher_id=teacher.id,
        student_id=data.student_id,
        # D5 fix: fin ocupado real del candidato (duración de prueba + su
        # propio margen).
        end_time_utc=data.start_time_utc + timedelta(minutes=trial_duration + trial_buffer),
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
        end_time_utc=data.start_time_utc + timedelta(minutes=trial_duration),
        duration=trial_duration,
        buffer_minutes=trial_buffer,
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
    response: Response,
    page: Pagination = Depends(),
    date: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None),
    class_type: Optional[str] = Query(None),
    subject: Optional[str] = Query(None),
    include_history: bool = Query(False),
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db)
):
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
            # Por el FIN, no por el inicio: una clase en curso sigue en "proximas" (con su enlace de Meet)
            # hasta que termina. Antes desaparecia del dashboard justo al empezar.
            Class.end_time_utc > now
        )

    total, upcoming, completed = _class_counters(query, now, ("completed",))
    page_classes = query.order_by(Class.start_time_utc, Class.id).offset(page.offset).limit(page.limit).all()

    response.headers["X-Total-Count"] = str(total)
    return ClassListResponse(
        classes=_build_class_responses(page_classes, db),
        total=total,
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
    _reject_if_external(class_)
    # Fase 22 (E2): bloqueo de fila y relectura del estado ANTES de validar la transicion (dos cambios
    # simultaneos no pueden contar el credito dos veces ni reabrir una clase recien cancelada).
    class_ = lock_class_row(db, class_id)

    # Matriz unica de transiciones (core/class_logic.py): sin reabrir canceladas, sin cancelar clases
    # dadas o pasadas, ventana de 72 h para cualquier cambio sobre clases terminadas (BUG-05/17, AUD-04).
    ok, error_msg = validate_class_status_transition(class_, data.status)
    if not ok:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, error_msg)

    if data.status == "cancelled" and class_.status != "cancelled":
        # Cancelar por aqui = cancelar por la via normal (participantes, Google, correos), tambien en grupales.
        if data.notes:
            class_.notes = data.notes
        _cancel_class_by_teacher(class_, db)
        db.refresh(class_)
        return _build_class_response(class_, db)

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

    sync_student_lifetime_class_counter(class_, old_status, data.status, db=db)
    class_.status = data.status
    # AUD-05: este endpoint lo usa el profesor/teacher_admin; la penalizacion por cancelar
    # tarde es solo del alumno, nunca de quien cancela desde aqui.
    new_counts = class_counts_towards_package(
        data.status, class_.start_time_utc,
        apply_late_cancel_penalty=False, min_cancel_hours=min_cancel_hours,
    )

    if data.notes:
        class_.notes = data.notes

    if class_.used_prepaid_credit and data.status in ["cancelled", "cancelled_by_teacher"]:
        enrollment = db.query(Enrollment).filter(Enrollment.id == class_.enrollment_id).first()
        if enrollment:
            enrollment.prepaid_unlimited_credits += 1
        class_.used_prepaid_credit = False
    elif class_.class_type == ClassType.regular and class_.enrollment_id:
        if new_counts and not old_counts:
            update_enrollment_counter(class_.enrollment_id, delta=1, db=db, class_=class_)
        elif old_counts and not new_counts:
            update_enrollment_counter(class_.enrollment_id, delta=-1, db=db, class_=class_)

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
    _reject_if_external(class_)

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
    _reject_if_external(class_)
    class_ = lock_class_row(db, class_id)

    if class_.status == "cancelled":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La clase ya se encuentra cancelada"
        )
    ok, error_msg = validate_class_status_transition(class_, "cancelled")
    if not ok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_msg)

    _cancel_class_by_teacher(class_, db)
    return {"message": "Clase cancelada por el profesor. El crédito ha sido reembolsado al estudiante."}


def _cancel_class_by_teacher(class_: Class, db: Session) -> None:
    """Cancelacion por el profesor (DELETE /teacher/{id} y PATCH status=cancelled): reembolsa el credito,
    avisa a los participantes y borra el evento de Google. Hace commit."""
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


@router.patch("/teacher/{class_id}/reschedule", response_model=ClassResponse)
def reschedule_class_teacher(
    class_id: int,
    data: RescheduleClassRequest,
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db)
):
    class_ = _get_class_or_404(db, class_id, teacher_id=current_user.teacher_profile.id)
    _reject_if_external(class_)
    class_ = lock_class_row(db, class_id)  # Fase 22: leer el estado fresco

    can_reschedule, error_msg = can_reschedule_class(class_, role="teacher", db=db)
    if not can_reschedule:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_msg
        )
    lock_booking_rows(db, class_.teacher_id, class_.student_id)

    can_book, error_msg = can_book_slot(
        start_time_utc=data.start_time_utc,
        teacher_id=class_.teacher_id,
        student_id=class_.student_id,
        # D5 fix: ver comentario equivalente en reschedule_class_student.
        end_time_utc=data.start_time_utc + timedelta(minutes=class_.duration + (class_.buffer_minutes or 0)),
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
    class_.end_time_utc = data.start_time_utc + timedelta(minutes=class_.duration)
    class_.day_of_week = DAYS_ES[data.start_time_utc.weekday()]
    # BUG fix: ver comentario equivalente en reschedule_class_student. El
    # profesor tampoco debe poder "desconfirmar" una clase ya paga/confirmada
    # por el simple hecho de reagendarla. Excepción: 'finalized' → 'confirmed'.
    apply_reschedule_status(class_, db)  # Fase 22 (TE-02): un no_show reagendado devuelve el credito ya contado
    db.commit()
    db.refresh(class_)

    _send_reschedule_emails_helper(class_, old_start, changed_by="teacher")

    _sync_google_calendar_updated(class_, db)
    return _build_class_response(class_, db)


@router.get("/admin/list", response_model=ClassListResponse)
def list_classes_admin(
    response: Response,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    teacher_id: Optional[int] = Query(None),
    student_id: Optional[int] = Query(None),
    student_q: Optional[str] = Query(None, max_length=100),
    date_from: Optional[str] = Query(None, description="YYYY-MM-DD (UTC, inclusive)"),
    date_to: Optional[str] = Query(None, description="YYYY-MM-DD (UTC, inclusive)"),
    status_filter: Optional[str] = Query(None, alias="status"),
    current_user: User = Depends(require_superadmin),
    db: Session = Depends(get_db),
):
    """Superadmin: busca clases de cualquier profesor/alumno para reagendar o cancelar."""
    query = db.query(Class)
    if teacher_id is not None:
        query = query.filter(Class.teacher_id == teacher_id)
    if student_id is not None:
        query = query.filter(Class.student_id == student_id)
    if student_q and student_q.strip():
        like = f"%{student_q.strip()}%"
        query = query.filter(Class.student_id.in_(
            db.query(StudentProfile.id).join(User, StudentProfile.user_id == User.id).filter(
                or_(User.name.ilike(like), User.surname.ilike(like), User.username.ilike(like))
            )
        ))
    try:
        if date_from:
            query = query.filter(Class.start_time_utc >= datetime.strptime(date_from, "%Y-%m-%d").replace(tzinfo=UTC))
        if date_to:
            query = query.filter(
                Class.start_time_utc < datetime.strptime(date_to, "%Y-%m-%d").replace(tzinfo=UTC) + timedelta(days=1)
            )
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Formato de fecha inválido (debe ser YYYY-MM-DD)")
    if status_filter:
        query = query.filter(Class.status == status_filter)

    total, upcoming, completed = _class_counters(query, utc_now(), ("completed",))
    rows = query.order_by(Class.start_time_utc.desc(), Class.id).offset(offset).limit(limit).all()
    response.headers["X-Total-Count"] = str(total)
    return ClassListResponse(
        classes=_build_class_responses(rows, db), total=total, upcoming=upcoming, completed=completed
    )


@router.patch("/admin/{class_id}/reschedule", response_model=ClassResponse)
def reschedule_class_admin(
    class_id: int,
    data: RescheduleClassRequest,
    current_user: User = Depends(require_superadmin),
    db: Session = Depends(get_db)
):
    class_ = _get_class_or_404(db, class_id)
    _reject_if_external(class_)
    class_ = lock_class_row(db, class_id)
    # Fase 22 (E2): el admin solo reagenda clases reagendables (las canceladas/completadas no se reabren).
    if class_.status not in ("pending", "pending_trial", "pending_payment", "confirmed", "finalized", "no_show"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No se puede reagendar una clase con estado '{class_.status}'",
        )
    lock_booking_rows(db, class_.teacher_id, class_.student_id)

    can_book, error_msg = can_book_slot(
        start_time_utc=data.start_time_utc,
        teacher_id=class_.teacher_id,
        student_id=class_.student_id,
        # D5 fix: ver comentario equivalente en reschedule_class_student.
        end_time_utc=data.start_time_utc + timedelta(minutes=class_.duration + (class_.buffer_minutes or 0)),
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
    class_.end_time_utc = data.start_time_utc + timedelta(minutes=class_.duration)
    class_.day_of_week = DAYS_ES[data.start_time_utc.weekday()]
    # BUG fix: ver comentario equivalente en reschedule_class_student.
    # Excepción: 'finalized' → 'confirmed'.
    apply_reschedule_status(class_, db)  # Fase 22 (TE-02): un no_show reagendado devuelve el credito ya contado
    db.commit()
    db.refresh(class_)

    _send_reschedule_emails_helper(class_, old_start, changed_by="admin")

    _sync_google_calendar_updated(class_, db)
    return _build_class_response(class_, db)


# ─── Admin/Staff ─────────────────────────────────────────────────────

@router.delete("/admin/{class_id}")
def cancel_class_admin(
    class_id: int,
    current_user: User = Depends(require_superadmin),
    db: Session = Depends(get_db)
):
    """
    El staff/admin cancela una clase. El crédito SIEMPRE se reembolsa,
    igual que en la cancelación del profesor.
    """
    class_ = _get_class_or_404(db, class_id)
    _reject_if_external(class_)
    class_ = lock_class_row(db, class_id)

    if class_.status == "cancelled":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La clase ya se encuentra cancelada"
        )
    ok, error_msg = validate_class_status_transition(class_, "cancelled")
    if not ok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_msg)

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