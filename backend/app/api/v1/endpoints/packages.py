# app/routers/packages.py

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import timedelta

from app.db.base import get_db
from app.auth.dependencies import (
    get_current_student,
    get_current_teacher_or_teacher_admin,
    get_current_staff,
    get_current_staff_or_teacher,
)
from app.models.class_ import Class, ClassType 
from app.core.timezone import utc_now             
from app.core.class_logic import get_business_rules
from app.models.user import User
from app.models.package import Package, Enrollment, EnrollmentStatus
from app.models.teacher import TeacherProfile
from app.schemas.packages import (
    PackageCreate,
    PackageResponse,
    EnrollmentResponse,
    RenewalRequest,
    EnrollmentComplianceResponse,
    PackageChangeRequest,
    PackageChangeApprovalResponse,
)

PACKAGE_CHANGE_BLOCKING_STATUSES = [
    "completed", "no_show", "confirmed", "pending",
    "pending_trial", "pending_payment", "rescheduled", "finalized",
]

router = APIRouter()


# ─── PROFESOR — Gestión de paquetes ─────────────────────────────────────────

@router.post("/", response_model=PackageResponse, status_code=status.HTTP_201_CREATED)
def create_package(
    data: PackageCreate,
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db)
):
    """El profesor crea un paquete de clases"""
    pkg_data = data.model_dump()
    if pkg_data.get("allow_installments") and pkg_data.get("installment_count"):
        if not pkg_data.get("installment_amount"):
            pkg_data["installment_amount"] = round(pkg_data["price"] / pkg_data["installment_count"], 2)

    package = Package(
        teacher_id=current_user.teacher_profile.id,
        **pkg_data
    )
    db.add(package)
    db.commit()
    db.refresh(package)
    return package


@router.get("/my-packages", response_model=List[PackageResponse])
def get_my_packages(
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db)
):
    """Paquetes del profesor"""
    return db.query(Package).filter(
        Package.teacher_id == current_user.teacher_profile.id,
        Package.is_active == True
    ).all()


@router.patch("/{package_id}", response_model=PackageResponse)
def update_package(
    package_id: int,
    data: PackageCreate,
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db)
):
    """Actualizar un paquete"""
    package = db.query(Package).filter(
        Package.id == package_id,
        Package.teacher_id == current_user.teacher_profile.id
    ).first()

    if not package:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Paquete no encontrado"
        )

    update_data = data.model_dump(exclude_unset=True)

    allow_inst = update_data.get("allow_installments", package.allow_installments)
    inst_count = update_data.get("installment_count", package.installment_count)
    price = update_data.get("price", package.price)

    if allow_inst and inst_count:
        if update_data.get("installment_amount") is None:
            update_data["installment_amount"] = round(price / inst_count, 2)
    else:
        update_data["installment_amount"] = None

    for field, value in update_data.items():
        setattr(package, field, value)

    db.commit()
    db.refresh(package)
    return package


@router.delete("/{package_id}")
def deactivate_package(
    package_id: int,
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db)
):
    """Desactivar un paquete — no se borra para conservar enrollments"""
    package = db.query(Package).filter(
        Package.id == package_id,
        Package.teacher_id == current_user.teacher_profile.id
    ).first()

    if not package:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Paquete no encontrado"
        )

    package.is_active = False
    db.commit()
    return {"message": "Paquete desactivado"}


# ─── PROFESOR — Seguimiento de cumplimiento ──────────────────────────────────

