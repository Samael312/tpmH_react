from fastapi import APIRouter, Depends, HTTPException, Request, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import os
from datetime import datetime, timedelta, time
from zoneinfo import ZoneInfo
from app.db.base import get_db
from app.core.rate_limit import limiter
from app.auth.dependencies import get_current_user, get_current_teacher
from app.models.user import User, UserRole
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
    build_weekly_range_utc,
    get_all_slots_utc,
    is_slot_in_past,
    is_slot_too_soon,
    validate_timezone,
)
from app.core.google_calendar import FreebusyError, get_teacher_busy_ranges
from app.core.slot_availability import (
    window_for_local_dates,
    load_teacher_window,
    compute_slot_grid,
    preference_intervals_for_window,
)
from app.core.slots_cache import Uncacheable, cached_slot_grid
from app.core.platform_config import get_platform_config  # Fase 14, E9: una lectura por petición

# Slots es publico: tope por IP (los repetidos los absorbe la cache de rejilla). Subir si hay muchos alumnos tras una misma IP.
SLOTS_RATE_LIMIT = "120/minute"

# Fase 24: contrato de `date` en /slots. Con `tz`, `date` es el dia CALENDARIO en esa zona (la del
# que mira) y se devuelven los huecos que EMPIEZAN en [00:00, 24:00) de ese dia en esa zona. Sin `tz`
# (clientes antiguos) es el dia UTC, como siempre. `end_date` (opcional, inclusive, max 14 dias)
# amplia la ventana a varios dias locales.
TZ_PARAM_DESC = ("Zona IANA de quien mira (p. ej. America/Bogota). Con ella `date` es el dia local en esa zona; "
                 "sin ella, el dia UTC (compatibilidad).")
END_DATE_PARAM_DESC = "Ultimo dia local (YYYY-MM-DD, inclusive) de la ventana; por defecto igual a `date`. Maximo 14 dias."
MAX_SLOTS_WINDOW_DAYS = 14

router = APIRouter()


# ─── ENDPOINTS DEL PROFESOR ─────────────────────────────────────────────────

def _weekly_response(rows, tz_name: str) -> List[WeeklySlotResponse]:
    return [WeeklySlotResponse(
        id=r.id, teacher_id=r.teacher_id, day_of_week=r.day_of_week,
        start_time_local=r.start_time_local, end_time_local=r.end_time_local,
        is_available=bool(r.is_available), timezone=tz_name) for r in rows]


@router.get(
    "/me/weekly",
    response_model=List[WeeklySlotResponse]
)
def get_my_weekly_availability(
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db)
):
    """Devuelve la disponibilidad semanal del profesor en su HORA LOCAL (Fase 26): `day_of_week` local,
    `start_time_local`/`end_time_local` y la zona IANA (`timezone`) con la que se interpreta."""
    profile = current_user.teacher_profile
    rows = db.query(TeacherAvailability).filter(
        TeacherAvailability.teacher_id == profile.id
    ).order_by(
        TeacherAvailability.day_of_week,
        TeacherAvailability.start_time_local
    ).all()
    return _weekly_response(rows, profile.timezone or "UTC")


@router.put(
    "/me/weekly",
    response_model=List[WeeklySlotResponse]
)
def set_my_weekly_availability(
    data: SetWeeklyAvailabilityRequest,
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db)
):
    """
    Reemplaza la disponibilidad semanal del profesor. Se guarda en HORA LOCAL (Fase 26, sin conversion a
    UTC): el UTC de cada fecha se calcula al consultar, asi el horario de verano no la desplaza. La zona
    en la que se escribe (`timezone`) es la del perfil: si difiere, el perfil pasa a esa zona (con el
    mismo efecto que cambiarla en PATCH /teachers/me/profile).
    """
    if not validate_timezone(data.timezone):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Zona horaria inválida: {data.timezone}"
        )

    profile = current_user.teacher_profile
    teacher_id = profile.id
    if data.timezone != profile.timezone:
        from app.core.schedule_recalc import apply_teacher_timezone_change
        apply_teacher_timezone_change(profile, data.timezone, db)

    db.query(TeacherAvailability).filter(
        TeacherAvailability.teacher_id == teacher_id
    ).delete()

    new_slots = []
    for slot in data.slots:
        new_slot = TeacherAvailability(
            teacher_id=teacher_id,
            day_of_week=slot.day_of_week,
            start_time_local=slot.start_time_local,
            end_time_local=slot.end_time_local,
            is_available=slot.is_available,
        )
        db.add(new_slot)
        new_slots.append(new_slot)

    db.commit()
    for slot in new_slots:
        db.refresh(slot)

    return _weekly_response(new_slots, profile.timezone)


