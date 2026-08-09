from datetime import datetime, timedelta, time
from zoneinfo import ZoneInfo
from typing import List, Tuple
import logging

logger = logging.getLogger(__name__)

UTC = ZoneInfo("UTC")


# ─── Conversiones base ──────────────────────────────────────────────────────

def to_utc(dt_naive_str: str, tz_str: str) -> datetime:
    """
    Convierte un datetime local a UTC.

    Args:
        dt_naive_str: "2025-04-14T09:00:00" (sin zona)
        tz_str: "America/Caracas"

    Returns:
        datetime en UTC con tzinfo=UTC

    Example:
        to_utc("2025-04-14T09:00:00", "America/Caracas")
        → datetime(2025, 4, 14, 13, 0, tzinfo=UTC)
    """
    try:
        tz = ZoneInfo(tz_str)
        dt_local = datetime.fromisoformat(dt_naive_str).replace(tzinfo=tz)
        return dt_local.astimezone(UTC)
    except Exception as e:
        logger.error(f"Error en to_utc: {e}")
        raise ValueError(f"No se pudo convertir '{dt_naive_str}' desde '{tz_str}' a UTC")


def from_utc(dt_utc: datetime, tz_str: str) -> datetime:
    """
    Convierte un datetime UTC a zona horaria local.
    Usado principalmente para logs y emails, el frontend
    hace su propia conversión.

    Args:
        dt_utc: datetime en UTC
        tz_str: "Europe/Madrid"

    Returns:
        datetime en la zona horaria solicitada
    """
    try:
        tz = ZoneInfo(tz_str)
        if dt_utc.tzinfo is None:
            dt_utc = dt_utc.replace(tzinfo=UTC)
        return dt_utc.astimezone(tz)
    except Exception as e:
        logger.error(f"Error en from_utc: {e}")
        raise ValueError(f"No se pudo convertir a zona '{tz_str}'")


def utc_now() -> datetime:
    """Devuelve el momento actual en UTC. Usar siempre en lugar de datetime.utcnow()"""
    return datetime.now(UTC)


# ─── Disponibilidad semanal ─────────────────────────────────────────────────

def build_weekly_range_utc(
    date_str: str,
    start_hhmm_utc: str,
    end_hhmm_utc: str,
) -> Tuple[datetime, datetime]:
    """
    Construye el rango datetime UTC para una disponibilidad semanal
    aplicada a una fecha concreta.

    Args:
        date_str: "2025-04-14"
        start_hhmm_utc: "13:00" (hora en UTC)
        end_hhmm_utc: "22:00" (hora en UTC)

    Returns:
        Tupla (start_utc, end_utc) como datetime con tzinfo=UTC

    Example:
        build_weekly_range_utc("2025-04-14", "13:00", "22:00")
        → (datetime(2025,4,14,13,0,tzinfo=UTC),
           datetime(2025,4,14,22,0,tzinfo=UTC))
    """
    try:
        start_dt = datetime.strptime(
            f"{date_str}T{start_hhmm_utc}:00", "%Y-%m-%dT%H:%M:%S"
        ).replace(tzinfo=UTC)

        end_dt = datetime.strptime(
            f"{date_str}T{end_hhmm_utc}:00", "%Y-%m-%dT%H:%M:%S"
        ).replace(tzinfo=UTC)

        # Si end < start significa que cruza medianoche UTC
        # Ej: start=22:00 UTC, end=02:00 UTC → end es del día siguiente
        if end_dt <= start_dt:
            end_dt += timedelta(days=1)

        return start_dt, end_dt
    except Exception as e:
        logger.error(f"Error en build_weekly_range_utc: {e}")
        raise ValueError(f"Rango horario inválido: {start_hhmm_utc} - {end_hhmm_utc}")

def get_next_weekday_date(day_of_week: int, tz_str: str, reference: datetime | None = None) -> str:
    """
    Devuelve la fecha (YYYY-MM-DD) de la próxima ocurrencia de day_of_week
    (0=Lunes...6=Domingo) a partir de "hoy" en la zona horaria indicada.
    Se usa como fecha de referencia para las conversiones de horarios
    recurrentes, así el offset UTC/DST calculado al guardar coincide
    siempre con el que usa el frontend al mostrar el horario.
    """
    tz = ZoneInfo(tz_str)
    now_local = reference.astimezone(tz) if reference else datetime.now(tz)
    days_ahead = (day_of_week - now_local.weekday()) % 7
    target_date = now_local.date() + timedelta(days=days_ahead)
    return target_date.strftime("%Y-%m-%d")


def convert_local_time_to_utc_string(
    time_str: str,
    tz_str: str,
    day_of_week: int,
) -> str:
    """
    Convierte una hora local "HH:MM" a su equivalente UTC "HH:MM".
    Usa la próxima fecha real de ese día de la semana como referencia,
    para que el offset (incluyendo DST) sea el correcto y consistente
    con la conversión inversa que hace el frontend al mostrar el horario.

    Example:
        convert_local_time_to_utc_string("09:00", "America/Caracas", 0)
        → "13:00"
    """
    try:
        tz = ZoneInfo(tz_str)
        reference_date = get_next_weekday_date(day_of_week, tz_str)
        dt_local = datetime.strptime(
            f"{reference_date}T{time_str}:00", "%Y-%m-%dT%H:%M:%S"
        ).replace(tzinfo=tz)
        dt_utc = dt_local.astimezone(UTC)
        return dt_utc.strftime("%H:%M")
    except Exception as e:
        logger.error(f"Error en convert_local_time_to_utc_string: {e}")
        raise ValueError(f"No se pudo convertir '{time_str}' desde '{tz_str}'")

