from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.db.base import get_db
from app.auth.dependencies import get_current_user, get_current_teacher
from app.models.user import User
from app.models.teacher import TeacherProfile, TeacherStatus
from app.models.availability import TeacherAvailability, TeacherAvailabilityException
from app.models.class_ import Class
from app.schemas.availability import (
    WeeklySlotResponse,
    ExceptionResponse,
    ExceptionCreate,
    SetWeeklyAvailabilityRequest,
    AvailableSlotResponse,
)
from app.core.timezone import (
    UTC,
    utc_now,
    convert_local_time_to_utc_string,
    build_weekly_range_utc,
    get_available_slots_utc,
    is_slot_in_past,
    validate_timezone,
)

router = APIRouter()


# ─── ENDPOINTS DEL PROFESOR ─────────────────────────────────────────────────

@router.get(
    "/me/weekly",
    response_model=List[WeeklySlotResponse]
)
def get_my_weekly_availability(
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db)
):
    """Devuelve la disponibilidad semanal del profesor en UTC"""
    return db.query(TeacherAvailability).filter(
        TeacherAvailability.teacher_id == current_user.teacher_profile.id
    ).order_by(
        TeacherAvailability.day_of_week,
        TeacherAvailability.start_time_utc
    ).all()


@router.post(
    "/me/weekly",
    response_model=List[WeeklySlotResponse]
)
def set_my_weekly_availability(
    data: SetWeeklyAvailabilityRequest,
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db)
):
    """
    Reemplaza toda la disponibilidad semanal del profesor.
    Convierte las horas locales del profesor a UTC antes de guardar.
    """
    if not validate_timezone(data.timezone):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Zona horaria inválida: {data.timezone}"
        )

    teacher_id = current_user.teacher_profile.id

    # Borrar disponibilidad anterior
    db.query(TeacherAvailability).filter(
        TeacherAvailability.teacher_id == teacher_id
    ).delete()

    # Crear nueva disponibilidad convirtiendo a UTC
    new_slots = []
    for slot in data.slots:
        try:
            start_utc = convert_local_time_to_utc_string(
                slot.start_time_local,
                data.timezone
            )
            end_utc = convert_local_time_to_utc_string(
                slot.end_time_local,
                data.timezone
            )
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e)
            )

        new_slot = TeacherAvailability(
            teacher_id=teacher_id,
            day_of_week=slot.day_of_week,
            start_time_utc=start_utc,
            end_time_utc=end_utc,
            is_available=slot.is_available
        )
        db.add(new_slot)
        new_slots.append(new_slot)

    db.commit()
    for slot in new_slots:
        db.refresh(slot)

    return new_slots


@router.get(
    "/me/exceptions",
    response_model=List[ExceptionResponse]
)
def get_my_exceptions(
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db)
):
    """Devuelve todas las excepciones del profesor ordenadas por fecha"""
    return db.query(TeacherAvailabilityException).filter(
        TeacherAvailabilityException.teacher_id == current_user.teacher_profile.id
    ).order_by(
        TeacherAvailabilityException.start_time_utc
    ).all()


@router.post(
    "/me/exceptions",
    response_model=ExceptionResponse,
    status_code=status.HTTP_201_CREATED
)
def add_exception(
    data: ExceptionCreate,
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db)
):
    """
    Añade una excepción puntual.
    El frontend envía UTC directamente.
    """
    teacher_id = current_user.teacher_profile.id

    # Verificar que no haya solapamiento con excepciones existentes
    overlap = db.query(TeacherAvailabilityException).filter(
        TeacherAvailabilityException.teacher_id == teacher_id,
        TeacherAvailabilityException.start_time_utc < data.end_time_utc,
        TeacherAvailabilityException.end_time_utc > data.start_time_utc,
    ).first()

    if overlap:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ya existe una excepción en ese rango horario"
        )

    exception = TeacherAvailabilityException(
        teacher_id=teacher_id,
        start_time_utc=data.start_time_utc,
        end_time_utc=data.end_time_utc,
        is_available=data.is_available,
        reason=data.reason
    )
    db.add(exception)
    db.commit()
    db.refresh(exception)
    return exception


@router.delete("/me/exceptions/{exception_id}")
def delete_exception(
    exception_id: int,
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db)
):
    """Elimina una excepción del profesor"""
    exception = db.query(TeacherAvailabilityException).filter(
        TeacherAvailabilityException.id == exception_id,
        TeacherAvailabilityException.teacher_id == current_user.teacher_profile.id
    ).first()

    if not exception:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Excepción no encontrada"
        )

    db.delete(exception)
    db.commit()
    return {"message": "Excepción eliminada"}


# ─── ENDPOINT PÚBLICO (VISTA ESTUDIANTE) ────────────────────────────────────

