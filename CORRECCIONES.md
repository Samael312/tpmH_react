# Checklist de correcciones

Lista de trabajo viva: se marca `[x]` al corregir. El diagnóstico (descripción, evidencia, severidad) está en `ANALISIS.md` (informe congelado) y el estado detallado en `backend/doc/KNOWN_ISSUES.md` y `frontend/doc/KNOWN_ISSUES.md`. Aquí solo van el orden, el esfuerzo y cómo verificar.

**Al cerrar un punto:** (1) marcar la casilla; (2) pasar su test `xfail` a normal en `backend/tests/audit`; (3) actualizar `KNOWN_ISSUES.md` (y `BUSINESS_RULES.md` si cambia una regla); (4) `cd backend && python doc/generate_docs.py`.

Esfuerzo: S (<2 h) · M (medio día) · L (1–2 días). Una fase = una rama y un PR.

---

## Fase 0 — Preparación

- [x] Rama de desarrollo en Neon (`backend/.env` ya apunta a ella)
- [x] Rotar secretos: aplazado por decisión del usuario (no hace falta por ahora)
- [x] Línea base: `python -m pytest tests/audit -q` → 81 passed, 1 skipped, 20 xfailed
- [x] Decisiones de negocio (ver abajo)

### Decisiones de negocio acordadas

- **Clases `finalized`:** pasadas 72 h sin que el profesor la marque, se marca `no_show` automáticamente (consume el crédito). El profesor o `teacher_admin` puede pedir el cambio con un ticket a soporte, describiendo la situación y los motivos; **soporte aprueba o rechaza**. Si se aprueba `completed`, no cambia el crédito; si se aprueba `cancelled`, se devuelve el crédito.
- **Renovación:** los créditos sobrantes **se suman** a los del paquete nuevo.
- **Aprobación de pagos:** solo `superadmin` y `teacher_admin` ven las cuentas de dinero y aprueban/rechazan pagos. Los profesores normales **no** aprueban nada: solo ven «pendiente de revisión». Un `teacher_admin` no aprueba pagos de su propio profesor (los aprueba el `superadmin`). `teacher_admin` (único, dueño de la plataforma) puede aprobar todos los demás pagos y cambiar su propia comisión.
- **Reembolsos:** plazo máximo de **7 días desde la aprobación del pago** (también en bajadas de paquete con devolución). Si el profesor ya retiró y su saldo no cubre el reembolso, **se bloquea** y se avisa al usuario de que contacte con soporte.
- **Workers:** 1 solo proceso `uvicorn` (el scheduler APScheduler es interno; con N workers se duplicaría). Añadir `--proxy-headers` (Fase 3); escalar solo separando el scheduler en otro servicio.

## Fase 1 — Críticos rápidos (dinero y rutas rotas)

- [x] **AUD-12** (S) ruta `get_pending_withdrawals` sin `@router.get` · verif.: `test_withdrawals_pending_real_path` + pestaña Retiros
- [x] **AUD-03** (M) renovar paquete agotado: reactivar y **sumar** los créditos sobrantes · verif.: xfail en `test_findings`
- [x] **AUD-14** (M) reembolso descuenta billetera; **plazo 7 días desde la aprobación** (incluye bajadas con devolución); si el saldo no cubre → bloquear y avisar «contacta con soporte» · verif.: xfail en `test_findings`
- [x] **AUD-21** (S) `credits_requested` > 0 · verif.: `test_unlimited_recharge_negative_or_zero_rejected`
- [x] **AUD-20** (S) `bypass_min_notice` recibe `Query` · verif.: `test_featured_teacher_slots_work_for_students`
- [x] **NEG-01** (L) pagos: quitar la aprobación a profesores normales (UI y API; solo ven «pendiente de revisión»); `superadmin`/`teacher_admin` aprueban; nadie aprueba el pago de su propio profesor · verif.: tests nuevos de permisos (relacionado con SEC-03)
- [x] **NEG-02** (L) `finalized` → `no_show` automático a las 72 h + ticket de soporte para corregirlo (categoría nueva, aprobación por soporte, crédito según decisión)
- [x] **AUD-19** (S) login cuenta solo-Google → 401, no 500

Salida: xfails de la fase en verde.

## Fase 2 — Reservas y concurrencia

- [x] **AUD-01** (M) validar disponibilidad del profesor en servidor (reservas y reagendados)
- [x] **AUD-02 / 02b** (L) doble reserva: `pending_trial`/`group` bloquean + lock de fila o restricción de exclusión (migración Alembic) · verif.: `concurrency_live.py` R1
- [x] **AUD-23** (M) sobre-reserva de créditos: `FOR UPDATE` sobre `enrollment` · verif.: R2
- [x] **Idempotencia** (M) `validate_payment` y `process_withdrawal_v2` con transición atómica · verif.: R3, R4
- [x] **Cancelación** (S) idempotente explícita, crédito devuelto una vez · verif.: R5
- [x] **AUD-22** (S) guarda anti doble clic identifica la cuota por número
- [x] **AUD-04** · [x] **AUD-05** · [x] **AUD-06** · [x] **AUD-07** · [x] **AUD-08** · [x] **AUD-09** · [x] **AUD-10** · [x] **AUD-11** · [x] **AUD-13** · [x] **AUD-15** · [x] **AUD-16** · [x] **AUD-17** · [x] **AUD-18** (agrupar por módulo: pagos, cuotas, cohortes, notificaciones)

Salida: `python -m tests.audit.concurrency_live` termina con 0 FALLO. **Pendiente de correr por el usuario contra Neon dev** (la restricción de exclusión no se creó: se usó `FOR UPDATE` sobre alumno y profesor). AUD-18 sin reproducir en API, pero se blindó `can_book_slot` con `student_id None`.

## Fase 3 — Seguridad

- [x] **SEC-01** (M) `--proxy-headers` + IP real; rate-limit compartido si hay >1 worker
- [x] **SEC-02** (M) Chipi: rate-limit, tope de tamaño, solo `role` user/assistant; TTS con cuota
- [x] **SEC-03** (M) `teacher_admin` sin aprobar sus propios pagos ni fijar su comisión
- [x] **SEC-04** (M) verificación de email; Google solo con `email_verified`
- [x] **SEC-05** (L) JWT en cookie HttpOnly + refresco (hecho, 3b) · CSP con nonce (script-src sin `unsafe-inline`; `style-src` lo conserva) · _pendiente al desplegar:_ retirar Bearer/`?token=` y access de 30 min
- [x] **SEC-06** (M) tope en `/logs/frontend`, `state` OAuth, `application/pptx`, borrado de cuenta, topes del WS · _pendiente en 3b:_ token WS fuera de la query

Salida: repetir sondas (200 KB y `role: system` en Chipi → rechazados).

## Fase 4 — Frontend / UX

