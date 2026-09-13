# app/api/v1/endpoints/cohorts.py

from datetime import timedelta
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_student, get_current_teacher_or_teacher_admin, get_current_user
from app.core.group_cohort_logic import (
    cancel_cohort,
    cancel_future_cohort_sessions,
    close_cohort,
    get_cohort_active_count,
    release_and_cancel_all_cohort_enrollments,
    release_cohort_seat,
)
from app.core.timezone import utc_now
from app.db.base import get_db
from app.models.class_ import Class, ClassType
from app.models.class_participant import ClassParticipant
from app.models.group_cohort import CohortStatus, GroupCohort
from app.models.package import Enrollment, EnrollmentStatus, Package
from app.models.payment import Payment
from app.models.teacher import TeacherProfile
from app.models.user import User, UserRole
from app.schemas.cohorts import (
    AttendanceSummaryResponse,
    CohortCloseRequest,
    CohortCreate,
    CohortMemberResponse,
    CohortResponse,
    GroupEnrollRequest,
    GroupSessionCreate,
    GroupSessionResponse,
    MarkAttendanceRequest,
    MigrationQuoteResponse,
    SessionParticipantResponse,
)

router = APIRouter()


def _to_cohort_response(cohort: GroupCohort, db: Session) -> CohortResponse:
    return CohortResponse(
        id=cohort.id,
        package_id=cohort.package_id,
        package_name=cohort.package.name if cohort.package else None,
        teacher_id=cohort.teacher_id,
        start_date=cohort.start_date,
        status=cohort.status.value if hasattr(cohort.status, "value") else cohort.status,
        min_students=cohort.min_students,
        max_students=cohort.max_students,
        current_students=get_cohort_active_count(cohort.id, db),
        created_at=cohort.created_at,
        closed_at=cohort.closed_at,
    )


# ─── PROFESOR — Gestión de cohortes ─────────────────────────────────────────

@router.post("/", response_model=CohortResponse, status_code=status.HTTP_201_CREATED)
def create_cohort(
    data: CohortCreate,
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db),
):
    teacher_id = current_user.teacher_profile.id
    package = db.query(Package).filter(
        Package.id == data.package_id,
        Package.teacher_id == teacher_id,
        Package.is_active == True,
    ).first()
    if not package:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Paquete no encontrado o no te pertenece")
    if not package.is_group:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Este paquete no está marcado como grupal")

    cohort = GroupCohort(
        package_id=package.id,
        teacher_id=teacher_id,
        status=CohortStatus.filling,
        min_students=data.min_students,
        max_students=data.max_students,
    )
    db.add(cohort)
    db.commit()
    db.refresh(cohort)
    return _to_cohort_response(cohort, db)


@router.get("/teacher", response_model=List[CohortResponse])
def get_my_cohorts(
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db),
):
    cohorts = db.query(GroupCohort).filter(
        GroupCohort.teacher_id == current_user.teacher_profile.id
    ).order_by(GroupCohort.created_at.desc()).all()
    return [_to_cohort_response(c, db) for c in cohorts]


@router.get("/{cohort_id}/members", response_model=List[CohortMemberResponse])
def get_cohort_members(
    cohort_id: int,
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db),
):
    """
    Integrantes actuales de la cohorte (Enrollments activos, no
    cancelados), sin importar su status ('filling', 'confirmed', etc).
    A diferencia de /sessions/{class_id}/participants, esto funciona
    incluso ANTES de que exista ninguna sesión agendada — es lo que
    permite mostrar en vivo, mientras el grupo se está llenando, quién
    se va uniendo (ver GroupCohort.status == 'filling').
    """
    cohort = db.query(GroupCohort).filter(
        GroupCohort.id == cohort_id,
        GroupCohort.teacher_id == current_user.teacher_profile.id,
    ).first()
    if not cohort:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cohorte no encontrada")

    enrollments = db.query(Enrollment).filter(
        Enrollment.cohort_id == cohort.id,
        Enrollment.status.notin_(["cancelled"]),
    ).order_by(Enrollment.created_at.asc()).all()

    members = []
    for e in enrollments:
        student = e.student
        user = student.user if student else None
        if not user:
            continue
        members.append(CohortMemberResponse(
            enrollment_id=e.id,
            student_id=e.student_id,
            student_name=f"{user.name} {user.surname}".strip(),
            student_avatar=user.avatar or (student.profile_photo_url if student else None),
            payment_status=e.payment_status,
            joined_at=e.created_at,
        ))
    return members


