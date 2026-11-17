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
- [x] **F10** (L) tests de frontend (Vitest + Playwright mínimo) y script `test` (Vitest, 22 tests; falta Playwright)

## Fase 5 — Coste y rendimiento

- [x] (M) pool real en lugar de `NullPool` (`pool_pre_ping`, `pool_recycle`; `DB_POOL_SIZE`/`DB_MAX_OVERFLOW`/`DB_POOL_RECYCLE`) · _pendiente medir en producción:_ objetivo `/users/me` < 400 ms (hoy ≈1,7 s; medir con `latency.py`)
- [ ] (L) eager loading en N+1 y paginación en listados
- [x] (M) sacar `finalize_past_classes` de los GET de agenda (hecho; solo lo hace el job de 10 min) · _no se tocó:_ la escritura de `get_student_booking_stage` (cancela el enrollment sin pago notificado; lo usan varios flujos)
- [x] (M) jobs `async` bloqueantes → `def` (hecho) · _pendiente, decisión de negocio:_ espaciar jobs para que Neon se suspenda (el de Meet cada 5 min lo mantiene despierto)
- [ ] (M) subidas de 100 MB por streaming a Cloudinary
- [ ] (S) evaluar alternativas a Railway (`backend/doc/RESOURCE_COSTS.md`)

## Fase 6 — Pruebas y documentación

- [x] Actualizar `tests/flow` obsoletos (regla D7, `payment_method`, cohorte sin pago confirmado, disponibilidad por hora) · ver `backend/doc/TESTING.md`
- [ ] Concurrencia en CI sobre PostgreSQL para PRs de reservas/pagos
- [ ] Paso de migraciones Alembic en el despliegue (no se ejecutan solas)
- [ ] Regenerar docs y cerrar IDs en `KNOWN_ISSUES.md`

## Fase 7 — Control de correos (cuota gratuita de Resend: 100 emails/día)

**Problema.** Todo correo sale por `app/core/email.py::_send()` (32 tipos distintos, ~50 puntos de envío) sin límite, sin contador y sin forma de apagarlos. Con el plan gratuito de Resend (100/día), un día con muchas clases puede agotarla y dejar sin correo a lo esencial (restablecer contraseña, verificar email). Resend responde con error y hoy solo se escribe en el log: el correo se pierde en silencio.

**Qué se hace**
- [ ] **Interruptores en Settings** (superadmin, `/admin/settings`, pestaña «Notificaciones por email»): un interruptor por categoría, con el badge de **probabilidad de agotar la cuota** al lado y el uso de hoy («37 / 100»).
- [ ] **Un solo punto de control:** `_send(..., category)` consulta la configuración antes de enviar. Categoría apagada -> no se envía y se anota como «omitido» (no cuenta para la cuota). Por defecto **todo encendido** (mismo comportamiento de hoy).
- [ ] **Contador diario** (tabla `email_log`: fecha, categoría, enviado/omitido/fallido) para mostrar el uso y para el modo automático.
- [ ] **Modo ahorro automático** (opcional, apagado por defecto): al llegar al X % de la cuota (por defecto 80 %) se pausan solas las categorías de probabilidad **Muy alta** y **Alta** hasta el día siguiente (UTC). Las **esenciales nunca se pausan**.
- [ ] **Límite diario configurable** (`email_daily_limit`, por defecto 100) para cuando se pase a un plan de pago.
- [ ] **Columnas nuevas** en `platform_config`: `email_notifications` (JSON `{categoría: bool}`), `email_daily_limit`, `email_auto_saver_enabled`, `email_auto_saver_percent`. Migración Alembic (la ejecuta el usuario). Endpoints: `GET/PUT /admin/email-settings` (solo superadmin; las esenciales no se pueden apagar).
- [ ] **Aviso visible:** si hoy se omitieron o fallaron correos por cuota, banner en el panel del superadmin.
- [ ] **Tests** (`tests/audit/test_f7_email_settings.py`, con `_send` capturado): por defecto todo se envía · categoría apagada no envía · esencial no se puede apagar (422) · el contador suma solo los enviados · modo ahorro pausa Muy alta/Alta al 80 % y no toca esenciales · cambio de día reinicia · solo superadmin · límite exacto 100/101.

**Categorías y probabilidad de agotar la cuota más rápido**

Son **estimaciones a partir del código** (cuántos correos genera cada evento y cuántas veces ocurre), no mediciones. Cuando exista `email_log` se reemplazan por datos reales.

| Categoría (interruptor) | Correos que incluye | Prob. de agotar la cuota | Por qué |
|---|---|---|---|
| Recordatorios de clase | `send_class_reminder_email`, `send_class_reminder_teacher_email` (scheduler) | 🔴 **Muy alta** | 2 avisos por clase y por persona (alumno + profesor); en grupales, uno por alumno inscrito. Se multiplica con cada clase del día |
| Mensajes nuevos de chat | `send_new_chat_message_teacher_email` | 🔴 **Muy alta** | Un correo por mensaje; no se observó agrupación por conversación. Una charla activa lo agota sola. Mejora prevista: 1 correo por conversación cada 30 min |
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