- [x] **UX-01** (M) bucle con cookie válida y `localStorage` vacío (`teacher/layout.tsx`, `proxy.ts`) (hecho en 3b)
- [x] **UX-02** (S) `aria-label` en ojo de contraseña y widget Chipi
- [x] **UX-03** (S) duración de prueba desde `trial_duration_minutes`
- [x] **UX-04** (S) error visible si falla la carga de retiros (el 404 se cerró en Fase 1; la UI ya muestra el error)
- [x] **F4** (M) un 401 no pierde formularios (hecho en 3b)
- [x] **F5** (M) reglas del servidor (mínimo retiro, duraciones) leídas de la configuración (mínimo de retiro desde `/system-catalogs/business-rules`)
- [x] **F6** (S) texto de borrar cuenta alineado con el comportamiento real
- [x] **F9** (S) quitar `"mar12"` hardcodeado
- [x] **F10** (L) tests de frontend (Vitest + Playwright mínimo) y script `test` (Vitest, 47 tests, y Playwright mínimo: `npm run test:e2e`, 7 pruebas contra el backend semilla en SQLite)

## Fase 5 — Coste y rendimiento

- [x] (M) pool real en lugar de `NullPool` (`pool_pre_ping`, `pool_recycle`; `DB_POOL_SIZE`/`DB_MAX_OVERFLOW`/`DB_POOL_RECYCLE`) · _pendiente medir en producción:_ objetivo `/users/me` < 400 ms (hoy ≈1,7 s; medir con `latency.py`)
- [x] (L) eager loading en N+1 (9 listados corregidos y vigilados por `tests/audit/test_perf_queries.py`, que falla si las consultas crecen con las filas) y paginación `limit`/`offset` + `X-Total-Count` en `/payments/history`, `/admin/support-tickets`, `/admin/teachers`, `/packages/teacher/enrollments` (`app/core/pagination.py`) · _resto de listados paginados y purga de `error_logs`/`email_log` en la Fase 9; queda `god_mode` y los listados de admin_
- [x] (M) sacar `finalize_past_classes` de los GET de agenda (hecho; solo lo hace su job) · `get_student_booking_stage` ya no escribe en los GET (Fase 9)
- [x] (M) jobs `async` bloqueantes → `def` (hecho) · jobs «por vencimiento» para que Neon pueda suspenderse (Fase 9)
- [x] (M) subidas de 100 MB por streaming a Cloudinary (`upload_file_stream`, endpoints en hilo, vídeo por trozos; `tests/audit/test_uploads_stream.py`) · cuota por profesor en la Fase 9 · _no se hizo:_ subida directa desde el navegador a Cloudinary
- [x] (S) evaluar alternativas a Railway: análisis hecho en `backend/doc/RESOURCE_COSTS.md` (sección «Alternativas gratuitas a Railway»); migrar o no es decisión pendiente

## Fase 6 — Pruebas y documentación

- [x] Actualizar `tests/flow` obsoletos (regla D7, `payment_method`, cohorte sin pago confirmado, disponibilidad por hora) · ver `backend/doc/TESTING.md`
- [x] Concurrencia en CI sobre PostgreSQL para PRs de reservas/pagos: `.github/workflows/backend.yml` (audit en SQLite, `alembic upgrade head` en PostgreSQL vacío y `concurrency_live.py`) · _sin ejecutar:_ no hay PostgreSQL ni GitHub Actions en este equipo; se valida en el primer PR
- [x] Migraciones Alembic en el despliegue: documentado en `docs/OPERATIONS.md` con las 3 migraciones nuevas por aplicar · automatizado en la Fase 9 con `preDeployCommand` en `railway.toml` (por verificar en el panel de Railway)
- [x] Regenerar docs y cerrar IDs en `KNOWN_ISSUES.md`

## Fase 7 — Control de correos (cuota gratuita de Resend: 100 emails/día)

**Problema.** Todo correo sale por `app/core/email.py::_send()` (32 tipos distintos, ~50 puntos de envío) sin límite, sin contador y sin forma de apagarlos. Con el plan gratuito de Resend (100/día), un día con muchas clases puede agotarla y dejar sin correo a lo esencial (restablecer contraseña, verificar email). Resend responde con error y hoy solo se escribe en el log: el correo se pierde en silencio.

**Qué se hace**
- [x] **Interruptores en Settings** (superadmin, `/admin/settings`, pestaña «Notificaciones por email»): un interruptor por categoría, con el badge de **probabilidad de agotar la cuota** al lado y el uso de hoy («37 / 100»).
- [x] **Un solo punto de control:** `_send(..., category)` consulta la configuración antes de enviar. Categoría apagada -> no se envía y se anota como «omitido» (no cuenta para la cuota). Por defecto **todo encendido** (mismo comportamiento de hoy).
- [x] **Contador diario** (tabla `email_log`: fecha, categoría, enviado/omitido/fallido) para mostrar el uso y para el modo automático.
- [x] **Modo ahorro automático** (opcional, apagado por defecto): al llegar al X % de la cuota (por defecto 80 %) se pausan solas las categorías de probabilidad **Muy alta** y **Alta** hasta el día siguiente (UTC). Las **esenciales nunca se pausan**.
- [x] **Límite diario configurable** (`email_daily_limit`, por defecto 100) para cuando se pase a un plan de pago.
- [x] **Columnas nuevas** en `platform_config`: `email_notifications` (JSON `{categoría: bool}`), `email_daily_limit`, `email_auto_saver_enabled`, `email_auto_saver_percent`. Migración Alembic (la ejecuta el usuario). Endpoints: `GET/PUT /admin/email-settings` (solo superadmin; las esenciales no se pueden apagar).
- [x] **Aviso visible:** si hoy se omitieron o fallaron correos por cuota, banner en el panel del superadmin.
- [x] **Tests** (13 en `tests/audit/test_f7_email_settings.py` y 9 de Vitest en `frontend/tests/emailSettings.test.ts`; `tests/audit/test_f7_email_settings.py`, con `_send` capturado): por defecto todo se envía · categoría apagada no envía · esencial no se puede apagar (422) · el contador suma solo los enviados · modo ahorro pausa Muy alta/Alta al 80 % y no toca esenciales · cambio de día reinicia · solo superadmin · límite exacto 100/101.

**Categorías y probabilidad de agotar la cuota más rápido**

Son **estimaciones a partir del código** (cuántos correos genera cada evento y cuántas veces ocurre), no mediciones. Cuando exista `email_log` se reemplazan por datos reales.

