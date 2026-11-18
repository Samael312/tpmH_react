# Análisis de la plataforma TPM (tuprofemaria) — seguridad, lógica, funcionamiento y UX

> **Informe de auditoría original (2026-11-16).** Describe el estado de entonces; lo corregido desde entonces está en `CORRECCIONES.md` y, por tema, en `backend/doc/KNOWN_ISSUES.md`.

Fecha: 2026-11-16 · Rama `master` (commit `848e6f3`) · Backend FastAPI + SQLAlchemy + PostgreSQL · Frontend Next.js 16 / React 19.

## 1. Resumen ejecutivo

La plataforma cubre un ciclo completo y bien pensado: registro → clase de prueba → compra de paquete (validación manual del pago) → agendado → cancelación/reagendado → comisión del profesor → billetera y retiros, más clases grupales (cohortes), materiales, tareas, chat, soporte, Google Calendar y un asistente de IA. El flujo principal **funciona**: lo comprobé de punta a punta con tests ejecutables (37 pasan).

Pero hay **fallos reales de lógica y de seguridad** que conviene corregir antes de escalar. Los cinco más graves:

| # | Hallazgo | Impacto |
|---|----------|---------|
| AUD-03 | **Renovar un paquete agotado lo deja `completed` sin créditos**: los créditos ocupados se cuentan sobre *todas* las clases históricas del enrollment, no solo las del ciclo actual. | Un alumno que paga la renovación no puede agendar. Es el flujo de ingresos recurrentes. |
| AUD-01 | **El servidor no valida la disponibilidad del profesor al agendar** (ni al reagendar). Solo se valida en la UI. | Cualquiera con `curl` agenda clases a las 03:00 o en vacaciones del profesor. |
| AUD-02 | **Doble reserva**: las clases `pending_trial` no bloquean el horario del profesor en `can_book_slot`. Tampoco hay restricción en BD ni bloqueo de fila. | Dos alumnos reservan la misma prueba; una clase individual se puede solapar con una sesión grupal. |
| AUD-12 | **Falta el decorador `@router.get`** de `get_pending_withdrawals` (`payments.py:2116`). El frontend llama a esa ruta y recibe 404. | El admin no ve los retiros pendientes → los profesores no pueden cobrar desde la UI. |
| AUD-14 | **Reembolsos no descuentan la billetera del profesor.** | La plataforma devuelve el dinero al alumno *y* el profesor conserva su parte retirable. Pérdida directa. |

En seguridad lo más relevante: limitador de tasa que probablemente ve la IP del proxy (no la del cliente), chatbot de IA anónimo y sin límite de tamaño (coste), `teacher_admin` sin separación de funciones (puede fijarse la comisión en 0 y aprobar sus propios retiros), cuentas por email sin verificar que se vinculan a Google, y JWT de 7 días en cookie no `HttpOnly` sin revocación.

## 2. Alcance, método y límites

**Hecho:**
- Lectura de ~76 000 líneas (backend 100 %, frontend por muestreo + herramientas automáticas). Se leyeron completos `class_logic.py`, `classes.py`, `payments.py`, `auth.py`, dependencias de auth, scheduler, timezone y buena parte de cohortes, disponibilidad, chat, materiales, logs, calendar, `proxy.ts`, `next.config.ts`, stores y cliente API.
- **Suite nueva `backend/tests/audit/`** (57 tests): corre **sin `.env` y sin PostgreSQL** (SQLite temporal + la app FastAPI real en proceso, emails mockeados). Resultado: **37 pasan, 1 skip, 19 `xfail` estrictos** = bugs confirmados (cada uno falla por la causa descrita; al corregirlo el test pasa a XPASS y avisa).
- Frontend: `npx tsc --noEmit` → 0 errores; `eslint .` → 0 avisos; `next build` → compila las 60 rutas.
- Análisis automático: `vulture`/`pyflakes` (código muerto), cruce de rutas backend ↔ llamadas del frontend, revisión de migraciones Alembic (1 solo head, OK).

**No hecho (ver §9):** no hay PostgreSQL, `.env`, ni navegador; por eso no corrí la suite `tests/flow`, ni pruebas de concurrencia reales, ni E2E de UI, ni integraciones externas (Google, Cloudinary, Resend, OpenAI).

## 3. Cómo funciona (mapa mental)

