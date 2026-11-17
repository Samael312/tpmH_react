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
      scheduler.py          jobs APScheduler (por vencimiento + diarios/semanal)
      chat_digest.py        aviso agrupado de mensajes de chat al profesor
      retention.py          purga de error_logs y email_log
      upload_quota.py       cuota de materiales por profesor
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
  alembic/versions/         migraciones (un solo head a9c4d5e6f7a8)
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

**Jobs por vencimiento (Fase 9).** No consultan la BD a intervalo fijo (eso mantenía despierta la base de Neon las 24 h): cada uno calcula **cuándo le toca actuar** con una consulta corta y se programa con un `DateTrigger`; sin nada pendiente duerme hasta 24 h. Se recalculan al arrancar (5 s después) y cuando una sesión confirma (`commit`) una escritura de `Class`, `PlatformConfig` o `GoogleCalendarToken` (ganchos de sesión en `scheduler.py`; el chat avisa a mano al marcar un aviso pendiente). Cada job respeta una separación mínima entre ejecuciones (`min_gap`) para que un fallo no se reintente en bucle.

| Job | Cuándo se ejecuta | Qué hace |
|---|---|---|
| `finalize_expired_classes` | al terminar la primera clase `confirmed`/`pending_trial`, o 72 h después de terminar una `finalized` (mín. 5 min entre ejecuciones) | `finalize_past_classes`: `confirmed` pasadas -> `finalized` -> `no_show` |
| `generate_meet_links` | cuando la próxima clase sin link entra en la ventana `meet_link_autogen_minutes` (mín. 5 min) | crea Meet vía Calendar del profesor |
| `class_reminders` | 25 h antes de la primera clase sin recordatorio (ventana 23–25 h; mín. 10 min) | recordatorio al alumno por clase y **un correo por profesor** con todas sus clases de la ventana |
| `chat_digest` | `CHAT_DIGEST_DELAY_MINUTES` (10) después del primer aviso pendiente (mín. 5 min) | un correo por profesor con sus conversaciones con mensajes sin leer |
| `sync_teacher_calendars` | cada 30 min si hay clase en curso o en las próximas 3 h; si no, cada 6 h y siempre antes de que la próxima clase entre en esa ventana; nada si ningún profesor tiene Calendar | sincroniza Calendar (busy e importación externa) |

Jobs con hora fija (`CronTrigger`, UTC; los diarios juntos para despertar Neon una sola vez): `purge_old_chat_messages` 03:00 (borra mensajes más viejos que `chat_retention_days`; 0 = no borra), `purge_old_logs` 03:05 (`error_logs` 30 d y `email_log` 60 d), `release_stale_enrollments` 03:10 (cancela enrollments individuales sin pagar de más de 24 h) y `notify_low_credit_packages` los lunes 14:00 (aviso de pocos créditos).

Con varios workers se duplican (hoy: un solo worker). Tests: `tests/audit/test_due_jobs.py`.

## Despliegue (Railway)

`railway.toml`: servicio backend (`backend/Dockerfile`, `uvicorn app.main:app --host 0.0.0.0 --port 8000`, healthcheck `/health`)
y frontend (`node server.js`). Uvicorn con `--proxy-headers --forwarded-allow-ips=*` y un solo worker (SEC-01).

## Manejo de errores y logs

`main.py` registra handlers: toda excepción no controlada -> 500 + fila `error_logs` (nivel error);
`HTTPException` de negocio -> log solo si `is_reportable_business_error`. `POST /logs/frontend` guarda errores del frontend.
La pantalla de Logs del admin lee `error_logs`.
