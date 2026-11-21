"""
Motor UNICO de disponibilidad de un profesor (Fase 24, medianoche UTC).

Lo usan LA REJILLA de huecos (`GET /availability/{u}/slots`) y la VALIDACION de reservas
(`is_within_teacher_availability`, `can_book_slot`, cohortes), para que lo que se ofrece
sea exactamente lo que se puede reservar.

Modelo (Fase 26): el horario semanal se guarda en HORA LOCAL del profesor (`day_of_week` local +
`HH:MM` local de inicio/fin; fin <= inicio cruza la medianoche local) y la zona IANA viva es
`teacher_profiles.timezone`. Para una ventana [w0, w1) cada fila se EXPANDE por fecha local con zoneinfo
(`local_range_to_utc`), asi el horario de verano mueve el UTC y la hora local no cambia. Hay que mirar
el dia local anterior al de w0 (su cola entra en la ventana). Excepciones y clases se cargan POR SOLAPE
con la ventana. Una ventana es un instante UTC cualquiera: el endpoint la calcula con los dias LOCALES
que pide el usuario (`window_for_local_dates`).

Bordes del cambio de hora (definidos y probados en tests/audit/test_f26_dst_availability.py):
  - hora local INEXISTENTE (salto de primavera, p. ej. 02:30 en Madrid el ultimo domingo de marzo): se
    salta; el limite se sujeta al instante del salto (02:30 -> 03:00 CEST). Una franja entera dentro del
    hueco desaparece.
  - hora local AMBIGUA (retroceso de otono): primera ocurrencia (fold=0, el horario de verano).
  - zona nula o invalida: se trata como UTC (el endpoint de perfil ya valida la zona).
"""
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from typing import Iterable, List, Optional, Tuple
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.core.timezone import UTC, build_weekly_range_utc
from app.models.availability import TeacherAvailability, TeacherAvailabilityException
from app.models.class_ import Class
from app.models.teacher import TeacherProfile

Range = Tuple[datetime, datetime]

# Una clase (hasta 180 min) + su margen nunca supera esto: prefiltro SQL por solape del fin.
_MAX_CLASS_SPAN = timedelta(hours=6)
SLOT_STEP_MINUTES = 30


def window_for_local_dates(
    start_date: str, tz_name: Optional[str], days: int = 1
) -> Tuple[datetime, datetime]:
    """[00:00 local de start_date, 00:00 local de start_date + days) como instantes UTC.
    Sin zona (o "UTC") es el dia UTC clasico. Lanza ValueError si fecha o zona no son validas."""
    d = datetime.strptime(start_date, "%Y-%m-%d").date()
    tz = ZoneInfo(tz_name) if tz_name else UTC
    w0 = datetime.combine(d, time(0, 0), tzinfo=tz).astimezone(UTC)
    w1 = datetime.combine(d + timedelta(days=days), time(0, 0), tzinfo=tz).astimezone(UTC)
    return w0, w1


def resolve_zone(tz_name: Optional[str]) -> ZoneInfo:
    """ZoneInfo de la zona del profesor; nula o invalida -> UTC (ver docstring del modulo)."""
    if not tz_name:
        return UTC
    try:
        return ZoneInfo(tz_name)
    except Exception:
        return UTC


def local_wall_to_utc(naive: datetime, tz: ZoneInfo) -> datetime:
    """Hora de reloj local (naive) -> instante UTC. Ambigua: primera ocurrencia (fold=0). Inexistente
    (salto de primavera): el instante del salto, es decir la primera hora que si existe."""
    aware = naive.replace(tzinfo=tz, fold=0)
    utc = aware.astimezone(UTC)
    if utc.astimezone(tz).replace(tzinfo=None) == naive:
        return utc
    # Inexistente: fold=0 usa el desfase de ANTES del salto, asi que `utc` cae ya DESPUES del salto real.
    # Retrocedemos por minutos mientras siga el desfase nuevo: el primero con el desfase nuevo es el salto.
    off_after = utc.astimezone(tz).utcoffset()
    while (utc - timedelta(minutes=1)).astimezone(tz).utcoffset() == off_after:
        utc -= timedelta(minutes=1)
    return utc


