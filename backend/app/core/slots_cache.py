"""
Caché corta de la rejilla de huecos de un profesor (Fase 14, E3).

`GET /availability/{username}/slots` recalculaba en cada petición los
rangos semanales, las excepciones, las clases del día y, si el profesor
tiene Google Calendar conectado, una llamada freebusy a Google. Mientras
un estudiante navega por el calendario se repite lo mismo muchas veces.

Aquí se guarda solo la parte que es igual para cualquier visitante: la
lista `(inicio_utc, ocupado)` para un profesor, fecha, duración y bloque
real (duración + margen). Lo que depende de quién mira o de la hora
(preferencias del estudiante, `is_past`, `too_soon`) se sigue calculando
en cada petición sobre esa lista.

Invalidación: al hacer commit de una sesión que creó, cambió o borró una
`Class`, una franja semanal, una excepción o el token de Google Calendar
de un profesor, se borran todas las entradas de ese profesor. Los UPDATE
o DELETE masivos (`query(...).update()/.delete()`) no dicen a qué
profesor afectan, así que borran la caché de huecos entera.

Límites: el TTL (`SLOTS_CACHE_TTL_SECONDS`) cubre lo que no pasa por la
sesión ORM: cambios en el Google Calendar del profesor hechos fuera de la
plataforma y SQL a mano. En ese margen se puede ofrecer un hueco ya
ocupado; la reserva lo vuelve a comprobar y lo rechaza. Vive en memoria
del proceso, como `app.core.cache`: vale con un solo worker (ver
railway.toml); con varias instancias habría que pasarla a Redis.
"""
from typing import Any, Callable, Iterable

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

from app.core.cache import cache_invalidate_prefix, cached
from app.core.config import settings
from app.models.availability import TeacherAvailability, TeacherAvailabilityException
from app.models.class_ import Class
from app.models.google_calendar import GoogleCalendarToken

SLOTS_PREFIX = "slots:"
_TRACKED = (Class, TeacherAvailability, TeacherAvailabilityException, GoogleCalendarToken)
_INFO_KEY = "slots_cache_teachers"
_ALL = "*"


def slots_key(teacher_id: int, date: str, duration: int, occupancy: int) -> str:
    return f"{SLOTS_PREFIX}{teacher_id}:{date}:{duration}:{occupancy}"


def cached_slot_grid(
    teacher_id: int, date: str, duration: int, occupancy: int, loader: Callable[[], Any]
) -> Any:
    ttl = settings.SLOTS_CACHE_TTL_SECONDS
    if ttl <= 0:
        return loader()
    return cached(slots_key(teacher_id, date, duration, occupancy), ttl, loader)


def invalidate_teacher_slots(teacher_id: int) -> None:
    cache_invalidate_prefix(f"{SLOTS_PREFIX}{teacher_id}:")


def invalidate_all_slots() -> None:
    cache_invalidate_prefix(SLOTS_PREFIX)


def _pending(session: Session) -> set:
    return session.info.setdefault(_INFO_KEY, set())


def _teacher_ids(obj: Any) -> Iterable[Any]:
    """teacher_id actual y, si cambió (sustitución de profesor), también el anterior.
    Si no está cargado (no se lanza SQL dentro del flush), se invalida todo."""
    hist = inspect(obj).attrs.teacher_id.history
    values = [v for v in (*hist.added, *hist.unchanged, *hist.deleted) if v is not None]
    return values or [_ALL]


@event.listens_for(Session, "after_flush")
def _collect_after_flush(session: Session, _flush_context) -> None:
    pending = _pending(session)
    for obj in (*session.new, *session.dirty, *session.deleted):
        if isinstance(obj, _TRACKED):
            pending.update(_teacher_ids(obj))


@event.listens_for(Session, "do_orm_execute")
def _collect_bulk(orm_execute_state) -> None:
    if not (orm_execute_state.is_update or orm_execute_state.is_delete):
        return
    mapper = orm_execute_state.bind_mapper
    if mapper is not None and mapper.class_ in _TRACKED:
        _pending(orm_execute_state.session).add(_ALL)


@event.listens_for(Session, "after_commit")
def _invalidate_after_commit(session: Session) -> None:
    pending = session.info.pop(_INFO_KEY, None)
    if not pending:
        return
    if _ALL in pending:
        invalidate_all_slots()
        return
    for teacher_id in pending:
        invalidate_teacher_slots(teacher_id)

# Sin limpiar en rollback a propósito: si un rollback de savepoint borrase lo
# pendiente del commit exterior, quedarían huecos viejos. Lo peor que pasa así
# es invalidar de más en el commit siguiente.
