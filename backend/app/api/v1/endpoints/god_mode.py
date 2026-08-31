from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import Optional
from datetime import timedelta

from app.db.base import get_db
from app.auth.dependencies import get_current_staff
from app.models.user import User, UserRole
from app.models.god_mode_audit import GodModeAuditLog
from app.models.package import Enrollment, Package, EnrollmentStatus
from app.schemas.god_mode import (
    GodModeAuditLogResponse,
    GodModeTransferStudentRequest,
    GodModeTransferStudentResponse,
)
from app.schemas.packages import (
    GodModeEnrollmentAdjustRequest,
    GodModeChangePackageRequest,
    GodModeEnrollmentResponse,
    EnrollmentResponse,
    PackageResponse,
)
from app.models.class_ import Class, ClassType
from app.models.teacher import TeacherProfile
from app.models.student import StudentProfile
from app.schemas.classes import (
    GodModeCreateClassRequest,
    GodModeRescheduleClassRequest,
    GodModeForceStatusRequest,
    ClassResponse,
)
from app.core.class_logic import (
    can_book_slot,
    resolve_status_after_reschedule,
    update_enrollment_counter,
    class_counts_towards_package,
    get_business_rules,
    get_buffer_minutes_for_type,
)
from app.models.payment import Payment, TeacherWallet
from app.models.student_teacher_link import StudentTeacherLink
from app.core.teacher_students import link_student_to_teacher
from app.schemas.payments import GodModeEditPaymentRequest, GodModeEditPaymentResponse, PaymentResponse
from app.api.v1.endpoints.payments import _apply_commission, _credit_wallet
from app.models.group_cohort import GroupCohort, CohortStatus
from app.schemas.cohorts import (
    GodModeMoveCohortRequest,
    GodModeCohortEditRequest,
    GodModeCohortReopenRequest,
    GodModeCohortActionResponse,
    GodModeMoveCohortResponse,
    CohortResponse,
)
from app.core.group_cohort_logic import get_cohort_active_count, release_cohort_seat
from app.core.god_mode_audit import log_god_mode_action
from app.core.timezone import utc_now

router = APIRouter()

DAYS_ES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]


def _payment_snapshot(payment: Payment) -> dict:
    return {
        "amount_total": payment.amount_total,
        "amount_teacher": payment.amount_teacher,
        "amount_platform": payment.amount_platform,
        "status": payment.status,
        "transaction_id": payment.transaction_id,
    }


def _require_class_scope(class_: Class, current_user: User) -> None:
    if current_user.role == UserRole.teacher_admin:
        teacher_profile = current_user.teacher_profile
        if not teacher_profile or class_.teacher_id != teacher_profile.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Como teacher_admin solo puedes usar el Modo Dios sobre tus propias clases.",
            )


def _class_snapshot(class_: Class) -> dict:
    return {
        "teacher_id": class_.teacher_id,
        "student_id": class_.student_id,
        "start_time_utc": class_.start_time_utc.isoformat() if class_.start_time_utc else None,
        "end_time_utc": class_.end_time_utc.isoformat() if class_.end_time_utc else None,
        "duration": class_.duration,
        "status": class_.status,
        "class_type": class_.class_type.value if hasattr(class_.class_type, "value") else class_.class_type,
        "enrollment_id": class_.enrollment_id,
        "notes": class_.notes,
    }


def _require_cohort_scope(cohort: GroupCohort, current_user: User) -> None:
    if current_user.role == UserRole.teacher_admin:
        teacher_profile = current_user.teacher_profile
        if not teacher_profile or cohort.teacher_id != teacher_profile.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Como teacher_admin solo puedes usar el Modo Dios sobre tus propias cohortes.",
            )


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


def _cohort_snapshot(cohort: GroupCohort) -> dict:
    return {
        "status": cohort.status.value if hasattr(cohort.status, "value") else cohort.status,
        "min_students": cohort.min_students,
        "max_students": cohort.max_students,
        "start_date": cohort.start_date.isoformat() if cohort.start_date else None,
        "closed_at": cohort.closed_at.isoformat() if cohort.closed_at else None,
    }


def _require_enrollment_scope(enrollment: Enrollment, current_user: User) -> None:
    """
    superadmin: sin restricción.
    teacher_admin: solo puede tocar enrollments de sus propios alumnos
    (mismo teacher_profile), igual que el resto de sus endpoints como
    profesor elevado.
    """
    if current_user.role == UserRole.teacher_admin:
        teacher_profile = current_user.teacher_profile
        if not teacher_profile or enrollment.teacher_id != teacher_profile.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Como teacher_admin solo puedes usar el Modo Dios sobre tus propios alumnos.",
            )


