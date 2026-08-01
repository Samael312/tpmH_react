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
    EnrollmentComplianceResponse
)

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
    Incluye activos, completados y en renovación.
    """
    return db.query(Enrollment).filter(
        Enrollment.student_id == current_user.student_profile.id
    ).order_by(Enrollment.created_at.desc()).all()


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

@router.post("/{enrollment_id}/activate-renewal")
def activate_renewal(
    enrollment_id: int,
    new_package_id: Optional[int] = None,
    current_user: User = Depends(get_current_staff_or_teacher),
    db: Session = Depends(get_db)
):
    """
    El staff o el profesor dueño del enrollment activa la renovación
    tras confirmar el pago (fuera de la plataforma).

    Si no se pasa new_package_id, se usa el que el estudiante pidió
    al solicitar la renovación.
    """
    old_enrollment = db.query(Enrollment).filter(
        Enrollment.id == enrollment_id,
        Enrollment.status == EnrollmentStatus.pending_renewal
    ).first()

    if not old_enrollment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Solicitud de renovación no encontrada"
        )

    # Un profesor solo puede aprobar renovaciones de sus propios estudiantes
    if current_user.role == "teacher":
        if not current_user.teacher_profile or old_enrollment.teacher_id != current_user.teacher_profile.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Solo puedes aprobar renovaciones de tus propios estudiantes"
            )

    target_package_id = new_package_id or old_enrollment.renewal_requested_package_id
    if not target_package_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se especificó qué paquete activar"
        )

    new_package = db.query(Package).filter(
        Package.id == target_package_id,
        Package.is_active == True
    ).first()

    if not new_package:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Paquete no encontrado"
        )

    old_enrollment.status = EnrollmentStatus.completed

    new_enrollment = Enrollment(
        student_id=old_enrollment.student_id,
        package_id=new_package.id,
        teacher_id=old_enrollment.teacher_id,
        classes_used=0,
        classes_total=new_package.classes_count,
        status=EnrollmentStatus.active,
        renewal_count=old_enrollment.renewal_count + 1,
        previous_enrollment_id=old_enrollment.id,
    )

    db.add(new_enrollment)
    db.commit()
    db.refresh(new_enrollment)

    return {
        "message": "Renovación activada correctamente",
        "new_enrollment_id": new_enrollment.id,
        "package": new_package.name,
        "classes_total": new_enrollment.classes_total,
        "renewal_count": new_enrollment.renewal_count,
    }

@router.post("/select-initial")
def select_initial_package(
    package_id: int,
    current_user: User = Depends(get_current_student),
    db: Session = Depends(get_db)
):
    """
    El estudiante elige su primer paquete, solo permitido justo
    después de completar la clase de prueba (stage == needs_package).
    """
    from app.core.class_logic import get_student_booking_stage

    student_id = current_user.student_profile.id
    stage = get_student_booking_stage(student_id, db)

    if stage != "needs_package":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Solo puedes elegir tu paquete inicial después de completar la clase de prueba."
        )

    package = db.query(Package).filter(
        Package.id == package_id,
        Package.is_active == True
    ).first()
    if not package:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Paquete no encontrado")

    enrollment = Enrollment(
        student_id=student_id,
        package_id=package.id,
        teacher_id=package.teacher_id,
        classes_used=0,
        classes_total=package.classes_count,
        status=EnrollmentStatus.active,
    )
    db.add(enrollment)
    db.commit()
    db.refresh(enrollment)

    return {
        "message": "Paquete activado. Ya puedes agendar tus clases.",
        "enrollment_id": enrollment.id,
        "classes_total": enrollment.classes_total,
    }

