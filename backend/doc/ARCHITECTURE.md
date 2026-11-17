# Arquitectura del backend

## Stack

FastAPI + SQLAlchemy (sync) + PostgreSQL (Neon) + Alembic. Auth JWT (HS256, `python-jose`) con bcrypt.
Rate limit con `slowapi` (memoria). Scheduler APScheduler en proceso. Emails con Resend. Archivos en Cloudinary.
IA: OpenAI (Chipi chatbot + TTS), Gemini (`ai_debug.py`). Google OAuth (login GSI + Calendar/Meet).
Python 3.11 en Docker, 3.12 en desarrollo local.

## Estructura

```
backend/
  app/
    main.py                 FastAPI, CORS, rate-limit, handlers de error -> error_logs, lifespan (scheduler)
    api/v1/api.py           agrupa routers; prefijo global /api/v1
    api/v1/endpoints/*.py   un archivo por dominio (ver generated/API_REFERENCE.md)
    auth/                   dependencias de rol, hash de contraseñas, JWT, verificación de Google
    core/                   lógica de negocio reutilizable (ver generated/CORE_FUNCTIONS.md)
      class_logic.py        reglas de agendado/créditos/estados  <- LEER ANTES DE TOCAR CLASES
      scheduler.py          jobs APScheduler
      timezone.py           UTC <-> local, slots
      email.py              plantillas Resend
      google_calendar.py / calendar_sync.py   integración Calendar/Meet
      group_cohort_logic.py cohortes grupales
      chat.py / chat_ws.py  chat interno + WebSocket
      chipi/                asistente IA (service, prompts, context)
      storage.py            Cloudinary + validación de magic bytes
      rate_limit.py         limiter (get_remote_address)
    models/                 SQLAlchemy (generated/MODELS.md)
    schemas/                Pydantic (generated/SCHEMAS.md)
    db/base.py              engine, SessionLocal, Base, get_db
  alembic/versions/         migraciones (un solo head f8b3c4d5e6a7)
  tests/flow/               suite de integración (necesita PostgreSQL + .env)
  tests/audit/              suite de auditoría sin .env (SQLite) + run_server.py
  doc/                      esta documentación
```

## Routers (prefijo `/api/v1`)

`auth`, `users`, `teachers`, `packages`, `payments`, `classes`, `availability`, `cohorts`, `calendar`,
`homework`, `materials`, `reviews`, `support`, `chat` (REST + WS), `chipi`, `tts`, `admin`, `god_mode`,
`system_catalogs`, `public` (landing), `logs`, `ai_debug`, `flow_tests` (lanza pytest; bloqueado si `ENVIRONMENT=production`).
Detalle exacto por ruta: `generated/API_REFERENCE.md`. Endpoint sin prefijo: `GET /health`.

## Configuración (`app/core/config.py`, pydantic-settings + `.env`)

| Variable | Obligatoria | Uso |
|---|---|---|
| `DATABASE_URL` | **sí** | PostgreSQL |
| `SECRET_KEY` | **sí** | firma JWT |
| `OPENAI_API_KEY` | **sí de facto** | el cliente se crea al importar `core/chipi/service.py`; sin ella la app no arranca |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | no (10080 = 7 días) | |
| `ENVIRONMENT` | no (`development`) | `production` desactiva `/docs` y `flow_tests` |
| `FRONTEND_URL`, `BACKEND_URL` | no | CORS, enlaces en emails |
| `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` | para Google | login GSI y Calendar |
| `RESEND_API_KEY`, `EMAIL_FROM` | para emails | sin clave los envíos fallan (se capturan) |
| `CLOUDINARY_*`, `MAX_VIDEO_UPLOAD_MB` (100) | para archivos | |
| `GEMINI_API_KEY` | opcional | `ai_debug` |
| `FEATURED_TEACHER_USERNAME` | opcional | profesor destacado (single-tenant/landing) |
| `LANDING_CACHE_TTL_SECONDS` | opcional | caché del landing |

## Scheduler (APScheduler, en el proceso web)

| Job | Intervalo | Qué hace |
|---|---|---|
| `finalize_expired_classes` | 10 min | `finalize_past_classes`: `confirmed` pasadas -> `finalized`; no confirmadas pasadas -> `no_show` |
| `send_class_reminders` | 1 h | email de recordatorio a ~24 h |
| `generate_upcoming_meet_links` | 5 min | crea Meet vía Calendar del profesor para clases próximas |
| `sync_all_teacher_calendars` | 30 min | sincroniza Calendar (busy e importación externa) |
| `notify_low_credit_packages` | 7 días | aviso de pocos créditos |
| `purge_old_chat_messages` | 24 h | borra mensajes más viejos que `chat_retention_days` (0 = no borra) |

Todos son `IntervalTrigger` (primer disparo **después** del intervalo). Con varios workers se duplican.

## Despliegue (Railway)

`railway.toml`: servicio backend (`backend/Dockerfile`, `uvicorn app.main:app --host 0.0.0.0 --port 8000`, healthcheck `/health`)
y frontend (`node server.js`). Uvicorn con `--proxy-headers --forwarded-allow-ips=*` y un solo worker (SEC-01).

## Manejo de errores y logs

`main.py` registra handlers: toda excepción no controlada -> 500 + fila `error_logs` (nivel error);
`HTTPException` de negocio -> log solo si `is_reportable_business_error`. `POST /logs/frontend` guarda errores del frontend.
La pantalla de Logs del admin lee `error_logs`.