- **Roles:** `student`, `teacher`, `teacher_admin` (profesor + staff), `superadmin`. Profesor nace `pending` y necesita aprobación.
- **Etapas de reserva** (`get_student_booking_stage`): `needs_trial → trial_in_progress → needs_package → package_pending_payment → ready` (+ `needs_renewal`, `renewal_pending`, `needs_group_refund`).
- **Dinero:** manual. El alumno "notifica" un pago (transferencia, etc.), el staff o el profesor lo aprueba, y al aprobar se calcula comisión (`commission_rate`, 15 % por defecto) y se acredita la billetera del profesor. Retiros: solicitud → staff completa/rechaza.
- **Créditos:** un paquete finito libera `unlocked_credits` (todo o por cuotas). Se "ocupa" un crédito al **agendar** (conteo de clases no canceladas), no al completar. `classes_used` es otro contador distinto que sube al completar/no_show.
- **Tiempo:** todo en UTC; disponibilidad semanal guardada como `HH:MM` UTC + día UTC.
- **Scheduler (APScheduler en proceso):** finalizar clases, recordatorios 24 h, Meet automático, sync Calendar, bajo crédito semanal, purga de chat.

## 4. Lo que funciona de forma coherente (verificado con tests)

- Registro/login (username o email), rechazo de roles privilegiados al registrarse, recuperación de contraseña sin enumeración de usuarios, token de reseteo de un solo uso y con caducidad, token manipulado/usuario desactivado rechazados.
- Progresión completa de etapas: prueba → completar → comprar → aprobar → `ready`.
- Agendado: se agota el cupo exacto de créditos (4 de 4, la 5ª se rechaza), antelación mínima, choque del mismo alumno, cancelación del alumno (≥12 h libera el cupo, <12 h bloqueada), cancelación del profesor siempre devuelve crédito, reagendado con regla de 12 h, aislamiento entre alumnos (no se puede tocar la clase de otro).
- Comisiones: 15 % por defecto (`100 → 15/85`), comisión personalizada, redondeo a centavos coherente (`33.33 → 28.33 + 5.00`), casos 0 % y 100 %, cota 0–1 en el endpoint de admin.
- Pagos: un pago no se aprueba dos veces (no duplica billetera), rechazo exige motivo y no acredita nada, método de pago deshabilitado rechazado, un alumno no puede validar pagos, un profesor no valida pagos de otro.
- Retiros: ciclo completo (saldo insuficiente, un solo retiro pendiente, completar suma `total_withdrawn`, rechazar devuelve saldo), bloqueo por `FOR UPDATE` en la solicitud.
- Slots: se calculan bien (solape, margen de preparación, rango disponible), conversión local→UTC con cambio de día (Sídney lunes 06:00 = domingo UTC).
- Calidad de código frontend: TypeScript y ESLint limpios, build correcto, sin `dangerouslySetInnerHTML`, sin `console.log`, CSP y cabeceras de seguridad configuradas.

## 5. Hallazgos de lógica de negocio

Severidad: 🔴 crítico · 🟠 alto · 🟡 medio · 🔵 bajo. Test = `backend/tests/audit/test_findings.py` salvo indicación.

### 🔴 AUD-03 — Renovación de paquete agotado deja al alumno sin créditos
`payments.py:1046` (`_get_enrollment_occupied_slots`) y `payments.py:568` cuentan `Class.enrollment_id == enrollment.id` sin filtrar por ciclo. La renovación **reutiliza el mismo enrollment** (`renewal_count` y `previous_enrollment_id` existen en el modelo pero nunca se usan). Al aprobar: `occupied_slots (4) >= target_credits (4)` ⇒ `status = completed`. En pagos en cuotas, `unlocked_credits` se reinicia a 0 mientras las clases viejas siguen contando.
**Test:** `test_renewal_after_full_cycle_gives_new_credits`. **Arreglo:** contar solo clases con `start_time >= activated_at` del ciclo, o crear un enrollment nuevo por renovación (usando `previous_enrollment_id`). Además, renovar un paquete *activo* con créditos sobrantes los **pierde** (`unlocked_credits = 0`, `payments.py:1004`): decidir si se arrastran.

### 🔴 AUD-01 — El agendado no valida la disponibilidad declarada del profesor
`book_class` (`payments.py:398-726`) solo llama a `can_book_slot` (choques y antelación). `is_within_teacher_availability` existe pero solo la usa cohortes. Lo mismo en los 3 reagendados (`classes.py:418, 780, 833`) y en la prueba. Las excepciones de bloqueo (vacaciones) y el horario semanal solo se respetan si la UI no se salta.
**Test:** `test_booking_outside_teacher_availability_rejected`, `test_student_reschedule_outside_availability_rejected`. **Arreglo:** llamar a `is_within_teacher_availability` (con buffer) dentro de `can_book_slot` para trial/regular, y contemplar el caso de clases que cruzan medianoche UTC (hoy solo se mira el día de inicio).