@router.get(
    "/me/exceptions",
    response_model=List[ExceptionResponse]
)
def get_my_exceptions(
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db)
):
    """Devuelve todas las excepciones del profesor ordenadas por fecha"""
    exceptions = db.query(TeacherAvailabilityException).filter(
        TeacherAvailabilityException.teacher_id == current_user.teacher_profile.id
    ).order_by(
        TeacherAvailabilityException.start_time_utc
    ).all()
    
    # Aquí está la clave: mapear cada objeto de la BD usando la función auxiliar
    return [_to_exception_response(exc) for exc in exceptions]


@router.post(
    "/me/exceptions",
    response_model=List[ExceptionResponse],  # ✅ CORREGIDO A List[]
    status_code=status.HTTP_201_CREATED
)
def add_exception(
    data: ExceptionCreate,
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db)
):
    """
    Añade una o varias excepciones puntuales (día completo u horas
    específicas), opcionalmente sobre un rango de fechas (ej. vacaciones).
    El profesor envía fecha(s) + hora LOCAL + su zona horaria; el backend
    convierte a UTC usando la fecha real de cada día (sin ambigüedad de DST).

    is_available=False → bloquea ese rango (fuente de la verdad, aunque
    el horario semanal lo tenga como disponible).
    is_available=True  → agrega disponibilidad extra puntual.
    """
    if not validate_timezone(data.timezone):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Zona horaria inválida: {data.timezone}"
        )

    try:
        start_date = datetime.strptime(data.date, "%Y-%m-%d").date()
        end_date = (
            datetime.strptime(data.end_date, "%Y-%m-%d").date()
            if data.end_date else start_date
        )
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Formato de fecha inválido. Usa YYYY-MM-DD"
        )

    if end_date < start_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La fecha final debe ser igual o posterior a la inicial"
        )

    if not data.is_full_day and (not data.start_time_local or not data.end_time_local):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Debes indicar hora de inicio y fin, o marcar 'todo el día'"
        )

    tz = ZoneInfo(data.timezone)
    teacher_id = current_user.teacher_profile.id

    created: list[TeacherAvailabilityException] = []
    current_date = start_date

    while current_date <= end_date:
        if data.is_full_day:
            start_local = datetime.combine(current_date, time(0, 0), tzinfo=tz)
            end_local = datetime.combine(current_date + timedelta(days=1), time(0, 0), tzinfo=tz)
        else:
            start_local = datetime.strptime(
                f"{current_date} {data.start_time_local}", "%Y-%m-%d %H:%M"
            ).replace(tzinfo=tz)
            end_local = datetime.strptime(
                f"{current_date} {data.end_time_local}", "%Y-%m-%d %H:%M"
            ).replace(tzinfo=tz)
            if end_local <= start_local:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="La hora de fin debe ser posterior a la de inicio"
                )

        start_utc = start_local.astimezone(UTC)
        end_utc = end_local.astimezone(UTC)

        overlap = db.query(TeacherAvailabilityException).filter(
            TeacherAvailabilityException.teacher_id == teacher_id,
            TeacherAvailabilityException.start_time_utc < end_utc,
            TeacherAvailabilityException.end_time_utc > start_utc,
        ).first()

        if overlap:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Ya existe una excepción que se solapa con el {current_date.isoformat()}"
            )

        exception = TeacherAvailabilityException(
            teacher_id=teacher_id,
            start_time_utc=start_utc,
            end_time_utc=end_utc,
            is_available=data.is_available,
            reason=data.reason
        )
        db.add(exception)
        created.append(exception)

        current_date += timedelta(days=1)

    db.commit()
    for exc in created:
        db.refresh(exc)

    return [_to_exception_response(exc) for exc in created]

