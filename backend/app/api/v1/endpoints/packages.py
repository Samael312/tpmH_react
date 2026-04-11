from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from app.db.base import get_db
from app.auth.dependencies import (
    get_current_student,
    get_current_teacher_or_teacher_admin,
    get_current_staff,
)
from app.models.user import User
from app.models.package import Package, Enrollment, EnrollmentStatus
from app.models.teacher import TeacherProfile
from app.schemas.packages import (
    PackageCreate,
    PackageResponse,
    EnrollmentResponse,
    RenewalRequest,
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
    El estudiante solicita renovar su paquete.

    Puede elegir:
    - El mismo paquete (repetir)
    - Otro paquete del mismo profesor (cambiar)

    El enrollment pasa a 'pending_renewal'.
    El staff lo activa al confirmar el pago.
    """
    # Verificar enrollment actual
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

    # Verificar que el nuevo paquete existe y es del mismo profesor
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

    # Verificar que no hay ya una renovación pendiente
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

    # Marcar el enrollment actual como pending_renewal
    # No creamos el nuevo hasta que el staff confirme el pago
    current_enrollment.status = EnrollmentStatus.pending_renewal
    db.commit()

    return {
        "message": "Solicitud de renovación enviada. "
                   "El staff la activará al confirmar tu pago.",
        "enrollment_id": current_enrollment.id,
        "requested_package": new_package.name,
        "price": new_package.price,
    }


# ─── STAFF — Activar renovación ──────────────────────────────────────────────

@router.post("/{enrollment_id}/activate-renewal")
def activate_renewal(
    enrollment_id: int,
    new_package_id: int,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db)
):
    """
    El staff activa la renovación tras confirmar el pago.

    Proceso:
    1. Marca el enrollment anterior como 'completed'
    2. Crea un nuevo enrollment con el nuevo paquete
    3. El estudiante puede volver a agendar clases
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

    new_package = db.query(Package).filter(
        Package.id == new_package_id,
        Package.is_active == True
    ).first()

    if not new_package:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Paquete no encontrado"
        )

    # Completar el enrollment anterior
    old_enrollment.status = EnrollmentStatus.completed

    # Crear nuevo enrollment
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