@router.post("/{cohort_id}/close", response_model=CohortResponse)
def close_cohort_endpoint(
    cohort_id: int,
    data: CohortCloseRequest,
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db),
):
    """
    El profesor cierra la cohorte con los integrantes actuales, sin
    importar si llegó al mínimo definido al crearla. Solo se bloquea si
    la cohorte quedó vacía (en ese caso corresponde cancelarla, no
    cerrarla) o si ya no está en estado "filling".
    """
    cohort = db.query(GroupCohort).filter(
        GroupCohort.id == cohort_id,
        GroupCohort.teacher_id == current_user.teacher_profile.id,
    ).first()
    if not cohort:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cohorte no encontrada")
    if cohort.status != CohortStatus.filling:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Solo puedes cerrar una cohorte que esté abierta")

    current_count = get_cohort_active_count(cohort.id, db)
    if current_count == 0:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "No puedes cerrar una cohorte sin alumnos inscritos. Cancélala en su lugar."
        )

    close_cohort(cohort, data.start_date, db)

    # Corrección QA: antes `start_date` quedaba solo como metadata de la
    # cohorte (para mostrar "Inicia el ...") sin generar ninguna sesión
    # real — el profesor tenía que ir aparte a "Agendar sesión" para que
    # esa fecha existiera como Class de verdad. Ahora se reutiliza la misma
    # lógica de creación de sesión que POST /{cohort_id}/sessions para que
    # el cierre ya deje agendada la primera clase del grupo. Si la
    # validación de esa sesión falla (sin disponibilidad, choque de
    # horario, etc.), nada de esto se comitea y la cohorte sigue "filling".
    _create_group_session(cohort, current_user, data.start_date, data.duration_minutes, db)

    db.refresh(cohort)
    return _to_cohort_response(cohort, db)


@router.post("/{cohort_id}/reopen", response_model=CohortResponse)
def reopen_cohort_endpoint(
    cohort_id: int,
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db),
):
    """
    Corrección QA: revierte un cierre manual (close_cohort_endpoint) si
    todavía no arrancó ninguna sesión — por ejemplo si el profesor cerró
    por error o decide seguir aceptando inscripciones. Vuelve la cohorte
    a "filling" y limpia la fecha de inicio/cierre para que un cierre
    posterior tenga que fijarlas de nuevo. Solo válido si sigue
    "confirmed" (si ya está in_progress/completed/cancelled no se puede
    revertir).
    """
    cohort = db.query(GroupCohort).filter(
        GroupCohort.id == cohort_id,
        GroupCohort.teacher_id == current_user.teacher_profile.id,
    ).first()
    if not cohort:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cohorte no encontrada")
    if cohort.status != CohortStatus.confirmed:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Solo puedes reabrir una cohorte que esté cerrada")

    cohort.status = CohortStatus.filling
    cohort.start_date = None
    cohort.closed_at = None
    db.commit()
    db.refresh(cohort)
    return _to_cohort_response(cohort, db)