@router.delete(
    "/me/exceptions/{exception_id}",
    status_code=status.HTTP_204_NO_CONTENT
)
def delete_exception(
    exception_id: int,
    current_user: User = Depends(get_current_teacher),
    db: Session = Depends(get_db)
):
    """
    Elimina una excepción específica del profesor.
    Verifica que la excepción exista y pertenezca al profesor autenticado.
    """
    teacher_id = current_user.teacher_profile.id
    
    # Buscamos la excepción asegurándonos de que le pertenezca a este profesor
    exception = db.query(TeacherAvailabilityException).filter(
        TeacherAvailabilityException.id == exception_id,
        TeacherAvailabilityException.teacher_id == teacher_id
    ).first()

    if not exception:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Excepción no encontrada o no tienes permisos para eliminarla"
        )

    # Si existe, la borramos y guardamos los cambios
    db.delete(exception)
    db.commit()
    
    return None # HTTP 204 No Content no requiere cuerpo en la respuesta

# NOTA: las rutas /featured-teacher/* van ANTES de /{teacher_username}/slots; si no, esta
# última las captura (teacher_username="featured-teacher") y responde 404.
featured_teacher = os.getenv("FEATURED_TEACHER_USERNAME", "mar12")  # Fallback a "mar12" si no está definido


def _resolve_featured_teacher_username(db: Session) -> Optional[str]:
    """
    Misma resolución que usa get_featured_teacher_slots (DB primero,
    env var como fallback), factorizada para reusarla también en el
    endpoint liviano que solo necesita el username (sin traer slots).
    """
    from app.models.payment_config import PlatformConfig
    from app.core.config import settings

    config = get_platform_config(db)

    teacher_username = None
    if config and config.featured_teacher_id:
        teacher = db.query(TeacherProfile).filter(
            TeacherProfile.id == config.featured_teacher_id
        ).first()
        if teacher:
            teacher_username = teacher.user_username

    if not teacher_username:
        teacher_username = settings.FEATURED_TEACHER_USERNAME

    return teacher_username


@router.get("/featured-teacher/username")
def get_featured_teacher_username(db: Session = Depends(get_db)):
    """
    Solo el username del profesor featured — para pantallas de booking en
    modo single-tenant que necesitan resolverlo UNA vez y reusarlo en
    endpoints que requieren el username como path param (slots, paquetes,
    etc.), en vez de tener que enseñarle esa lógica a cada uno.
    """
    teacher_username = _resolve_featured_teacher_username(db)
    if not teacher_username:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No hay profesora featured configurada"
        )
    return {"username": teacher_username}


