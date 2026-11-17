# Archivos `.env` y variables de entorno

Estado verificado el 2026-11-16. **Este documento no contiene valores secretos**; los `.env` reales están ignorados por git (`*.env` en `.gitignore`, `.env*` en `frontend/.gitignore`). Plantillas sin secretos: `backend/.env.example` y `frontend/.env.example`.

## Estado actual (2026-11-16): entorno local de pruebas

La plataforma **no está en uso**; los `.env` se configuraron para probar en local:
- Backend `http://localhost:8000` (`BACKEND_URL`), frontend `http://localhost:3000` (`FRONTEND_URL`, `NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1`), `GOOGLE_REDIRECT_URI=http://localhost:3000/teacher/calendar/callback`.
- Ambos archivos llevan **comentarios en línea** que documentan cada variable, con el valor anterior de producción anotado donde cambió. El resto de valores (secretos incluidos) no se tocó; las copias originales se guardaron fuera del repo.
- `NODE_ENV` ya no está en `frontend/.env` (Next la gestiona sola).

## ⚠ Lo que sigue siendo real

1. **`DATABASE_URL` sigue siendo la base Neon real** (`neondb`, 34 tablas, revisión Alembic `c9d0e1f2a3b4` = head, ~10 usuarios, 21 clases, 18 pagos). Aunque la plataforma no esté en uso, **`tests/flow` crea y borra datos ahí**. Para aislar: rama `dev` gratuita de Neon y su URL en este `.env`.
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
| `COOKIE_DOMAIN` | vacío | prod | dominio de las cookies de sesión | `.tuprofemaria.com` en producción |
| `COOKIE_SAMESITE` | `lax` | no | SameSite de las cookies | `none` solo si front y API son de sitios distintos |
| `ENVIRONMENT` | `development` | no | `production` oculta `/docs` y bloquea `flow_tests` | ver ⚠4 |
| `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` / `DB_POOL_RECYCLE` | no definidas (5 / 5 / 240) | no | `db/base.py`: pool del engine principal | bajar `DB_POOL_SIZE` con el endpoint *pooled* de Neon |
| `FRONTEND_URL` | `http://localhost:3000` (antes `https://tuprofemaria.com`) | no | CORS (`main.py`), enlaces en emails | CORS permite además `http://localhost:3000` |
| `BACKEND_URL` | `http://localhost:8000` (antes `https://api.tuprofemaria.com`) | no | enlaces absolutos | |
| `OPENAI_API_KEY` | definida | **sí de facto** | Chipi (`gpt-4o-mini`) y TTS; sin ella la app no arranca | facturación por uso |
| `GEMINI_API_KEY` | definida | no | `ai_debug.py` | se envía en la URL (SEC-06) |
| `RESEND_API_KEY` | definida | para emails | `core/email.py` | sin ella los envíos fallan en silencio (se capturan) |
| `EMAIL_FROM` | `soporte@mail.tuprofemaria.com` | no | remitente | el dominio debe estar verificado en Resend |
| `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` | definidas | para archivos | `core/storage.py`, TTS | |
| `MAX_VIDEO_UPLOAD_MB` | `100` | no | tope de vídeo (`storage.py`) | se lee entero en RAM (RESOURCE_COSTS #7) |
| `TTS_CACHE_FOLDER` | `tts_cache` | no | carpeta Cloudinary del audio cacheado | |
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
Conexión a Neon con `default_transaction_read_only=on`: PostgreSQL 17.12, revisión Alembic `c9d0e1f2a3b4` (coincide con el único head del repo), 34 tablas, ~11,8 MB. Recuentos: users 10, teacher_profiles 4, student_profiles 6, classes 21, payments 18, enrollments 8, packages 5, teacher_wallets 2, `error_logs` 397, chat_messages 22. No se escribió nada ni se llamó a OpenAI/Resend/Cloudinary/Google.
`error_logs` es la tabla con más filas: confirma el crecimiento sin tope (RESOURCE_COSTS #9).
