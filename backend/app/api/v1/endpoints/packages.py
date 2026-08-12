#models/packages.py

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from app.db.base import get_db
from app.auth.dependencies import (
    get_current_student,
    get_current_teacher_or_teacher_admin,
    get_current_staff,
    get_current_staff_or_teacher,
)
from app.models.class_ import Class, ClassType 
from app.core.timezone import utc_now             
from datetime import timedelta 
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

PACKAGE_CHANGE_BLOCKING_STATUSES = ["completed", "no_show", "confirmed", "pending"]

router = APIRouter()


# ─── PROFESOR — Gestión de paquetes ─────────────────────────────────────────

@router.post("/", response_model=PackageResponse, status_code=status.HTTP_201_CREATED)
def create_package(
    data: PackageCreate,
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db)
):
    """El profesor crea un paquete de clases"""
    package = Package(
        teacher_id=current_user.teacher_profile.id,
        name=data.name,
        subject=data.subject,
        description=data.description,
        description_type=data.description_type,
        description_items=data.description_items,
        icon=data.icon,
        color=data.color,
        classes_count=data.classes_count,
        price=data.price,
        duration_minutes=data.duration_minutes,
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

    for field, value in data.model_dump(exclude_unset=True).items():
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

    enrollments = db.query(Enrollment).filter(
        Enrollment.teacher_id == teacher_id
    ).order_by(Enrollment.created_at.desc()).all()

    result = []
    for e in enrollments:
        classes = db.query(Class).filter(Class.enrollment_id == e.id).all()

        completed_count = sum(1 for c in classes if c.status in ("completed", "finalized"))
        no_show_count = sum(1 for c in classes if c.status == "no_show")
        # Aproximamos "cancelada tarde" comparando contra cuándo se actualizó
        # el registro, ya que no guardamos un timestamp específico de cancelación.
        cancelled_late_count = sum(
            1 for c in classes
            if c.status == "cancelled"
            and c.updated_at is not None
            and (c.start_time_utc - c.updated_at) < timedelta(hours=12)
        )

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
            status=e.status,
            completed_count=completed_count,
            no_show_count=no_show_count,
            cancelled_late_count=cancelled_late_count,
            renewal_requested_package_name=requested_pkg_name,
            change_requested_package_name=change_pkg_name,
            created_at=e.created_at,
        ))

    return result