**Fuera de este alcance (decidir después):** preferencias por usuario (que cada alumno o profesor elija qué correos recibir) y un resumen diario único en vez de varios correos.

---

## Fase 8 — Idiomas que habla el usuario (perfil + onboarding)

**Objetivo.** Que cada usuario (alumno y profesor) declare **qué idiomas habla**: se pide en el onboarding de ambos roles y se puede editar después en el perfil.

**Punto de partida (verificado en el código).** `TeacherProfile.languages` ya existe, pero son los idiomas que el profesor **enseña** (se usa en la búsqueda de profesores, junto con `subjects`, y en las notificaciones de profesor pendiente). No sirve para esto: mezclar «lo que enseña» con «lo que habla» rompería la búsqueda. Los alumnos no tienen ningún campo de idiomas. Por eso es un dato **nuevo y separado**.

**Qué se hace**
- [ ] **Modelo:** columna `users.spoken_languages` (JSONB, lista de códigos o nombres, por defecto `[]`) en `users`, porque es común a alumno y profesor y así hay un solo lugar de lectura y edición. Migración Alembic (la ejecuta el usuario); sin relleno de datos: los usuarios actuales quedan en `[]`.
- [ ] **Validación en el servidor** (`schemas/user.py`): hasta 10 idiomas, sin duplicados (sin distinguir mayúsculas), cada uno de 2 a 40 caracteres y elegido del catálogo; el servidor rechaza basura (422) y normaliza el texto. El frontend nunca es la única barrera.
- [ ] **Catálogo:** nuevo catálogo editable por el superadmin `spoken_languages` en `system_catalogs` (el existente `languages` es el de idiomas que se enseñan y no se toca). Valores iniciales: español, inglés, portugués, francés, italiano, alemán, etc.
- [ ] **API:** `GET /users/me` devuelve `spoken_languages`; `PATCH /users/me` lo acepta (mismos permisos y límites que el resto del perfil). El perfil público del profesor lo expone; el del alumno solo lo ve su profesor.
- [ ] **Onboarding del alumno** (`(student)/dashboard/onboarding`): paso nuevo «¿Qué idiomas hablas?» (selector múltiple, mínimo 1).
- [ ] **Onboarding del profesor** (`(teacher)/teacher/onboarding`): mismo paso, ubicado junto al de idiomas/materias que enseña, con textos distintos para no confundirlos («Idiomas que hablas» frente a «Idiomas que enseñas»). Mínimo 1.
- [ ] **Perfil editable** en ambos roles (`(student)/dashboard/profile` y `(teacher)/teacher/profile`): sección «Idiomas que hablo» con el mismo selector y guardado con aviso.
- [ ] **Usuarios que ya terminaron el onboarding** no lo vuelven a ver: aviso suave en el perfil y en el panel («Agrega los idiomas que hablas») hasta que los completen. No bloquea nada.
- [ ] **Donde se muestra:** perfil público y tarjeta del profesor («Habla: español, inglés»); ficha del alumno que ve su profesor. Opcional: filtro «habla…» en el directorio de profesores.
- [ ] **Privacidad:** actualizar el texto de `PrivacyContent` (nuevo dato de perfil) y decir quién lo ve.
- [ ] **Tests:** `tests/audit/test_f8_spoken_languages.py` (límite: 10/11 idiomas, 1/0 en onboarding, longitudes 2/40/41; combinatoria: rol × catálogo/ajeno × duplicados con distinta capitalización; invariantes: guardar dos veces es idempotente, no toca `TeacherProfile.languages`; integración: onboarding -> perfil -> API pública, y un alumno no puede leer los idiomas de otro) y tests de frontend (Vitest) del selector.
- [ ] **Docs:** `API_REFERENCE`, `MODELS`, `BUSINESS_RULES`, `frontend/doc/PAGES_AND_UX.md`.

**Decisiones que quedan abiertas (preguntar antes de implementar)**
- ¿Solo la lista de idiomas, o también un **nivel** por idioma (nativo, fluido, intermedio, básico)? Con nivel el dato es más útil para emparejar alumno y profesor, pero el onboarding se alarga. Propuesta inicial: solo lista, y el nivel como mejora posterior.
- ¿El **idioma de la interfaz o de los correos** debe salir de este dato? Propuesta: no; sería otra preferencia distinta.
- ¿El **filtro por idioma hablado** en el directorio entra en esta fase o después?

---

---

**Orden:** 0 → **1** → **2** → 3 y 4 en paralelo → 5 → 6 (continua) → 7 (correos; puede adelantarse: no depende de las demás) → 8 (idiomas que habla el usuario; independiente, pero toca onboarding y perfil igual que la Fase 7 toca settings).