| Categoría (interruptor) | Correos que incluye | Prob. de agotar la cuota | Por qué |
|---|---|---|---|
| Recordatorios de clase | `send_class_reminder_email`, `send_class_reminder_teacher_email` (scheduler) | 🔴 **Muy alta** | 2 avisos por clase y por persona (alumno + profesor); en grupales, uno por alumno inscrito. **Desde la Fase 9 el profesor recibe un solo correo con todas sus clases de la ventana** |
| Mensajes nuevos de chat | `send_new_chat_message_teacher_email` | 🔴 **Muy alta** | Antes un correo por conversación reactivada; **desde la Fase 9 sale agrupado: un correo por profesor 10 min después del primer aviso** |
| Reservas y confirmaciones de clase | `send_new_booking_teacher_email`, `send_class_confirmed_email`, `send_class_confirmed_teacher_email`, `send_class_booking_confirmation` | 🟠 **Alta** | 2 correos por reserva (alumno + profesor); las reservas se concentran en pocas horas |
| Cancelaciones y reprogramaciones | `send_class_cancelled_*`, `send_class_rescheduled_*`, `send_class_no_show_email`, `send_cohort_ended_email` | 🟠 **Alta** | 1–2 correos por evento; las cancelaciones en cohortes avisan a todos los alumnos |
| Tareas y materiales | `send_homework_submitted_email`, `send_homework_graded_email`, `send_material_assigned_email` | 🟠 **Alta** | Asignar material o tarea a varios alumnos manda un correo por alumno de golpe |
| Avisos al admin: pagos pendientes | `send_admin_payment_pending_email` (6 puntos de envío) | 🟡 **Media** | 1 por cada pago o cuota notificada; sube en días de renovaciones |
| Recibos y fallos de pago | `send_payment_receipt_email`, `send_payment_failed_email` | 🟡 **Media** | 1 por pago aprobado o rechazado |
| Bienvenida | `send_welcome_email` | 🟡 **Media** | 1 por registro; se dispara en lanzamientos o campañas |
| Avisos al admin: soporte y profesores nuevos | `send_admin_new_support_ticket_email`, `send_admin_new_teacher_pending_email` | 🟢 **Baja** | Pocos eventos al día |
| Retiros | `send_withdrawal_requested_teacher_email`, `send_admin_withdrawal_requested_email`, `send_withdrawal_processed_email` | 🟢 **Baja** | Un retiro es poco frecuente |
| Paquete por vencer | `send_package_expiring_email` | 🟢 **Baja** | Una vez por paquete |
| Reseñas recibidas | `send_new_review_received_email` | 🟢 **Baja** | Pocas reseñas |
| Estado del profesor y respuestas de soporte | `send_teacher_status_update_email`, `send_support_ticket_response_email` | 🟢 **Baja** | Manuales, iniciados por el admin |
| **Esenciales (siempre activos, sin interruptor)** | `send_verification_email` (SEC-04), `send_password_reset_email`, `send_username_recovery_email` | 🟢 **Baja** | Sin ellos el usuario no puede entrar o verificarse (los retiros y pagos exigen email verificado). Tienen límite por IP/hora en el endpoint |

**Orden de implementación sugerido:** primero el interruptor y el control en `_send()` (resuelve el riesgo ya), luego el contador y el modo ahorro, y al final la agrupación del chat y de los recordatorios, que es lo que más reduce el consumo sin apagar nada.

**Fuera de este alcance (decidir después):** preferencias por usuario (que cada alumno o profesor elija qué correos recibir) y un resumen diario único en vez de varios correos. _La agrupación del chat y de los recordatorios del profesor se hizo en la Fase 9._

---

## Fase 8 — Idiomas que habla el usuario (perfil + onboarding)

**Objetivo.** Que cada usuario (alumno y profesor) declare **qué idiomas habla**: se pide en el onboarding de ambos roles y se puede editar después en el perfil.

**Punto de partida (verificado en el código).** `TeacherProfile.languages` ya existe, pero son los idiomas que el profesor **enseña** (se usa en la búsqueda de profesores, junto con `subjects`, y en las notificaciones de profesor pendiente). No sirve para esto: mezclar «lo que enseña» con «lo que habla» rompería la búsqueda. Los alumnos no tienen ningún campo de idiomas. Por eso es un dato **nuevo y separado**.

**Qué se hace**
- [x] **Modelo:** columna `users.spoken_languages` (JSONB, lista de códigos o nombres, por defecto `[]`) en `users`, porque es común a alumno y profesor y así hay un solo lugar de lectura y edición. Migración Alembic (la ejecuta el usuario); sin relleno de datos: los usuarios actuales quedan en `[]`.
- [x] **Validación en el servidor** (`schemas/user.py`): hasta 10 idiomas, sin duplicados (sin distinguir mayúsculas), cada uno de 2 a 40 caracteres y elegido del catálogo; el servidor rechaza basura (422) y normaliza el texto. El frontend nunca es la única barrera.
- [x] **Catálogo:** nuevo catálogo editable por el superadmin `spoken_languages` en `system_catalogs` (el existente `languages` es el de idiomas que se enseñan y no se toca). Valores iniciales: español, inglés, portugués, francés, italiano, alemán, etc.
- [x] **API:** `GET /users/me` devuelve `spoken_languages`; `PATCH /users/me` lo acepta (mismos permisos y límites que el resto del perfil). El perfil público del profesor lo expone; el del alumno solo lo ve su profesor.
- [x] **Onboarding del alumno** (`(student)/dashboard/onboarding`): paso nuevo «¿Qué idiomas hablas?» (selector múltiple, mínimo 1).
- [x] **Onboarding del profesor** (`(teacher)/teacher/onboarding`): mismo paso, ubicado junto al de idiomas/materias que enseña, con textos distintos para no confundirlos («Idiomas que hablas» frente a «Idiomas que enseñas»). Mínimo 1.
- [x] **Perfil editable** en ambos roles (`(student)/dashboard/profile` y `(teacher)/teacher/profile`): sección «Idiomas que hablo» con el mismo selector y guardado con aviso.
- [x] **Usuarios que ya terminaron el onboarding** no lo vuelven a ver: aviso suave en el perfil y en el panel («Agrega los idiomas que hablas») hasta que los completen. No bloquea nada.
- [x] **Donde se muestra:** perfil público y tarjeta del profesor («Habla: español, inglés»); ficha del alumno que ve su profesor. _El filtro «habla…» del directorio se hizo en la Fase 10._
- [x] **Privacidad:** texto de `PrivacyContent` actualizado (nuevo dato de perfil y quién lo ve) · fecha «Última actualización» puesta al 17 de noviembre de 2026 en la Fase 10
- [x] **Tests (42 en backend, 16 de Vitest en `frontend/tests/spokenLanguages.test.ts`):** `tests/audit/test_f8_spoken_languages.py` (límite: 10/11 idiomas, 1/0 en onboarding, longitudes 2/40/41; combinatoria: rol × catálogo/ajeno × duplicados con distinta capitalización; invariantes: guardar dos veces es idempotente, no toca `TeacherProfile.languages`; integración: onboarding -> perfil -> API pública, y un alumno no puede leer los idiomas de otro) y tests de frontend (Vitest) del selector.
- [x] **Docs:** `API_REFERENCE`, `MODELS`, `BUSINESS_RULES`, `frontend/doc/PAGES_AND_UX.md`.

**Decisiones que estaban abiertas (se implementó la propuesta inicial; quedan apuntadas en «Decisiones pendientes» al final)**
- ¿Solo la lista de idiomas, o también un **nivel** por idioma (nativo, fluido, intermedio, básico)? Con nivel el dato es más útil para emparejar alumno y profesor, pero el onboarding se alarga. Propuesta inicial: solo lista, y el nivel como mejora posterior.
- ¿El **idioma de la interfaz o de los correos** debe salir de este dato? Propuesta: no; sería otra preferencia distinta.
- ¿El **filtro por idioma hablado** en el directorio entra en esta fase o después?

---

---

## Fase 9 — Jobs por vencimiento, correos agrupados y cuotas

**Objetivo.** Bajar el consumo fijo (Neon despierto 24 h, correos de la cuota de Resend, almacenamiento) sin cambiar lo que ve el usuario.