### 🔴 AUD-02 — Doble reserva (solape de agenda del profesor)
- `can_book_slot` excluye `pending_trial` del chequeo (`class_logic.py:303, 326`) y `group` del chequeo del profesor (`:304`). Resultado: dos alumnos reservan la misma prueba; un individual puede pisar una sesión grupal (cohortes sí bloquea individuales, así que es asimétrico).
- La UI de slots **sí** marca esos horarios ocupados (`availability.py` no excluye `pending_trial`), es decir: UI y API discrepan.
- No hay `SELECT … FOR UPDATE`, ni restricción única/`EXCLUDE` en BD: dos peticiones simultáneas pasan ambas el chequeo (también el de créditos: `occupied >= unlocked`, `payments.py:573`) y el descuento de saldo prepagado (`prepaid_unlimited_credits -= 1`, `:694`) no es atómico.
**Test:** `test_two_students_cannot_book_same_trial_slot`. **Arreglo:** incluir `pending_trial` en el solape; bloquear fila de profesor/enrollment al reservar; idealmente restricción `EXCLUDE USING gist` sobre rango por profesor (clases no grupales).

### 🔴 AUD-12 — Retiros pendientes inaccesibles
`payments.py:2116` define `get_pending_withdrawals` **sin decorador**; el frontend llama a `GET /payments/admin/withdrawals/pending` (`hooks/useAdminData.ts:171`) → 404. (El README de tests ya documenta que esa ruta "es la real", por lo que se rompió al editar el archivo.) **Test:** `test_admin_can_list_pending_withdrawals`.

### 🔴 AUD-14 — Reembolso sin contra-asiento en la billetera
En `validate_payment` (`:906-911`) un `refund` pone `amount_teacher = 0` y no toca la billetera; el dinero que se acreditó al aprobar el pago original queda disponible para retiro. Para reembolsos totales por suspensión, cohorte cancelada o downgrade, el profesor cobra de más. **Test:** `test_refund_claws_back_teacher_wallet`. **Arreglo:** al aprobar un reembolso, restar proporcionalmente la parte del profesor (permitiendo saldo negativo o bloqueando retiros hasta compensar). Relacionado: God Mode al editar un pago sí revierte billetera, pero puede dejar saldo negativo sin aviso.

### 🟠 AUD-04 — Se puede marcar `completed` una clase futura
`classes.py:639-645` solo exige "no pasaron más de 72 h desde el fin"; una clase futura da diferencia negativa y pasa. Un profesor puede completar clases que no ocurrieron (cuenta para contador de por vida, reseñas, progreso de paquete). **Test:** `test_cannot_complete_future_class`. Exigir `now >= start_time`.

### 🟠 AUD-05 — `PATCH /classes/{id}/status = cancelled` penaliza al alumno aunque cancele el profesor
`update_class_status` usa `class_counts_towards_package` con `apply_late_cancel_penalty=True` por defecto: una cancelación tardía hecha por el profesor incrementa `classes_used`. El endpoint dedicado (`DELETE /classes/teacher/{id}`) sí devuelve crédito. Dos caminos, dos resultados. Además el estado permitido es "cualquiera" (incluye `pending`, `rescheduled`, `pending_payment`) y hay una rama muerta para `"cancelled_by_teacher"` (`classes.py:666`). **Test:** `test_teacher_status_cancel_does_not_penalize_student`. **Arreglo:** que `PATCH status` no acepte `cancelled` (usar los DELETE) y definir una máquina de estados.

### 🟠 AUD-09 — `update_enrollment_counter` pisa estados del enrollment
`class_logic.py:496-500` asigna `status = "active"` o `"completed"` siempre. Si el enrollment está `pending_renewal`/`pending_package_change`/`cancelled` y se marca una clase, vuelve a `active` y se pierde la solicitud pendiente. **Test:** `test_counter_update_keeps_pending_renewal_status`.

### 🟠 AUD-07 — La duración reservada no se valida contra el paquete
`book_class` valida contra el catálogo global (`validate_class_duration`), no contra `package.duration_minutes`. Un paquete de 50 min permite reservar 110. **Test:** `test_booking_duration_must_match_package`.

