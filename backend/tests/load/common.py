"""
Piezas compartidas de la prueba de carga (Fase 14, E5).

- `guard_database()`: se niega a seguir si no se confirma a mano el host de
  la base de datos del `.env`. `app/db/base.py` hace `load_dotenv(override=True)`,
  así que la URL del `.env` manda siempre: hay que mirar ESA, no la del entorno.
- `disable_outbound()`: anula el envío real de correos (Resend). Las reservas
  mandan 2 correos cada una; en una prueba de carga serían cientos.

Datos de la prueba: todo lleva el prefijo `lt_` y `is_test_account=True`
(no sale en el marketplace). Ver README.md.
"""
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

BACKEND_DIR = Path(__file__).resolve().parents[2]
SEED_FILE = Path(__file__).resolve().parent / ".seed.json"

PREFIX = "lt_"
PASSWORD = "LoadTest123"
EMAIL_DOMAIN = "loadtest.tuprofemaria.com"  # subdominio sin MX; además el envío está anulado (`.invalid` no pasa EmailStr)


def _dotenv_values() -> dict:
    from dotenv import dotenv_values
    return dotenv_values(BACKEND_DIR / ".env")


def guard_database() -> str:
    """Devuelve el host de la BD si LOADTEST_DB_HOST lo confirma; si no, sale con un mensaje."""
    env = _dotenv_values()
    url = env.get("DATABASE_URL") or os.getenv("DATABASE_URL") or ""
    host = urlparse(url.replace("postgresql+psycopg2", "postgresql")).hostname or ""
    if not host:
        sys.exit("ABORTADO: no hay DATABASE_URL en backend/.env")
    if (env.get("ENVIRONMENT") or os.getenv("ENVIRONMENT", "")).lower() == "production":
        sys.exit("ABORTADO: ENVIRONMENT=production en backend/.env")
    confirmed = os.getenv("LOADTEST_DB_HOST", "")
    if confirmed != host:
        sys.exit(
            "ABORTADO: la prueba de carga escribe en la base de datos del .env:\n"
            f"    {host}\n"
            "Comprueba en Neon que ese host es una rama de desarrollo (no la principal) y repite con\n"
            f"    LOADTEST_DB_HOST={host}"
        )
    return host


def disable_outbound() -> None:
    """Correos a ninguna parte. Se llama ANTES de importar la app."""
    import resend
    resend.Emails.send = lambda *a, **k: {"id": "loadtest"}


def add_backend_to_path() -> None:
    if str(BACKEND_DIR) not in sys.path:
        sys.path.insert(0, str(BACKEND_DIR))
    os.chdir(BACKEND_DIR)
