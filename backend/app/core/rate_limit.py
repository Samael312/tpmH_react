"""
Rate limiting compartido para toda la API.

Usa slowapi (wrapper de la librería `limits` para FastAPI/Starlette).
Por defecto los contadores se guardan en memoria del propio proceso —
funciona bien mientras el backend corra en una sola instancia (que es
el caso actual en Railway). Si en algún momento se escala a más de un
worker/instancia, hay que apuntar `storage_uri` a Redis para que el
límite se comparta entre todas las instancias en vez de resetearse por
proceso, por ejemplo:

    limiter = Limiter(
        key_func=get_remote_address,
        storage_uri=settings.REDIS_URL,
        default_limits=["200/minute"],
    )

`key_func=get_remote_address` limita por IP. Es lo correcto para
rutas públicas/no autenticadas (login, registro, recuperación de
contraseña); para rutas ya autenticadas donde se quiera limitar por
usuario en vez de por IP se puede pasar un `key_func` distinto por
endpoint con el decorador `@limiter.limit(..., key_func=...)`.
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(
    key_func=get_remote_address,
    # Límite general de "red de seguridad" para cualquier endpoint que
    # no tenga un límite propio más estricto — evita que un cliente
    # (o script) sature cualquier ruta a fuerza bruta de requests.
    default_limits=["200/minute"],
)