### 🟡 AUD-08 — `datetime` sin zona horaria da 500
Pydantic acepta `2026-12-01T10:00:00`; luego se compara naive con aware (`TypeError`). **Test:** `test_naive_datetime_does_not_crash`. Validador que exija tz o la asuma UTC.

### 🟡 AUD-10 — Valor `0` ignorado en reglas de negocio
`get_business_rules` usa `config.x or DEFAULT` (`class_logic.py:176-183`): `min_cancel_hours=0`, `min_booking_hours=0`, `low_credit_threshold=0` vuelven al valor por defecto, aunque el admin lo configure. Los buffers sí usan `is not None`. **Test:** `test_business_rules_accept_zero`.

### 🟡 AUD-11 — `commission_rate` NULL rompe el pago
`_apply_commission` solo contempla `teacher is None`, no `commission_rate is None` (`payments.py:103`). La columna es nullable. **Test:** `test_commission_null_rate_falls_back_to_default`.

### 🟡 AUD-13 — Mínimo de retiro no aplicado en servidor
La UI exige $10 (`wallet/page.tsx:122`) y el schema antiguo `WithdrawalRequest` también (ahora sin uso), pero `WithdrawalRequestV2` acepta cualquier monto > 0. Además la respuesta `WithdrawalResponse.destination_method` siempre es `null`. **Test:** `test_withdrawal_minimum_amount`.

### 🟡 AUD-18 — Reagendado grupal por el profesor
`reschedule_class_teacher` llama a `can_book_slot(student_id=class_.student_id)`; en una sesión grupal es `None` y la consulta `Class.student_id == None` casa con otras clases grupales de **cualquier** profesor cercanas en el tiempo → falso "Ya tienes una clase en ese horario". *Revisado en código, pendiente de reproducir con cohortes reales (test marcado skip).*

### 🟡 Otros de lógica
- **`finalized` nunca se resuelve solo.** Las clases `confirmed` pasadas pasan a `finalized` y ahí se quedan hasta que el profesor las marque (ventana 72 h; después queda bloqueada). Sin acción: no cuentan para `classes_used`, reseñas (`completed`), contador de por vida ni ganancias de progreso. Test: `test_finalize_past_classes_leaves_finalized_forever`. Decisión de negocio: auto-completar tras N horas, o alertar al profesor.
- **Doble contabilidad de créditos.** Disponibilidad real = clases no canceladas (`occupied`), pero el aviso de "pocos créditos" (`scheduler.py:268`) usa `unlocked_credits - classes_used`, que ignora las clases ya agendadas: avisa tarde o nunca. Igual `min_classes_before_package_change` usa `classes_used`.
- `get_student_booking_stage` **escribe en BD** (cancela enrollments `unpaid` sin pago pendiente) y se invoca desde un `GET` (`/payments/booking-status`) y desde `book`. Una lectura con efectos laterales.
- `finalize_past_classes` (`class_logic.py:667`) tiene una rama muerta: dentro del bucle de `pending_trial` pregunta por `class_type == regular`, que nunca ocurre. Además una prueba `pending_trial` no confirmada pasa a `no_show` y suma al contador de por vida del alumno.
- `finalize_past_classes` se ejecuta en **cada** `GET /classes/my-classes` y `GET /classes/teacher/classes` (escritura masiva en lecturas) además del job.
- `manual-grant` sobre un paquete **ilimitado** deja `payment_status=paid` pero 0 créditos (`payments.py:1181-1184`). Sobre un enrollment activo reinicia `unlocked_credits` sin límite; el profesor puede ejecutarlo repetidamente.
- `cancel_class_admin` (`classes.py:880`) no notifica a los participantes de sesiones grupales (el endpoint del profesor sí).
- Los **reembolsos de downgrade** se calculan sobre `price_per_class` del paquete antiguo; si el profesor edita precios después, los cálculos de enrollments existentes cambian (el precio efectivamente pagado no se congela en el enrollment).
- Aprobación de pagos **sin idempotencia fuerte**: dos aprobaciones simultáneas leen `pending_review` a la vez (no hay `with_for_update` en `validate_payment` ni en `process_withdrawal_v2`). El test secuencial pasa; la carrera real requiere PostgreSQL.
- `transaction_reference` no es único: la misma referencia puede usarse en varios pagos.
- **Zonas horarias y DST:** la disponibilidad recurrente se guarda como `HH:MM` UTC con el desfase de la *próxima* fecha (`convert_local_time_to_utc`). Al cambiar el horario de verano, la hora local real del profesor se corre 1 h hasta que vuelva a guardarla (hay recálculo solo al cambiar de zona, no por DST). Pendiente de verificar con fechas fijas.