def _build_enrollment_response(enrollment: Enrollment, db: Session) -> EnrollmentResponse:
    """
    Espejo de la construcción manual de EnrollmentResponse usada en
    GET /packages/my-enrollments — necesario porque el schema tiene
    campos computados (available_credits, teacher_name, cohort_status)
    que no son columnas del modelo y no se resuelven vía from_attributes.
    """
    e = enrollment
    teacher_user = e.teacher.user if e.teacher and e.teacher.user else None

    if e.package.classes_count is not None:
        if e.cohort_id:
            from app.core.group_cohort_logic import get_enrollment_group_occupied_slots
            occupied_slots = get_enrollment_group_occupied_slots(e, db)
        else:
            occupied_slots = db.query(Class).filter(
                Class.enrollment_id == e.id,
                Class.status != "cancelled",
            ).count()
        available_credits = max((e.unlocked_credits or 0) - occupied_slots, 0)
    else:
        available_credits = e.prepaid_unlimited_credits or 0

    cohort_status = None
    cohort_start_date = None
    cohort_current_students = None
    cohort_max_students = None
    if e.cohort_id and e.cohort:
        from app.core.group_cohort_logic import get_cohort_active_count
        cohort_status = e.cohort.status.value if hasattr(e.cohort.status, "value") else e.cohort.status
        cohort_start_date = e.cohort.start_date
        cohort_current_students = get_cohort_active_count(e.cohort_id, db)
        cohort_max_students = e.cohort.max_students

    return EnrollmentResponse(
        id=e.id,
        student_id=e.student_id,
        package_id=e.package_id,
        teacher_id=e.teacher_id,
        classes_used=e.classes_used,
        classes_total=e.classes_total,
        status=e.status,
        payment_status=e.payment_status,
        installments_paid=getattr(e, "installments_paid", 0),
        paid_via_installments=getattr(e, "paid_via_installments", False),
        unlocked_credits=getattr(e, "unlocked_credits", 0),
        prepaid_unlimited_credits=getattr(e, "prepaid_unlimited_credits", 0),
        available_credits=available_credits,
        activated_at=getattr(e, "activated_at", None),
        renewal_count=e.renewal_count,
        created_at=e.created_at,
        package=PackageResponse.model_validate(e.package),
        teacher_name=f"{teacher_user.name} {teacher_user.surname}" if teacher_user else None,
        teacher_avatar=(teacher_user.avatar if teacher_user else None)
        or (e.teacher.profile_photo_url if e.teacher else None),
        teacher_username=teacher_user.username if teacher_user else None,
        cohort_id=e.cohort_id,
        cohort_status=cohort_status,
        cohort_start_date=cohort_start_date,
        cohort_current_students=cohort_current_students,
        cohort_max_students=cohort_max_students,
        credit_balance_usd=getattr(e, "credit_balance_usd", None),
    )


def _enrollment_snapshot(enrollment: Enrollment) -> dict:
    return {
        "unlocked_credits": enrollment.unlocked_credits,
        "classes_used": enrollment.classes_used,
        "classes_total": enrollment.classes_total,
        "prepaid_unlimited_credits": enrollment.prepaid_unlimited_credits,
        "installments_paid": enrollment.installments_paid,
        "payment_status": enrollment.payment_status,
        "status": enrollment.status.value if hasattr(enrollment.status, "value") else enrollment.status,
        "package_id": enrollment.package_id,
    }


# ─── AUDITORÍA DEL MODO DIOS ──────────────────────────────────────────────
#
# Este endpoint es únicamente de lectura. El log en sí se alimenta desde
# `app.core.god_mode_audit.log_god_mode_action`, llamado dentro de cada
# endpoint de acción del Modo Dios (créditos, clases, cohortes, pagos...).
#
# Tanto superadmin como teacher_admin ven el log COMPLETO (no solo sus
# propias acciones): la trazabilidad de un modo con este nivel de poder
# debe ser transparente para todo el staff, no solo para quien la ejecutó.