def convert_utc_time_to_local_string(
    utc_time_str: str,
    tz_str: str,
    day_of_week: int,
) -> str:
    """
    Inversa de convert_local_time_to_utc_string.
    Dado un "HH:MM" UTC recurrente asociado a un day_of_week, devuelve el
    "HH:MM" que esa misma hora representa en la zona horaria indicada.
    Se usa para recuperar la hora LOCAL que un usuario configuró antes de
    recalcular su horario tras un cambio de zona horaria.

    Example:
        convert_utc_time_to_local_string("10:00", "America/Caracas", 0)
        → "06:00"
    """
    try:
        tz = ZoneInfo(tz_str)
        reference_date = get_next_weekday_date(day_of_week, tz_str)
        dt_utc = datetime.strptime(
            f"{reference_date}T{utc_time_str}:00", "%Y-%m-%dT%H:%M:%S"
        ).replace(tzinfo=UTC)
        dt_local = dt_utc.astimezone(tz)
        return dt_local.strftime("%H:%M")
    except Exception as e:
        logger.error(f"Error en convert_utc_time_to_local_string: {e}")
        raise ValueError(f"No se pudo convertir '{utc_time_str}' a '{tz_str}'")

# ─── Cálculo de slots ───────────────────────────────────────────────────────

def get_available_slots_utc(
    availability_ranges: List[Tuple[datetime, datetime]],
    busy_ranges: List[Tuple[datetime, datetime]],
    duration_minutes: int,
    step_minutes: int = 30,
) -> List[datetime]:
    """
    Calcula los slots libres dado un conjunto de rangos disponibles
    y rangos ocupados. Todo en UTC.

    Args:
        availability_ranges: [(start_utc, end_utc), ...] disponibles
        busy_ranges: [(start_utc, end_utc), ...] ocupados
        duration_minutes: duración de cada clase
        step_minutes: cada cuántos minutos hay un slot (default 30)

    Returns:
        Lista de datetime UTC con los inicios de slots libres
        ordenados cronológicamente

    Example:
        availability = [(9:00 UTC, 18:00 UTC)]
        busy = [(10:00 UTC, 11:00 UTC)]
        duration = 60
        → [9:00, 11:00, 12:00, 13:00, 14:00, 15:00, 16:00, 17:00]
        (10:00 no aparece porque está ocupado)
    """
    duration = timedelta(minutes=duration_minutes)
    step = timedelta(minutes=step_minutes)

    free_slots = []

    for range_start, range_end in availability_ranges:
        curr = range_start

        while curr + duration <= range_end:
            slot_end = curr + duration

            is_busy = any(
                curr < busy_end and slot_end > busy_start
                for busy_start, busy_end in busy_ranges
            )

            if not is_busy:
                free_slots.append(curr)

            curr += step

    # Eliminar duplicados y ordenar
    return sorted(set(free_slots))

def get_all_slots_utc(
    availability_ranges: List[Tuple[datetime, datetime]],
    busy_ranges: List[Tuple[datetime, datetime]],
    duration_minutes: int,
    step_minutes: int = 30,
) -> List[Tuple[datetime, bool]]:
    """
    Igual que get_available_slots_utc pero NO descarta los slots ocupados:
    devuelve todos los slots dentro de los rangos de disponibilidad,
    marcando cada uno con su estado de ocupación (is_busy).

    Returns:
        Lista de tuplas (slot_start_utc, is_busy) ordenada cronológicamente.
        Si un slot cae en más de un rango, se marca ocupado si lo está
        en cualquiera de ellos.
    """
    duration = timedelta(minutes=duration_minutes)
    step = timedelta(minutes=step_minutes)

    slots: dict[datetime, bool] = {}

    for range_start, range_end in availability_ranges:
        curr = range_start
        while curr + duration <= range_end:
            slot_end = curr + duration
            is_busy = any(
                curr < busy_end and slot_end > busy_start
                for busy_start, busy_end in busy_ranges
            )
            if curr not in slots or is_busy:
                slots[curr] = is_busy
            curr += step

    return sorted(slots.items())


def is_slot_in_past(slot_utc: datetime, buffer_minutes: int = 60) -> bool:
    """
    Verifica si un slot ya pasó.
    buffer_minutes: margen mínimo desde ahora para poder agendar.
    Por defecto no puedes agendar una clase que empieza en menos de 1 hora.
    """
    now = utc_now()
    return slot_utc < now + timedelta(minutes=buffer_minutes)


def validate_timezone(tz_str: str) -> bool:
    """Verifica que una zona horaria es válida"""
    try:
        ZoneInfo(tz_str)
        return True
    except Exception:
        return False