## 6. Seguridad

### 🟠 SEC-01 — Rate limiting probablemente ineficaz detrás del proxy
`get_remote_address` usa `request.client.host`. Con `uvicorn app.main:app --host 0.0.0.0` (Dockerfile y `railway.toml`) Uvicorn solo confía en `X-Forwarded-For` desde `127.0.0.1` por defecto. En Railway toda petición llega desde la IP del proxy ⇒ **todos los usuarios comparten el mismo contador**: 10 logins/minuto en total para toda la plataforma (DoS trivial) y el bruteforce por IP no se distingue. Añadir `--proxy-headers --forwarded-allow-ips='*'` (o la IP del proxy) y verificar. Además el almacenamiento es en memoria (se reinicia con cada despliegue y no escala a >1 worker).

### 🟠 SEC-02 — Chatbot Chipi anónimo y sin límites (coste)
`POST /chipi/chat` acepta usuarios sin sesión (`get_current_user_optional`), `message: str` y `history: List[ChatMessage]` sin tope de tamaño ni de elementos, `role` libre en el historial (se puede inyectar mensajes `system`/`assistant` falsos) y solo el límite global de 200/min/IP. Riesgo de facturación OpenAI y de *prompt injection*. Poner límite propio, longitudes máximas, validar `role in {user, assistant}` y exigir login para streaming largo. `/tts/*` exige login pero no tiene límite por usuario (50 palabras × N peticiones).

### 🟠 SEC-03 — `teacher_admin` sin separación de funciones
`get_current_staff` incluye a `teacher_admin`, que además es profesor. Puede: fijar **su propia comisión** (`admin.py:420`, test `test_teacher_admin_cannot_change_own_commission`), **completar sus propios retiros** (`payments.py:1306`), editar la configuración de pagos y de plataforma, validar sus propios pagos. God Mode sí restringe a `teacher_admin` a sus propios datos; el resto no. Decidir qué acciones son solo `superadmin`.
También: el **profesor** puede aprobar pagos de sus alumnos (`validate_payment`) y por tanto acreditarse a sí mismo; el dinero va "a la cuenta del admin" según el modelo, así que quien aprueba un pago no debería ser quien cobra.

### 🟡 SEC-04 — Cuentas sin verificación de email + vinculación a Google
El registro por email no verifica propiedad. `google_login` vincula `google_id` a una cuenta existente por email sin exigir `email_verified` (`auth.py:150`, `google.py:25`; el dato se calcula pero no se usa). Escenario: atacante registra `victima@gmail.com` con su contraseña; cuando la víctima entra con Google se vincula a la cuenta del atacante, que conserva la contraseña. Exigir verificación de email y `email_verified == "true"`.

### 🟡 SEC-05 — Sesión: JWT 7 días en cookie no `HttpOnly`, sin revocación
La cookie `access_token` la crea `js-cookie` (`authStore.ts`), legible por JavaScript; el CSP permite `'unsafe-inline'` en scripts. Cualquier XSS roba la sesión. No hay revocación ni versión de token: cambiar o restablecer contraseña no invalida los JWT emitidos. `proxy.ts` decodifica el token sin verificar firma (solo UX; el backend valida de verdad, correcto). Recomendado: cookie `HttpOnly; Secure; SameSite=Lax` emitida por el backend + tokens cortos con refresh.