- [x] **Jobs por vencimiento** (`core/scheduler.py`): finalizar clases, Meet, recordatorios, resumen de chat y sincronización de Calendar calculan cuándo les toca (hora de la clase, de su fin, etc.) y se programan con `DateTrigger`; se recalculan al arrancar y cuando se confirma una escritura de `Class`, `PlatformConfig` o `GoogleCalendarToken` (ganchos de sesión); sin trabajo pendiente duermen hasta 24 h; `min_gap` evita reintentos en bucle; un fallo al calcular reintenta a los 10 min. Calendar: cada 30 min con clase en curso o en las próximas 3 h, si no cada 6 h, y nada si nadie lo tiene conectado. Los jobs diarios pasan a `CronTrigger` a las 03:00 UTC (el semanal, lunes 14:00). Comprobado con el `AsyncIOScheduler` real: llamar a `request_reschedule()` desde un hilo (endpoint síncrono) funciona y fusiona llamadas seguidas. _Tests: `tests/audit/test_due_jobs.py` (31)._
- [x] **`get_student_booking_stage` sin escribir en GET** (`heal=False` en `GET /payments/booking-status` y `GET /users/me/teachers`; los POST siguen curando) + barrido diario `release_stale_unpaid_enrollments` (24 h de margen; no toca cohortes ni enrollments con pago en revisión). _Tests: `tests/audit/test_f9_stale_enrollments.py` (10)._
- [x] **Paginación del resto de listados** (`limit`/`offset` + `X-Total-Count`, 200 por defecto): pagos, retiros, tickets propios, alumnos del profesor, conversaciones, clases y cohortes. _Tests: `tests/audit/test_pagination_rest.py` (16)._ Queda `god_mode` y los listados de admin.
- [x] **Purga de logs** (`core/retention.py`, job 03:05 UTC): `error_logs` 30 días, `email_log` 60 días (`ERROR_LOG_RETENTION_DAYS`, `EMAIL_LOG_RETENTION_DAYS`).
- [x] **Correos agrupados:** resumen de chat por profesor 10 min después del primer aviso (`core/chat_digest.py`, columna `chat_conversations.teacher_notify_pending_at`) y un correo de recordatorio por profesor con todas sus clases de la ventana. Plantillas nuevas `send_chat_digest_teacher_email` y `send_class_reminders_teacher_digest_email` (escapan HTML y entran en las categorías de la Fase 7). _Tests: `tests/audit/test_f9_email_digests.py` (16)._
- [x] **Cuota de materiales por profesor** (`core/upload_quota.py`, `MATERIALS_QUOTA_MB` = 500, columna `materials.file_size`, 413 antes de llamar a Cloudinary, `GET /materials/quota`). El vídeo de presentación ya era único por profesor. _Tests: `tests/audit/test_f9_materials_quota.py` (9)._
- [x] **Migraciones automáticas:** `preDeployCommand = "alembic upgrade head"` en `railway.toml` · _por verificar en el panel de Railway (el archivo usa una estructura multi-servicio)_. Migración nueva `a9c4d5e6f7a8` (head actual).
- [x] **Playwright** (`npm run test:e2e`): backend semilla en SQLite + frontend; 8 pruebas (ver `frontend/doc/TESTING.md`).
- [x] **Docs:** ARCHITECTURE (scheduler), OPERATIONS (§4 y §7), ENVIRONMENT, RESOURCE_COSTS, KNOWN_ISSUES, FLOWS, BUSINESS_RULES, DEVELOPER_GUIDE, READMEs, `API_REFERENCE`/`MODELS` regenerados.

## Fase 10 — Idiomas con nivel, filtro del directorio y política de privacidad

- [x] **Nivel por idioma** (`native|fluent|intermediate|basic`, obligatorio al guardar): `users.spoken_languages` pasa a `[{language, level}]`; los textos sueltos de la Fase 8 se leen con `level = null` (sin migración de datos) y la interfaz pide completarlos (aviso suave también para ellos). Selector con nivel en onboarding (alumno y profesor) y perfil; el nivel se ve en tarjeta, perfil público y ficha del alumno («Habla: español (nativo), inglés (intermedio)»). _Tests: `tests/audit/test_f8_spoken_languages.py` (64) y `frontend/tests/spokenLanguages.test.ts` (26)._
- [x] **Filtro «Habla»** en el directorio de profesores del alumno (`GET /teachers/?speaks=`).
- [x] **Política de privacidad:** fecha actualizada al 17 de noviembre de 2026, nivel por idioma y bullet en inglés (la Fase 8 solo lo había añadido en español).
- [x] **Idioma de la interfaz/correos:** **pendiente por ahora** (la plataforma está solo en español); no se deriva de este dato.

---

## Fase 11 — Rendimiento sin coste extra

**Objetivo.** Mejorar la velocidad y el consumo de la plataforma sin cambiar funcionalidades y sin gasto nuevo. Salió de una revisión de 31 puntos de rendimiento contra el código.

- [x] **Índices** (migración `b1d5e6f7a8c9`, `app/models/indexes.py`): solo había índices en claves primarias, logs, tokens y chat; las claves foráneas de `classes`, `payments`, `enrollments`, `materials`, `homework`, etc. y `teacher_profiles.user_id`/`student_profiles.user_id` no tenían ninguno (PostgreSQL no los crea solo). 26 índices nuevos con `if_not_exists`. _Tests: `tests/audit/test_performance_indexes.py` (5)._
- [x] **Timeouts a servicios externos:** OpenAI 30 s con 1 reintento (el SDK traía 600 s con 2), Cloudinary (conexión 10 s, lectura 120 s; antes sin límite), revocar token de Google 10 s, intercambio OAuth 15 s. Variables `OPENAI_TIMEOUT_SECONDS` y `CLOUDINARY_READ_TIMEOUT_SECONDS`.
- [x] **gzip en la API** (`GZipMiddleware`, nivel 5, desde 1000 bytes; no comprime el streaming de Chipi). _Tests: `tests/audit/test_gzip.py` (5)._ Variable `API_GZIP_MIN_BYTES` (0 = desactivado).
- [x] **Frontend lista todas las páginas** (`lib/pagination.ts` → `fetchAllPages`): los listados ya no se cortan a 200 filas; una sola petición si hay menos. Aplicado a 22 puntos (pagos, retiros, ingresos, tickets, alumnos, clases, cohortes, conversaciones, listados de admin y Modo Dios). Encontró además un fallo real: las pantallas de alumnos del admin (`/admin/users`) mostraban solo los 50 primeros aunque el contador dijera más. _Tests: `tests/pagination.test.ts` (10)._
- [x] **Paginación del Modo Dios** (historial de una entidad, profesores, alumnos de un profesor, enrollments y cohortes), y el historial ya no hace una consulta por fila. _Tests: `tests/audit/test_god_mode_pagination.py` (7)._
- [x] **Tiempos de petición** (`Server-Timing` + aviso de peticiones lentas en el log, `SLOW_REQUEST_MS`), sin base de datos. _Tests: `tests/audit/test_request_timing.py` (6)._
- [x] **Imágenes de Cloudinary optimizadas por Cloudinary** (`f_auto,q_auto,w_<ancho>`, `lib/imageLoader.ts`): el servidor de Railway deja de recodificarlas. _Tests: `tests/cloudinaryImage.test.ts` (8)._
- [x] **Dependencias:** `requirements.txt` a UTF-8 y 9 paquetes sin uso fuera (`opencode-*`, `typer`, `rich`, `passlib`, `wsproto`…). `pytest` se queda porque el probador de flujos del superadmin lo ejecuta dentro de la app.
- [x] **Debounce** (`hooks/useDebouncedValue.ts`) en la auditoría de chats del superadmin (llamaba a la API en cada tecla).
- [x] **Imágenes:** los 2 `<img>` restantes con `loading="lazy"` y `decoding="async"`.
- [x] **Fuentes** con `next/font/google` (Poppins 600/700/800 y DM Sans 400/500/600) en lugar del `@import` de Google Fonts; CSP más estricta (`style-src` y `font-src` sin Google) y con la hoja del botón de Google permitida (estaba bloqueada). Comprobado en navegador: sin peticiones a Google Fonts ni violaciones de CSP.
- [x] **Caché** de 7 días para `/models` y `/assets` (`next.config.ts`).
- [x] **Modelo 3D (22,85 MB → 6,65 MB)** (`public/models/Chipi_Waving.glb`: 13 MB de texturas JPEG y 9 MB de geometría con 128 000 vértices): pendiente de comprimir. Pasos en «Pendiente de hacer tú».
- [ ] **Activar el CDN de Railway** en el servicio del frontend (ver `docs/OPERATIONS.md` §8).
- [x] **Docs:** ENVIRONMENT, OPERATIONS (§4 y §8), KNOWN_ISSUES (backend y frontend), frontend ARCHITECTURE y TESTING.