@router.get("/audit-log")
def list_god_mode_audit_log(
    entity_type: Optional[str] = Query(None, description="Ej: class, enrollment, cohort, payment"),
    entity_id: Optional[int] = Query(None),
    action: Optional[str] = Query(None, description="Ej: class.force_status"),
    actor_user_id: Optional[int] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    query = db.query(GodModeAuditLog)

    if entity_type:
        query = query.filter(GodModeAuditLog.entity_type == entity_type)
    if entity_id is not None:
        query = query.filter(GodModeAuditLog.entity_id == entity_id)
    if action:
        query = query.filter(GodModeAuditLog.action == action)
    if actor_user_id is not None:
        query = query.filter(GodModeAuditLog.actor_user_id == actor_user_id)

    total = query.count()
    logs = query.order_by(
        GodModeAuditLog.created_at.desc()
    ).offset(skip).limit(limit).all()

    items = []
    for log in logs:
        actor = db.query(User).filter(User.id == log.actor_user_id).first()
        actor_name = f"{actor.name} {actor.surname}" if actor else None
        items.append(
            GodModeAuditLogResponse(
                id=log.id,
                actor_user_id=log.actor_user_id,
                actor_name=actor_name,
                actor_role=log.actor_role,
                action=log.action,
                entity_type=log.entity_type,
                entity_id=log.entity_id,
                reason=log.reason,
                before_data=log.before_data,
                after_data=log.after_data,
                created_at=log.created_at,
            )
        )

    return {
        "items": items,
        "total": total,
        "page": (skip // limit) + 1,
        "page_size": limit,
    }


@router.get("/audit-log/{entity_type}/{entity_id}", response_model=list[GodModeAuditLogResponse])
def get_entity_god_mode_history(
    entity_type: str,
    entity_id: int,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """
    Historial de Modo Dios de una entidad puntual — ej: todos los cambios
    manuales hechos sobre el Enrollment #42, o la Clase #103. Útil para
    mostrar un panel "historial" directamente en la ficha del alumno,
    la clase o la cohorte, sin tener que filtrar el log general.
    """
    logs = db.query(GodModeAuditLog).filter(
        GodModeAuditLog.entity_type == entity_type,
        GodModeAuditLog.entity_id == entity_id,
    ).order_by(GodModeAuditLog.created_at.desc()).all()

    results = []
    for log in logs:
        actor = db.query(User).filter(User.id == log.actor_user_id).first()
        actor_name = f"{actor.name} {actor.surname}" if actor else None
        results.append(
            GodModeAuditLogResponse(
                id=log.id,
                actor_user_id=log.actor_user_id,
                actor_name=actor_name,
                actor_role=log.actor_role,
                action=log.action,
                entity_type=log.entity_type,
                entity_id=log.entity_id,
                reason=log.reason,
                before_data=log.before_data,
                after_data=log.after_data,
                created_at=log.created_at,
            )
        )
    return results


# ─── CRÉDITOS Y PAQUETES ──────────────────────────────────────────────────

@router.patch("/enrollments/{enrollment_id}/adjust", response_model=GodModeEnrollmentResponse)
def god_mode_adjust_enrollment(
    enrollment_id: int,
    data: GodModeEnrollmentAdjustRequest,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """
    Ajusta directamente los contadores/estado de un enrollment, sin pasar
    por el flujo normal de pagos, renovación o cambio de paquete. Solo se
    tocan los campos que vengan en el body (el resto queda intacto).

    Ejemplos de uso:
      - Sumar un crédito porque el alumno reclamó una clase mal descontada.
      - Marcar payment_status=paid porque el pago se validó por WhatsApp.
      - Forzar status=active para reactivar un enrollment cancelado por error.
    """
    enrollment = db.query(Enrollment).filter(Enrollment.id == enrollment_id).first()
    if not enrollment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Enrollment no encontrado")

    _require_enrollment_scope(enrollment, current_user)

    before = _enrollment_snapshot(enrollment)

    if data.unlocked_credits is not None:
        enrollment.unlocked_credits = data.unlocked_credits
    if data.classes_used is not None:
        enrollment.classes_used = data.classes_used
    if data.classes_total is not None:
        enrollment.classes_total = data.classes_total
    if data.prepaid_unlimited_credits is not None:
        enrollment.prepaid_unlimited_credits = data.prepaid_unlimited_credits
    if data.installments_paid is not None:
        enrollment.installments_paid = data.installments_paid
    if data.payment_status is not None:
        enrollment.payment_status = data.payment_status
    if data.status is not None:
        enrollment.status = EnrollmentStatus(data.status)

    after = _enrollment_snapshot(enrollment)

    if before == after:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "No se envió ningún campo para modificar.",
        )

    log_god_mode_action(
        db,
        actor=current_user,
        action="enrollment.adjust",
        entity_type="enrollment",
        entity_id=enrollment.id,
        reason=data.reason,
        before=before,
        after=after,
    )

    db.commit()
    db.refresh(enrollment)

    return {
        "message": "Enrollment ajustado por Modo Dios.",
        "enrollment": _build_enrollment_response(enrollment, db),
    }


@router.post("/enrollments/{enrollment_id}/change-package", response_model=GodModeEnrollmentResponse)
def god_mode_change_package(
    enrollment_id: int,
    data: GodModeChangePackageRequest,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """
    Cambia el paquete de un enrollment de forma instantánea, saltándose
    'request-package-change' y cualquier validación de pago pendiente.

    Ejemplo de uso: el alumno pagó por transferencia bancaria fuera del
    sistema y el staff quiere activarle directamente el paquete de 20
    clases sin pasar por el flujo de aprobación normal.

    No permite cambiar hacia/desde un enrollment grupal (cohort_id
    seteado): ese caso tiene su propio flujo de migración por la
    complejidad de liberar/ocupar cupos de cohorte.
    """
    enrollment = db.query(Enrollment).filter(Enrollment.id == enrollment_id).first()
    if not enrollment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Enrollment no encontrado")

    _require_enrollment_scope(enrollment, current_user)

    if enrollment.cohort_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Este enrollment es grupal. Usa las herramientas de Modo Dios de cohortes "
            "para mover/migrar alumnos de clases grupales.",
        )

    new_package = db.query(Package).filter(Package.id == data.new_package_id).first()
    if not new_package:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Paquete no encontrado")

    if new_package.is_group:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "No se puede asignar un paquete grupal por esta vía. Usa las herramientas de cohortes.",
        )

    if new_package.teacher_id != enrollment.teacher_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "El paquete pertenece a otro profesor. Si quieres reasignar al alumno de "
            "profesor, usa primero la transferencia de alumno del Modo Dios.",
        )

    before = _enrollment_snapshot(enrollment)

    enrollment.package_id = new_package.id
    enrollment.classes_total = new_package.classes_count
    enrollment.unlocked_credits = new_package.classes_count if new_package.classes_count is not None else 0
    if data.reset_classes_used:
        enrollment.classes_used = 0
    enrollment.status = EnrollmentStatus.active
    enrollment.payment_status = "paid"
    enrollment.installments_paid = new_package.installment_count or 1
    enrollment.renewal_requested_package_id = None
    enrollment.change_requested_package_id = None
    enrollment.activated_at = utc_now()

    after = _enrollment_snapshot(enrollment)

    log_god_mode_action(
        db,
        actor=current_user,
        action="enrollment.change_package",
        entity_type="enrollment",
        entity_id=enrollment.id,
        reason=data.reason,
        before=before,
        after=after,
    )

    db.commit()
    db.refresh(enrollment)

    return {
        "message": f"Paquete cambiado a '{new_package.name}' por Modo Dios.",
        "enrollment": _build_enrollment_response(enrollment, db),
    }


# ─── COHORTES / GRUPOS ────────────────────────────────────────────────────

@router.post("/enrollments/{enrollment_id}/move-cohort", response_model=GodModeMoveCohortResponse)
def god_mode_move_cohort(
    enrollment_id: int,
    data: GodModeMoveCohortRequest,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """
    Mueve el enrollment de un alumno a otra cohorte del mismo profesor,
    o lo convierte a individual si new_cohort_id es None.

    Ejemplos de uso:
      - El alumno se inscribió en la cohorte de martes por error y quiere
        pasarse a la de jueves (mismo paquete, misma materia).
      - La cohorte del alumno se canceló y en vez de que reinicie el
        flujo de pago, el staff lo reubica directo en otra con cupo.
    """
    enrollment = db.query(Enrollment).filter(Enrollment.id == enrollment_id).first()
    if not enrollment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Enrollment no encontrado")

    _require_enrollment_scope(enrollment, current_user)

    old_cohort_id = enrollment.cohort_id
    old_package_id = enrollment.package_id

    new_cohort = None
    if data.new_cohort_id is not None:
        new_cohort = db.query(GroupCohort).filter(GroupCohort.id == data.new_cohort_id).first()
        if not new_cohort:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Cohorte destino no encontrada")

        if new_cohort.teacher_id != enrollment.teacher_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "La cohorte destino pertenece a otro profesor. Transfiere primero al "
                "alumno de profesor con la herramienta correspondiente del Modo Dios.",
            )

        if new_cohort.id == old_cohort_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "El alumno ya está en esta cohorte")

        if not data.force:
            current_count = get_cohort_active_count(new_cohort.id, db)
            if current_count >= new_cohort.max_students:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    f"La cohorte destino ya está al máximo de cupo ({new_cohort.max_students}). "
                    "Usa force=true si igual quieres moverlo.",
                )

    before = {"cohort_id": old_cohort_id, "package_id": old_package_id}

    # Libera el cupo/participaciones futuras en la cohorte de origen (si
    # tenía una) y limpia enrollment.cohort_id — mismo helper que usa
    # leave_cohort() para un estudiante saliendo por su cuenta.
    if old_cohort_id:
        release_cohort_seat(enrollment, db)

    if new_cohort:
        enrollment.cohort_id = new_cohort.id
        enrollment.package_id = new_cohort.package_id
        enrollment.classes_total = new_cohort.package.classes_count if new_cohort.package else None
        if data.reset_classes_used:
            enrollment.classes_used = 0

    after = {"cohort_id": enrollment.cohort_id, "package_id": enrollment.package_id}

    log_god_mode_action(
        db,
        actor=current_user,
        action="enrollment.move_cohort",
        entity_type="enrollment",
        entity_id=enrollment.id,
        reason=data.reason,
        before=before,
        after=after,
    )

    db.commit()

    if new_cohort:
        return {"message": f"Alumno movido a la cohorte #{new_cohort.id} por Modo Dios."}
    return {"message": "Alumno convertido a individual (fuera de cohorte) por Modo Dios."}