@router.get("/teacher/enrollments", response_model=List[EnrollmentComplianceResponse])
def get_teacher_enrollments_overview(
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db)
):
    """
    Lista todos los enrollments (activos, agotados y pendientes de
    renovación) de los estudiantes del profesor, con el desglose de
    cumplimiento: completadas, no-show y canceladas tarde.
    """
    teacher_id = current_user.teacher_profile.id
    min_cancel_hours = get_business_rules(db)["min_cancel_hours"]

    enrollments = db.query(Enrollment).filter(
        Enrollment.teacher_id == teacher_id
    ).order_by(Enrollment.created_at.desc()).all()

    result = []
    for e in enrollments:
        classes = db.query(Class).filter(Class.enrollment_id == e.id).all()

        # BUG-02 fix: "finalized" es un estado transitorio (le da margen al
        # profesor para resolver la clase) y no debe contar como completada.
        completed_count = sum(1 for c in classes if c.status == "completed")
        no_show_count = sum(1 for c in classes if c.status == "no_show")
        cancelled_late_count = sum(
            1 for c in classes
            if c.status == "cancelled"
            and c.updated_at is not None
            and (c.start_time_utc - c.updated_at) < timedelta(hours=min_cancel_hours)
        )

        if e.package and e.package.classes_count is not None:
            occupied_slots = sum(1 for c in classes if c.status != "cancelled")
            available_credits = max((e.unlocked_credits or 0) - occupied_slots, 0)
        elif e.package:
            available_credits = e.prepaid_unlimited_credits or 0
        else:
            available_credits = None

        student_user = e.student.user if e.student else None
        package = e.package

        requested_pkg_name = None
        if e.renewal_requested_package_id:
            rp = db.query(Package).filter(Package.id == e.renewal_requested_package_id).first()
            requested_pkg_name = rp.name if rp else None

        change_pkg_name = None
        if e.change_requested_package_id:
            cp = db.query(Package).filter(Package.id == e.change_requested_package_id).first()
            change_pkg_name = cp.name if cp else None

        result.append(EnrollmentComplianceResponse(
            id=e.id,
            student_id=e.student_id,
            student_username=student_user.username if student_user else "unknown",
            student_name=f"{student_user.name} {student_user.surname}" if student_user else "Desconocido",
            package_id=e.package_id,
            package_name=package.name if package else "N/A",
            classes_used=e.classes_used,
            classes_total=e.classes_total,
            available_credits=available_credits,
            status=e.status,
            completed_count=completed_count,
            no_show_count=no_show_count,
            cancelled_late_count=cancelled_late_count,
            renewal_requested_package_name=requested_pkg_name,
            change_requested_package_name=change_pkg_name,
            created_at=e.created_at,
        ))

    return result


# ─── PÚBLICO — Ver paquetes de un profesor ───────────────────────────────────

@router.get(
    "/teacher/{teacher_username}",
    response_model=List[PackageResponse]
)
def get_teacher_packages(
    teacher_username: str,
    subject: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """
    Paquetes disponibles de un profesor.
    Filtrable por materia.
    Endpoint público.
    """
    teacher = db.query(TeacherProfile).filter(
        TeacherProfile.user_username == teacher_username
    ).first()

    if not teacher:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profesor no encontrado"
        )

    query = db.query(Package).filter(
        Package.teacher_id == teacher.id,
        Package.is_active == True
    )

    if subject:
        query = query.filter(Package.subject == subject)

    return query.all()


# ─── ESTUDIANTE — Enrollments y renovación ───────────────────────────────────

@router.get("/my-enrollments", response_model=List[EnrollmentResponse])
def get_my_enrollments(
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    """
    Enrollments del estudiante.
    Incluye activos, completados y en renovación, junto con el
    nombre del profesor para mostrarlo en el dashboard.
    """
    enrollments = db.query(Enrollment).filter(
        Enrollment.student_id == current_user.student_profile.id
    ).order_by(Enrollment.created_at.desc()).all()

    result = []
    for e in enrollments:
        teacher_user = e.teacher.user if e.teacher and e.teacher.user else None

        if e.package.classes_count is not None:
            occupied_slots = db.query(Class).filter(
                Class.enrollment_id == e.id,
                Class.status != "cancelled",
            ).count()
            available_credits = max((e.unlocked_credits or 0) - occupied_slots, 0)
        else:
            available_credits = e.prepaid_unlimited_credits or 0

        result.append(EnrollmentResponse(
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
        ))

    return result


@router.post("/request-renewal")
def request_renewal(
    data: RenewalRequest,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    """
    El estudiante solicita renovar su paquete (mismo u otro del mismo
    profesor). El enrollment pasa a 'pending_renewal' y se guarda cuál
    paquete pidió.
    """
    current_enrollment = db.query(Enrollment).filter(
        Enrollment.id == data.current_enrollment_id,
        Enrollment.student_id == current_user.student_profile.id
    ).first()

    if not current_enrollment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Enrollment no encontrado"
        )

    if current_enrollment.status not in [
        EnrollmentStatus.active,
        EnrollmentStatus.completed
    ]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Solo puedes renovar un paquete activo o completado"
        )

    new_package = db.query(Package).filter(
        Package.id == data.new_package_id,
        Package.teacher_id == current_enrollment.teacher_id,
        Package.is_active == True
    ).first()

    if not new_package:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Paquete no encontrado o no disponible"
        )

    existing_renewal = db.query(Enrollment).filter(
        Enrollment.student_id == current_user.student_profile.id,
        Enrollment.teacher_id == current_enrollment.teacher_id,
        Enrollment.status == EnrollmentStatus.pending_renewal
    ).first()

    if existing_renewal:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ya tienes una solicitud de renovación pendiente"
        )

    current_enrollment.status = EnrollmentStatus.pending_renewal
    current_enrollment.renewal_requested_package_id = new_package.id
    current_enrollment.installments_paid = 0  # arranca limpio: cuotas del ciclo anterior no aplican al nuevo
    db.commit()

    return {
        "message": "Solicitud de renovación enviada. Tu profesor(a) la activará al confirmar tu pago.",
        "enrollment_id": current_enrollment.id,
        "requested_package": new_package.name,
        "price": new_package.price,
    }