**Decisiones tomadas sobre las demás propuestas**
- _No se hace:_ **skeletons nuevos** (las pantallas que parecían no tenerlos delegan en componentes que sí los tienen; el hallazgo era un falso positivo de la búsqueda); **`reactCompiler`** (exige una dependencia nueva y cambia el build, sin medir antes que haga falta); **`dynamic()` en más componentes** y **interfaz optimista** (beneficio especulativo; se decide con datos reales); **web-vitals** (se mide al lanzar a producción, como ya se decidió).
- _Interfaz solo en español_ por ahora; el idioma de la interfaz y de los correos queda pendiente.

---

## Fase 12 — Revisión de flujos y mejora por tandas (sin cambios de infraestructura)

**Objetivo.** Subir cada aspecto (robustez, profesionalidad, seguridad, escalabilidad, UX) con cambios pequeños. Fuera de alcance: scheduler en otro servicio, Redis y cambios de proveedor.

- [x] **Bugs graves de la revisión** (`tests/audit/test_flow_review_fixes.py`): prueba gratis repetida (`finalized`/`no_show`), el alumno reagendaba clases ya pasadas sin gastar crédito, la clase en curso desaparecía de «próximas».
- [x] **Tanda 1 — robustez:** clases `external` se quedan en `finalized`; layouts verifican el onboarding una vez por sesión; idiomas retirados del catálogo se pueden quitar; el job de Meet solo cuenta profesores con Calendar; recordatorio sin destinatario no se reintenta.
- [x] **Tanda 2 — profesionalidad/modernidad:** `FLOWS.md` y `PAGES_AND_UX.md` al día; fuera `postcss.config.mjs` y `@tailwindcss/postcss` (config muerta de Tailwind 4: Next usa `postcss.config.js`); CI del frontend (`.github/workflows/frontend.yml`: lint, tipos, Vitest y build); ruta de `E2E_PYTHON` corregida.
- [x] **Tanda 3 — seguridad** (`tests/audit/test_f12_security.py`): `new_password` con tope de 128 en restablecer y cambiar contraseña; el login con usuario inexistente o solo-Google verifica un hash ficticio (mismo tiempo, no se enumeran cuentas); `user_or_ip_key` lee también la cookie `tpm_access` (antes, con sesión por cookie, caía a la IP); cabeceras `X-Content-Type-Options`, `Referrer-Policy` y `X-Frame-Options` en la API. _Sin hacer:_ bloqueo por cuenta tras N fallos (solo hay 10/min por IP).
- [x] **Tanda 4 — escalabilidad sin infraestructura (parcial, decidido con el dueño: solo lo que más crece):** historial de pagos, ingresos y retiros del profesor pasan a «Cargar más» de 50 en 50 con paginación del servidor (`lib/loadMore.ts`, `hooks/useLoadMoreList.ts`, `components/ui/LoadMoreButton.tsx`, `tests/loadMore.test.ts`). _Sin hacer (deuda):_ clases del profesor y del alumno y `/admin/users` siguen con `fetchAllPages` porque las pantallas suman, filtran y pintan calendario sobre la lista completa; migrarlas exige contadores y filtros nuevos en el backend.
- [x] **Tanda 5 — UX (parcial):** las clases `finalized` muestran un aviso en la tarjeta (`lib/classStatusNotice.ts`, `tests/classStatusNotice.test.ts`): al profesor, el tiempo que le queda de las 72 h antes de que pase sola a «No asistió» (rojo con menos de 24 h); al alumno, que espera a su profesor y no puede reseñar aún. _Sin hacer:_ avisar por correo o notificación al profesor cuando una clase pasa sola a `no_show`: las notificaciones internas son solo para el staff y un correo más suma volumen (`RESOURCE_COSTS.md`); decidir si compensa.

---

## Fase 13 — Subir las puntuaciones sin tocar la estructura base

Propuestas surgidas de la tabla de `ANALISIS.md` (Seguridad 79, Escalabilidad 64, Robustez 78, Profesionalidad 81, UX 78). Ninguna cambia la arquitectura (sin Redis, sin otro servicio, sin otro proveedor). El «+» es una estimación, no una medición. Se marcan `[x]` al cerrarlas y se actualiza la tabla de `ANALISIS.md`.

### A. Se pueden hacer ahora, en desarrollo

**Prioridad (se hacen primero, en este orden)**
- [x] **A1 · Seguridad (+3):** bloqueo temporal de la cuenta tras 8 logins fallidos durante 15 min (`users.failed_login_count` y `locked_until`, migración `c2e6f7a8b9d0`, variables `LOGIN_MAX_FAILED` y `LOGIN_LOCK_MINUTES`, 3 tests en `test_f12_security.py`). Responde 429, también con la contraseña correcta mientras dura. Compromiso: revela que la cuenta existe y un tercero puede bloquearla 15 min. **Requiere `alembic upgrade head`.**
- [x] **A2 · Robustez:** carrera de la cuota de materiales: `ensure_quota` bloquea la fila del profesor (`FOR UPDATE`) hasta el commit, así dos subidas simultáneas del mismo profesor se serializan. Test de que pide el bloqueo; la carrera real solo se prueba en PostgreSQL (`concurrency_live`, pendiente de añadir ese caso). Contrapartida: el profesor mantiene una transacción abierta durante la subida a Cloudinary.
- [x] **A3 · Seguridad (+1/2) y profesionalidad:** `.github/workflows/dependencies.yml` (`pip-audit` y `npm audit --omit=dev`, como aviso, en PR que toquen dependencias y cada lunes). _Resultado de la primera pasada local:_ npm 0 vulnerabilidades; **pip-audit 65 en 15 paquetes** (starlette 1.0.0, python-multipart 0.0.24, cryptography 46.0.6, urllib3, idna, certifi, anyio, mako, pyasn1, dnspython, httplib2, oauthlib, pydantic-settings; `python-jose` y `ecdsa` sin versión corregida). Ver A12.
- [x] **A4 · UX:** banner en el dashboard del profesor («Tienes N clases por marcar; la más urgente vence en X h», rojo con menos de 24 h) que lleva al historial (`pendingToMark` en `lib/classStatusNotice.ts`, 3 tests).