@router.post("/{cohort_id}/cancel", response_model=CohortResponse)
def cancel_cohort_endpoint(
    cohort_id: int,
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db),
):
    """
    Cancela una cohorte que no se llenó (o que el profesor decide abortar).
    Cancela el enrollment de cada alumno inscrito (ver cancel_cohort) para
    que quede libre de elegir un paquete nuevo, y le notifica por email.
    """
    cohort = db.query(GroupCohort).filter(
        GroupCohort.id == cohort_id,
        GroupCohort.teacher_id == current_user.teacher_profile.id,
    ).first()
    if not cohort:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cohorte no encontrada")
    if cohort.status not in (CohortStatus.filling, CohortStatus.confirmed):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Esta cohorte ya no se puede cancelar")

    package_name = cohort.package.name if cohort.package else "el paquete grupal"
    affected = cancel_cohort(cohort, db)
    cancelled_sessions = cancel_future_cohort_sessions(cohort.id, db)
    db.commit()
    db.refresh(cohort)

    from app.api.v1.endpoints.classes import _sync_google_calendar_cancelled
    for session in cancelled_sessions:
        _sync_google_calendar_cancelled(session.teacher_id, session.google_event_id, db)

    from app.core.email import send_cohort_ended_email
    for enrollment in affected:
        student = enrollment.student
        if not student or not student.user:
            continue
        was_paid = enrollment.payment_status == "paid"
        send_cohort_ended_email(
            to_email=student.user.email,
            student_name=student.user.name,
            package_name=package_name,
            reason="teacher_cancelled",
            credit_returned=was_paid,
        )

    return _to_cohort_response(cohort, db)


@router.post("/{cohort_id}/complete", response_model=CohortResponse)
def complete_cohort_endpoint(
    cohort_id: int,
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db),
):
    """
    El profesor marca una cohorte como finalizada — el paquete/las sesiones
    ya cumplieron su ciclo (antes no existía ningún estado de "terminó
    normalmente", solo "cancelada" antes de arrancar). Si al finalizar el
    grupo quedó por debajo del mínimo declarado, se cancela el enrollment
    de cada alumno restante y se le notifica por email (mismo mecanismo
    que cancelar una cohorte), dejándolo libre de elegir un nuevo paquete.
    Si el grupo llegó al mínimo, solo se marca como completada — esos
    alumnos siguen el ciclo normal de renovación cuando se les agoten los
    créditos, igual que cualquier paquete individual.
    """
    cohort = db.query(GroupCohort).filter(
        GroupCohort.id == cohort_id,
        GroupCohort.teacher_id == current_user.teacher_profile.id,
    ).first()
    if not cohort:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cohorte no encontrada")
    if cohort.status not in (CohortStatus.confirmed, CohortStatus.in_progress):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Solo se puede finalizar una cohorte confirmada o en curso"
        )

    active_count = get_cohort_active_count(cohort.id, db)
    below_minimum = active_count < cohort.min_students
    package_name = cohort.package.name if cohort.package else "el paquete grupal"

    cohort.status = CohortStatus.completed
    cohort.closed_at = utc_now()

    # "Completada" siempre significa que el ciclo de esta cohorte terminó,
    # tanto si llegó al mínimo como si no — cualquier sesión futura que
    # haya quedado agendada de más se cancela en ambos casos (mismo bug
    # que en cancel_cohort_endpoint: antes las Class quedaban huérfanas).
    cancelled_sessions = cancel_future_cohort_sessions(cohort.id, db)

    affected = []
    if below_minimum:
        affected = release_and_cancel_all_cohort_enrollments(cohort.id, db)

    db.commit()
    db.refresh(cohort)

    from app.api.v1.endpoints.classes import _sync_google_calendar_cancelled
    for session in cancelled_sessions:
        _sync_google_calendar_cancelled(session.teacher_id, session.google_event_id, db)

    if affected:
        from app.core.email import send_cohort_ended_email
        for enrollment in affected:
            student = enrollment.student
            if not student or not student.user:
                continue
            was_paid = enrollment.payment_status == "paid"
            send_cohort_ended_email(
                to_email=student.user.email,
                student_name=student.user.name,
                package_name=package_name,
                reason="below_minimum",
                credit_returned=was_paid,
            )

    return _to_cohort_response(cohort, db)


# ─── PROFESOR — Sesiones dentro de una cohorte confirmada ──────────────────

def _to_session_response(class_: Class) -> GroupSessionResponse:
    active = [p for p in class_.participants if p.attendance_status != "cancelled"]
    return GroupSessionResponse(
        id=class_.id,
        cohort_id=class_.cohort_id,
        start_time_utc=class_.start_time_utc,
        end_time_utc=class_.end_time_utc,
        duration=class_.duration,
        status=class_.status,
        participant_count=len(active),
    )


