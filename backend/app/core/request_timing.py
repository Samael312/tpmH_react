"""
Medicion del tiempo de cada peticion (Fase 11), sin dependencias ni escrituras en la base de datos.

- Anade la cabecera `Server-Timing: app;dur=<ms>` a las respuestas (las herramientas de desarrollo del navegador la
  muestran en la pestana Red / Timing).
- Escribe un aviso en el log cuando una peticion tarda mas de SLOW_REQUEST_MS (1500 por defecto; 0 lo desactiva):
  `Peticion lenta: GET /api/v1/... 2310 ms (200)`. Asi se ve en los logs de Railway que endpoints hay que optimizar,
  sin necesitar un servicio externo de trazas.

Mide hasta que la aplicacion empieza a responder (la primera cabecera), que es lo que importa para detectar consultas
lentas; el envio del cuerpo de respuestas largas (streaming de Chipi) no cuenta.
"""
import logging
import os
import time

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger("app.slow_requests")

# Rutas que no interesan (sondeos frecuentes y baratos)
_IGNORED_PATHS = ("/health",)


def slow_request_ms() -> int:
    try:
        return int(os.getenv("SLOW_REQUEST_MS", "1500"))
    except ValueError:
        return 1500


class RequestTimingMiddleware:
    """Middleware ASGI puro (sin BaseHTTPMiddleware: no retiene ni vuelve a trocear el cuerpo)."""

    def __init__(self, app: ASGIApp, slow_ms: int | None = None) -> None:
        self.app = app
        self.slow_ms = slow_request_ms() if slow_ms is None else slow_ms

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        start = time.perf_counter()

        async def send_with_timing(message: Message) -> None:
            if message["type"] == "http.response.start":
                elapsed_ms = (time.perf_counter() - start) * 1000
                MutableHeaders(scope=message).append("Server-Timing", f"app;dur={elapsed_ms:.0f}")
                path = scope.get("path", "")
                if self.slow_ms > 0 and elapsed_ms >= self.slow_ms and not path.startswith(_IGNORED_PATHS):
                    logger.warning(
                        "Peticion lenta: %s %s %.0f ms (%s)", scope.get("method", "?"), path, elapsed_ms, message.get("status")
                    )
            await send(message)

        await self.app(scope, receive, send_with_timing)
