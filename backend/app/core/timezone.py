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


def convert_local_time_to_utc_string(
    time_str: str,
    tz_str: str,
    reference_date: str = "2025-01-06",  # Lunes de referencia neutral
) -> str:
    """
    Convierte una hora local "HH:MM" a su equivalente UTC "HH:MM".
    Usa una fecha de referencia neutral para la conversión.
    Se usa cuando el profesor configura su horario semanal.

    Args:
        time_str: "09:00" (hora local del profesor)
        tz_str: "America/Caracas"
        reference_date: fecha de referencia para la conversión

    Returns:
        "13:00" (hora en UTC)

    Example:
        convert_local_time_to_utc_string("09:00", "America/Caracas")
        → "13:00"
    """
    try:
        tz = ZoneInfo(tz_str)
        dt_local = datetime.strptime(
            f"{reference_date}T{time_str}:00", "%Y-%m-%dT%H:%M:%S"
        ).replace(tzinfo=tz)
        dt_utc = dt_local.astimezone(UTC)
        return dt_utc.strftime("%H:%M")
    except Exception as e:
        logger.error(f"Error en convert_local_time_to_utc_string: {e}")
        raise ValueError(f"No se pudo convertir '{time_str}' desde '{tz_str}'")


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