"""
Cache muy simple en memoria de proceso, pensado para endpoints públicos
de solo lectura (landing, config de plataforma, etc.) donde no hace
falta Redis: la app corre en una sola instancia y los datos son los
mismos para cualquier visitante.

No es apto para datos por-usuario ni para despliegues multi-instancia
(cada worker/instancia tendría su propia copia del cache) — si el
proyecto migra a varias instancias detrás de un load balancer, esto
debería reemplazarse por Redis u otro cache compartido.
"""
import threading
import time
from typing import Any, Callable, Optional

_lock = threading.Lock()
_store: dict[str, tuple[float, Any]] = {}  # key -> (expires_at_epoch, value)


def cache_get(key: str) -> Optional[Any]:
    with _lock:
        entry = _store.get(key)
        if entry is None:
            return None
        expires_at, value = entry
        if expires_at < time.time():
            _store.pop(key, None)
            return None
        return value


def cache_set(key: str, value: Any, ttl_seconds: float) -> None:
    with _lock:
        _store[key] = (time.time() + ttl_seconds, value)


def cache_invalidate(key: str) -> None:
    with _lock:
        _store.pop(key, None)


def cache_invalidate_prefix(prefix: str) -> None:
    with _lock:
        for k in [k for k in _store if k.startswith(prefix)]:
            _store.pop(k, None)


def cached(key: str, ttl_seconds: float, loader: Callable[[], Any]) -> Any:
    """Devuelve el valor cacheado si sigue vigente; si no, lo recalcula
    con `loader`, lo guarda y lo devuelve."""
    value = cache_get(key)
    if value is not None:
        return value
    value = loader()
    cache_set(key, value, ttl_seconds)
    return value