### 🟡 SEC-06 — Otros
- `POST /logs/frontend` es **anónimo**, `stack` y `extra` sin límite de tamaño ⇒ llenado de la tabla `error_logs` (disco/BD).
- Google Calendar OAuth: `state = teacher_profile.id` (predecible, nunca se verifica en el callback), `payload: dict` sin esquema, y el error de Google se devuelve crudo (`calendar.py:47-70`).
- WebSocket de chat con el JWT en la query string (queda en logs de acceso); sin límite de tasa de mensajes por conexión.
- `GET /payments/config` es público y expone datos bancarios/PayPal/Binance (necesario para pagar, pero debería requerir sesión).
- `GET /admin/platform-config` público (el nombre sugiere admin; se usa en el landing). Revisar que `serialize_platform_config` no filtre nada interno (el test no encuentra secretos).
- Borrar cuenta (`DELETE /users/me`) no pide contraseña (la UI pide escribir el usuario) y no comprueba **saldo en billetera, retiros pendientes, paquetes activos ni clases futuras**: un profesor con saldo pierde el acceso al dinero; las clases futuras quedan colgadas con el "Usuario eliminado". La UI dice "se borrarán todos tus datos, clases y progreso de forma permanente" pero el backend anonimiza y conserva pagos/clases (inconsistencia legal/UX; la tabla de pagos conserva `refund_payment_info` con datos bancarios).
- Subida de archivos: validación de *magic bytes* bien hecha; pero `application/pptx` (`storage.py:23, 120`) **no es un MIME real** (el de `.pptx` es `application/vnd.openxmlformats-officedocument.presentationml.presentation`), por lo que subir PowerPoint desde un navegador probablemente falla. `/materials/{id}/stream` redirige a una URL pública de Cloudinary: el control de acceso se evita con la URL directa.
- Login con una cuenta solo-Google (`password_hash` NULL) → `verify_password(None…)` → **500** (AUD-19). Debe ser 401 con mensaje claro.
- Login por username distingue mayúsculas mientras el registro lo pasa a minúsculas (AUD-16); email sin normalizar → `A@x.com` y `a@x.com` son cuentas distintas (AUD-17).
- Clave de Gemini en la URL (`ai_debug.py`), enviable a logs; mover a cabecera.
- `flow_tests.py` expone en el router de producción un endpoint que lanza `pytest` como subproceso (protegido por rol staff y bloqueado si `ENVIRONMENT=production`); es una superficie innecesaria en el despliegue real. Cargarlo solo en desarrollo.
- Documentación `/docs` activa salvo `ENVIRONMENT=production`: asegurarse de que esa variable está fijada en Railway.

## 7. Código muerto, incongruencias y deuda

- `get_pending_withdrawals` sin ruta (AUD-12) y `WithdrawalRequest` (schema viejo) importado sin usar.
- **Endpoints heredados duplicados** que el frontend ya no usa y que reimplementan el flujo con menos protecciones: `POST /packages/request-renewal`, `/request-package-change`, `/{id}/cancel-package-change` (la UI usa `/payments/notify-payment`). Un docstring cita `POST /cohorts/migrate-to-individual`, que no existe. Eliminar o unificar para no tener dos "fuentes de verdad".
- Campos de modelo sin uso: `Enrollment.renewal_count`, `previous_enrollment_id` (nunca se escriben), `Class.payment_expires_at`, `pending_payment`/`pending`/`expired`/`rescheduled` (estados que "ya no se producen" pero siguen en `UPCOMING_STATUSES`, validadores y comentarios).
- `default_commission_rate` (config de pagos) **no se aplica a ningún profesor nuevo**: `TeacherProfile.commission_rate` tiene su propio default fijo de 0.15; la configuración solo se muestra.
- Constante `featured_teacher = os.getenv(... "mar12")` sin uso en `availability.py:488` y el valor `"mar12"` hardcodeado también como default en `next.config.ts` y en `availability.py`.
- `availability.py`: imports duplicados (`datetime`, `timedelta`, `ZoneInfo`); `current_user: Optional[User] = Depends(get_current_user)` en `/slots` es estricto aunque se tipa y documenta como opcional (los slots exigen login).
- `get_featured_teacher_slots` (AUD-20): llama a `get_teacher_available_slots(...)` sin pasar `bypass_min_notice`, de modo que recibe el objeto `Query(...)` (truthy) → **403 para alumnos y bypass de antelación para staff**. **Test:** `test_featured_teacher_slots_work_for_students`. Modo single-tenant afectado si el frontend lo usa.
- `classes.py:906` variable `teacher_name` sin usar; `class_logic.can_cancel_class(requesting_user_id)` parámetro sin usar; funciones y rutas sin consumidor aparente en el frontend (muchas God Mode se usan por URL dinámica, así que solo señalo con seguridad: `/classes/trial`, `/payments/my-payments`, `/reviews/{id}` DELETE).
- `requirements.txt` está codificado en **UTF-16** (pip lo tolera, pero otras herramientas/Dependabot no), incluye `opencode-ai`/`opencode-cli` (no relacionados), `pytest*` en producción y no fija `httpx` ni `python-dotenv` como dependencia directa de forma clara. El `Dockerfile` usa Python 3.11 y el desarrollo local 3.12. La app **no arranca sin `OPENAI_API_KEY`** (`core/chipi/service.py:8` crea el cliente al importar).
- Dos migraciones con el mismo prefijo de archivo `a1b2c3d4e5f6_*` (ids distintos, un solo head: funciona, pero confunde).
- APScheduler con `IntervalTrigger` de 24 h y 7 días: el primer disparo ocurre *después* del intervalo; si el servicio se reinicia/despliega más a menudo, **la purga de chat y el aviso de bajo crédito pueden no ejecutarse nunca**. Los jobs también se duplican si se escala a más de un worker.
- No existe ninguna prueba en el frontend (0 archivos de test, ni script `test` en `package.json`).
- Archivos enormes difíciles de mantener: `payments.py` (2130 líneas), `god_mode.py` (1926), `schedule/page.tsx` (1795), `admin/settings/page.tsx` (1610), `materials/page.tsx` (1565).