@router.get(
    "/{teacher_username}/slots",
    response_model=List[AvailableSlotResponse]
)
def get_teacher_available_slots(
    teacher_username: str,
    date: str = Query(..., description="Fecha en formato YYYY-MM-DD"),
    duration: int = Query(60, description="Duración en minutos", ge=30, le=180),
    current_user: Optional[User] = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Devuelve los slots disponibles de un profesor para una fecha.
    Devuelve UTC. El frontend convierte a zona local del usuario.

    Proceso:
    1. Obtiene disponibilidad semanal del profesor para ese día
    2. Aplica excepciones (bloqueos o extras)
    3. Resta las clases ya agendadas
    4. Devuelve slots libres en UTC
    5. Marca los horarios como preferidos si el estudiante está logueado
    """

    # 1. Verificar que el profesor existe y está aprobado
    teacher = db.query(TeacherProfile).filter(
        TeacherProfile.user_username == teacher_username,
        TeacherProfile.status == TeacherStatus.approved
    ).first()

    if not teacher:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profesor no encontrado o no disponible"
        )

    # 2. Parsear la fecha
    try:
        dt = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=UTC)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Formato de fecha inválido. Usa YYYY-MM-DD"
        )

    # No permitir fechas pasadas
    today = utc_now().replace(hour=0, minute=0, second=0, microsecond=0)
    if dt < today:
        return []

    day_of_week = dt.weekday()  # 0=Lunes, 6=Domingo (ISO)

    # 3. Obtener disponibilidad base (horario semanal)
    weekly_slots = db.query(TeacherAvailability).filter(
        TeacherAvailability.teacher_id == teacher.id,
        TeacherAvailability.day_of_week == day_of_week,
        TeacherAvailability.is_available == True
    ).all()

    if not weekly_slots:
        return []

    # Construir rangos UTC para esta fecha concreta
    availability_ranges = []
    for slot in weekly_slots:
        try:
            start_utc, end_utc = build_weekly_range_utc(
                date,
                slot.start_time_utc,
                slot.end_time_utc
            )
            availability_ranges.append((start_utc, end_utc))
        except ValueError:
            continue

    if not availability_ranges:
        return []

    # 4. Obtener excepciones para esta fecha
    day_start = dt
    day_end = dt + timedelta(days=1)

    exceptions = db.query(TeacherAvailabilityException).filter(
        TeacherAvailabilityException.teacher_id == teacher.id,
        TeacherAvailabilityException.start_time_utc < day_end,
        TeacherAvailabilityException.end_time_utc > day_start,
    ).all()

    # Separar excepciones de bloqueo y de disponibilidad extra
    extra_availability = []
    busy_from_exceptions = []

    for exc in exceptions:
        if exc.is_available:
            extra_availability.append((exc.start_time_utc, exc.end_time_utc))
        else:
            busy_from_exceptions.append((exc.start_time_utc, exc.end_time_utc))

    # Añadir disponibilidad extra si existe
    availability_ranges.extend(extra_availability)

    # 5. Obtener clases ya agendadas del profesor ese día
    booked = db.query(Class).filter(
        Class.teacher_id == teacher.id,
        Class.start_time_utc >= day_start,
        Class.start_time_utc < day_end,
        Class.status.notin_(["cancelled"])
    ).all()

    busy_from_classes = [
        (c.start_time_utc, c.end_time_utc)
        for c in booked
    ]

    # 6. Calcular slots libres en UTC
    all_busy = busy_from_exceptions + busy_from_classes

    free_slots = get_available_slots_utc(
        availability_ranges=availability_ranges,
        busy_ranges=all_busy,
        duration_minutes=duration,
    )

    if not free_slots:
        return []

    # 7. Obtener preferencias del estudiante si está autenticado
    student_preferences = []
    if current_user and current_user.student_profile:
        from app.models.student_preferences import StudentSchedulePreference
        prefs = db.query(StudentSchedulePreference).filter(
            StudentSchedulePreference.student_id == current_user.student_profile.id,
            StudentSchedulePreference.day_of_week == day_of_week
        ).all()
        student_preferences = [
            (p.start_time_utc, p.end_time_utc)
            for p in prefs
        ]

    # Función interna para evaluar si el slot es preferido
    def is_preferred_slot(slot_utc: datetime, preferences: list) -> bool:
        slot_time_str = slot_utc.strftime("%H:%M")
        for start_utc_str, end_utc_str in preferences:
            if start_utc_str <= slot_time_str < end_utc_str:
                return True
        return False

    # 8. Construir respuesta final
    duration_td = timedelta(minutes=duration)

    result = []
    for slot_start in free_slots:
        slot_end = slot_start + duration_td

        result.append(AvailableSlotResponse(
            start_time_utc=slot_start,
            end_time_utc=slot_end,
            duration_minutes=duration,
            is_past=is_slot_in_past(slot_start),
            is_preferred=is_preferred_slot(slot_start, student_preferences)
        ))

    return result

@router.get(
    "/featured-teacher/slots",
    response_model=List[AvailableSlotResponse]
)
def get_featured_teacher_slots(
    date: str = Query(...),
    duration: int = Query(60, ge=30, le=180),
    current_user: Optional[User] = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Slots disponibles de la profesora featured.
    Shortcut para el modo single-tenant — el frontend
    no necesita saber el username de la profesora.

    Internamente llama al mismo endpoint de slots
    con el username de la profesora featured.
    """
    from app.models.payment_config import PlatformConfig
    from app.core.config import settings

    # 1. Intentar obtener de la BD
    config = db.query(PlatformConfig).first()

    teacher_username = None

    if config and config.featured_teacher_id:
        teacher = db.query(TeacherProfile).filter(
            TeacherProfile.id == config.featured_teacher_id
        ).first()
        if teacher:
            teacher_username = teacher.user_username

    # 2. Fallback a variable de entorno
    if not teacher_username:
        teacher_username = settings.FEATURED_TEACHER_USERNAME

    if not teacher_username:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No hay profesora featured configurada"
        )

    # 3. Reusar el endpoint existente
    return get_teacher_available_slots(
        teacher_username=teacher_username,
        date=date,
        duration=duration,
        current_user=current_user,
        db=db,
    )