**Resto**
- [x] **A5 · Escalabilidad (parcial, sin cambiar el contrato de la API):** `/classes/my-classes` y `/classes/teacher/classes` ya no cargan todas las clases en memoria: los contadores (`total`, `upcoming`, `completed`) salen de una sola agregación SQL, `offset`/`limit` se aplican en SQL, las clases grupales del alumno usan una subconsulta (antes cargaba los ids) y el orden lleva `id` como desempate para que las páginas no se solapen (`tests/audit/test_f13_class_counters.py`, 5 tests; los tests de paginación y reservas existentes siguen pasando). `/admin/users` ya paginaba y filtraba en SQL. _Sin hacer (ahora **B7**, mejora futura en producción):_ las pantallas del calendario siguen pidiendo todas las páginas con `fetchAllPages` porque pintan el mes completo; para evitarlo hay que añadir un filtro por rango de fechas (`from`/`to`) y pedir solo el mes visible, lo que cambia la lógica de las pantallas del calendario.
- [x] **A6 · Robustez:** los jobs por vencimiento que fallan (o con elementos fallidos: recordatorios y Meet) se anotan en la pantalla de Logs con el número de intento, se reintentan con espera creciente (`min_gap` x 2^(fallos-1), tope 6 h) y a los 5 fallos seguidos paran 24 h (`JobFailed`, `retry_delay`, `report_job_failure` en `core/scheduler.py`; 7 tests nuevos en `test_due_jobs.py`). Antes los fallos solo iban al log del proceso y se reintentaban cada `min_gap` sin tope. El contador es en memoria. _Sin cubrir:_ los 4 jobs de cron (purgas, paquetes por vencer, enrollments sin pagar) siguen solo con `logger.error`.
- [x] **A7 · Profesionalidad:** `.github/workflows/docs.yml` regenera `backend/doc/generated` y `frontend/doc/generated` con `generate_docs.py` y falla si el resultado difiere de lo commiteado (mensaje con el comando de arreglo). Corre en PR y push a `master` que toquen `backend/**` o `frontend/**`. Comprobado en local: el generador es idempotente (dos ejecuciones seguidas dan lo mismo) y escribe siempre con saltos `
`. _Sin verificar:_ no se ha ejecutado en GitHub/Linux; si el primer PR falla solo por diferencias de plataforma, habrá que ajustarlo (entra en B5).
- [x] **A8 · Profesionalidad:** 39 pruebas Vitest nuevas (de 91 a 130; 16 ficheros) sobre lo que afecta a flujos de reserva y sesión: `tzFormat` (la misma clase vista desde Caracas y Madrid, cambio de día y de año, horario de verano, medianoche = hora 0), `scheduleUtc` (próximo día de la semana y conversión de horarios semanales), `getErrorMessage` (incluye el 429 del bloqueo de A1), `authStore` (login sin token en el navegador, logout con revocación en el servidor aunque falle la red), `toastStore`, `displayName` y `capitalizeWords`. No salió ningún bug nuevo. _Sin cubrir:_ componentes React (el entorno de Vitest es `node`, sin DOM) y `chatStore`, `godModeActions` y `errorReporting`, que quedan para más adelante.
- [x] **A9 · UX:** aviso al profesor cuando una clase pasa sola a `no_show`, sin correo. Backend: `notifications.recipient_user_id` (migración `d3f7a8b9c0e1`; NULL en los avisos de staff, que no cambian), `notify_teachers_auto_no_show` en `finalize_past_classes` (UNA notificación por profesor y pasada, máximo 5 clases listadas, en la misma transacción que el cambio de estado), endpoints `GET /teachers/me/notifications`, `/unread-count`, `PATCH /{id}/read` y `POST /mark-all-read` (cada profesor solo ve y toca los suyos) y purga diaria de los ya leídos con más de 90 días (`USER_NOTIFICATION_RETENTION_DAYS`). Frontend: pantalla `/teacher/notifications` con «Cargar más», entrada «Avisos» con badge en el menú lateral y en el «Más» del móvil; el contador se consulta al cargar y al volver a la pestaña, sin sondeo. 11 tests en `test_f13_teacher_notifications.py`. **Requiere `alembic upgrade head`.** _Sin hacer:_ también pasan solas a `no_show` las pruebas `pending_trial` que el profesor nunca confirmó (no se avisan); el aviso es solo dentro de la plataforma, no llega por correo ni push.
- [x] **A10 · UX (parcial):** revisión de errores y estados vacíos. Hallazgo: varias pantallas no distinguían «falló la carga» de «no hay datos» y, si la API fallaba, pintaban el estado vacío («No tienes clases»; en la reserva, «No hay disponibilidad para esta fecha» y «No hay paquetes disponibles. Contacta al staff»), con lo que la persona creía haber perdido datos o contactaba al staff sin motivo. Nuevo `components/ui/LoadError.tsx` («No se pudo cargar X» + «Reintentar»), que se muestra solo si falla la carga y no hay datos en caché (`isError && lista vacía`; si ya hay datos antiguos se siguen viendo). Aplicado en: clases, materiales y tareas del alumno; horarios y paquetes del profesor en el flujo de reserva y de renovación (`/dashboard/schedule`); paquetes y lista de estudiantes con paquetes del profesor. Además, dos mensajes fijos pasan a mostrar el motivo real del servidor (`getErrorMessage`): eliminar una excepción de disponibilidad y guardar usuarios en el admin. _Sin hacer:_ el resto de pantallas del admin y del profesor que ya tenían estado de error propio (cada una lo escribe a mano; podrían migrar a `LoadError`), las pantallas de chat, las `catch {}` que son fallbacks intencionados (login, formato de zonas) y las pruebas de `LoadError` (Vitest corre en `node`, sin DOM).
- [x] **A12 · Seguridad (de A3):** dependencias del backend actualizadas y `python-jose`/`ecdsa` sustituidos por `PyJWT` (`app/auth/jwt.py`, mismo HS256). Versiones: starlette 1.0.0→1.10.0, cryptography 46→50, python-multipart 0.0.24→0.0.34, urllib3 2.6.3→2.8.0, oauthlib 3→4, mako 1.3→1.4, anyio, idna, certifi, pyasn1, dnspython, httplib2, pydantic-settings. `pip-audit`: de 65 vulnerabilidades a 0 en las dependencias de la app (solo marca `pip`, la herramienta del venv). Suite `tests/audit` completa en un venv nuevo: 594 correctos, 1 omitido. _No se ejecutó_ `concurrency_live` (necesita PostgreSQL real). Hay que correr `pip install -r requirements.txt` en cada entorno. PyJWT avisa si `SECRET_KEY` mide menos de 32 bytes: en producción debe tener 32 o más.
- [x] **A13 · Pasada E2E con Chrome (en un entorno aislado: SQLite + datos semilla en 127.0.0.1:8001/3001, sin tocar la BD real).** Dos pasadas con un agente y la extensión de Chrome. _Corregido:_ (1) cerrar sesión no llegaba a `/login` porque la recarga abortaba el `POST /auth/logout` (también en el interceptor 401 y en «eliminar cuenta»; `logout()` ahora devuelve la promesa y las pantallas la esperan); (2) la tarjeta «Confirmar clase de prueba» mostraba el día anterior si la zona del perfil y la del navegador diferían (`formatCalendarDateHuman`); (3) registro simultáneo: 400 en vez de 500 (`IntegrityError`) y bloqueo del doble clic; (4) la foto del alumno ahora también se exige en el servidor; (5) `/users/me` se comparte entre layout, aviso de email y hooks (`lib/me.ts`); (6) voseo en la interfaz; (7) condición de carrera en `/chat/conversations/{id}/read` (dos POST a la vez en la primera apertura, `IntegrityError` en `chat_read_states`; `mark_read` ahora reintenta como actualización); (8) `/dashboard/schedule` sin profesor elegido se quedaba en «Cargando…»; (9) el aviso de email sin verificar depende del rol; (10) «Profesor Verificado» fijo en la barra superior, ahora «Profesor»; (11) «De» con mayúscula en la fecha de la clase de prueba. _Pendiente (bajo):_ `auth-storage` conserva los datos del usuario en localStorage tras una sesión vencida; en zonas como Auckland los slots del día salen ordenados por hora UTC; voseo en los textos legales (`TermsContent`, `PrivacyContent`). _Sin probar en navegador:_ móvil (el viewport no se pudo reducir), pagos y paquetes completos (la clase de prueba no se puede completar antes de que empiece), subida de materiales y comprobantes (Cloudinary es mock), ticks enviado/entregado/leído, reconexión del WebSocket tras caída de red, «Cargar más» con más de una página, Modo Dios y avisos del profesor con datos.
- [x] **A14 · Escalabilidad: chat eficiente con Neon.** Backend (`core/chat.py`, `endpoints/chat.py`): no leídos en una consulta agrupada (antes 2 por conversación); lista paginada en SQL con las relaciones precargadas (antes todas las conversaciones y 3-4 consultas por cada una); historial con el remitente en la misma consulta; recuento de mensajes del admin agrupado; participantes de un mensaje en 1 consulta; apertura del socket con una sola sesión y catch-up de entregas en 2 consultas fijas; `chat_enabled`/horas de reactivación cacheados 30 s e invalidados al guardar los ajustes. Medido con 12 conversaciones: lista 9 consultas, no leídos 3, historial 4, admin 7, y no crecen con las filas (`tests/audit/test_f13_chat_queries.py`, 8 tests). Frontend: con el socket conectado, polling de lista y no leídos cada 5 min (antes 30 s y 45 s); reconexión con retroceso aleatorio, renovación de sesión ante 4401 y espera de 5 min ante 4403; `POST /read` simultáneos agrupados (`tests/chatPolling.test.ts`). _Sin cambiar:_ una sola instancia (el gestor de sockets vive en memoria; con 2+ instancias hace falta Redis pub/sub, ver `core/chat_ws.py`). _No medido_ en producción ni bajo carga.
- [x] **A11 · Seguridad (parcial):** en producción `style-src` (elementos `<style>`/`<link>`) pasa de `'unsafe-inline'` a `'nonce-…'`, y los atributos `style="…"` que React escribe en el HTML se permiten aparte con `style-src-attr 'unsafe-inline'`, porque un nonce no los cubre; quitarlos del todo exigiría mover los 59 `style={…}` a clases o a CSSOM. En desarrollo se conserva `'unsafe-inline'` (el HMR inyecta `<style>` sin nonce). Cambio en `lib/csp.ts` + 2 tests en `tests/csp.test.ts`. **Verificado en un build de producción** (`next build` + `next start`) con Chrome: la landing (con los 2 canvas de Three.js) y `/admin/dashboard`, `/admin/users`, `/admin/settings` y `/admin/god-mode` cargan con estilos correctos, 0 atributos `style` bloqueados y 0 etiquetas `<style>` (la app solo usa hojas `<link>` propias), y un `<style>` inyectado sin nonce queda bloqueado. _Sin verificar:_ el botón de Google de `/login` y `/register` (el navegador tenía una sesión de superadmin y no quise cerrarla; su hoja `accounts.google.com/gsi/style` sigue permitida por URL, pero conviene mirarlo una vez a mano), y las pantallas de profesor y alumno (mismo layout, pero no se abrieron con esos roles). Si algo se ve sin estilo, el aviso aparece en la consola como `Refused to apply inline style`. Revertir: volver a poner `'unsafe-inline'` en `style-src` de `lib/csp.ts`.

