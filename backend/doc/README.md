# Documentación del backend (TPM / tuprofemaria)

> **Para el próximo Claude/desarrollador: lee esto primero.** Estos documentos describen el comportamiento
> **actual** del backend (commit `848e6f3`, 2026-11-16), verificado con tests y lectura de código.
> No hace falta volver a auditar todo: parte de aquí y verifica solo lo que vayas a tocar.

## Índice

| Documento | Qué contiene | Cómo se mantiene |
|---|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Stack, estructura de carpetas, arranque, config/env, scheduler, despliegue | a mano |
| [`BUSINESS_RULES.md`](BUSINESS_RULES.md) | Reglas de negocio vigentes: créditos, comisiones, cancelación, reagendado, estados, pagos, retiros | a mano |
| [`ENVIRONMENT.md`](ENVIRONMENT.md) | Archivos `.env`: variables, estado local y riesgos (BD y claves reales), perfiles, plantillas `.env.example` | a mano |
| [`FLOWS.md`](FLOWS.md) | Flujos de punta a punta (registro → prueba → paquete → agenda → pago → retiro, cohortes, renovación…) con funciones y archivo:línea | a mano |
| [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md) | Bugs confirmados (AUD-xx / SEC-xx), con test que los reproduce y estado | a mano |
| [`RESOURCE_COSTS.md`](RESOURCE_COSTS.md) | Acciones que más consumen BD/servidor/APIs de pago, ordenadas de mayor a menor, con mitigaciones | a mano |
| [`TESTING.md`](TESTING.md) | Cómo correr cada suite, qué cubre, servidor local de pruebas, qué falta | a mano |
| [`generated/API_REFERENCE.md`](generated/API_REFERENCE.md) | **Las 211 rutas**: método, ruta, rol requerido, rate-limit, función `archivo:línea`, docstring | **generado** |
| [`generated/MODELS.md`](generated/MODELS.md) | Todas las tablas y columnas | **generado** |
| [`generated/CORE_FUNCTIONS.md`](generated/CORE_FUNCTIONS.md) | Funciones de `app/core`, `app/auth`, `app/db` con firma y docstring | **generado** |
| [`generated/SCHEMAS.md`](generated/SCHEMAS.md) | Modelos Pydantic y validadores | **generado** |

Regenerar lo generado tras cambiar código: `cd backend && python doc/generate_docs.py` (no necesita `.env` ni BD).
El generador también escribe `frontend/doc/generated/*`.

## Cómo localizar algo rápido

1. ¿Qué endpoint hace X? → `generated/API_REFERENCE.md` (busca por ruta o palabra del docstring).
2. ¿Qué regla de negocio aplica? → `BUSINESS_RULES.md`.
3. ¿Cómo encaja un flujo? → `FLOWS.md`.
4. ¿Es un bug conocido? → `KNOWN_ISSUES.md` antes de "arreglar" algo raro.
5. ¿Qué columna/tabla? → `generated/MODELS.md`.

## Mapa de archivos grandes (donde vive la lógica)

| Archivo | Líneas aprox. | Contenido |
|---|---|---|
| `app/api/v1/endpoints/payments.py` | 2130 | **El corazón**: reserva (`book_class`), notificar/validar pagos, comisiones, billetera, retiros, enrollments, renovación, cambio de paquete, reembolsos |
| `app/api/v1/endpoints/classes.py` | ~1000 | Estado, cancelación, reagendado (alumno/profesor/admin), mis clases |
| `app/core/class_logic.py` | ~850 | Reglas: `can_book_slot`, créditos, etapas de reserva, `finalize_past_classes`, cancelación + reembolso de crédito |
| `app/api/v1/endpoints/god_mode.py` | 1926 | Edición administrativa directa con auditoría |
| `app/api/v1/endpoints/cohorts.py` + `app/core/group_cohort_logic.py` | | Clases grupales (cohortes) |
| `app/api/v1/endpoints/availability.py` | | Slots libres, disponibilidad semanal y excepciones |
| `app/core/timezone.py` | | Todo el manejo UTC ↔ local |
| `app/core/scheduler.py` | | Jobs APScheduler en proceso: por vencimiento (no mantienen despierto Neon) + diarios/semanal |
| `app/core/chat_digest.py`, `app/core/retention.py`, `app/core/upload_quota.py` | | Aviso de chat agrupado, purga de logs, cuota de materiales |
| `app/core/email_settings.py` | | Interruptores, contador diario y modo ahorro de correos |
| `app/core/spoken_languages.py` | | Idiomas que habla el usuario y su nivel |
| `app/core/email.py` | | ~40 plantillas de email (Resend) |

## Convenciones del proyecto

- Todo en **UTC** en BD/API; el frontend convierte. `utc_now()` de `app/core/timezone.py`, nunca `datetime.utcnow()`.
- Roles: `student`, `teacher`, `teacher_admin` (profesor + staff), `superadmin`. Dependencias: `get_current_user`, `get_current_student`, `get_current_teacher`, `get_current_staff`, `get_current_superadmin` (ver `app/auth/`).
- Comentarios y mensajes de error de la API en **español**.
- Migraciones: Alembic (`alembic/versions`), un solo head `a9c4d5e6f7a8`.
- Los `.env` están ignorados por git, usan URLs localhost pero la **BD Neon y las claves reales**: lee `ENVIRONMENT.md` antes de ejecutar nada fuera de `tests/audit`.