## 8. UX y frontend (revisión estática; no se pudo probar en navegador)

Positivo: mensajes de error en español claros, modales de confirmación, escritura del usuario para borrar la cuenta, estados de carga, componente de reporte de errores, accesibilidad básica (≈58 `aria-`/`alt`), preferencia de movimiento reducido para el 3D, CSP/HSTS/X-Frame configurados.

A vigilar:
- La UI valida lo que el servidor no (mínimo de retiro, disponibilidad): cualquier cliente alternativo se salta las reglas (ver AUD-01/13).
- **Retiros pendientes del admin** darán error/lista vacía (AUD-12).
- Texto de borrado de cuenta contradice el comportamiento real (§6).
- Estados "limbo" visibles al usuario: clases `finalized` que nunca pasan a `completed` y reseñas que no se pueden dejar hasta que el profesor actúe.
- Tras una renovación pagada, el alumno puede ver el banner de renovación o "sin créditos" aunque ya pagó (AUD-03).
- Páginas muy grandes (`schedule` ~1800 líneas) con lógica de negocio duplicada del backend (estado de reserva, duraciones): riesgo de desalineación.
- Interceptor Axios: cualquier 401 fuerza logout con `window.location.href` (pierde formularios en curso); `403/500` se reportan a logs pero sin reintento.
- Login con cuenta solo Google y contraseña → error genérico 500 en vez de mensaje guiado.

## 9. Pruebas

### 9.1 Ejecutadas (reproducibles hoy, sin `.env` ni BD)
```bash
cd backend
pip install -r requirements.txt            # (UTF-16; en Windows/pip funciona)
python -m pytest tests/audit -q            # ~4 min por el hashing bcrypt
```
Resultado: **37 passed, 1 skipped, 19 xfailed**. `tests/audit/conftest.py` crea SQLite temporal, registra `JSONB→JSON`, emula datetimes con zona (SQLite devuelve naive) y mockea Resend. Para convertir un bug en test normal basta quitar el `@pytest.mark.xfail` tras corregirlo.

Frontend: `npx tsc --noEmit` ✅, `npx eslint .` ✅, `npx next build` ✅.

### 9.2 Pendientes (necesitan entorno que aquí no existe)
| Prueba | Qué necesita |
|--------|--------------|
| Suite `tests/flow` (≈ 16 módulos: cohortes, chat, soporte, materiales, God Mode, cambio de paquete, regresiones D1–D14) | PostgreSQL local + `.env` (`DATABASE_URL`, `SECRET_KEY`, `ENVIRONMENT=development`, claves dummy) + `alembic upgrade head` + `pytest tests/flow --run-flow-tests`. **Nunca contra producción.** |
| Concurrencia: doble reserva simultánea, doble aprobación de pago, doble retiro, créditos prepagados | PostgreSQL real + tests con hilos (`pytest-xdist`/`asyncio.gather`) |
| Cohortes: reagendado grupal (AUD-18), unión tardía, cancelación y reembolso, sesiones recurrentes | Datos de cohorte; cubierto en parte por `tests/flow` |
| DST y zonas horarias reales (cambio de hora de Madrid/Nueva York) | Fechas fijas con `freezegun` o parámetro `reference` |
| Integraciones: Google Calendar/Meet, Cloudinary (subidas/magic bytes reales), Resend (emails), OpenAI (Chipi/TTS), Google Sign-In | Credenciales de sandbox y red |
| WebSocket del chat (reconexión, entrega, límite de mensajes) | Servidor corriendo + cliente WS |
| E2E de UI (registro → prueba → pago → agenda en móvil y escritorio; admin aprueba pago; retiro) | Navegador (Playwright/Chrome) + backend y BD levantados + usuarios semilla |
| Accesibilidad y rendimiento del landing 3D | Lighthouse / axe en navegador real |
| Pruebas de carga y de rate-limit tras el proxy (SEC-01) | Despliegue de staging en Railway |
| Escaneo de dependencias (`pip-audit`, `npm audit`) | Red a bases de vulnerabilidades |
| Tests de frontend (componentes/hooks) | Elegir framework (Vitest + Testing Library) — hoy no hay ninguno |