def _create_group_session(
    cohort: GroupCohort,
    current_user: User,
    start_time_utc,
    duration_minutes: int,
    db: Session,
) -> Class:
    """
    Lógica compartida para agendar UNA sesión (Class) de una cohorte ya
    confirmada, inscribiendo automáticamente a todos los alumnos
    actualmente activos vía ClassParticipant — el cupo/capacidad ya se
    definió al crear la cohorte, no por sesión.

    La usan tanto POST /{cohort_id}/sessions (agendar una sesión adicional)
    como POST /{cohort_id}/close (la primera sesión, correspondiente a la
    fecha/hora de inicio elegida al cerrar el grupo — antes esa fecha
    quedaba solo como metadata sin generar ninguna clase real).

    Hace su propio commit al final (cubre también cualquier cambio
    pendiente en `cohort`, como el cierre, ya que comparten la misma
    sesión de SQLAlchemy) y devuelve la Class recién creada.
    """
    from app.api.v1.endpoints.payments import DAYS_ES, _sync_google_calendar_created
    from app.core.class_logic import validate_class_duration

    package = cohort.package
    existing_sessions = db.query(Class).filter(
        Class.cohort_id == cohort.id,
        Class.status.notin_(["cancelled"]),
    ).count()
    if package.classes_count is not None and existing_sessions >= package.classes_count:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Ya agendaste las {package.classes_count} sesiones incluidas en este paquete grupal."
        )

    can_duration, duration_msg = validate_class_duration(duration_minutes, db)
    if not can_duration:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, duration_msg)

    teacher_id = current_user.teacher_profile.id
    active_enrollments = db.query(Enrollment).filter(
        Enrollment.cohort_id == cohort.id,
        Enrollment.status.notin_(["cancelled"]),
        Enrollment.payment_status == "paid",
    ).all()
    if not active_enrollments:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "No hay alumnos con pago confirmado en esta cohorte todavía."
        )

    end_time_utc = start_time_utc + timedelta(minutes=duration_minutes)

    # Margen de preparación para clases grupales (mismo criterio que las
    # regulares, según confirmaste): se fija una sola vez al crear la
    # sesión y define el bloque real ocupado en la agenda del profesor.
    from app.core.class_logic import get_buffer_minutes_for_type
    group_buffer = get_buffer_minutes_for_type(ClassType.group, db)
    occupied_end_time_utc = end_time_utc + timedelta(minutes=group_buffer)

    # Validar contra la disponibilidad declarada del profesor — antes se
    # podía agendar una sesión grupal a cualquier hora sin chequear
    # TeacherAvailability/excepciones (a diferencia de una reserva
    # individual, que solo puede elegirse entre los slots que ya salen
    # filtrados por disponibilidad en el selector del alumno). El bloque
    # que debe caber en la disponibilidad incluye el margen de preparación.
    from app.core.class_logic import is_within_teacher_availability
    is_available, availability_msg = is_within_teacher_availability(
        teacher_id, start_time_utc, occupied_end_time_utc, db
    )
    if not is_available:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, availability_msg)

    # Solo nos interesa que el profesor no tenga una clase INDIVIDUAL
    # (trial/regular) chocando con este horario — can_book_slot ya excluye
    # las "group" de este chequeo (ver class_logic.py), pero repetimos la
    # consulta acá explícitamente en vez de reutilizar can_book_slot, que
    # está pensada para un alumno puntual, no para "el profesor en general".
    # El choque se evalúa contra el bloque REAL ocupado por cada clase
    # existente (su propio end_time_utc + buffer_minutes), no solo su
    # horario visible.
    candidate_individual = db.query(Class).filter(
        Class.teacher_id == teacher_id,
        Class.class_type != ClassType.group,
        Class.start_time_utc < occupied_end_time_utc,
        Class.status.notin_(["cancelled", "expired", "pending_trial"]),
    ).all()
    conflicting_individual_class = any(
        start_time_utc < (c.end_time_utc + timedelta(minutes=c.buffer_minutes or 0))
        for c in candidate_individual
    )
    if conflicting_individual_class:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya tienes una clase individual agendada en ese horario")

    # Choque contra OTRA cohorte del mismo profesor a la misma hora — el
    # chequeo de arriba solo excluye clases individuales, no otras sesiones
    # grupales (BUG: antes dos cohortes distintas podían quedar agendadas
    # en el mismo horario sin ningún aviso).
    candidate_group = db.query(Class).filter(
        Class.teacher_id == teacher_id,
        Class.class_type == ClassType.group,
        Class.cohort_id != cohort.id,
        Class.start_time_utc < occupied_end_time_utc,
        Class.status.notin_(["cancelled"]),
    ).all()
    conflicting_group_session = any(
        start_time_utc < (c.end_time_utc + timedelta(minutes=c.buffer_minutes or 0))
        for c in candidate_group
    )
    if conflicting_group_session:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya tienes otra sesión grupal agendada en ese horario")

    new_class = Class(
        enrollment_id=None,
        teacher_id=teacher_id,
        student_id=None,
        cohort_id=cohort.id,
        class_type=ClassType.group,
        subject=package.subject,
        start_time_utc=start_time_utc,
        end_time_utc=end_time_utc,
        duration=duration_minutes,
        buffer_minutes=group_buffer,
        teacher_timezone=current_user.teacher_profile.timezone,
        student_timezone=None,
        status="confirmed",
        day_of_week=DAYS_ES[start_time_utc.weekday()],
    )
    db.add(new_class)
    db.flush()

    for enrollment in active_enrollments:
        db.add(ClassParticipant(
            class_id=new_class.id,
            student_id=enrollment.student_id,
            enrollment_id=enrollment.id,
            attendance_status="confirmed",
        ))

    db.commit()
    db.refresh(new_class)

    _sync_google_calendar_created(new_class, db)

    # Notificar a cada alumno inscrito — a diferencia de una reserva
    # individual, acá no hay un solo student_id: se recorre cada
    # enrollment activo de la cohorte.
    from app.core.email import send_class_booking_confirmation
    from app.core.timezone import format_local_datetime
    for enrollment in active_enrollments:
        student_profile = enrollment.student
        if student_profile and student_profile.user:
            send_class_booking_confirmation(
                to_email=student_profile.user.email,
                student_name=student_profile.user.name,
                teacher_name=f"{current_user.name} {current_user.surname}",
                subject=package.subject,
                class_start_local=format_local_datetime(start_time_utc, student_profile.timezone),
                duration_minutes=duration_minutes,
                buffer_minutes=group_buffer,
            )

    return new_class