### B. Necesitan producción (o un servicio externo)

- [ ] **B1 · Seguridad (+4):** al lanzar, retirar Bearer y `?token=` y bajar el access token a 30 min (pasos en «Pendiente de hacer tú», punto 5).
- [ ] **B2 · Escalabilidad:** medir `/users/me` y el resto de rutas con `latency.py` en producción y optimizar solo las que superen 400 ms.
- [ ] **B3 · Escalabilidad:** revisar con `EXPLAIN` sobre datos reales los listados de pagos, clases y chat (con tablas casi vacías el plan no es representativo).
- [ ] **B4 · Escalabilidad:** activar el CDN de Railway (Settings → Edge) y comprobarlo con `curl -I -H "Accept-Encoding: br" <url>`.
- [ ] **B5 · Profesionalidad:** ejecutar por primera vez el CI en GitHub con un PR (`backend.yml` y `frontend.yml`) y corregir lo que falle.
- [ ] **B6 · Profesionalidad:** añadir el job de Playwright al CI cuando B5 esté estable.
- [ ] **B7 · Escalabilidad (antes A5b, mejora futura):** que el navegador deje de descargar todas las clases. **Cuándo hacerlo:** cuando B2 mida lentitud en las pantallas de clases o un profesor/alumno pase de unas 500 clases; hoy no hay ese volumen y el cambio es el más delicado de la lista. **Qué hay hoy:** el dashboard del profesor, `/dashboard/classes` y `/dashboard/schedule` del alumno piden todas las páginas (`fetchAllPages`, 200 por petición, tope 5000) porque filtran y cuentan en el navegador (calendario, pestañas próximas/historial, filtro por alumno, banner de A4). El backend solo filtra un día exacto (`date`, solo profesor). **Qué se aplicaría:** (1) `from_date`/`to_date` en `/classes/teacher/classes` y `/classes/my-classes`, con contadores globales; (2) calendario pide solo el mes visible (con margen); (3) pestaña Próximas desde hoy; (4) Historial con «Cargar más» (`useLoadMoreList`); (5) mover al servidor el banner de A4 (pedir solo `finalized`) y el filtro por alumno (`student_id`), o mostrarían datos de una lista parcial. **Riesgo:** regresiones en calendario, contadores y claves de caché de tres pantallas grandes. **Versión mínima:** solo el historial del dashboard del profesor con «Cargar más».

---

**Orden:** 0 → **1** → **2** → 3 y 4 en paralelo → 5 → 6 (continua) → 7 (correos; puede adelantarse: no depende de las demás) → 8 (idiomas que habla el usuario; independiente, pero toca onboarding y perfil igual que la Fase 7 toca settings) → 9 (jobs por vencimiento, correos agrupados y cuotas) → 10 (idiomas con nivel y filtro) → 11 (rendimiento sin coste) → 12 (revisión de flujos y tandas).

---

## Fase 14 — Escalabilidad (sin cambiar la estructura base)

Punto de partida: escalabilidad 73 (estimación tras A14, ver `ANALISIS.md`). Lo que limita: una sola instancia, correos síncronos, sondeos periódicos, listados que descargan todas las páginas (22 llamadas a `fetchAllPages`, no 40 como decía el análisis) y nada medido bajo carga.