## 10. Plan de acción sugerido

**Esta semana (bloquea ingresos o dinero):** AUD-03 renovación, AUD-12 decorador, AUD-14 reembolsos, AUD-01/02 disponibilidad + solapes (con bloqueo de fila), SEC-01 `--proxy-headers`.
**Siguiente:** AUD-04/05/09 (máquina de estados de clases y contadores), SEC-02 límites de Chipi/TTS, SEC-03 separación de funciones `teacher_admin`, SEC-04 verificación de email, AUD-19/16/17 (auth), AUD-20, AUD-13, AUD-07/08/10/11.
**Después:** auto-resolución de `finalized`, unificar el flujo de renovación/cambio (borrar endpoints heredados), cookie `HttpOnly` + refresh, mover jobs largos a un scheduler persistente, partir los archivos gigantes, suite de frontend y E2E en CI.

## 11. Dudas abiertas (necesito tu criterio)

1. ¿`finalized` debe auto-completarse tras N horas, o el profesor siempre decide? (afecta créditos, reseñas, ganancias).
2. ¿Al **renovar** un paquete activo con créditos sobrantes, se arrastran los sobrantes o se pierden?
3. ¿Quién puede aprobar pagos, retiros y cambiar comisiones: solo `superadmin`, o también `teacher_admin`/profesor sobre sus alumnos?
4. ¿La comisión se aplica sobre el pago *aprobado* (como hoy) y, en reembolsos, el profesor devuelve su parte?
5. ¿Hay despliegue con más de un worker/instancia? (afecta rate-limit, scheduler y flow-tests).
6. ¿Quieres que corrija los hallazgos? Puedo hacerlo por lotes (cada AUD con su test pasando de `xfail` a normal).


---

## Puntuaciones 0-100 (rúbrica nueva, registro por tandas)

**Origen y límites.** No se conservaban las notas del análisis anterior, así que esta es una rúbrica nueva. La columna «Antes» es una **estimación hecha tras la tanda 2 de la Fase 12** (commit `049c181`) con el código y los documentos del repo; no es una medición. Ningún valor se ha medido en producción (por ejemplo `/users/me` sigue sin medirse). Se actualiza al cerrar cada fase o grupo de tandas.

| Aspecto | Antes (`049c181`) | Tras tandas 3-5 | Qué cambió y qué lo limita |
|---|---|---|---|
| Robustez | 78 | 78 | Sin cambios de lógica de negocio en estas tandas. Limita: un solo worker, jobs en memoria y carrera de cuota de materiales. |
| Profesionalidad | 80 | 81 | Docs al día y tests nuevos (backend 4, frontend 9). Limita: `backend.yml` nunca se ha ejecutado en GitHub. |
| Seguridad | 74 | 79 | Tope de contraseña, login sin enumeración por tiempo, límite de tasa por cookie, cabeceras de la API. Limita: sin bloqueo por cuenta, Bearer y `?token=` siguen activos hasta el lanzamiento y la CSP conserva `unsafe-inline` en estilos. |
| Escalabilidad | 62 | 64 | Pagos, ingresos y retiros del profesor paginados en el servidor. Limita: 40 usos de `fetchAllPages`, un worker y sin Redis. |
| UX | 76 | 78 | Aviso del plazo de 72 h en clases `finalized` (profesor y alumno). Limita: el profesor no recibe aviso cuando una clase pasa sola a `no_show`. |

**Criterios.** Seguridad: hallazgos cerrados frente a abiertos y estado de la autenticación. Escalabilidad: listados sin tope en servidor y puntos únicos de fallo. UX: flujos con avisos claros y sin estados mudos. Robustez: bugs graves corregidos y tests de concurrencia. Profesionalidad: documentación, CI y configuración sin código muerto.