@router.post(
    "/{cohort_id}/sessions",
    response_model=GroupSessionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_group_session(
    cohort_id: int,
    data: GroupSessionCreate,
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db),
):
    """
    Agenda una sesión concreta de una cohorte ya confirmada. Se crea UNA
    sola fila de Class (compartida) y se inscribe automáticamente a todos
    los alumnos actualmente activos de la cohorte vía ClassParticipant —
    el cupo/capacidad ya se definió al crear la cohorte, no por sesión.
    """
    cohort = db.query(GroupCohort).filter(
        GroupCohort.id == cohort_id,
        GroupCohort.teacher_id == current_user.teacher_profile.id,
    ).first()
    if not cohort:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cohorte no encontrada")
    if cohort.status != CohortStatus.confirmed:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Solo puedes agendar sesiones de una cohorte confirmada (ciérrala primero)."
        )

    new_class = _create_group_session(cohort, current_user, data.start_time_utc, data.duration_minutes, db)
    return _to_session_response(new_class)


@router.get("/{cohort_id}/attendance-summary", response_model=List[AttendanceSummaryResponse])
def get_cohort_attendance_summary(
    cohort_id: int,
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db),
):
    """
    Historial de asistencia agregado por alumno a lo largo de todas las
    sesiones ya realizadas de la cohorte — antes solo se podía ver la
    asistencia sesión por sesión (get_session_participants), sin un
    resumen acumulado que le muestre al profesor patrones (ej. un
    alumno que falta seguido).
    """
    cohort = db.query(GroupCohort).filter(
        GroupCohort.id == cohort_id,
        GroupCohort.teacher_id == current_user.teacher_profile.id,
    ).first()
    if not cohort:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cohorte no encontrada")

    past_sessions = db.query(Class).filter(
        Class.cohort_id == cohort_id,
        Class.status.notin_(["cancelled"]),
        Class.start_time_utc <= utc_now(),
    ).all()
    total_sessions = len(past_sessions)

    summary: dict[int, dict] = {}
    for session in past_sessions:
        for p in session.participants:
            if p.attendance_status == "cancelled":
                continue
            if not p.student or not p.student.user:
                continue
            entry = summary.setdefault(p.student_id, {
                "student_id": p.student_id,
                "student_name": f"{p.student.user.name} {p.student.user.surname}",
                "confirmed": 0,
                "no_show": 0,
            })
            if p.attendance_status == "confirmed":
                entry["confirmed"] += 1
            elif p.attendance_status == "no_show":
                entry["no_show"] += 1

    return [
        AttendanceSummaryResponse(
            student_id=e["student_id"],
            student_name=e["student_name"],
            sessions_confirmed=e["confirmed"],
            sessions_no_show=e["no_show"],
            sessions_total=total_sessions,
        )
        for e in summary.values()
    ]