@router.patch("/cohorts/{cohort_id}", response_model=GodModeCohortActionResponse)
def god_mode_edit_cohort(
    cohort_id: int,
    data: GodModeCohortEditRequest,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """
    Edita min_students/max_students/start_date de una cohorte ya creada.

    Ejemplo de uso: la cohorte se creó con max_students=6 pero llegaron
    8 inscripciones por WhatsApp antes de que el profesor abriera bien
    el cupo online; el staff sube el máximo para reflejar la realidad.
    """
    cohort = db.query(GroupCohort).filter(GroupCohort.id == cohort_id).first()
    if not cohort:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cohorte no encontrada")

    _require_cohort_scope(cohort, current_user)

    before = _cohort_snapshot(cohort)

    if data.max_students is not None:
        current_count = get_cohort_active_count(cohort.id, db)
        if data.max_students < current_count:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"No puedes bajar el máximo a {data.max_students}: ya hay {current_count} "
                "alumnos activos en esta cohorte.",
            )
        cohort.max_students = data.max_students
    if data.min_students is not None:
        cohort.min_students = data.min_students
    if data.start_date is not None:
        cohort.start_date = data.start_date

    after = _cohort_snapshot(cohort)

    if before == after:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No se envió ningún campo para modificar.")

    log_god_mode_action(
        db,
        actor=current_user,
        action="cohort.edit",
        entity_type="cohort",
        entity_id=cohort.id,
        reason=data.reason,
        before=before,
        after=after,
    )

    db.commit()
    db.refresh(cohort)

    return {"message": "Cohorte editada por Modo Dios.", "cohort": _to_cohort_response(cohort, db)}


