# Archivos `.env` y variables de entorno

Estado verificado el 2026-11-16. **Este documento no contiene valores secretos**; los `.env` reales están ignorados por git (`*.env` en `.gitignore`, `.env*` en `frontend/.gitignore`). Plantillas sin secretos: `backend/.env.example` y `frontend/.env.example`.

## Estado actual (2026-11-16): entorno local de pruebas

La plataforma **no está en uso**; los `.env` se configuraron para probar en local:
- Backend `http://localhost:8000` (`BACKEND_URL`), frontend `http://localhost:3000` (`FRONTEND_URL`, `NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1`), `GOOGLE_REDIRECT_URI=http://localhost:3000/teacher/calendar/callback`.
- Ambos archivos llevan **comentarios en línea** que documentan cada variable, con el valor anterior de producción anotado donde cambió. El resto de valores (secretos incluidos) no se tocó; las copias originales se guardaron fuera del repo.
- `NODE_ENV` ya no está en `frontend/.env` (Next la gestiona sola).

## ⚠ Lo que sigue siendo real

1. **`DATABASE_URL` sigue siendo la base Neon real** (`neondb`, 34 tablas, revisión Alembic `c9d0e1f2a3b4` (el head del repo es ahora `b1d5e6f7a8c9`) = head, ~10 usuarios, 21 clases, 18 pagos). Aunque la plataforma no esté en uso, **`tests/flow` crea y borra datos ahí**. Para aislar: rama `dev` gratuita de Neon y su URL en este `.env`.
2. **Las claves son reales**: Resend (los emails de las pruebas **se envían de verdad**: usa cuentas tuyas), OpenAI (cada Chipi/TTS gasta saldo), Cloudinary (las subidas quedan en la nube), Google.
3. `app/db/base.py` usa `load_dotenv(override=True)`: **el `.env` pisa a las variables del sistema**, incluso `DATABASE_URL` pasada por línea de comandos. Por eso `tests/audit` neutraliza `load_dotenv` y aborta si el motor no es SQLite (ver `tests/audit/conftest.py` y `run_server.py`).
4. `ENVIRONMENT=development` activa `/docs` y `/redoc` y **no** bloquea `flow_tests` (solo se bloquea con `production`). En Railway debe ser `production`.
5. **Google en local**: en Google Cloud Console añade `http://localhost:3000` a «Orígenes JavaScript autorizados» y `http://localhost:3000/teacher/calendar/callback` a «URIs de redirección», o el login con Google y el OAuth de Calendar fallarán (`redirect_uri_mismatch`). El `GOOGLE_CLIENT_ID` del backend y el `NEXT_PUBLIC_GOOGLE_CLIENT_ID` del frontend deben ser el mismo.
6. **Si vuelves a producción**, restaura los valores anotados como «Valor anterior» (URLs `https://tuprofemaria.com` / `https://api.tuprofemaria.com`; el redirect de Google estaba en `http://`, debe ser `https://`), pon `ENVIRONMENT=production` y define las variables en el panel de Railway, no en el portátil.

## Cómo arrancar en local

```bash
cd backend  && uvicorn app.main:app --reload --port 8000     # API + /docs
cd frontend && npm run dev                                    # http://localhost:3000
```
Cuenta de prueba sin tocar la BD real: `python -m tests.audit.run_server` (SQLite + datos semilla; ignora este `.env`).

## Dónde se carga cada archivo

| Archivo | Lo lee | Cómo |
|---|---|---|
| `backend/.env` | `app/core/config.py` (`Settings`, pydantic-settings con `env_file=".env"` + `load_dotenv()`), `app/core/storage.py` (`load_dotenv()`), `app/db/base.py` (`load_dotenv(override=True)`) | al importar; la ruta es relativa al directorio de trabajo, así que **ejecuta siempre desde `backend/`** |
| `frontend/.env` | Next.js | `NEXT_PUBLIC_*` se **incrustan en el bundle en tiempo de build** (cambiarlas exige reconstruir); no pongas secretos ahí |
| Railway | variables del servicio | en producción no se usa el `.env`: se definen en el panel de cada servicio; el frontend las necesita como *build args* si el Dockerfile construye dentro de Railway |

## Backend — variables

