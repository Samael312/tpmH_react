"""
Cabeceras de caché HTTP para respuestas públicas (Fase 14, E4).

Solo para endpoints sin autenticación cuya respuesta es la misma para
cualquier visitante y que no ponen cookies: landing, lista y perfil
público de profesores. Así el navegador (y una CDN delante, B4) puede
reutilizar la respuesta sin tocar el backend.

- `max-age` (`PUBLIC_CACHE_MAX_AGE`, 60 s): se reutiliza sin preguntar.
- `stale-while-revalidate` (`PUBLIC_CACHE_SWR`, 300 s): pasado el
  max-age se sirve la copia vieja al instante y se pide la nueva en
  segundo plano; la visita siguiente ya la ve.

Peor caso: un cambio (perfil editado, profesor suspendido) tarda hasta
max-age + una visita en verse en un navegador que ya tenía la copia. La
caché en memoria de la landing se invalida al guardar, pero esto no
alcanza a los navegadores. `PUBLIC_CACHE_MAX_AGE=0` lo desactiva
(`no-cache`). CORS ya añade `Vary: Origin`.

Solo se llama en la rama de éxito: un 404 o un error nunca se cachea.
"""
from fastapi import Response

from app.core.config import settings


def set_public_cache(response: Response) -> None:
    max_age = settings.PUBLIC_CACHE_MAX_AGE
    if max_age <= 0:
        response.headers["Cache-Control"] = "no-cache"
        return
    response.headers["Cache-Control"] = (
        f"public, max-age={max_age}, stale-while-revalidate={settings.PUBLIC_CACHE_SWR}"
    )