# ─── ESTUDIANTE — Cambio de paquete ──────────────────────────────────────────

@router.post("/request-package-change")
def request_package_change(
    data: PackageChangeRequest,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    """
    El estudiante solicita cambiar de paquete manteniendo la relación activa.
    """
    current_enrollment = db.query(Enrollment).filter(
        Enrollment.id == data.current_enrollment_id,
        Enrollment.student_id == current_user.student_profile.id,
    ).first()

    if not current_enrollment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Enrollment no encontrado"
        )

    if current_enrollment.status != EnrollmentStatus.active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Solo puedes solicitar un cambio de paquete si tu paquete actual está activo. Si ya lo agotaste, usa la opción de renovar."
        )

    # Regla de negocio 3.2: bloquear el cambio mientras haya cuotas (o
    # cualquier saldo) pendiente de pago en el paquete actual. Ver el
    # mismo chequeo en notify_payment() (payments.py), fuente de verdad
    # del flujo que realmente usa el frontend.
    if current_enrollment.payment_status != "paid":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Debes completar el pago de tu paquete actual antes de poder cambiarlo."
        )

    new_package = db.query(Package).filter(
        Package.id == data.new_package_id,
        Package.teacher_id == current_enrollment.teacher_id,
        Package.is_active == True
    ).first()

    if not new_package:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Paquete no encontrado, no disponible, o no pertenece a tu profesor actual."
        )

    if new_package.id == current_enrollment.package_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ya tienes este paquete activo"
        )

    if new_package.classes_count is not None:
        occupied_slots = db.query(Class).filter(
            Class.enrollment_id == current_enrollment.id,
            Class.status.in_(PACKAGE_CHANGE_BLOCKING_STATUSES)
        ).count()

        if occupied_slots > new_package.classes_count:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"No puedes cambiar a este paquete: tienes {occupied_slots} clases "
                    f"usadas o agendadas y el nuevo paquete solo permite {new_package.classes_count}. "
                    "Cancela algunas clases futuras primero o elige un paquete con más clases."
                )
            )

    current_enrollment.status = EnrollmentStatus.pending_package_change
    current_enrollment.change_requested_package_id = new_package.id
    db.commit()

    return {
        "message": "Solicitud de cambio de paquete enviada. Tu profesor(a) o el staff la aprobará en breve.",
        "enrollment_id": current_enrollment.id,
        "requested_package": new_package.name,
        "price": new_package.price,
    }


@router.post("/{enrollment_id}/cancel-package-change")
def cancel_package_change(
    enrollment_id: int,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    """
    El estudiante cancela su solicitud de cambio de paquete.
    """
    enrollment = db.query(Enrollment).filter(
        Enrollment.id == enrollment_id,
        Enrollment.student_id == current_user.student_profile.id,
        Enrollment.status == EnrollmentStatus.pending_package_change,
    ).first()

    if not enrollment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No tienes una solicitud de cambio de paquete pendiente para este enrollment"
        )

    enrollment.status = EnrollmentStatus.active
    enrollment.change_requested_package_id = None
    db.commit()

    return {"message": "Solicitud de cambio de paquete cancelada. Tu paquete original sigue activo."}


@router.get("/enrollment/{enrollment_id}")
def get_enrollment_package(
    enrollment_id: int,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    """
    Obtiene los detalles del paquete asignado a un enrollment.
    """
    enrollment = db.query(Enrollment).filter(
        Enrollment.id == enrollment_id,
        Enrollment.student_id == current_user.student_profile.id
    ).first()
    if not enrollment:
        raise HTTPException(status_code=404, detail="Enrollment no encontrado")

    target_pkg_id = (
        enrollment.renewal_requested_package_id
        or enrollment.change_requested_package_id
        or enrollment.package_id
    )
    package = db.query(Package).filter(Package.id == target_pkg_id).first()

    return {
        "package": package,
        "installments_paid": enrollment.installments_paid,
        "payment_status": enrollment.payment_status,
        "enrollment_id": enrollment.id
    }