@router.get("/admin/pending-requests")
def get_all_pending_requests(
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db)
):
    """
    Lista TODAS las solicitudes pendientes (renovación y cambio de
    paquete) de toda la plataforma, sin importar el profesor. Pensado
    para que superadmin/teacher_admin puedan aprobar sin depender de
    que el profesor dueño entre a su propio panel.
    """
    enrollments = db.query(Enrollment).filter(
        Enrollment.status.in_([
            EnrollmentStatus.pending_renewal,
            EnrollmentStatus.pending_package_change,
        ])
    ).order_by(Enrollment.created_at.desc()).all()

    result = []
    for e in enrollments:
        classes = db.query(Class).filter(Class.enrollment_id == e.id).all()

        completed_count = sum(1 for c in classes if c.status in ("completed", "finalized"))
        no_show_count = sum(1 for c in classes if c.status == "no_show")
        cancelled_late_count = sum(
            1 for c in classes
            if c.status == "cancelled"
            and c.updated_at is not None
            and (c.start_time_utc - c.updated_at) < timedelta(hours=12)
        )

        student_user = e.student.user if e.student else None
        package = e.package
        teacher_user = e.teacher.user if e.teacher and e.teacher.user else None

        requested_pkg_name = None
        if e.renewal_requested_package_id:
            rp = db.query(Package).filter(Package.id == e.renewal_requested_package_id).first()
            requested_pkg_name = rp.name if rp else None

        change_pkg_name = None
        if e.change_requested_package_id:
            cp = db.query(Package).filter(Package.id == e.change_requested_package_id).first()
            change_pkg_name = cp.name if cp else None

        item = EnrollmentComplianceResponse(
            id=e.id,
            student_id=e.student_id,
            student_username=student_user.username if student_user else "unknown",
            student_name=f"{student_user.name} {student_user.surname}" if student_user else "Desconocido",
            package_id=e.package_id,
            package_name=package.name if package else "N/A",
            classes_used=e.classes_used,
            classes_total=e.classes_total,
            status=e.status,
            completed_count=completed_count,
            no_show_count=no_show_count,
            cancelled_late_count=cancelled_late_count,
            renewal_requested_package_name=requested_pkg_name,
            change_requested_package_name=change_pkg_name,
            created_at=e.created_at,
        )
        # Campos extra solo para esta vista (no rompen el schema porque
        # Pydantic v2 permite atributos dinámicos vía model_dump si se
        # usan aparte) — los añadimos como dict al final en vez de forzarlos
        # al schema tipado, para no tener que tocar EnrollmentComplianceResponse.
        result.append({
            **item.model_dump(),
            "teacher_username": teacher_user.username if teacher_user else "unknown",
            "teacher_name": f"{teacher_user.name} {teacher_user.surname}" if teacher_user else "Desconocido",
        })

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

        result.append(EnrollmentResponse(
            id=e.id,
            student_id=e.student_id,
            package_id=e.package_id,
            teacher_id=e.teacher_id,
            classes_used=e.classes_used,
            classes_total=e.classes_total,
            status=e.status,
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
    paquete pidió, para que el staff/profesor no tenga que preguntarle
    de nuevo al aprobar.
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
    db.commit()

    return {
        "message": "Solicitud de renovación enviada. "
                   "Tu profesor(a) la activará al confirmar tu pago.",
        "enrollment_id": current_enrollment.id,
        "requested_package": new_package.name,
        "price": new_package.price,
    }


# ─── STAFF — Activar renovación ──────────────────────────────────────────────


@router.post("/select-initial")
def select_initial_package(
    package_id: int,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    """
    El estudiante elige su primer paquete con UN profesor, solo permitido
    justo después de completar la clase de prueba con ese mismo profesor
    (stage == needs_package para esa relación específica).
    """
    from app.core.class_logic import get_student_booking_stage

    student_id = current_user.student_profile.id

    package = db.query(Package).filter(
        Package.id == package_id,
        Package.is_active == True
    ).first()
    if not package:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Paquete no encontrado")

    stage = get_student_booking_stage(student_id, package.teacher_id, db)

    if stage != "needs_package":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Solo puedes elegir tu paquete inicial después de completar la clase de prueba con este profesor."
        )

    # Se crea el enrollment con 0 créditos desbloqueados y estado "unpaid".
    # El frontend debe llamar a /notify-payment inmediatamente después.
    enrollment = Enrollment(
        student_id=student_id,
        package_id=package.id,
        teacher_id=package.teacher_id,
        classes_used=0,
        classes_total=package.classes_count,
        unlocked_credits=0,
        payment_installment_status="unpaid",
        status=EnrollmentStatus.active,
    )
    db.add(enrollment)
    db.commit()
    db.refresh(enrollment)

    return {
        "message": "Paquete seleccionado. Procede a notificar el pago para desbloquear tus créditos.",
        "enrollment_id": enrollment.id,
        "package_id": package.id,
        "classes_total": enrollment.classes_total,
        "unlocked_credits": enrollment.unlocked_credits,
        "payment_installment_status": enrollment.payment_installment_status,
    }

# ─── ESTUDIANTE — Cambio de paquete (paquete actual sigue activo) ───────────

# Estados de clase que "ocupan" un cupo del paquete al validar un cambio:
# completed/no_show = ya sucedieron y cuentan como usadas; confirmed = clase
# futura ya confirmada; pending = clase futura reservada pero sin confirmar
# pago todavía. finalized/cancelled no cuentan (finalized ya se resolvió
# aparte, cancelled liberó su cupo).



@router.post("/request-package-change")
def request_package_change(
    data: PackageChangeRequest,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    """
    El estudiante solicita cambiar de paquete (con el MISMO profesor)
    mientras el paquete actual sigue activo. No crea un enrollment nuevo:
    al aprobarse, este mismo enrollment se actualiza in-place.

    Se rechaza si:
    - El enrollment no está 'active' (agotado → usar renovación; ya tiene
      una solicitud pendiente; cancelado, etc.)
    - El paquete nuevo no pertenece al mismo profesor o no está activo
    - Las clases que ya ocupan un cupo (completed/no_show/confirmed/pending)
      superan el límite del paquete nuevo
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
            detail="Solo puedes solicitar un cambio de paquete si tu paquete actual está activo. "
                   "Si ya lo agotaste, usa la opción de renovar."
        )

    new_package = db.query(Package).filter(
        Package.id == data.new_package_id,
        Package.teacher_id == current_enrollment.teacher_id,
        Package.is_active == True
    ).first()

    if not new_package:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Paquete no encontrado, no disponible, o no pertenece a tu profesor actual. "
                   "Solo puedes cambiar de paquete dentro del mismo profesor."
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
        "message": "Solicitud de cambio de paquete enviada. "
                   "Tu profesor(a) o el staff la aprobará en breve.",
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
    El enrollment vuelve a 'active' tal cual estaba, sin ningún cambio.
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
        "enrollment_id": enrollment.id
    }

