"""
Arranca el backend real para la prueba de carga, igual que en Railway (un
worker, `--proxy-headers`), pero sin enviar correos.

Uso (desde backend/):
    LOADTEST_DB_HOST=<host del .env> python -m tests.load.run_server [puerto]

`--proxy-headers` con `forwarded_allow_ips="*"` hace que el límite por IP
use `X-Forwarded-For`: cada usuario simulado de Locust manda su propia IP,
como pasa con usuarios reales detrás del proxy de Railway. Sin eso, todos
comparten el límite general de 200/min y el de login de 10/min.

Además cuenta consultas SQL y tiempo de BD por ruta (`profiling.py`).
"""
import sys

from tests.load.common import add_backend_to_path, disable_outbound, guard_database

if __name__ == "__main__":
    host = guard_database()
    add_backend_to_path()
    disable_outbound()

    import uvicorn
    from app.main import app
    from app.db.base import chat_engine, engine
    from tests.load import profiling

    profiling.install([engine, chat_engine])  # consultas por ruta -> tests/load/results/queries.csv

    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8001
    print(f"[loadtest] BD {host} · correos desactivados · http://127.0.0.1:{port}")
    uvicorn.run(profiling.QueryCountMiddleware(app), host="127.0.0.1", port=port, workers=1,
                proxy_headers=True, forwarded_allow_ips="*", log_level="warning")