@router.get(
    "/featured-teacher/slots",
    response_model=List[AvailableSlotResponse]
)
@limiter.limit(SLOTS_RATE_LIMIT)
def get_featured_teacher_slots(
    request: Request,
    date: str = Query(...),
    duration: int = Query(60, ge=15, le=180),
    class_type: str = Query("regular"),
    tz: Optional[str] = Query(None, description=TZ_PARAM_DESC),
    end_date: Optional[str] = Query(None, description=END_DATE_PARAM_DESC),
    current_user: Optional[User] = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Slots disponibles de la profesora featured.
    """
    teacher_username = _resolve_featured_teacher_username(db)

    if not teacher_username:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No hay profesora featured configurada"
        )

    # 3. Reusar la logica del endpoint existente (sin pasar dos veces por el rate limit)
    return _teacher_available_slots(
        teacher_username=teacher_username,
        date=date,
        duration=duration,
        class_type=class_type,
        bypass_min_notice=False,  # llamada directa: sin esto recibía el objeto Query() (truthy)
        current_user=current_user,
        db=db,
        tz=tz,
        end_date=end_date,
    )


# ─── ENDPOINT PÚBLICO (VISTA ESTUDIANTE) ────────────────────────────────────

@router.get(
    "/{teacher_username}/slots",
    response_model=List[AvailableSlotResponse]
)
@limiter.limit(SLOTS_RATE_LIMIT)
def get_teacher_available_slots(
    request: Request,
    teacher_username: str,
    date: str = Query(..., description="Fecha en formato YYYY-MM-DD"),
    duration: int = Query(60, description="Duración REAL de la clase en minutos", ge=15, le=180),
    class_type: str = Query(
        "regular",
        description="'trial' | 'regular' | 'group' — determina el margen de preparación aplicado",
    ),
    bypass_min_notice: bool = Query(
        False,
        description="Solo staff (superadmin/teacher_admin): ignora el margen mínimo de "
                     "antelación para reagendar/crear clases desde God Mode, sin afectar "
                     "el chequeo normal de choques ni de horarios ya ocurridos.",
    ),
    tz: Optional[str] = Query(None, description=TZ_PARAM_DESC),
    end_date: Optional[str] = Query(None, description=END_DATE_PARAM_DESC),
    current_user: Optional[User] = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Slots disponibles de un profesor para un dia (local en `tz`, o UTC si no se indica `tz`).
    Público, con límite por IP (SLOTS_RATE_LIMIT). La lógica vive en `_teacher_available_slots`.
    """
    return _teacher_available_slots(
        teacher_username=teacher_username, date=date, duration=duration, class_type=class_type,
        bypass_min_notice=bypass_min_notice, current_user=current_user, db=db, tz=tz, end_date=end_date,
    )


def _teacher_available_slots(
    teacher_username: str,
    date: str,
    duration: int,
    class_type: str,
    bypass_min_notice: bool,
    current_user: Optional[User],
    db: Session,
    tz: Optional[str] = None,
    end_date: Optional[str] = None,
):
    """
    Devuelve los slots disponibles de un profesor para un dia (o varios) LOCAL en `tz`
    (sin `tz`: dia UTC); solo salen huecos cuyo INICIO cae en la ventana.
    Devuelve UTC. El frontend convierte a zona local del usuario.

    `duration` es la duración REAL de la clase (lo que ve el estudiante).
    Internamente se le suma el margen de preparación correspondiente al
    `class_type` (ver core/class_logic.py::get_buffer_minutes_for_type)
    para calcular el bloque real que ocupa la agenda del profesor — ese
    bloque más grande es el que se usa para detectar choques y para
    verificar que quepa dentro de la disponibilidad declarada, pero el
    `end_time_utc` devuelto en cada slot sigue siendo el fin real de la
    clase (start + duration), no el fin del bloque.
    """

    # 1. Verificar que el profesor existe y está aprobado
    teacher = db.query(TeacherProfile).join(User, TeacherProfile.user_id == User.id).filter(
        TeacherProfile.user_username == teacher_username,
        TeacherProfile.status == TeacherStatus.approved,
        User.is_active.is_(True),  # Fase 21, S6
    ).first()

    if not teacher:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profesor no encontrado o no disponible"
        )

    # 2. Ventana UTC = dias LOCALES pedidos (Fase 24, C5). Sin `tz`, el dia UTC de siempre.
    if tz is not None and not validate_timezone(tz):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Zona horaria inválida: {tz}")
    try:
        first_day = datetime.strptime(date, "%Y-%m-%d").date()
        last_day = datetime.strptime(end_date, "%Y-%m-%d").date() if end_date else first_day
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Formato de fecha inválido. Usa YYYY-MM-DD"
        )
    n_days = (last_day - first_day).days + 1
    if n_days < 1 or n_days > MAX_SLOTS_WINDOW_DAYS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"end_date debe ser igual o posterior a date y no pasar de {MAX_SLOTS_WINDOW_DAYS} días"
        )
    w0, w1 = window_for_local_dates(date, tz, n_days)

    # No permitir fechas pasadas (hoy, en la zona del que mira, sigue valiendo: sus huecos salen con is_past)
    today_local = utc_now().astimezone(ZoneInfo(tz) if tz else UTC).date()
    if w1 <= window_for_local_dates(today_local.isoformat(), tz, 1)[0]:
        return []

    # 6. Margen de preparación según el tipo de clase, y bloque real que
    # ocupa la agenda del profesor (duración real + margen).
    from app.core.class_logic import get_business_rules, get_buffer_minutes_for_type
    business_rules = get_business_rules(db)
    prep_buffer_minutes = get_buffer_minutes_for_type(class_type, db)
    occupancy_minutes = duration + prep_buffer_minutes

    # 3-7. Rejilla (inicio, ocupado): igual para cualquier visitante, se cachea unos
    # segundos por profesor/ventana/duración/bloque (Fase 14, E3, ver core/slots_cache.py).
    # Lo que depende de quién mira o de la hora (preferencias, is_past, too_soon) va después.
    # Motor compartido con la validación de reservas: core/slot_availability.py.
    def load_slot_grid():
        occ_td = timedelta(minutes=occupancy_minutes)
        # Rangos semanales (incluida la cola de la fila UTC del dia anterior), excepciones y clases por SOLAPE.
        tw = load_teacher_window(db, teacher.id, w0, w1, pad=occ_td)

        # G4/C4: Google se pide para toda la ventana de huecos + el bloque del ultimo (no por dia UTC).
        google_failed = False
        try:
            busy_from_google = get_teacher_busy_ranges(
                teacher_id=teacher.id,
                time_min=w0,
                time_max=w1 + occ_td,
                db=db,
                strict=True,
            )
        except FreebusyError:
            # G5: Google fallo. Se ofrece la rejilla igual (falla abierto, no se rompen reservas) pero NO se
            # cachea: la siguiente peticion vuelve a preguntar a Google en vez de servir huecos falsos unos segundos.
            busy_from_google = []
            google_failed = True

        grid = compute_slot_grid(tw, occupancy_minutes, google_busy=busy_from_google)
        return Uncacheable(grid) if google_failed else grid

    # La clave incluye la ventana UTC exacta (dias locales + zona), no la fecha suelta.
    window_key = f"{w0.strftime('%Y%m%dT%H%M')}-{w1.strftime('%Y%m%dT%H%M')}"
    all_slots = cached_slot_grid(teacher.id, window_key, duration, occupancy_minutes, load_slot_grid)

    if not all_slots:
        return []

    # 7b. Margen mínimo de reserva configurado por el superadmin (en minutos).
    # God Mode (superadmin/teacher_admin) puede saltárselo explícitamente
    # via bypass_min_notice — pero eso NO afecta is_past (un horario ya
    # ocurrido sigue bloqueado siempre) ni is_available (los choques con
    # otras clases se siguen respetando).
    if bypass_min_notice:
        is_staff = current_user is not None and current_user.role in (
            UserRole.superadmin,
            UserRole.teacher_admin,
        )
        if not is_staff:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tienes permisos para saltar la antelación mínima de reserva",
            )
        min_booking_buffer_minutes = 0
    else:
        min_booking_buffer_minutes = business_rules["min_booking_hours"] * 60

    # 7. Preferencias del estudiante (C6): intervalos UTC concretos, también los que cruzan medianoche UTC.
    preferred_ranges = []
    if current_user and current_user.student_profile:
        from app.models.student_preferences import StudentSchedulePreference
        prefs = db.query(StudentSchedulePreference).filter(
            StudentSchedulePreference.student_id == current_user.student_profile.id,
        ).all()
        preferred_ranges = preference_intervals_for_window(prefs, w0, w1)

    def is_preferred_slot(slot_utc: datetime) -> bool:
        return any(p_s <= slot_utc < p_e for p_s, p_e in preferred_ranges)

    # 8. Construir respuesta final. end_time_utc es el fin REAL de la clase
    # (start + duration); block_end_time_utc es informativo (hasta cuándo
    # queda ocupada la agenda del profesor, incluyendo el margen).
    duration_td = timedelta(minutes=duration)
    occupancy_td = timedelta(minutes=occupancy_minutes)

    result = []
    for slot_start, is_busy in all_slots:
        result.append(AvailableSlotResponse(
            start_time_utc=slot_start,
            end_time_utc=slot_start + duration_td,
            duration_minutes=duration,
            is_past=is_slot_in_past(slot_start),
            too_soon=is_slot_too_soon(slot_start, buffer_minutes=min_booking_buffer_minutes),
            is_preferred=is_preferred_slot(slot_start),
            is_available=not is_busy,
            buffer_minutes=prep_buffer_minutes,
            block_end_time_utc=slot_start + occupancy_td,
        ))

    return result

def _to_exception_response(exc: TeacherAvailabilityException) -> ExceptionResponse:
    duration = exc.end_time_utc - exc.start_time_utc
    is_full_day = duration >= timedelta(hours=23, minutes=55)
    return ExceptionResponse(
        id=exc.id,
        teacher_id=exc.teacher_id,
        start_time_utc=exc.start_time_utc,
        end_time_utc=exc.end_time_utc,
        is_available=exc.is_available,
        reason=exc.reason,
        is_full_day=is_full_day,
    )