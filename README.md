# TPM — plataforma de clases particulares (tuprofemaria)

Plataforma web para que **alumnos** reserven clases con **profesores** (prueba gratuita → compra de paquete → agenda), con pagos validados manualmente, comisión de plataforma, billetera y retiros para el profesor, clases grupales (cohortes), chat, tareas, materiales, reseñas, soporte, integración con Google Calendar/Meet y un asistente de IA («Chipi»).

> Documentación detallada (generada tras una auditoría completa, 2026-11-16): ver [Documentación](#documentación).
> Si eres un asistente de IA: lee primero [`CLAUDE.md`](CLAUDE.md).

## Índice
1. [Stack](#stack) · 2. [Estructura del repositorio](#estructura-del-repositorio) · 3. [Requisitos](#requisitos) · 4. [Puesta en marcha local](#puesta-en-marcha-local) · 5. [Variables de entorno](#variables-de-entorno) · 6. [Roles y funcionalidades](#roles-y-funcionalidades) · 7. [Reglas de negocio clave](#reglas-de-negocio-clave) · 8. [API](#api) · 9. [Pruebas](#pruebas) · 10. [Despliegue](#despliegue) · 11. [Estado y problemas conocidos](#estado-y-problemas-conocidos) · 12. [Costes y recursos](#costes-y-recursos) · 13. [Documentación](#documentación) · 14. [Solución de problemas](#solución-de-problemas)

## Stack

| Capa | Tecnología |
|---|---|
| Backend | Python 3.11 (Docker) / 3.12 (local), FastAPI, SQLAlchemy (síncrono), Alembic, Pydantic v2, APScheduler, slowapi |
| Base de datos | PostgreSQL (Neon serverless) |
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind 3, TanStack Query 5, Zustand 5, axios, three.js |
| Auth | JWT HS256 (7 días) en cookie `access_token`; Google Sign-In (GSI) |
| Servicios | Resend (emails), Cloudinary (archivos y audio), OpenAI (Chipi y TTS), Google Calendar/Meet, Gemini (depuración) |
| Despliegue | Railway (dos servicios con Dockerfile) |

## Estructura del repositorio

```
.
├── backend/                FastAPI
│   ├── app/                main.py, api/v1/endpoints, core (lógica), models, schemas, auth, db
│   ├── alembic/            migraciones (55; un solo head e7a1b2c3d4f5)
│   ├── tests/audit/        suite sin .env (SQLite) + servidor de pruebas con datos semilla
│   ├── tests/flow/         suite de integración contra PostgreSQL real (¡cuidado!)
│   ├── doc/                documentación del backend
│   ├── Dockerfile · requirements.txt · .env.example
├── frontend/               Next.js
│   ├── app/                rutas por grupos: (public) (auth) (student) (teacher) (superadmin)
│   ├── components/ hooks/ store/ lib/   proxy.ts (guard por rol)   next.config.ts (CSP/cabeceras)
│   ├── doc/                documentación del frontend
│   ├── Dockerfile · .env.example
├── railway.toml            despliegue de ambos servicios
├── ANALISIS.md             informe de auditoría (seguridad, lógica, UX)
└── CLAUDE.md               guía de arranque para asistentes de IA
```

## Requisitos

- Python 3.11 o 3.12, Node.js 20+ y npm.
- Una base PostgreSQL (recomendado: una **rama de desarrollo de Neon**; ver [Variables de entorno](#variables-de-entorno)).
- Claves de Resend, Cloudinary, OpenAI y Google solo si vas a probar esas funciones. **`OPENAI_API_KEY` es obligatoria para arrancar** (puede ser falsa, p. ej. `sk-dummy`).

## Puesta en marcha local

### Opción A — sin `.env` ni PostgreSQL (la más segura)
Backend real con SQLite temporal y datos semilla; ignora cualquier `.env`.
```bash
cd backend
python -m venv venv && source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt                         # el archivo está en UTF-16; pip lo admite
python -m tests.audit.run_server                        # API en http://localhost:8000
# en otra terminal
cd frontend && npm install && npm run dev               # http://localhost:3000
```
Cuentas semilla (contraseña `Password123`): `admin` (superadmin), `profe` (profesor aprobado, disponible 08–20 UTC, «Paquete 4» de 4 clases por 100) y `alumno`. Emails, OpenAI, Google y Cloudinary están simulados o inactivos.

### Opción B — con tu base PostgreSQL
```bash
cd backend
cp .env.example .env            # rellena DATABASE_URL, SECRET_KEY, OPENAI_API_KEY, ...
alembic upgrade head            # crea/actualiza el esquema
uvicorn app.main:app --reload --port 8000     # ejecuta SIEMPRE desde backend/
# frontend
cd ../frontend
cp .env.example .env.local      # NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
npm install && npm run dev
```
Documentación interactiva de la API: <http://localhost:8000/docs> (solo si `ENVIRONMENT` ≠ `production`).

Comandos útiles del frontend: `npm run build` · `npm run lint` · `npx tsc --noEmit`.

## Variables de entorno

Los `.env` están ignorados por git; hay plantillas sin secretos en `backend/.env.example` y `frontend/.env.example`. Documentación completa de cada variable, riesgos y perfiles: [`backend/doc/ENVIRONMENT.md`](backend/doc/ENVIRONMENT.md).

| Variable | Obligatoria | Descripción |
|---|---|---|
| `DATABASE_URL` | sí | cadena PostgreSQL (Neon con `sslmode=require`) |
| `SECRET_KEY` | sí | firma JWT; `python -c "import secrets;print(secrets.token_urlsafe(48))"` |
| `OPENAI_API_KEY` | sí (de facto) | Chipi y TTS; sin ella el backend no arranca |
| `ENVIRONMENT` | no | `production` oculta `/docs` y bloquea el router `flow_tests` |
| `FRONTEND_URL` / `BACKEND_URL` | no | CORS y enlaces de emails |
| `RESEND_API_KEY`, `EMAIL_FROM` | emails | remitente con dominio verificado |
| `CLOUDINARY_*`, `MAX_VIDEO_UPLOAD_MB` | archivos | subidas y caché de audio |
| `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` | Google | login y Calendar; mismo `CLIENT_ID` que `NEXT_PUBLIC_GOOGLE_CLIENT_ID` |
| `ACCESS_TOKEN_EXPIRE_MINUTES`, `ALGORITHM` | no | JWT (10080 min, HS256) |
| `FEATURED_TEACHER_USERNAME` | no | profesor destacado |
| `NEXT_PUBLIC_API_URL` | frontend | base de la API (por defecto `http://localhost:8000/api/v1`) |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_FEATURED_TEACHER_USERNAME` | frontend | públicas: se incrustan en el bundle |

⚠ **`app/db/base.py` usa `load_dotenv(override=True)`: el `.env` manda sobre el entorno del sistema.** Si tu `.env` apunta a una base real, cualquier prueba que escriba (por ejemplo `tests/flow`) escribirá allí.

## Roles y funcionalidades

| Rol | Qué hace |
|---|---|
| **student** | explora profesores, reserva prueba, compra/renueva/cambia paquete, agenda/cancela/reagenda, tareas, materiales, chat, reseñas, soporte |
| **teacher** | onboarding y aprobación, disponibilidad semanal y excepciones, paquetes (finitos, ilimitados, cuotas), alumnos, estados de clase, valida pagos de sus alumnos, billetera y retiros, cohortes, tareas, materiales, Google Calendar |
| **teacher_admin** | profesor + panel de staff |
| **superadmin** | usuarios, profesores (aprobación y comisión), pagos y retiros, configuración de plataforma y reglas, soporte, logs, «God Mode» con auditoría |

Flujo principal: registro → **prueba** con un profesor → pago del **paquete** (el alumno lo notifica; staff o profesor lo aprueba) → **agenda** → clase (Meet automático) → profesor marca `completed` → comisión y billetera → **retiro** del profesor (staff lo procesa).

## Reglas de negocio clave

- Todo en **UTC** en BD y API; el frontend convierte a la zona del usuario.
- **Comisión**: 15 % por defecto (configurable por profesor, 0–1), calculada y **congelada** al aprobar el pago.
- **Créditos**: un paquete finito libera `unlocked_credits` (todo o por cuotas); se ocupa un crédito **al agendar**. Ilimitados: créditos prepagados.
- **Cancelar** (alumno): ≥ 12 h antes devuelve el crédito; < 12 h no se permite. El profesor siempre devuelve crédito.
- Antelación mínima de reserva 1 h; margen de preparación entre clases (prueba 5 min, regular y grupal 10); duraciones 15–240 min (opciones 25/50/80/110).
- Cada profesor exige su propia prueba. Reglas configurables en `PlatformConfig` (panel `/admin/settings`).

Detalle completo y verificado: [`backend/doc/BUSINESS_RULES.md`](backend/doc/BUSINESS_RULES.md).

## API

Prefijo `/api/v1`; 211 rutas en 23 módulos de endpoints (`auth`, `users`, `teachers`, `packages`, `payments`, `classes`, `availability`, `cohorts`, `calendar`, `homework`, `materials`, `reviews`, `support`, `chat` + WebSocket, `chipi`, `tts`, `admin`, `god_mode`, `system_catalogs`, `public`, `logs`, `flow_tests`…). `GET /health` para healthchecks.
Referencia generada con método, rol, límite de tasa y archivo:línea: [`backend/doc/generated/API_REFERENCE.md`](backend/doc/generated/API_REFERENCE.md).

## Pruebas

```bash
cd backend
python -m pytest tests/audit -q        # ~3-6 min; 81 pasan, 1 skip, 20 xfail (bugs conocidos); solo SQLite
```
- `tests/audit/` es seguro: usa SQLite temporal, simula emails y **aborta si el motor no es SQLite**. Los `xfail(strict=True)` son bugs confirmados; al corregir uno, el test pasa a XPASS y hay que quitar el marcador.
- `tests/flow/` necesita PostgreSQL + `.env` + `alembic upgrade head` y **crea y borra datos**: no lo ejecutes contra una base con datos que importen (`pytest tests/flow --run-flow-tests`; ver `backend/tests/flow/README.md`).
- Frontend: `npx tsc --noEmit`, `npm run lint` y `npm run build` pasan; **no hay tests de frontend**.
- Pendiente: concurrencia real, integraciones externas, E2E en navegador, DST, carga. Detalle en [`backend/doc/TESTING.md`](backend/doc/TESTING.md).

## Despliegue

`railway.toml` define dos servicios construidos con Dockerfile:
- **backend**: `uvicorn app.main:app --host 0.0.0.0 --port 8000`, healthcheck `/health`.
- **frontend**: `node server.js` (Next en modo `standalone`), healthcheck `/`.

Requisitos en producción: `ENVIRONMENT=production`, variables definidas en el panel de Railway (no se usa el `.env`), `NEXT_PUBLIC_*` disponibles en el **build** del frontend, migraciones aplicadas (`alembic upgrade head`), **un solo worker** (el scheduler y el rate-limit viven en memoria), y `--proxy-headers` en uvicorn para que el límite de tasa vea la IP real (SEC-01).
El scheduler (APScheduler, en el proceso web) ejecuta: finalizar clases (10 min), Meet automático (5 min), sincronización de Calendar (30 min), recordatorios (1 h), aviso de bajo crédito (7 días) y purga de chat (24 h).

## Estado y problemas conocidos

El flujo principal funciona de punta a punta (verificado con tests). La auditoría encontró **bugs reales sin corregir**; los más graves:

| ID | Problema |
|---|---|
| AUD-03 | Renovar un paquete agotado lo deja sin créditos |
| AUD-01 | El servidor no valida la disponibilidad declarada del profesor al agendar |
| AUD-02 | Doble reserva posible (pruebas pendientes y sesiones grupales no bloquean; sin bloqueo de fila) |
| AUD-12 | `GET /payments/admin/withdrawals/pending` devuelve 404 (falta el decorador) |
| AUD-14 | Los reembolsos no descuentan la billetera del profesor |
| SEC-05 | JWT en cookie no HttpOnly sin revocación (SEC-01/02/03/04 y casi todo SEC-06 corregidos en las Fases 1 y 3a) |

Lista completa con tests que los reproducen: [`backend/doc/KNOWN_ISSUES.md`](backend/doc/KNOWN_ISSUES.md) y [`ANALISIS.md`](ANALISIS.md).

## Costes y recursos

Qué acciones más consumen Neon/Railway/OpenAI/Cloudinary, ordenadas de mayor a menor, con mitigaciones y alternativas gratuitas a Railway: [`backend/doc/RESOURCE_COSTS.md`](backend/doc/RESOURCE_COSTS.md). Lo más caro: jobs que mantienen Neon despierto 24/7, jobs bloqueantes en el event loop, `NullPool` (una conexión nueva por consulta) y Chipi/TTS sin límites.

## Documentación

| Qué | Dónde |
|---|---|
| **Guías transversales** (índice maestro) | [`docs/README.md`](docs/README.md): [desarrollo](docs/DEVELOPER_GUIDE.md) · [dominio y diagramas](docs/DOMAIN_AND_DIAGRAMS.md) · [manual por rol](docs/USER_MANUAL.md) · [operación](docs/OPERATIONS.md) |
| Índice del backend | [`backend/doc/README.md`](backend/doc/README.md) |
| Arquitectura · reglas · flujos · errores · pruebas · entorno · costes | `backend/doc/{ARCHITECTURE,BUSINESS_RULES,FLOWS,KNOWN_ISSUES,TESTING,ENVIRONMENT,RESOURCE_COSTS}.md` |
| Referencias generadas (rutas, tablas, funciones, schemas) | `backend/doc/generated/` |
| Índice del frontend | [`frontend/doc/README.md`](frontend/doc/README.md) |
| Arquitectura · pantallas y UX · errores · pruebas | `frontend/doc/{ARCHITECTURE,PAGES_AND_UX,KNOWN_ISSUES,TESTING}.md` |
| Rutas, componentes y llamadas a la API (generadas) | `frontend/doc/generated/` |
| Informe de auditoría completo | [`ANALISIS.md`](ANALISIS.md) |

Regenerar lo automático tras cambiar código: `cd backend && python doc/generate_docs.py` (no necesita `.env` ni BD). Next 16 tiene cambios incompatibles: lee `frontend/AGENTS.md` antes de escribir código de frontend.

## Solución de problemas

| Síntoma | Causa probable |
|---|---|
| El backend no arranca: `OPENAI_API_KEY` | el cliente se crea al importar; pon cualquier valor (`sk-dummy`) |
| `RuntimeError`/`KeyError` de `DATABASE_URL` | ejecutas desde fuera de `backend/` (el `.env` se busca en el directorio actual) |
| CORS al llamar desde otro puerto | solo se permiten `FRONTEND_URL` y `http://localhost:3000` |
| Login con Google: `redirect_uri_mismatch` | añade `http://localhost:3000` y la URI de callback en Google Cloud Console |
| 429 en login | límite 10/min por IP (compartido tras un proxy: SEC-01) |
| Los jobs no corren / chat sin tiempo real en un hosting gratuito | el servicio se duerme; necesita proceso siempre encendido |
| Las pruebas escribieron en la base real | `load_dotenv(override=True)` + `.env` con base real; usa `tests/audit` o una rama de desarrollo |
| `pip install` falla leyendo `requirements.txt` | está en UTF-16: conviértelo a UTF-8 (incluye paquetes ajenos como `opencode-*`) |
| Retiros pendientes del admin dan 404 | bug conocido AUD-12 |

## Licencia y autoría
Proyecto privado. Sin licencia de código abierto declarada.
