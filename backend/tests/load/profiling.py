"""
Consultas SQL y tiempo de base de datos por ruta, solo en el servidor de la
prueba de carga (`run_server.py`); el backend de producción no lo lleva.

La latencia que mide Locust depende de dónde se lance: desde un portátil en
Europa contra Neon us-west-2 cada consulta cuesta ~150 ms de red. El número de
consultas por petición no depende de eso, así que es lo que se compara entre
corridas y lo que dice qué endpoint optimizar.

Cada 10 s (y al salir) escribe `tests/load/results/queries.csv`:
ruta, peticiones, consultas por petición, ms de BD por petición, ms totales por petición.
"""
import atexit
import contextvars
import csv
import re
import threading
import time
from collections import defaultdict
from pathlib import Path

from sqlalchemy import event

OUT = Path(__file__).resolve().parent / "results" / "queries.csv"
_current = contextvars.ContextVar("loadtest_request", default=None)
_lock = threading.Lock()
_stats = defaultdict(lambda: [0, 0, 0.0, 0.0])  # ruta -> [peticiones, consultas, ms BD, ms total]


def _route(method: str, path: str) -> str:
    path = re.sub(r"/lt_[A-Za-z0-9_]+", "/{username}", path)
    path = re.sub(r"/\d+", "/{id}", path)
    return f"{method} {path}"


def install(engines) -> None:
    for engine in engines:
        @event.listens_for(engine, "before_cursor_execute")
        def _before(conn, cursor, statement, parameters, context, executemany):
            context._lt_start = time.perf_counter()

        @event.listens_for(engine, "after_cursor_execute")
        def _after(conn, cursor, statement, parameters, context, executemany):
            req = _current.get()
            if req is not None:
                req[0] += 1
                req[1] += (time.perf_counter() - getattr(context, "_lt_start", time.perf_counter())) * 1000

    def _flush_loop():
        while True:
            time.sleep(10)
            dump()

    threading.Thread(target=_flush_loop, daemon=True).start()
    atexit.register(dump)


class QueryCountMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("path") == "/health":
            await self.app(scope, receive, send)
            return
        req = [0, 0.0]  # lista mutable: el hilo del endpoint síncrono ve el mismo objeto
        token = _current.set(req)
        start = time.perf_counter()
        try:
            await self.app(scope, receive, send)
        finally:
            _current.reset(token)
            key = _route(scope.get("method", "?"), scope.get("path", ""))
            with _lock:
                s = _stats[key]
                s[0] += 1
                s[1] += req[0]
                s[2] += req[1]
                s[3] += (time.perf_counter() - start) * 1000


def dump() -> None:
    with _lock:
        rows = sorted(_stats.items(), key=lambda kv: -kv[1][1] / max(kv[1][0], 1))
        snapshot = [(k, n, q / n, db / n, tot / n) for k, (n, q, db, tot) in rows if n]
    OUT.parent.mkdir(exist_ok=True)
    with OUT.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["route", "requests", "queries_per_req", "db_ms_per_req", "total_ms_per_req"])
        for k, n, q, db, tot in snapshot:
            w.writerow([k, n, f"{q:.1f}", f"{db:.0f}", f"{tot:.0f}"])