@router.get("/{cohort_id}/sessions", response_model=List[GroupSessionResponse])
def get_cohort_sessions(
    cohort_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Visible tanto para el profesor como para los alumnos de la cohorte."""
    cohort = db.query(GroupCohort).filter(GroupCohort.id == cohort_id).first()
    if not cohort:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cohorte no encontrada")

    is_owner_teacher = (
        current_user.teacher_profile is not None
        and cohort.teacher_id == current_user.teacher_profile.id
    )
    is_enrolled_student = False
    if current_user.student_profile is not None:
        is_enrolled_student = db.query(Enrollment).filter(
            Enrollment.cohort_id == cohort_id,
            Enrollment.student_id == current_user.student_profile.id,
        ).first() is not None

    if not (is_owner_teacher or is_enrolled_student or current_user.role == UserRole.superadmin):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No tenés acceso a esta cohorte")

    sessions = db.query(Class).filter(
        Class.cohort_id == cohort_id,
        Class.status.notin_(["cancelled"]),
    ).order_by(Class.start_time_utc.asc()).all()
    return [_to_session_response(s) for s in sessions]


@router.get("/sessions/{class_id}/participants", response_model=List[SessionParticipantResponse])
def get_session_participants(
    class_id: int,
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db),
):
    """
    Lista los integrantes de UNA sesión grupal puntual con su asistencia
    individual — antes no existía forma de ver esto desglosado por alumno,
    el único estado disponible era el de la Class compartida (todo o nada).
    """
    class_ = db.query(Class).filter(
        Class.id == class_id,
        Class.class_type == ClassType.group,
        Class.teacher_id == current_user.teacher_profile.id,
    ).first()
    if not class_:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sesión grupal no encontrada")

    result = []
    for p in class_.participants:
        if p.attendance_status == "cancelled":
            continue
        if not p.student or not p.student.user:
            continue
        result.append(SessionParticipantResponse(
            student_id=p.student_id,
            student_name=f"{p.student.user.name} {p.student.user.surname}",
            attendance_status=p.attendance_status,
        ))
    return result


@router.patch("/sessions/{class_id}/participants/{student_id}/attendance")
def mark_participant_attendance(
    class_id: int,
    student_id: int,
    data: MarkAttendanceRequest,
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db),
):
    """
    El profesor marca la asistencia de UN alumno en una sesión grupal —
    a diferencia del estado general de la Class (que aplica a todos por
    igual), esto permite reflejar que, por ejemplo, 4 de 6 asistieron.
    Solo admite "confirmed" (asistió) o "no_show" (no asistió); para
    sacar a un alumno de la sesión existe DELETE /classes/{id}/leave
    (uso del propio alumno) — este endpoint no cancela participaciones.
    """
    if data.attendance_status not in ("confirmed", "no_show"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "attendance_status debe ser 'confirmed' o 'no_show'")

    class_ = db.query(Class).filter(
        Class.id == class_id,
        Class.class_type == ClassType.group,
        Class.teacher_id == current_user.teacher_profile.id,
    ).first()
    if not class_:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sesión grupal no encontrada")

    participant = db.query(ClassParticipant).filter(
        ClassParticipant.class_id == class_id,
        ClassParticipant.student_id == student_id,
        ClassParticipant.attendance_status != "cancelled",
    ).first()
    if not participant:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ese alumno no está inscrito en esta sesión")

    participant.attendance_status = data.attendance_status
    db.commit()
    return {"message": "Asistencia actualizada"}


# ─── ESTUDIANTE — Descubrir e inscribirse ──────────────────────────────────

@router.get("/available", response_model=List[CohortResponse])
def get_available_cohorts(
    package_id: int,
    db: Session = Depends(get_db),
):
    """Cohortes abiertas (con cupo) para un paquete grupal específico."""
    cohorts = db.query(GroupCohort).filter(
        GroupCohort.package_id == package_id,
        GroupCohort.status == CohortStatus.filling,
    ).order_by(GroupCohort.created_at.asc()).all()

    result = []
    for c in cohorts:
        current = get_cohort_active_count(c.id, db)
        if current < c.max_students:
            result.append(_to_cohort_response(c, db))
    return result


@router.post("/{cohort_id}/enroll", status_code=status.HTTP_201_CREATED)
def enroll_in_cohort(
    cohort_id: int,
    data: GroupEnrollRequest,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """
    El estudiante se inscribe en una cohorte abierta. Crea el Enrollment
    (unpaid, igual que la compra inicial de un paquete individual) y un
    Payment pendiente de revisión — mismo circuito manual que cualquier
    otro pago de la plataforma.
    """
    student_id = current_user.student_profile.id

    cohort = db.query(GroupCohort).filter(
        GroupCohort.id == data.cohort_id,
        GroupCohort.status == CohortStatus.filling,
    ).first()
    if not cohort:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cohorte no encontrada o ya no acepta inscripciones")

    package = db.query(Package).filter(Package.id == cohort.package_id).first()
    teacher = db.query(TeacherProfile).filter(TeacherProfile.id == cohort.teacher_id).first()

    current_count = get_cohort_active_count(cohort.id, db)
    if current_count >= cohort.max_students:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Esta cohorte ya no tiene cupo disponible")

    already_enrolled = db.query(Enrollment).filter(
        Enrollment.cohort_id == cohort.id,
        Enrollment.student_id == student_id,
        Enrollment.status.notin_(["cancelled"]),
    ).first()
    if already_enrolled:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ya estás inscrito en esta cohorte")

    from app.api.v1.endpoints.payments import _ensure_teacher_linked
    _ensure_teacher_linked(current_user, teacher, db)

    enrollment = Enrollment(
        student_id=student_id,
        package_id=package.id,
        teacher_id=teacher.id,
        cohort_id=cohort.id,
        classes_used=0,
        classes_total=package.classes_count,
        unlocked_credits=0,
        payment_status="unpaid",
        status=EnrollmentStatus.active,
    )
    db.add(enrollment)
    db.flush()

    payment = Payment(
        enrollment_id=enrollment.id,
        student_id=student_id,
        teacher_id=teacher.id,
        amount_total=package.price,
        amount_teacher=0,
        amount_platform=0,
        payment_method="manual",
        status="pending_review",
        payment_type="group_enrollment",
        transaction_id=data.transaction_reference,
    )
    db.add(payment)
    db.commit()
    db.refresh(enrollment)

    return {
        "message": "Inscripción registrada. Tu profesor(a) confirmará tu pago en breve.",
        "enrollment_id": enrollment.id,
        "cohort_id": cohort.id,
    }


@router.post("/{cohort_id}/leave")
def leave_cohort(
    cohort_id: int,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """
    El estudiante abandona una cohorte grupal POR COMPLETO (no solo una
    sesión puntual, ver DELETE /classes/{id}/leave para eso): cancela su
    Enrollment y libera su cupo en todas las sesiones futuras vía
    release_cohort_seat. Al quedar sin enrollment activo con este profesor,
    get_student_booking_stage lo llevará a "needs_renewal" (o
    "needs_package" si nunca tuvo otro), habilitándolo para elegir un
    nuevo paquete — individual o unirse a otra cohorte.
    """
    student_id = current_user.student_profile.id

    enrollment = db.query(Enrollment).filter(
        Enrollment.cohort_id == cohort_id,
        Enrollment.student_id == student_id,
        Enrollment.status.notin_(["cancelled"]),
    ).first()
    if not enrollment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No estás inscrito en esta cohorte")

    release_cohort_seat(enrollment, db)
    enrollment.status = EnrollmentStatus.cancelled
    db.commit()

    return {"message": "Saliste del grupo. Ya puedes elegir un nuevo paquete."}


# ─── ESTUDIANTE — Cotización de migración grupal -> individual ────────────
#
# La EJECUCIÓN de la migración no vive acá: se hace con el mismo
# endpoint que cualquier otro cambio de paquete, POST /payments/notify-payment
# con {"type": "package_change", "enrollment_id": ..., "package_id": ...}.
# Ese es el único lugar que aplica la regla de negocio 3.1/3.2 completa
# (reembolso total si no se usó ninguna clase, ajuste diferencial si ya
# se usaron, aplicación instantánea si la diferencia es 0) y ya libera
# el cupo de la cohorte automáticamente gracias a los hooks agregados
# ahí. Tener la misma fórmula en dos lugares es una fuente de bugs por
# divergencia, así que este endpoint SOLO calcula la vista previa para
# el modal de "resumen amigable" — con la fórmula idéntica a la real.

@router.get("/migration-quote", response_model=MigrationQuoteResponse)
def get_migration_quote(
    current_enrollment_id: int,
    new_package_id: int,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    from app.api.v1.endpoints.payments import _get_enrollment_occupied_slots

    student_id = current_user.student_profile.id

    current_enrollment = db.query(Enrollment).filter(
        Enrollment.id == current_enrollment_id,
        Enrollment.student_id == student_id,
    ).first()
    if not current_enrollment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Enrollment no encontrado")
    if not current_enrollment.cohort_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Este enrollment no es grupal")

    new_package = db.query(Package).filter(
        Package.id == new_package_id,
        Package.teacher_id == current_enrollment.teacher_id,
        Package.is_active == True,
        Package.is_group == False,
    ).first()
    if not new_package:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Paquete individual no encontrado o no disponible")

    old_total = current_enrollment.classes_total or 1
    old_price = current_enrollment.package.price
    price_per_class_old = old_price / old_total
    occupied_slots = _get_enrollment_occupied_slots(current_enrollment, db)
    classes_remaining = max(old_total - occupied_slots, 0)

    if occupied_slots == 0:
        # Caso A (idéntico a notify_payment): ningún crédito usado ->
        # se compara valor total del paquete grupal vs el nuevo.
        diff = round(new_package.price - old_price, 2)
    else:
        # Caso B: ya se usaron clases -> se ajusta sobre el valor restante.
        remaining_value = round(price_per_class_old * classes_remaining, 2)
        diff = round(new_package.price - remaining_value, 2)

    return MigrationQuoteResponse(
        classes_remaining_in_group=classes_remaining,
        remaining_value_usd=round(price_per_class_old * classes_remaining, 2),
        new_package_name=new_package.name,
        new_package_price=new_package.price,
        difference_usd=diff,
        is_instant=(diff == 0),
    )