| Variable | Estado actual | Obligatoria | Para qué se usa | Notas |
|---|---|---|---|---|
| `DATABASE_URL` | definida (Neon, `sslmode=require&channel_binding=require`) | **sí** | `db/base.py` (engines), Alembic | Usar el endpoint *pooled* de Neon si se activa pool (ver RESOURCE_COSTS #3) |
| `SECRET_KEY` | definida (64 car.) | **sí** | firma JWT HS256 | Rotarla invalida todas las sesiones. No reutilizar entre entornos |
| `ALGORITHM` | `HS256` | no | JWT | |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `10080` (7 días) | no | caducidad del access token | Con refresh (SEC-05) bájalo a `30` cuando el frontend nuevo esté desplegado |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `30` | no | caducidad del refresh token (cookie `tpm_refresh`) | |
| `LOGIN_MAX_FAILED` | `8` | no | contraseñas erróneas seguidas que bloquean la cuenta | Requiere la migración `c2e6f7a8b9d0` |
| `LOGIN_LOCK_MINUTES` | `15` | no | duración del bloqueo por logins fallidos | |
| `COOKIE_DOMAIN` | vacío | prod | dominio de las cookies de sesión | `.tuprofemaria.com` en producción |
| `COOKIE_SAMESITE` | `lax` | no | SameSite de las cookies | `none` solo si front y API son de sitios distintos |
| `ENVIRONMENT` | `development` | no | `production` oculta `/docs` y bloquea `flow_tests` | ver ⚠4 |
| `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` / `DB_POOL_RECYCLE` | no definidas (5 / 5 / 240) | no | `db/base.py`: pool del engine principal | con la red lenta hasta Neon es el cuello: en la prueba de carga (E5, `tests/load/README.md`) 20 usuarios saturan 10 conexiones; con 20/10 la latencia vuelve a la de un usuario |
| `FRONTEND_URL` | `http://localhost:3000` (antes `https://tuprofemaria.com`) | no | CORS (`main.py`), enlaces en emails | CORS permite además `http://localhost:3000` |
| `BACKEND_URL` | `http://localhost:8000` (antes `https://api.tuprofemaria.com`) | no | enlaces absolutos | |
| `OPENAI_API_KEY` | definida | **sí de facto** | Chipi (`gpt-4o-mini`) y TTS; sin ella la app no arranca | facturación por uso |
| `GEMINI_API_KEY` | definida | no | `ai_debug.py` | se envía en la URL (SEC-06) |
| `RESEND_API_KEY` | definida | para emails | `core/email.py` | sin ella los envíos fallan en silencio (se capturan) |
| `EMAIL_FROM` | `soporte@mail.tuprofemaria.com` | no | remitente | el dominio debe estar verificado en Resend |
| `PUBLIC_CACHE_MAX_AGE` / `PUBLIC_CACHE_SWR` | `60` / `300` | no | `Cache-Control` de landing, lista y perfil público de profesores (Fase 14, E4, `core/http_cache.py`) | `0` = `no-cache`; afecta al navegador y a la CDN, no a la caché en memoria |
| `SLOTS_CACHE_TTL_SECONDS` | `45` | no | caché de la rejilla de huecos por profesor (Fase 14, E3, `core/slots_cache.py`) | `0` = sin caché; se invalida al hacer commit de clases o disponibilidad |
| `FLOW_TESTS_ENABLED` | `false` | no | habilita el Flow Tester del panel (`/flow-tests/*`, solo superadmin; lanza `pytest tests/flow`, que escribe en la BD real) (Fase 21, S4) | déjalo en `false` salvo en un backend de desarrollo con rama de BD propia; con `ENVIRONMENT=production` queda bloqueado aunque sea `true` |
| `EMAIL_ASYNC` / `EMAIL_WORKERS` | `true` / `2` | no | envío de correos en segundo plano (Fase 14, E1): la petición no espera a Resend | `false` = envío en línea (tests); la cola vive en memoria |
| `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` | definidas | para archivos | `core/storage.py`, TTS | |
| `MAX_VIDEO_UPLOAD_MB` | `100` | no | tope de vídeo (`storage.py`) | desde la Fase 5 se sube por streaming (no se carga entero en RAM) |
| `MATERIALS_QUOTA_MB` | `500` | no | cuota de materiales por profesor (`core/upload_quota.py`); `0` la desactiva | 413 al superarla; borrar un material libera espacio |
| `ERROR_LOG_RETENTION_DAYS` / `EMAIL_LOG_RETENTION_DAYS` | `30` / `60` | no | purga diaria de `error_logs` / `email_log` (`core/retention.py`); `0` la desactiva | |
| `USER_NOTIFICATION_RETENTION_DAYS` | `90` | no | la misma purga diaria borra los avisos dirigidos a un usuario (campana «Avisos» del profesor) **ya leídos** y más viejos que esto; los de staff no se tocan; `0` la desactiva | Requiere la migración `d3f7a8b9c0e1` |
| `CHAT_DIGEST_DELAY_MINUTES` | `10` | no | espera antes de enviar el resumen de mensajes de chat al profesor (`core/chat_digest.py`) | |
| `OPENAI_TIMEOUT_SECONDS` | `30` | no | timeout de las llamadas a OpenAI (chat de Chipi y TTS), con 1 reintento (`core/chipi/service.py`, `core/tts_service.py`) | el valor por defecto del SDK era 600 s |
| `CLOUDINARY_READ_TIMEOUT_SECONDS` | `120` | no | espera máxima entre bytes recibidos de Cloudinary al subir o borrar (`core/storage.py`); conexión 10 s | sin esto una subida colgada bloqueaba el hilo |
| `API_GZIP_MIN_BYTES` | `1000` | no | tamaño mínimo (bytes) para comprimir con gzip las respuestas de la API (`app/main.py`); `0` la desactiva | no comprime `text/event-stream` (streaming de Chipi) |
| `SLOW_REQUEST_MS` | `1500` | no | umbral (ms) para avisar en el log de las peticiones lentas (`app/core/request_timing.py`); `0` desactiva el aviso (la cabecera `Server-Timing` se envía siempre) | busca `Peticion lenta` en los logs de Railway |
| `TTS_CACHE_FOLDER` | `tts_cache` | no | carpeta Cloudinary del audio cacheado | |
| `TTS_REALTIME_MODEL` | `gpt-realtime-2.1-mini` | no | modelo Realtime que genera el audio de las palabras (`core/tts_service.py`); sustituye a `tts-1`/`gpt-4o-mini-tts`, que OpenAI apaga el 2027-01-06 | |
| `TTS_MAX_CONCURRENCY` | `5` | no | sesiones Realtime simultáneas en todo el servidor; un lote de 20 palabras se genera de 5 en 5 | subirlo acelera los lotes pero consume los límites de OpenAI |
| `TTS_WORD_TIMEOUT_SECONDS` | `45` | no | tiempo máximo por palabra (abrir sesión + generar) | |
| `TTS_WORD_ATTEMPTS` | `2` | no | intentos por palabra ante un fallo de red o de sesión | |
| `GOOGLE_CLIENT_ID` | definida | para Google | login GSI y Calendar | debe ser el **mismo** que `NEXT_PUBLIC_GOOGLE_CLIENT_ID` |
| `GOOGLE_CLIENT_SECRET` | definida | Calendar | intercambio OAuth | |
| `GOOGLE_REDIRECT_URI` | `http://localhost:3000/teacher/calendar/callback` (antes `http://tuprofemaria.com/...`) | Calendar | callback OAuth | ver ⚠5 |
| `FEATURED_TEACHER_USERNAME` | `mar12` | no | profesor destacado (landing/single-tenant) | |
| `LANDING_CACHE_TTL_SECONDS` | **no definida** | no | caché del landing | usa el valor por defecto del código |

Variables que el código acepta y **no** están en tu `.env`: `LANDING_CACHE_TTL_SECONDS`. Variables en tu `.env` que el código **no** lee con ese nombre: ninguna detectada.

## Frontend — variables

| Variable | Valor actual | Uso |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000/api/v1` (antes `https://api.tuprofemaria.com/api/v1`) | base de axios (`lib/api.ts`, 6 usos). Default si falta: `http://localhost:8000/api/v1` |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | definida | botón de Google (GSI) |
| `NEXT_PUBLIC_FEATURED_TEACHER_USERNAME` | `mar12` | perfil destacado (`next.config.ts`, landing) |
| `NODE_ENV` | eliminada | la gestiona Next |

Importante: `next.config.ts` construye el CSP; el dominio del backend debe estar permitido en `connect-src`. Si cambias `NEXT_PUBLIC_API_URL` a otro host (p. ej. local o Render), actualiza el CSP.

## Perfiles

| Perfil | `backend/.env` | `frontend/.env` | Para qué |
|---|---|---|---|
| **local (actual)** | URLs localhost, `ENVIRONMENT=development`, BD Neon real | `NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1` | pruebas manuales y E2E con navegador |
| **local aislado (recomendado para `tests/flow`)** | `DATABASE_URL` = rama Neon `dev` o PostgreSQL local | igual | pruebas que crean/borran datos |
| **auditoría sin riesgo** | no usa `.env`: `tests/audit` y `run_server.py` usan SQLite | igual | lógica y UI con datos semilla |
| **producción (Railway)** | variables del panel, `ENVIRONMENT=production`, URLs `https://` | build args `NEXT_PUBLIC_*` | |

## Seguridad de los secretos
- Están en disco en texto plano; no los pegues en chats, issues ni logs. Este asistente ha leído `backend/.env` para documentarlo; si compartes la conversación, **rota** `OPENAI_API_KEY`, `RESEND_API_KEY`, `CLOUDINARY_API_SECRET`, `GOOGLE_CLIENT_SECRET`, `GEMINI_API_KEY`, `SECRET_KEY` y la contraseña de Neon.
- Verifica que ningún `.env` esté en el historial: `git log --all --full-history -- "*.env"` (debe salir vacío).
- `SECRET_KEY` distinta por entorno; ≥ 32 bytes aleatorios (`python -c "import secrets;print(secrets.token_urlsafe(48))"`).

## Comprobación de conectividad (hecha el 2026-11-16, solo lectura)
Conexión a Neon con `default_transaction_read_only=on`: PostgreSQL 17.12, revisión Alembic `c9d0e1f2a3b4` (el head del repo es ahora `b1d5e6f7a8c9`) (coincide con el único head del repo), 34 tablas, ~11,8 MB. Recuentos: users 10, teacher_profiles 4, student_profiles 6, classes 21, payments 18, enrollments 8, packages 5, teacher_wallets 2, `error_logs` 397, chat_messages 22. No se escribió nada ni se llamó a OpenAI/Resend/Cloudinary/Google.
`error_logs` es la tabla con más filas: confirma el crecimiento sin tope (RESOURCE_COSTS #9).