def local_range_to_utc(day: date, start_hhmm: str, end_hhmm: str, tz: ZoneInfo) -> Optional[Range]:
    """Franja semanal de la fecha LOCAL `day` -> (inicio, fin) UTC. fin <= inicio cruza la medianoche local.
    None si el texto no es HH:MM valido o si la franja queda vacia tras saltar horas inexistentes."""
    try:
        sh, sm = (int(x) for x in start_hhmm.split(":"))
        eh, em = (int(x) for x in end_hhmm.split(":"))
        start_naive = datetime.combine(day, time(sh, sm))
        end_naive = datetime.combine(day, time(eh, em))
    except (ValueError, AttributeError):
        return None
    if end_naive <= start_naive:
        end_naive += timedelta(days=1)
    s_utc = local_wall_to_utc(start_naive, tz)
    e_utc = local_wall_to_utc(end_naive, tz)
    if e_utc <= s_utc:
        return None
    return s_utc, e_utc


def weekly_ranges_for_window(
    rows: Iterable[TeacherAvailability], tz_name: Optional[str], w0: datetime, w1: datetime
) -> List[Range]:
    """Rangos UTC concretos de las filas semanales (hora local en la zona `tz_name`) que solapan con
    [w0, w1). Incluye la cola de la fila del dia local anterior que cruza la medianoche local."""
    tz = resolve_zone(tz_name)
    by_dow: dict[int, list] = {}
    for r in rows:
        by_dow.setdefault(r.day_of_week, []).append(r)
    out: List[Range] = []
    day = w0.astimezone(tz).date() - timedelta(days=1)
    last = w1.astimezone(tz).date()
    while day <= last:
        for r in by_dow.get(day.weekday(), ()):
            rng = local_range_to_utc(day, r.start_time_local, r.end_time_local, tz)
            if rng and rng[0] < w1 and rng[1] > w0:
                out.append(rng)
        day += timedelta(days=1)
    return out


@dataclass
class TeacherWindow:
    """Todo lo que condiciona la agenda del profesor en una ventana."""
    w0: datetime
    w1: datetime
    ranges: List[Range] = field(default_factory=list)      # semanal + disponibilidad extra
    blocks: List[Range] = field(default_factory=list)      # excepciones de bloqueo
    classes: List[Tuple[datetime, datetime, int]] = field(default_factory=list)  # (inicio, fin+margen, id)

    def busy_ranges(self) -> List[Range]:
        return self.blocks + [(s, e) for s, e, _ in self.classes]


def load_busy_classes(
    db: Session, teacher_id: int, w0: datetime, w1: datetime, exclude_class_id: Optional[int] = None
) -> List[Tuple[datetime, datetime, int]]:
    """Clases que ocupan la agenda en algun punto de [w0, w1): (inicio, fin + margen propio, id).
    Por SOLAPE (no por inicio dentro del dia UTC). BUG-04: cancelled/expired no ocupan;
    pending_trial y sesiones grupales si."""
    q = db.query(Class).filter(
        Class.teacher_id == teacher_id,
        Class.start_time_utc < w1,
        Class.end_time_utc > w0 - _MAX_CLASS_SPAN,
        Class.status.notin_(["cancelled", "expired"]),
    )
    if exclude_class_id:
        q = q.filter(Class.id != exclude_class_id)
    out = []
    for c in q.all():
        occ_end = c.end_time_utc + timedelta(minutes=c.buffer_minutes or 0)
        if occ_end > w0:
            out.append((c.start_time_utc, occ_end, c.id))
    return out


def load_teacher_window(
    db: Session,
    teacher_id: int,
    w0: datetime,
    w1: datetime,
    pad: timedelta = timedelta(0),
    exclude_class_id: Optional[int] = None,
    include_classes: bool = True,
) -> TeacherWindow:
    """3 consultas (semanal, excepciones, clases). Los rangos se buscan por solape con [w0, w1);
    bloqueos y clases por solape con [w0, w1 + pad) (un hueco que empieza antes de w1 ocupa hasta +pad).
    BUG-04: clases "cancelled"/"expired" no ocupan. Las grupales y pending_trial SI ocupan."""
    # Una sola consulta: filas semanales + zona viva del profesor (join, sin consulta extra).
    pairs = db.query(TeacherAvailability, TeacherProfile.timezone).join(
        TeacherProfile, TeacherProfile.id == TeacherAvailability.teacher_id
    ).filter(
        TeacherAvailability.teacher_id == teacher_id,
        TeacherAvailability.is_available == True,  # noqa: E712
    ).all()
    rows = [p[0] for p in pairs]
    ranges = weekly_ranges_for_window(rows, pairs[0][1] if pairs else None, w0, w1)

    wide_end = w1 + pad
    exceptions = db.query(TeacherAvailabilityException).filter(
        TeacherAvailabilityException.teacher_id == teacher_id,
        TeacherAvailabilityException.start_time_utc < wide_end,
        TeacherAvailabilityException.end_time_utc > w0,
    ).all()
    blocks: List[Range] = []
    for exc in exceptions:
        if exc.is_available:
            if exc.start_time_utc < w1:  # disponibilidad extra solo cuenta si toca la ventana
                ranges.append((exc.start_time_utc, exc.end_time_utc))
        else:
            blocks.append((exc.start_time_utc, exc.end_time_utc))

    classes = load_busy_classes(db, teacher_id, w0, wide_end, exclude_class_id) if include_classes else []
    return TeacherWindow(w0, w1, ranges, blocks, classes)


