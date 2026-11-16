"""
Backend REAL con el .env (BD Neon de desarrollo, OpenAI/Cloudinary reales) pero con los EMAILS DESACTIVADOS.
Para pruebas E2E con navegador (frontend en http://localhost:3000). Ejecutar desde backend/:

    python -m tests.audit.run_dev_server            # puerto 8000

Los emails de Resend se interceptan y se guardan en tests/audit/outbox.jsonl (no se envía nada).
Se niega a arrancar si ENVIRONMENT=production.
"""
import json
import os
import sys
import time

import resend
from dotenv import load_dotenv

load_dotenv(override=True)
if os.getenv("ENVIRONMENT") == "production":
    sys.exit("ABORTADO: ENVIRONMENT=production")

_OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "outbox.jsonl")


def _fake_send(params, *a, **k):
    with open(_OUT, "a", encoding="utf8") as f:
        f.write(json.dumps({"t": time.time(), "to": params.get("to"), "subject": params.get("subject")}, ensure_ascii=False) + "\n")
    return {"id": "dev-outbox"}


resend.Emails.send = _fake_send

import uvicorn  # noqa: E402

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="127.0.0.1", port=int(sys.argv[1]) if len(sys.argv) > 1 else 8000)