@router.post("/cohorts/{cohort_id}/reopen", response_model=GodModeCohortActionResponse)
def god_mode_reopen_cohort(
    cohort_id: int,
    data: GodModeCohortReopenRequest,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """
    Reabre una cohorte cancelada o completada, devolviéndola a 'filling'
    (vuelve a aceptar inscripciones) o 'confirmed' (fecha ya fija, solo
    esperando que arranquen las sesiones).

    Ejemplo de uso: la cohorte se canceló porque no llegó al mínimo,
    pero luego aparecieron 2 alumnos más interesados — en vez de crear
    una cohorte nueva desde cero (perdiendo el historial), se reabre.

    Nota: esto NO revive los enrollments que ya quedaron cancelados ni
    las sesiones (Class) que ya se cancelaron al cerrar la cohorte — eso
    requiere re-inscribir a los alumnos y crear sesiones nuevas.
    """
    cohort = db.query(GroupCohort).filter(GroupCohort.id == cohort_id).first()
    if not cohort:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cohorte no encontrada")

    _require_cohort_scope(cohort, current_user)

    if cohort.status not in (CohortStatus.cancelled, CohortStatus.completed):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Solo se pueden reabrir cohortes canceladas o completadas (estado actual: "
            f"{cohort.status.value if hasattr(cohort.status, 'value') else cohort.status}).",
        )

    before = _cohort_snapshot(cohort)

    cohort.status = CohortStatus(data.new_status)
    cohort.closed_at = None
    if data.new_status == "filling":
        cohort.start_date = None

    after = _cohort_snapshot(cohort)

    log_god_mode_action(
        db,
        actor=current_user,
        action="cohort.reopen",
        entity_type="cohort",
        entity_id=cohort.id,
        reason=data.reason,
        before=before,
        after=after,
    )

    db.commit()
    db.refresh(cohort)

    return {"message": "Cohorte reabierta por Modo Dios.", "cohort": _to_cohort_response(cohort, db)}


# ─── CLASES ────────────────────────────────────────────────────────────────

@router.post("/classes", response_model=ClassResponse, status_code=status.HTTP_201_CREATED)
def god_mode_create_class(
    data: GodModeCreateClassRequest,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """
    Crea una clase individual (regular o trial) para cualquier par
    profesor-alumno, sin pasar por los flujos normales de reserva ni por
    la disponibilidad declarada del profesor.

    Ejemplo de uso: el alumno pagó por WhatsApp y quiere su clase del
    jueves 18h, aunque el profesor no tenga esa franja abierta en su
    calendario público.

    Por defecto igual valida que no choque con otra clase existente del
    profesor o del alumno (can_book_slot) — usa skip_conflict_check=true
    para permitir un doble-booking real y consciente.
    """
    teacher = db.query(TeacherProfile).filter(TeacherProfile.id == data.teacher_id).first()
    if not teacher:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profesor no encontrado")

    if current_user.role == UserRole.teacher_admin:
        teacher_profile = current_user.teacher_profile
        if not teacher_profile or teacher.id != teacher_profile.id:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Como teacher_admin solo puedes crear clases para ti mismo como profesor.",
            )

    student = db.query(StudentProfile).filter(StudentProfile.id == data.student_id).first()
    if not student:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Estudiante no encontrado")

    enrollment = None
    if data.enrollment_id is not None:
        enrollment = db.query(Enrollment).filter(Enrollment.id == data.enrollment_id).first()
        if not enrollment:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Enrollment no encontrado")
        if enrollment.student_id != data.student_id or enrollment.teacher_id != data.teacher_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "El enrollment indicado no corresponde a este alumno y profesor.",
            )

    if not data.skip_conflict_check:
        can_book, error_msg = can_book_slot(
            start_time_utc=data.start_time_utc,
            teacher_id=data.teacher_id,
            student_id=data.student_id,
            db=db,
        )
        if not can_book:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"{error_msg}. Usa skip_conflict_check=true si igual quieres forzar la creación.",
            )

    class_type_enum = ClassType(data.class_type)
    buffer_minutes = get_buffer_minutes_for_type(class_type_enum, db)

    new_class = Class(
        enrollment_id=enrollment.id if enrollment else None,
        teacher_id=data.teacher_id,
        student_id=data.student_id,
        class_type=class_type_enum,
        subject=data.subject,
        start_time_utc=data.start_time_utc,
        end_time_utc=data.start_time_utc + timedelta(minutes=data.duration_minutes),
        duration=data.duration_minutes,
        buffer_minutes=buffer_minutes,
        teacher_timezone=teacher.timezone,
        student_timezone=student.timezone,
        status=data.status,
        day_of_week=DAYS_ES[data.start_time_utc.weekday()],
        notes=data.notes,
    )
    db.add(new_class)
    db.flush()

    # Consumo de crédito: si el staff no especificó consume_credit
    # explícitamente, se sigue la misma regla que el resto de la app
    # (el estado inicial determina si "cuenta" contra el paquete). Si sí
    # lo especificó, se respeta esa decisión sin importar el estado.
    if class_type_enum == ClassType.regular and enrollment is not None:
        min_cancel_hours = get_business_rules(db)["min_cancel_hours"]
        if data.consume_credit is None:
            should_consume = class_counts_towards_package(
                data.status, data.start_time_utc, min_cancel_hours=min_cancel_hours,
            )
        else:
            should_consume = data.consume_credit

        if should_consume:
            update_enrollment_counter(enrollment.id, delta=1, db=db)

    log_god_mode_action(
        db,
        actor=current_user,
        action="class.create",
        entity_type="class",
        entity_id=new_class.id,
        reason=data.reason,
        before=None,
        after=_class_snapshot(new_class),
    )

    db.commit()
    db.refresh(new_class)

    return ClassResponse.model_validate(new_class)


@router.patch("/classes/{class_id}/reschedule", response_model=ClassResponse)
def god_mode_reschedule_class(
    class_id: int,
    data: GodModeRescheduleClassRequest,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """
    Reagenda cualquier clase sin las restricciones normales (antelación
    mínima, disponibilidad). Por defecto sigue validando que no choque
    con otra clase (can_book_slot); usa skip_conflict_check=true para
    saltarte incluso eso.
    """
    class_ = db.query(Class).filter(Class.id == class_id).first()
    if not class_:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Clase no encontrada")

    _require_class_scope(class_, current_user)

    if not data.skip_conflict_check:
        can_book, error_msg = can_book_slot(
            start_time_utc=data.start_time_utc,
            teacher_id=class_.teacher_id,
            student_id=class_.student_id,
            db=db,
            exclude_class_id=class_id,
        )
        if not can_book:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"{error_msg}. Usa skip_conflict_check=true si igual quieres forzar el reagendado.",
            )

    before = _class_snapshot(class_)

    duration = data.duration_minutes or class_.duration
    class_.start_time_utc = data.start_time_utc
    class_.end_time_utc = data.start_time_utc + timedelta(minutes=duration)
    class_.duration = duration
    class_.day_of_week = DAYS_ES[data.start_time_utc.weekday()]
    class_.status = resolve_status_after_reschedule(class_)

    after = _class_snapshot(class_)

    log_god_mode_action(
        db,
        actor=current_user,
        action="class.reschedule",
        entity_type="class",
        entity_id=class_.id,
        reason=data.reason,
        before=before,
        after=after,
    )

    db.commit()
    db.refresh(class_)

    return ClassResponse.model_validate(class_)