def slot_free(tw: TeacherWindow, start: datetime, occupied_end: datetime) -> Tuple[bool, str]:
    """[start, occupied_end) cabe en UN rango declarado, sin bloqueo ni clase encima.
    (Google se comprueba aparte: es una llamada externa.) Devuelve (ok, motivo)."""
    for b_s, b_e in tw.blocks:
        if b_s < occupied_end and b_e > start:
            return False, "blocked"
    if not any(start >= r_s and occupied_end <= r_e for r_s, r_e in tw.ranges):
        return False, "outside_availability"
    for c_s, c_e, _ in tw.classes:
        if start < c_e and c_s < occupied_end:
            return False, "class_conflict"
    return True, ""


def is_slot_free(
    db: Session,
    teacher_id: int,
    start_utc: datetime,
    occupied_end_utc: datetime,
    exclude_class_id: Optional[int] = None,
) -> Tuple[bool, str]:
    """Version "una sola franja" para la validacion de reservas (misma logica que la rejilla)."""
    tw = load_teacher_window(db, teacher_id, start_utc, occupied_end_utc, exclude_class_id=exclude_class_id)
    return slot_free(tw, start_utc, occupied_end_utc)


def compute_slot_grid(
    tw: TeacherWindow,
    occupancy_minutes: int,
    google_busy: Optional[List[Range]] = None,
    step_minutes: int = SLOT_STEP_MINUTES,
) -> List[Tuple[datetime, bool]]:
    """Inicios de hueco dentro de [w0, w1) -> (inicio, ocupado). La rejilla va de 30 en 30 desde el
    inicio de cada rango; el bloque entero (clase + margen) debe caber en el rango. Un inicio puede
    pertenecer a un rango que empieza antes de w0 o termina despues de w1."""
    occupancy = timedelta(minutes=occupancy_minutes)
    step = timedelta(minutes=step_minutes)
    busy = tw.busy_ranges() + list(google_busy or [])
    slots: dict[datetime, bool] = {}
    for r_s, r_e in tw.ranges:
        curr = r_s
        if curr < tw.w0:
            skip = -((tw.w0 - curr) // -step)  # techo: primer paso >= w0
            curr = r_s + skip * step
        while curr < tw.w1 and curr + occupancy <= r_e:
            occ_end = curr + occupancy
            is_busy = any(curr < b_e and occ_end > b_s for b_s, b_e in busy)
            if curr not in slots or is_busy:
                slots[curr] = is_busy
            curr += step
    return sorted(slots.items())


def preference_intervals_for_window(prefs, w0: datetime, w1: datetime) -> List[Range]:
    """Preferencias del alumno (`day_of_week` UTC + HH:MM UTC, fin <= inicio cruza medianoche)
    como intervalos UTC concretos que solapan con [w0, w1). Evita comparar cadenas "23:30" <= t < "01:00"."""
    by_dow: dict[int, list] = {}
    for p in prefs:
        by_dow.setdefault(p.day_of_week, []).append(p)
    out: List[Range] = []
    day = (w0 - timedelta(days=1)).date()
    while day <= w1.date():
        for p in by_dow.get(day.weekday(), ()):
            try:
                s, e = build_weekly_range_utc(day.isoformat(), p.start_time_utc, p.end_time_utc)
            except ValueError:
                continue
            if s < w1 and e > w0:
                out.append((s, e))
        day += timedelta(days=1)
    return out
