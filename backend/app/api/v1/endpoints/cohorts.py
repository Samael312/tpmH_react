# app/api/v1/endpoints/cohorts.py

from datetime import timedelta
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_student, get_current_teacher_or_teacher_admin
from app.core.group_cohort_logic import (
    cancel_cohort,
    close_cohort,
    get_cohort_active_count,
    release_cohort_seat,
)
from app.db.base import get_db
from app.models.class_ import Class, ClassType
from app.models.class_participant import ClassParticipant
from app.models.group_cohort import CohortStatus, GroupCohort
from app.models.package import Enrollment, EnrollmentStatus, Package
from app.models.payment import Payment
from app.models.teacher import TeacherProfile
from app.models.user import User
from app.schemas.cohorts import (
    CohortCloseRequest,
    CohortCreate,
    CohortResponse,
    GroupEnrollRequest,
    GroupSessionCreate,
    GroupSessionResponse,
    MigrationQuoteResponse,
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
    Cancela una cohorte que no se llenó. Libera el cupo de todos sus
    alumnos inscritos; cada uno queda con su enrollment activo pero sin
    cohorte, listo para migrar a individual o para que el profesor/staff
    gestione un reembolso manual.
    """
    cohort = db.query(GroupCohort).filter(
        GroupCohort.id == cohort_id,
        GroupCohort.teacher_id == current_user.teacher_profile.id,
    ).first()
    if not cohort:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cohorte no encontrada")
    if cohort.status not in (CohortStatus.filling, CohortStatus.confirmed):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Esta cohorte ya no se puede cancelar")

    cancel_cohort(cohort, db)
    db.commit()
    db.refresh(cohort)
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
    from app.api.v1.endpoints.payments import DAYS_ES, _sync_google_calendar_created
    from app.core.class_logic import validate_class_duration

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

    can_duration, duration_msg = validate_class_duration(data.duration_minutes, db)
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

    end_time_utc = data.start_time_utc + timedelta(minutes=data.duration_minutes)

    # Solo nos interesa que el profesor no tenga una clase INDIVIDUAL
    # (trial/regular) chocando con este horario — can_book_slot ya excluye
    # las "group" de este chequeo (ver class_logic.py), pero repetimos la
    # consulta acá explícitamente en vez de reutilizar can_book_slot, que
    # está pensada para un alumno puntual, no para "el profesor en general".
    conflicting_individual_class = db.query(Class).filter(
        Class.teacher_id == teacher_id,
        Class.class_type != ClassType.group,
        Class.start_time_utc < end_time_utc,
        Class.end_time_utc > data.start_time_utc,
        Class.status.notin_(["cancelled", "expired", "pending_trial"]),
    ).first()
    if conflicting_individual_class:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya tienes una clase individual agendada en ese horario")

    new_class = Class(
        enrollment_id=None,
        teacher_id=teacher_id,
        student_id=None,
        cohort_id=cohort.id,
        class_type=ClassType.group,
        subject=package.subject,
        start_time_utc=data.start_time_utc,
        end_time_utc=end_time_utc,
        duration=data.duration_minutes,
        teacher_timezone=current_user.teacher_profile.timezone,
        student_timezone=None,
        status="confirmed",
        day_of_week=DAYS_ES[data.start_time_utc.weekday()],
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

    return _to_session_response(new_class)


@router.get("/{cohort_id}/sessions", response_model=List[GroupSessionResponse])
def get_cohort_sessions(
    cohort_id: int,
    db: Session = Depends(get_db),
):
    """Visible tanto para el profesor como para los alumnos de la cohorte."""
    cohort = db.query(GroupCohort).filter(GroupCohort.id == cohort_id).first()
    if not cohort:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cohorte no encontrada")

    sessions = db.query(Class).filter(
        Class.cohort_id == cohort_id,
        Class.status.notin_(["cancelled"]),
    ).order_by(Class.start_time_utc.asc()).all()
    return [_to_session_response(s) for s in sessions]


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
