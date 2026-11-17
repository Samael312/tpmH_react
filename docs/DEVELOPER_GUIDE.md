# Guía para desarrolladores

## 1. Primer día

1. Lee `README.md` (raíz) y `CLAUDE.md`. Luego `backend/doc/BUSINESS_RULES.md` y `docs/DOMAIN_AND_DIAGRAMS.md`.
2. Arranca sin riesgo: `cd backend && python -m tests.audit.run_server` + `cd frontend && npm run dev` (SQLite + datos semilla; cuentas `admin`/`profe`/`alumno`, contraseña `Password123`).
3. Corre `python -m pytest tests/audit -q` (81 pasan, 1 skip, 20 `xfail`). Si no, tu entorno tiene un problema.
4. Antes de tocar una zona, mira `backend/doc/KNOWN_ISSUES.md`: puede que el comportamiento «raro» sea un bug ya documentado con su test.

**Seguridad de datos:** los `.env` locales pueden apuntar a la base Neon real (ver `backend/doc/ENVIRONMENT.md`). `app/db/base.py` usa `load_dotenv(override=True)`: el `.env` gana a tu entorno. No ejecutes `tests/flow` sin una rama de desarrollo.

## 2. Mapa mental del código

```
Petición HTTP → app/main.py (CORS, slowapi, handlers) → api/v1/router.py → endpoints/<dominio>.py
   endpoint: Depends(get_current_*) [auth/dependencies.py] + Depends(get_db) [db/base.py]
   → schemas/*.py (Pydantic valida) → core/*.py (reglas de negocio) → models/*.py (SQLAlchemy) → PostgreSQL
Efectos secundarios: core/email.py (Resend), core/calendar_sync.py (Google), core/storage.py (Cloudinary)
Segundo plano: core/scheduler.py (APScheduler, en el mismo proceso)
```
Regla de oro del repo: **los endpoints orquestan, las reglas viven en `app/core/`** (aunque `payments.py` y `classes.py` mezclan bastante: 2130 y ~1000 líneas).

Dependencias de rol (`app/auth/dependencies.py`): `get_current_user`, `get_current_user_optional`, `get_current_student`, `get_current_teacher` (teacher o teacher_admin), `get_current_approved_teacher`, `get_current_staff` (superadmin o teacher_admin), `get_current_teacher_or_teacher_admin`, `get_current_staff_or_teacher`.

## 3. Cómo hacer cosas en el backend

### Añadir un endpoint a un dominio existente
1. Función en `app/api/v1/endpoints/<dominio>.py` con `@router.get/post/...`.
2. Auth con la dependencia de rol adecuada; **nunca** confíes en datos del cliente para la identidad.
3. Schemas de entrada/salida en `app/schemas/<dominio>.py` (Pydantic v2, `field_validator` para reglas: ver `BookClassRequest`).
4. Reglas reutilizables en `app/core/`, no en el endpoint.
5. Errores: `HTTPException(status.HTTP_..., "mensaje en español")`.
6. Si es público o sensible, límite de tasa: `@limiter.limit("5/hour")` con `request: Request` como primer argumento (ver `auth.py`).
7. Comprueba que el orden de rutas no se pisa (`/x/pending` antes que `/x/{id}`).
8. Añade un test en `tests/audit/` y regenera docs.

### Añadir un router nuevo
Crea `endpoints/<nombre>.py` con `router = APIRouter()`, impórtalo y regístralo en `app/api/v1/router.py` con `prefix` y `tags`.

### Añadir o cambiar un modelo (migración Alembic)
1. Edita/crea el modelo en `app/models/` y **expórtalo en `app/models/__init__.py`** (Alembic hace `from app.models import *`).
2. `cd backend && alembic revision --autogenerate -m "descripcion_corta"`.
3. **Revisa el archivo generado** (JSONB, enums, defaults del servidor; autogenerate falla con algunos cambios).
4. `alembic upgrade head` contra una **base de desarrollo**, nunca contra la real sin copia.
5. Comprueba un solo head: `alembic heads` (hoy `f8b3c4d5e6a7`; hay 55 migraciones y dos con el prefijo `a1b2c3d4e5f6_`).
6. Las migraciones **no se ejecutan solas al desplegar** (ver `OPERATIONS.md`).
Ojo con `Enum` de Postgres: añadir valores exige migración explícita.

### Zonas horarias y fechas
Todo en UTC con zona (`datetime` aware). Usa `utc_now()` de `app/core/timezone.py`, nunca `datetime.utcnow()`. Valida que las fechas del cliente traigan zona (hoy una fecha sin zona da 500: AUD-08). Disponibilidad semanal = `HH:MM` UTC + día; ojo con DST.

### Dinero y créditos (zona crítica)
Antes de modificar `payments.py`/`class_logic.py`, lee `BUSINESS_RULES.md` §Créditos/§Dinero y los tests `test_booking_flow.py`, `test_findings.py`, `test_edge_cases.py`. Cualquier cambio en contadores (`unlocked_credits`, `classes_used`, `prepaid_unlimited_credits`) debe mantener las dos contabilidades coherentes (ocupadas vs usadas). Las operaciones de saldo deberían usar `with_for_update()` (hoy solo el retiro lo usa).

