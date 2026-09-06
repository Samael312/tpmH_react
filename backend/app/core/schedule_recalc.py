"""
Recálculo de horarios al cambiar la zona horaria de una cuenta.

Regla de negocio:
- Disponibilidad semanal recurrente (TeacherAvailability) y preferencias del
  estudiante (StudentSchedulePreference): se guardan como "HH:MM UTC" +
  day_of_week + local_day_of_week. Al cambiar de zona horaria, la hora LOCAL
  que el usuario configuró ("trabajo de 12:00 a 19:00") se PRESERVA tal cual,
  y lo que se recalcula es el UTC equivalente para la nueva zona horaria.
  local_day_of_week NO cambia nunca — es el día que el usuario eligió en su
  propio calendario, independientemente de dónde esté físicamente. day_of_week
  SÍ puede cambiar: representa el día de la semana real en UTC de ese horario,
  y un cambio de zona horaria puede correrlo de día (ver core/timezone.py,
  convert_local_time_to_utc) — por eso se recalcula acá igual que las horas.

- Excepciones puntuales (TeacherAvailabilityException): tienen una fecha de
  calendario real (ej. "17 de agosto, vacaciones 09:00-13:00"). Ahí se
  reinterpreta la MISMA fecha y hora de reloj local en la nueva zona
  horaria, preservando fecha y hora exactas.

Ninguna de estas funciones hace commit — el endpoint que las llama decide
cuándo confirmar la transacción (junto con el resto de cambios del perfil).
"""
from zoneinfo import ZoneInfo
from sqlalchemy.orm import Session
from typing import List, Dict, Any
import logging

from app.core.timezone import (
    UTC,
    convert_local_time_to_utc,
    convert_utc_time_to_local_string,
)
from app.models.availability import TeacherAvailability, TeacherAvailabilityException
from app.models.student_preferences import StudentSchedulePreference

logger = logging.getLogger(__name__)


def _recalc_weekly_rows(rows, old_tz: str, new_tz: str) -> List[Dict[str, Any]]:
    """
    Recalcula filas con day_of_week + start_time_utc/end_time_utc ("HH:MM"),
    preservando la hora local y recalculando el UTC para la nueva zona
    horaria. Devuelve un resumen de los cambios para notificar al usuario.
    """
    changes = []
    for row in rows:
        try:
            # El ancla para "qué día es este horario en la vida real del
            # usuario" es local_day_of_week — NO day_of_week, que ahora
            # representa el día en UTC y puede diferir del local para
            # horarios cercanos a la medianoche (ver core/timezone.py).
            # Si por algún motivo una fila vieja no tiene local_day_of_week
            # cargado, day_of_week es el mejor fallback disponible.
            anchor_day = row.local_day_of_week if row.local_day_of_week is not None else row.day_of_week

            local_start = convert_utc_time_to_local_string(row.start_time_utc, old_tz, anchor_day)
            local_end = convert_utc_time_to_local_string(row.end_time_utc, old_tz, anchor_day)

            new_start_utc, new_utc_day = convert_local_time_to_utc(local_start, new_tz, anchor_day)
            new_end_utc, _ = convert_local_time_to_utc(local_end, new_tz, anchor_day)

            if (
                new_start_utc == row.start_time_utc
                and new_end_utc == row.end_time_utc
                and new_utc_day == row.day_of_week
            ):
                continue  # mismo offset y mismo día UTC, sin cambio real

            changes.append({
                "day_of_week": anchor_day,
                "local_time": f"{local_start} - {local_end}",
                "old_start_utc": row.start_time_utc,
                "old_end_utc": row.end_time_utc,
                "new_start_utc": new_start_utc,
                "new_end_utc": new_end_utc,
            })

            row.start_time_utc = new_start_utc
            row.end_time_utc = new_end_utc
            row.day_of_week = new_utc_day
        except ValueError as e:
            logger.warning(f"No se pudo recalcular fila id={getattr(row, 'id', '?')}: {e}")
            continue
    return changes


def _recalc_exception_rows(rows, old_tz: str, new_tz: str) -> List[Dict[str, Any]]:
    """
    Recalcula excepciones puntuales (fecha real + hora), preservando la
    fecha y hora de reloj local exactas al reinterpretarlas en la nueva
    zona horaria.
    """
    changes = []
    old_zone = ZoneInfo(old_tz)
    new_zone = ZoneInfo(new_tz)

    for exc in rows:
        old_start = exc.start_time_utc
        old_end = exc.end_time_utc

        local_start = old_start.astimezone(old_zone)
        local_end = old_end.astimezone(old_zone)

        # Reinterpretamos la MISMA hora de reloj local como si fuera en la
        # nueva zona horaria (no convertimos el instante — reasignamos el
        # tzinfo y luego sí convertimos a UTC).
        new_start = local_start.replace(tzinfo=new_zone).astimezone(UTC)
        new_end = local_end.replace(tzinfo=new_zone).astimezone(UTC)

        if new_start == old_start and new_end == old_end:
            continue

        changes.append({
            "exception_id": exc.id,
            "reason": exc.reason,
            "local_date_time": local_start.strftime("%Y-%m-%d %H:%M"),
        })

        exc.start_time_utc = new_start
        exc.end_time_utc = new_end

    return changes


def recalculate_teacher_schedule_timezone(
    teacher_id: int, old_tz: str, new_tz: str, db: Session
) -> Dict[str, Any]:
    """
    Recalcula disponibilidad semanal + excepciones del profesor tras un
    cambio de zona horaria. NO hace commit.
    """
    if not old_tz or old_tz == new_tz:
        return {"weekly_changes": [], "exception_changes": []}

    weekly_rows = db.query(TeacherAvailability).filter(
        TeacherAvailability.teacher_id == teacher_id
    ).all()
    weekly_changes = _recalc_weekly_rows(weekly_rows, old_tz, new_tz)

    exception_rows = db.query(TeacherAvailabilityException).filter(
        TeacherAvailabilityException.teacher_id == teacher_id
    ).all()
    exception_changes = _recalc_exception_rows(exception_rows, old_tz, new_tz)

    return {"weekly_changes": weekly_changes, "exception_changes": exception_changes}


def recalculate_student_preferences_timezone(
    student_id: int, old_tz: str, new_tz: str, db: Session
) -> Dict[str, Any]:
    """
    Recalcula las preferencias de horario del estudiante tras un cambio de
    zona horaria. NO hace commit.
    """
    if not old_tz or old_tz == new_tz:
        return {"weekly_changes": []}

    rows = db.query(StudentSchedulePreference).filter(
        StudentSchedulePreference.student_id == student_id
    ).all()
    weekly_changes = _recalc_weekly_rows(rows, old_tz, new_tz)

    return {"weekly_changes": weekly_changes}