@router.patch("/classes/{class_id}/force-status", response_model=ClassResponse)
def god_mode_force_class_status(
    class_id: int,
    data: GodModeForceStatusRequest,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """
    Fuerza el estado de cualquier clase a cualquier valor, sin la ventana
    de 72h que aplica al profesor normal (ver update_class_status en
    classes.py) y sin importar de qué profesor sea. Ajusta el contador
    de créditos del enrollment igual que el flujo normal, para no dejar
    el paquete del alumno desincronizado.

    Ejemplo de uso: se pasó la ventana de 72h y el profesor no llegó a
    marcar una clase como 'completed'; el staff la corrige manualmente
    tras confirmar con ambas partes.
    """
    class_ = db.query(Class).filter(Class.id == class_id).first()
    if not class_:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Clase no encontrada")

    _require_class_scope(class_, current_user)

    min_cancel_hours = get_business_rules(db)["min_cancel_hours"]

    before = _class_snapshot(class_)
    old_status = class_.status
    old_counts = class_counts_towards_package(
        old_status, class_.start_time_utc,
        reference_time=class_.updated_at,
        min_cancel_hours=min_cancel_hours,
    )

    class_.status = data.status
    if data.notes:
        class_.notes = data.notes

    new_counts = class_counts_towards_package(data.status, class_.start_time_utc, min_cancel_hours=min_cancel_hours)

    if class_.used_prepaid_credit and data.status in ("cancelled", "cancelled_by_teacher"):
        enrollment = db.query(Enrollment).filter(Enrollment.id == class_.enrollment_id).first()
        if enrollment:
            enrollment.prepaid_unlimited_credits += 1
        class_.used_prepaid_credit = False
    elif class_.class_type == ClassType.regular and class_.enrollment_id:
        if new_counts and not old_counts:
            update_enrollment_counter(class_.enrollment_id, delta=1, db=db)
        elif old_counts and not new_counts:
            update_enrollment_counter(class_.enrollment_id, delta=-1, db=db)

    after = _class_snapshot(class_)

    log_god_mode_action(
        db,
        actor=current_user,
        action="class.force_status",
        entity_type="class",
        entity_id=class_.id,
        reason=data.reason,
        before=before,
        after=after,
    )

    db.commit()
    db.refresh(class_)

    return ClassResponse.model_validate(class_)


@router.delete("/classes/{class_id}")
def god_mode_hard_delete_class(
    class_id: int,
    reason: str = Query(..., min_length=5, max_length=500),
    refund_credit: bool = Query(False, description="Si la clase ya consumía un crédito del enrollment, devuélvelo al eliminarla"),
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """
    Elimina una clase POR COMPLETO (a diferencia de cancelar, que solo
    cambia el status). Pensado para clases creadas por error que nunca
    debieron existir — no un reemplazo de la cancelación normal.

    Por defecto NO reembolsa crédito. Usa refund_credit=true si la clase
    sí estaba consumiendo un crédito del enrollment (ej. estaba en
    'completed') y quieres devolvérselo al alumno al borrarla.

    No permite eliminar sesiones grupales (class_type='group') por esta
    vía — una sesión grupal tiene participantes de varios alumnos con su
    propio historial de asistencia; usa las herramientas de cohortes.
    """
    class_ = db.query(Class).filter(Class.id == class_id).first()
    if not class_:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Clase no encontrada")

    _require_class_scope(class_, current_user)

    if class_.class_type == ClassType.group:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "No se pueden eliminar sesiones grupales por esta vía. Cancela la cohorte "
            "o la sesión puntual desde las herramientas de cohortes.",
        )

    before = _class_snapshot(class_)
    class_id_captured = class_.id
    enrollment_id_captured = class_.enrollment_id

    refunded = False
    if refund_credit and enrollment_id_captured and class_.class_type == ClassType.regular:
        update_enrollment_counter(enrollment_id_captured, delta=-1, db=db)
        refunded = True

    log_god_mode_action(
        db,
        actor=current_user,
        action="class.hard_delete",
        entity_type="class",
        entity_id=class_id_captured,
        reason=reason,
        before=before,
        after={"refunded_credit": refunded},
    )

    db.delete(class_)
    db.commit()

    msg = f"Clase #{class_id_captured} eliminada permanentemente por Modo Dios."
    if refunded:
        msg += " Se devolvió 1 crédito al enrollment."
    return {"message": msg}


# ─── PAGOS ─────────────────────────────────────────────────────────────────

@router.patch("/payments/{payment_id}", response_model=GodModeEditPaymentResponse)
def god_mode_edit_payment(
    payment_id: int,
    data: GodModeEditPaymentRequest,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """
    Edita un Payment ya registrado: monto y/o status. Ajusta el saldo de
    la billetera del profesor cuando corresponde, para que nunca quede
    desincronizada de lo que el Payment dice haber acreditado:

      - Si el pago ya estaba 'approved' y se cambia amount_total, se
        aplica solo la DIFERENCIA a available_balance/total_earned.
      - Si se cambia el status DE 'approved' a otro, se revierte el
        crédito ya otorgado.
      - Si se cambia el status HACIA 'approved' (no lo estaba), se
        acredita como lo haría el flujo normal de aprobación.

    Los pagos de tipo 'refund' o con is_manual_grant=True nunca mueven
    la billetera del profesor (igual que en el flujo normal).

    Ejemplo de uso: se cargó un pago por $45 pero el comprobante real
    era de $50 — se corrige el monto sin tener que rechazar y rehacer
    todo el pago.
    """
    payment = db.query(Payment).filter(Payment.id == payment_id).first()
    if not payment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pago no encontrado")

    if current_user.role == UserRole.teacher_admin:
        teacher_profile = current_user.teacher_profile
        if not teacher_profile or payment.teacher_id != teacher_profile.id:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Como teacher_admin solo puedes editar pagos de tus propios alumnos.",
            )

    moves_wallet = payment.payment_type != "refund" and not payment.is_manual_grant

    before = _payment_snapshot(payment)

    # ── 1. Cambio de monto ──
    if data.amount_total is not None and data.amount_total != payment.amount_total:
        old_amount_teacher = payment.amount_teacher
        payment.amount_total = data.amount_total

        if moves_wallet:
            teacher = db.query(TeacherProfile).filter(TeacherProfile.id == payment.teacher_id).first()
            new_amount_teacher, new_amount_platform = _apply_commission(data.amount_total, teacher)
            payment.amount_teacher = new_amount_teacher
            payment.amount_platform = new_amount_platform

            if payment.status == "approved":
                delta = new_amount_teacher - old_amount_teacher
                wallet = db.query(TeacherWallet).filter(TeacherWallet.teacher_id == payment.teacher_id).first()
                if not wallet:
                    wallet = TeacherWallet(teacher_id=payment.teacher_id, available_balance=0.0, total_earned=0.0, total_withdrawn=0.0)
                    db.add(wallet)
                    db.flush()
                wallet.available_balance += delta
                wallet.total_earned += delta

    # ── 2. Cambio de status ──
    if data.status is not None and data.status != payment.status:
        old_status = payment.status

        if data.status == "rejected" and not data.rejection_reason and not payment.rejection_reason:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Debes indicar rejection_reason al rechazar un pago.")

        if old_status == "approved" and data.status != "approved" and moves_wallet:
            wallet = db.query(TeacherWallet).filter(TeacherWallet.teacher_id == payment.teacher_id).first()
            if wallet:
                wallet.available_balance -= payment.amount_teacher
                wallet.total_earned -= payment.amount_teacher

        elif data.status == "approved" and old_status != "approved":
            if moves_wallet:
                teacher = db.query(TeacherProfile).filter(TeacherProfile.id == payment.teacher_id).first()
                new_amount_teacher, new_amount_platform = _apply_commission(payment.amount_total, teacher)
                payment.amount_teacher = new_amount_teacher
                payment.amount_platform = new_amount_platform
                _credit_wallet(payment.teacher_id, new_amount_teacher, db)
            else:
                payment.amount_teacher = 0
                payment.amount_platform = 0
            payment.validated_by = current_user.id
            payment.validated_at = utc_now()

        payment.status = data.status
        if data.rejection_reason:
            payment.rejection_reason = data.rejection_reason

    if data.transaction_id is not None:
        payment.transaction_id = data.transaction_id

    after = _payment_snapshot(payment)

    if before == after:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No se envió ningún cambio real.")

    log_god_mode_action(
        db,
        actor=current_user,
        action="payment.edit",
        entity_type="payment",
        entity_id=payment.id,
        reason=data.reason,
        before=before,
        after=after,
    )

    db.commit()
    db.refresh(payment)

    return {"message": "Pago editado por Modo Dios.", "payment": PaymentResponse.model_validate(payment)}


# ─── RELACIONES PROFESOR-ALUMNO ───────────────────────────────────────────

@router.post("/students/{student_id}/transfer-teacher", response_model=GodModeTransferStudentResponse)
def god_mode_transfer_student(
    student_id: int,
    data: GodModeTransferStudentRequest,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """
    Transfiere a un alumno de un profesor a otro: crea/asegura el
    vínculo (StudentTeacherLink) con el profesor destino, reasigna sus
    enrollments individuales activos y sus clases futuras al nuevo
    profesor.

    IMPORTANTE: no toca a qué paquete apunta cada enrollment (los
    paquetes pertenecen a cada profesor). Después de transferir, corrige
    el paquete de cada enrollment con change-package o adjust.

    Solo superadmin puede ejecutar esta transferencia — un teacher_admin
    no puede mover un alumno hacia/desde sí mismo sin supervisión.
    """
    if current_user.role != UserRole.superadmin:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Solo superadmin puede transferir alumnos entre profesores.",
        )

    student = db.query(StudentProfile).filter(StudentProfile.id == student_id).first()
    if not student:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Estudiante no encontrado")

    from_teacher = db.query(TeacherProfile).filter(TeacherProfile.id == data.from_teacher_id).first()
    to_teacher = db.query(TeacherProfile).filter(TeacherProfile.id == data.to_teacher_id).first()
    if not from_teacher or not to_teacher:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profesor de origen o destino no encontrado")

    if from_teacher.id == to_teacher.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El profesor de origen y destino son el mismo")

    existing_link = db.query(StudentTeacherLink).filter(
        StudentTeacherLink.student_id == student_id,
        StudentTeacherLink.teacher_id == to_teacher.id,
    ).first()
    if not existing_link:
        db.add(StudentTeacherLink(student_id=student_id, teacher_id=to_teacher.id))

    if data.remove_old_link:
        old_link = db.query(StudentTeacherLink).filter(
            StudentTeacherLink.student_id == student_id,
            StudentTeacherLink.teacher_id == from_teacher.id,
        ).first()
        if old_link:
            db.delete(old_link)

    # Enrollments individuales (no grupales) activos con el profesor de origen.
    enrollments = db.query(Enrollment).filter(
        Enrollment.student_id == student_id,
        Enrollment.teacher_id == from_teacher.id,
        Enrollment.cohort_id.is_(None),
        Enrollment.status.in_([EnrollmentStatus.active, EnrollmentStatus.pending_renewal, EnrollmentStatus.pending_package_change]),
    ).all()
    for e in enrollments:
        e.teacher_id = to_teacher.id

    # Clases futuras/pendientes (no completadas/canceladas/no_show) individuales.
    future_classes = db.query(Class).filter(
        Class.student_id == student_id,
        Class.teacher_id == from_teacher.id,
        Class.class_type != ClassType.group,
        Class.status.notin_(["completed", "cancelled", "no_show", "expired"]),
    ).all()
    for c in future_classes:
        c.teacher_id = to_teacher.id

    link_student_to_teacher(db, student, to_teacher, old_teacher_username=from_teacher.user_username)

    log_god_mode_action(
        db,
        actor=current_user,
        action="student.transfer_teacher",
        entity_type="student",
        entity_id=student_id,
        reason=data.reason,
        before={"teacher_id": from_teacher.id},
        after={
            "teacher_id": to_teacher.id,
            "enrollments_transferred": len(enrollments),
            "classes_transferred": len(future_classes),
        },
    )

    db.commit()

    return {
        "message": f"Alumno transferido de {from_teacher.user_username} a {to_teacher.user_username} por Modo Dios.",
        "enrollments_transferred": len(enrollments),
        "future_classes_transferred": len(future_classes),
    }


# ─── LOOKUP (selectores inteligentes del panel de Modo Dios) ──────────────
#
# Endpoints de solo lectura para que el frontend arme selectores en
# cascada (profesor → alumno → enrollment/clase) en vez de pedir IDs a
# mano, que es una fuente constante de errores humanos.

@router.get("/lookup/teachers")
def god_mode_lookup_teachers(
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """
    superadmin: todos los profesores aprobados.
    teacher_admin: solo él mismo (coherente con el scope del resto del
    Modo Dios: un teacher_admin únicamente crea/gestiona sobre sí mismo
    como profesor).
    """
    query = db.query(TeacherProfile).filter(TeacherProfile.status == "approved")
    if current_user.role == UserRole.teacher_admin:
        query = query.filter(TeacherProfile.id == current_user.teacher_profile.id) if current_user.teacher_profile else query.filter(False)

    teachers = query.order_by(TeacherProfile.user_username).all()
    return [
        {
            "id": t.id,
            "username": t.user_username,
            "name": f"{t.user.name} {t.user.surname}" if t.user else t.user_username,
            "subjects": t.subjects or [],
        }
        for t in teachers
    ]


@router.get("/lookup/teachers/{teacher_id}/students")
def god_mode_lookup_teacher_students(
    teacher_id: int,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    teacher = db.query(TeacherProfile).filter(TeacherProfile.id == teacher_id).first()
    if not teacher:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profesor no encontrado")

    if current_user.role == UserRole.teacher_admin:
        teacher_profile = current_user.teacher_profile
        if not teacher_profile or teacher_id != teacher_profile.id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Como teacher_admin solo puedes ver tus propios alumnos.")

    links = db.query(StudentTeacherLink).filter(StudentTeacherLink.teacher_id == teacher_id).all()
    result = []
    for link in links:
        sp = link.student
        if not sp or not sp.user:
            continue
        result.append({
            "id": sp.id,
            "name": f"{sp.user.name} {sp.user.surname}",
            "username": sp.user_username,
        })
    result.sort(key=lambda s: s["name"])
    return result


@router.get("/lookup/students/{student_id}/enrollments")
def god_mode_lookup_student_enrollments(
    student_id: int,
    teacher_id: Optional[int] = Query(None, description="Filtra solo enrollments con este profesor"),
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    student = db.query(StudentProfile).filter(StudentProfile.id == student_id).first()
    if not student:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Estudiante no encontrado")

    query = db.query(Enrollment).filter(Enrollment.student_id == student_id)
    if teacher_id is not None:
        query = query.filter(Enrollment.teacher_id == teacher_id)

    if current_user.role == UserRole.teacher_admin:
        teacher_profile = current_user.teacher_profile
        if not teacher_profile:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "No tienes perfil de profesor.")
        query = query.filter(Enrollment.teacher_id == teacher_profile.id)

    enrollments = query.order_by(Enrollment.created_at.desc()).all()
    return [
        {
            "id": e.id,
            "package_name": e.package.name if e.package else "N/A",
            "subject": e.package.subject if e.package else None,
            "teacher_id": e.teacher_id,
            "classes_used": e.classes_used,
            "classes_total": e.classes_total,
            "status": e.status.value if hasattr(e.status, "value") else e.status,
            "is_group": bool(e.cohort_id),
            "is_unlimited": e.package.classes_count is None if e.package else False,
            "unlocked_credits": e.unlocked_credits,
            "prepaid_unlimited_credits": e.prepaid_unlimited_credits,
        }
        for e in enrollments
    ]


@router.get("/lookup/class-durations")
def god_mode_lookup_class_durations(
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """
    Duraciones de clase permitidas, configuradas por el superadmin en
    /admin/settings (PlatformConfig.allowed_class_durations). El panel
    de Modo Dios las usa para el selector de duración en vez de un
    input numérico libre, que podía terminar en una clase de una
    duración que la plataforma ni siquiera ofrece normalmente.
    """
    rules = get_business_rules(db)
    return {
        "allowed_class_durations": rules["allowed_class_durations"],
        "trial_duration_minutes": rules["trial_duration_minutes"],
    }


@router.get("/lookup/teachers/{teacher_id}/students/{student_id}/classes")
def god_mode_lookup_pair_classes(
    teacher_id: int,
    student_id: int,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """
    Clases existentes entre un profesor y un alumno puntuales — para
    elegir cuál reagendar / forzar estado / eliminar sin escribir el ID
    de la clase a mano. Ordenadas de más próxima a más lejana.
    """
    if current_user.role == UserRole.teacher_admin:
        teacher_profile = current_user.teacher_profile
        if not teacher_profile or teacher_id != teacher_profile.id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Como teacher_admin solo puedes ver tus propias clases.")

    classes = db.query(Class).filter(
        Class.teacher_id == teacher_id,
        Class.student_id == student_id,
    ).order_by(Class.start_time_utc.desc()).limit(100).all()

    return [
        {
            "id": c.id,
            "enrollment_id": c.enrollment_id,
            "subject": c.subject,
            "start_time_utc": c.start_time_utc.isoformat() if c.start_time_utc else None,
            "duration": c.duration,
            "status": c.status,
            "class_type": c.class_type.value if hasattr(c.class_type, "value") else c.class_type,
        }
        for c in classes
    ]