### Emails
Una función `send_*` por plantilla en `app/core/email.py` usando `_send()` + `_base_template()`. Se envían síncronos; llámalos tras el `commit`.

## 4. Cómo hacer cosas en el frontend

> Lee `frontend/AGENTS.md`: Next 16 tiene cambios incompatibles (p. ej. `proxy.ts` reemplaza al middleware). La guía vive en `node_modules/next/dist/docs/`.

- **Nueva pantalla**: `app/(student|teacher|superadmin)/<prefijo>/<ruta>/page.tsx`. El guard por rol es automático por prefijo en `proxy.ts` (`/dashboard`, `/teacher`, `/admin`); el layout de cada grupo monta navegación, chat y onboarding.
- **Datos**: hook en `hooks/use*Data.ts` con TanStack Query y el cliente `api` de `lib/api.ts` (añade `Authorization` desde la cookie). Define la interfaz TypeScript junto al hook. Invalida queries tras mutaciones.
- **UI**: reutiliza `components/ui/*` (`Button`, `Card`, `ConfirmModal`, `BottomSheet`, `Toast`…) y `useToast`.
- **Estado global** (sesión, chat, toasts): Zustand en `store/`. No guardes el token fuera de la cookie.
- **Variables públicas** `NEXT_PUBLIC_*`: se incrustan en el build; añádelas también como `ARG`+`ENV` en `frontend/Dockerfile`, a `.env.example` y a `backend/doc/ENVIRONMENT.md`.
- **Fechas**: usa `lib/tzFormat.ts` y `lib/scheduleUtc.ts`; no hagas aritmética de zonas a mano.
- **Reglas de negocio** que la UI muestra (duraciones, antelación…): se leen del backend con `hooks/useBusinessRules.ts`; evita duplicarlas.
- **Calidad antes de commit**: `npx tsc --noEmit && npm run lint && npm run build`.

## 5. Pruebas

| Qué | Dónde | Notas |
|---|---|---|
| Lógica y API sin infraestructura | `backend/tests/audit/` | SQLite; fixtures `client`, `world` (admin, profe, alumno, paquete), `db`; helpers `book`, `approve`, `ready_student`, `complete_trial`, `set_status` |
| Bug confirmado | `@pytest.mark.xfail(strict=True, reason="AUD-xx …")` | al corregirlo pasa a XPASS → quita el marcador |
| Integración con PostgreSQL | `backend/tests/flow/` | crea/borra datos reales; solo con rama de desarrollo |
| Frontend | `npm test` (Vitest, lógica pura) y `npm run test:e2e` (Playwright, Chromium) | E2E: levanta solo el backend semilla (SQLite, `tests/audit/run_server.py`) y el frontend; en Windows exporta `E2E_PYTHON=..\venv\Scripts\python.exe`; primera vez `npx playwright install chromium` |

Plantilla de test: ver `tests/audit/test_edge_cases.py` (p. ej. `test_cancel_just_outside_and_inside_12h_boundary`). Una suite completa tarda 3–6 min (bcrypt).

## 6. Convenciones

- **Commits**: estilo corto `tipo: descripción` en minúsculas (`fix:`, `build:`), como en el historial (`fix: materials`, `build: landing skeleton`). 265 commits en `master`; trabaja en rama y evita commitear `.env`.
- **Idioma**: comentarios, mensajes de error y textos de UI en español; identificadores en inglés.
- **Comentarios**: el código está muy comentado con contexto histórico (`BUG-xx fix`, «informe D1-D14»); respétalos.
- **Sin ORM async**: SQLAlchemy síncrono; los endpoints `def` se ejecutan en el pool de hilos de FastAPI. No metas trabajo bloqueante en `async def` (bloquea el event loop; ya ocurre en el scheduler: ver `RESOURCE_COSTS.md`).
- **Seguridad**: valida pertenencia (el alumno solo ve lo suyo, el profesor lo suyo); `404` en vez de `403` para no filtrar existencia, como hace el código actual.

## 7. Trampas conocidas (léelas antes de tocar)

1. `payments.py:2116` `get_pending_withdrawals` sin decorador (404).
2. `can_book_slot` no valida disponibilidad del profesor ni bloquea `pending_trial`/`group` (AUD-01/02).
3. El enrollment se reutiliza al renovar; las clases históricas siguen contando (AUD-03).
4. `finalize_past_classes` ya no se ejecuta en lecturas: solo el job de 10 min (Fase 5).
5. `get_student_booking_stage` también escribe en un `GET`.
6. `load_dotenv(override=True)` en `db/base.py`.
7. `requirements.txt` está en UTF-16 y contiene paquetes ajenos (`opencode-*`).
8. La app no arranca sin `OPENAI_API_KEY`.

## 8. Checklist de PR

- [ ] `python -m pytest tests/audit -q` verde (sin XPASS inesperados)
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run build` verdes
- [ ] Migración revisada y un solo head
- [ ] Docs regeneradas y reglas/bugs actualizados
- [ ] Sin secretos en el diff; `.env.example` al día
- [ ] Probado en local con las tres cuentas semilla