### A. Se pueden hacer ahora, en desarrollo
- [x] **E1 · Correos fuera de la petición.** `core/email.py::_send` encola el envío en un pool de 2 hilos (`EMAIL_WORKERS`) y vuelve al instante; antes cada correo bloqueaba un hilo del servidor 200-800 ms esperando a Resend (una reserva manda 2). Al apagar, `main.py` vacía la cola. `EMAIL_ASYNC=false` vuelve al envío en línea (lo usan los tests). Ningún llamador usaba el valor devuelto. Tests: `tests/audit/test_f14_scalability.py`. _Límite:_ la cola vive en memoria; si el proceso muere de golpe se pierden los correos aún no enviados (con `email_log` se ve cuáles salieron).
- [x] **E2 · Sondeos solo con la pestaña visible.** `lib/polling.ts` (`visiblePoll`, `useVisiblePolling`): avisos del admin y no leídos de soporte pasan de cada 30 s (también con la pestaña oculta) a cada 60 s solo visibles y al volver a la pestaña; mis tickets de 20 s a 60 s; logs de errores de 30 s a 60 s. Tests: `tests/polling.test.ts`.
- [ ] **E3 · Caché corta de huecos disponibles** (`/availability/.../slots`): se calculan en cada petición (rangos × clases × excepciones × Google). Caché por profesor y ventana de 30-60 s, invalidada al reservar, cancelar o cambiar disponibilidad. Riesgo: mostrar un hueco ya ocupado unos segundos (la reserva lo rechaza igual).
- [ ] **E4 · Caché HTTP de lo público** (landing, lista y perfil público de profesores): `Cache-Control` con `max-age` corto y `stale-while-revalidate`, para que navegador y CDN (B4) sirvan sin tocar el backend.
- [ ] **E5 · Prueba de carga reproducible:** script (k6 o Locust) contra una rama de desarrollo de Neon con usuarios simulados (login, dashboard, chat, reservar). Es lo que convierte las estimaciones en medidas.
- [ ] **E6 · Listados del admin paginados en servidor** (usuarios, pagos, profesores, tickets): hoy descargan todas las páginas para filtrar en el navegador. Mover búsqueda y filtros al backend con «Cargar más». Más cambio de UI que E3-E5.

### B. Necesitan producción o un servicio externo
- [ ] **E7 · Varias instancias:** Redis pub/sub para el chat (`core/chat_ws.py` ya describe el cambio) y un candado (advisory lock de Postgres) para que el scheduler corra en una sola instancia. Hasta entonces, una instancia.
- [ ] **E8 · Cola de correos persistente** (tabla o Redis) si se pasa a varias instancias o se quiere reintento tras un reinicio.

## Decisiones y tareas pendientes

**Decididas (ya implementadas):** jobs por vencimiento para que Neon se suspenda · `get_student_booking_stage` fuera de los GET · tope de paginación 200 por defecto (500 máximo) · migraciones automáticas con `preDeployCommand` · cuota de materiales de 500 MB por profesor, sin subida directa a Cloudinary por ahora · correos de chat y recordatorios agrupados · idiomas con nivel, filtro «Habla» y fecha de privacidad · Railway se mantiene por ahora.

**Pendiente de hacer tú**
1. **Aplicar las migraciones `a9c4d5e6f7a8`** (Fase 9: `materials.file_size` y `chat_conversations.teacher_notify_pending_at`) **y `b1d5e6f7a8c9`** (Fase 11: 26 índices) con `alembic upgrade head`, **antes** de desplegar el código nuevo. Si Railway ejecuta el *pre-deploy* automático, se aplicará sola. Sin ella fallan la subida de materiales y los mensajes de chat.
2. **Verificar `preDeployCommand` en el panel de Railway** (servicio backend → Settings → Deploy). El `railway.toml` del repo usa una estructura multi-servicio que Railway puede no interpretar; si no aparece, escribe `alembic upgrade head` en ese campo. Comprueba además que la `DATABASE_URL` admite DDL (en Neon, mejor la conexión directa que la *pooled*).
3. **Primer PR en GitHub:** se ejecuta por primera vez `.github/workflows/backend.yml` (audit, migraciones sobre PostgreSQL vacío y concurrencia). Mira la pestaña *Actions*; nunca se ha ejecutado. Conviene añadir el job de Playwright cuando funcione el resto.
4. **Medir en producción** (cuando exista): objetivo `/users/me` < 400 ms (hoy ≈ 1,7 s sin pool; medir con `latency.py`).
5. **Fin de la transición de sesión (Fase 3b), al lanzar a producción:** retirar Bearer y `?token=` del backend y bajar el access token a 30 min (`ACCESS_TOKEN_EXPIRE_MINUTES=30`). Pasos: comprobar en los logs que ningún cliente los usa, quitar la rama Bearer de `get_current_user` y `?token=` del WebSocket y las descargas, desplegar primero el frontend y luego el backend. Solo hace falta al lanzar: antes de eso no hay sesiones reales que se puedan cerrar.
6. ~~Comprimir el modelo 3D~~ **Hecho:** `frontend/public/models/Chipi_Waving.glb` pasó de 22,85 MB a 6,65 MB (`gltf-transform optimize --compress quantize --texture-compress webp --texture-size 1024 --simplify false`). Conserva la animación del saludo (99 canales, 3 s) y se comprobó en la landing: carga, textura y pose correctas, sin errores en consola. Usa `EXT_texture_webp` y `KHR_mesh_quantization` (los soporta el cargador de three.js, sin decodificador ni cambios de CSP). El original queda en Git.
7. **Activar el CDN de Railway** en el servicio del frontend (Settings → Edge → *Enable CDN Caching*) y comprobar con `curl -I -H "Accept-Encoding: br" <url>`.
8. **Opciones de despliegue y migrar fuera de Railway:** se deja para el final de todo (análisis en `backend/doc/RESOURCE_COSTS.md`).

**Deuda técnica conocida (sin fecha)**
- Los listados cargan todas las páginas del servidor (Fase 11); si alguno llega a miles de filas, pasarlo a «Cargar más» con filtros en el servidor.
- Idioma de la interfaz y de los correos: solo español por ahora; si se añaden más, decidir de dónde sale (preferencia propia, no el dato «idiomas que hablo»).
- **Preferencias de correo por usuario** (anotado, sin implementar; hacerlo cuando el volumen se acerque a los 100 correos/día de Resend). Diseño: columna JSON en `users` con las categorías desactivadas (por defecto todas activas) + migración; sección en el perfil de alumno y de profesor; en `_send` de `app/core/email.py` se envía solo si el interruptor global del superadmin Y el del destinatario lo permiten. Los correos esenciales (verificación de email, recuperación de contraseña, pagos) no se pueden desactivar. Aparte: resumen diario único (un solo correo con clases de mañana, mensajes sin leer y tareas; exige decidir hora y contenido) y agrupar el resto de categorías de correo.
- Subida directa desde el navegador a Cloudinary (quitaría carga al backend); la cuota de materiales puede superarse por una subida si dos coinciden.
- Límite de mensajes por segundo por conexión en el chat.
- Los jobs y el limitador viven en memoria: un solo worker (documentado).
