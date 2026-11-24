# Reglas de negocio vigentes (comportamiento ACTUAL, no el deseado)

Verificado con `tests/audit` salvo donde se indica. Los bugs conocidos que contradicen estas reglas están en `KNOWN_ISSUES.md`.

## Roles

| Rol | Puede |
|---|---|
| `student` | reservar, pagar (notificar), cancelar/reagendar sus clases, tareas, reseñas, chat, soporte |
| `teacher` | su agenda, disponibilidad, paquetes, alumnos, estados de sus clases, ver sus pagos como «pendiente de revisión» (**no aprueba ni rechaza**: solo staff), billetera y retiros, materiales/tareas |
| `teacher_admin` | todo lo de `teacher` + panel staff (`get_current_staff`): validar pagos de otros profesores, procesar retiros ajenos, comisiones de otros; **no valida los pagos de sus propias clases, ni procesa su propio retiro (403), ni cambia su propia comisión** (lo hace el `superadmin`), God Mode solo sobre sus propios datos. **Sí puede** editar los datos de pago de la plataforma (`PATCH /payments/config`: banco, PayPal, Binance, WhatsApp…; decisión del propietario), banear/desbanear alumnos, cambiar el estado de profesores y editar usuarios (el cambio de rol es solo del `superadmin`). **No puede** (`require_superadmin`, 403): modo single/multi y profesor destacado (`PATCH /admin/platform-config`), `email-settings`, crear/editar pagos en Modo Dios (`POST /god-mode/payments`, `PATCH /god-mode/payments/{id}`), moderar chats (`/chat/admin/conversations*`), reagendar/borrar clases ajenas desde el panel, descargar materiales de otros ni procesar su propio retiro (Fase 16) |
| `superadmin` | todo el panel, config de plataforma, comisiones, retiros, God Mode global, moderación de chats, estado de profesores/usuarios y bajas de alumnos |

Registro (`POST /auth/register`) solo admite `student`/`teacher`; los roles privilegiados se rechazan. Un profesor nace `pending` y necesita aprobación staff (`approved`; también `suspended`, etc.).
Un usuario `is_active=False` o `is_banned` recibe 403 (login y con token existente). Token de usuario borrado -> 401.

## Modo de plataforma: single-tenant y multi-tenant (`PlatformConfig.is_single_tenant`)

- **Single-tenant:** la plataforma gestiona solo las clases de la profesora destacada (`featured_teacher_id`; si está vacío, `FEATURED_TEACHER_USERNAME` del entorno, resuelto por `core/platform_config.py::resolve_featured_teacher`). El alumno no elige profesor: `POST /payments/book` sin enrollment agenda siempre con ella (se ignora `teacher_username`), `/users/me/teachers` devuelve solo a ella y elegir o dejar profesor da 400. Si la destacada no está aprobada, reservar da 400.
- **Single-tenant, nada con otro profesor** (`ensure_featured_teacher_in_single_tenant`, 400 «La plataforma solo gestiona las clases de…»): reservar con un enrollment de otro profesor, comprar/renovar/cambiar su paquete, recargar su ilimitado o inscribirse a su grupo. Son créditos de una etapa multi anterior: quedan para cuando vuelva multi (o para un reembolso).
- **El vínculo alumno–profesor (`StudentTeacherLink`) se guarda en los dos modos** al reservar. En single no se ve, pero así, al pasar a multi, cada alumno sigue con su profesora aunque la destacada haya cambiado durante la etapa single.
- **Single → multi** (`PATCH /admin/platform-config` con `is_single_tenant=false`, Fase 18): corre `backfill_student_teacher_links` (en `core/teacher_students.py`, también usable desde un script) en la MISMA transacción que el cambio de modo. Cubre todos los pares (alumno, profesor) con Enrollment no cancelado o Class con alumno (no cancelada/rechazada/expirada) con CUALQUIER profesor, no solo la destacada previa; omite alumnos baneados/inactivos y perfiles inexistentes. Garantiza SIEMPRE las tres fuentes (`StudentTeacherLink`, `TeacherProfile.students`, conversación directa) aunque el link ya existiera. Es atómico (rollback total si falla), idempotente y corre siempre que se pida multi, así un reintento repara. La fila de `PlatformConfig` se bloquea (`FOR UPDATE`) y los creadores de links toleran la restricción única (nunca 500).
- **Single exige destacada:** `is_single_tenant=true` sin destacada resoluble (BD o `FEATURED_TEACHER_USERNAME`) -> 400. `/users/me/teachers` en single usa esa misma resolución.
- **Multi → single** no borra, migra ni cancela nada. Pre-check: si hay alumnos con enrollment vivo (active/pending_renewal/pending_package_change) o clase futura con profesores distintos de la destacada, el PATCH responde 409 `{message, affected_students, sample[]}` salvo `force=true` (el panel `/admin/settings` pide confirmación y reintenta con `force`). Forzado, esos créditos quedan inutilizables en la UI hasta volver a multi (o reembolso). El cambio de destacada A->B dentro de single no tiene pre-check.
- Reservar en single ya no saca al alumno de `TeacherProfile.students` del profesor anterior.
- Verificado en `tests/audit/test_f15_tenant_modes.py` y `test_f18_tenant_transition.py`.

## Etapas de reserva (por pareja alumno–profesor) — `get_student_booking_stage`

`needs_trial` -> `trial_in_progress` -> `needs_package` -> `package_pending_payment` -> `ready`;
más `needs_renewal`, `renewal_pending`, `needs_group_refund`. Cada profesor exige su propia prueba.
**Una sola prueba por profesor:** una prueba `finalized` (ya pasó, sin marcar) sigue en `trial_in_progress`; una prueba `no_show` (el alumno faltó, o pasaron 72 h sin marcarla) cuenta como prueba usada y lleva a `needs_package`, igual que `completed` (decisión del dueño, 2026-11-17).
Endpoint: `GET /payments/booking-status?teacher_username=`. **Efecto lateral:** cancela enrollments `unpaid` sin pago pendiente (escribe en un GET).

## Clases

Tipos: `trial` (no consume paquete; 25 min por defecto), `regular` (consume crédito), `group` (sesión grupal; `student_id` NULL, alumnos en `ClassParticipant`), `external` (importada de Google Calendar, sin alumno ni crédito).
Estados vivos: `pending_trial`, `confirmed`; terminales: `completed`, `cancelled`, `no_show`, `finalized` (confirmada ya pasada sin resolver). Estados heredados que ya no se producen pero siguen en validadores/`UPCOMING_STATUSES`: `pending`, `pending_payment`, `expired`, `rescheduled`.

### Duraciones y márgenes (configurables en `PlatformConfig`, defaults en `class_logic.py`)

- Opciones globales `[25, 50, 80, 110]`; regular/paquete por defecto `[50, 80, 110]`; prueba 25 min.
- **Buffer** (descuenta del final real, ocupa agenda): prueba 5 min, regular 10, grupal 10. Verificado: clase 10:00–10:50 bloquea hasta 11:00; 10:55 da 409, 11:00 OK.
- Antelación mínima para reservar: 1 h. Cancelar el alumno: ≥12 h. Reagendar el alumno: ≥12 h; staff: 0.
- **Tope de reagendados (Fase 25):** el alumno puede reagendar una misma clase como máximo `MAX_STUDENT_RESCHEDULES = 2` veces (constante en `models/class_.py`, no configurable). Cuenta `Class.student_reschedule_count`, que sube solo en reagendados exitosos del alumno; el 3.º da 400 (contactar al profesor o cancelar con ≥12 h). Profesor y admin no cuentan ni tienen tope. `ClassResponse` expone `student_reschedule_count`, `reschedule_limit` y `reschedules_remaining`. Se comprueba tras la regla de estado/antelación y antes de validar el hueco.
- Una clase ya pasada (`finalized`, `no_show`) solo la reagenda el **profesor** (o el staff); el alumno no (reagendar una `finalized` la devolvía a `confirmed` sin gastar crédito).
- «Próximas» (`GET /classes/my-classes` y `/classes/teacher/classes` sin historial) incluye la clase **en curso** hasta su fin (`end_time_utc > ahora`), para que el enlace de Meet siga a mano durante la clase.
- Duración reservada se valida contra el catálogo global, **no** contra el paquete (AUD-07). Schema exige 15–240 min (0, negativo, 14, 241 -> 422).
- Fecha pasada -> rechazada. Fecha sin zona horaria -> 500 (AUD-08).

### Reservar (`POST /payments/book`, `book_class` en `payments.py`)

Valida: enrollment del propio alumno (otro alumno -> 404), profesor `approved` (suspendido congela enrollments existentes con mensaje «congelados»), créditos disponibles, `can_book_slot` (choque del alumno y del profesor, antelación). **No valida disponibilidad declarada del profesor** (AUD-01) ni solape con pruebas pendientes/grupales (AUD-02).
Un slot cancelado se puede volver a reservar. Reagendar al mismo horario se permite.

### Cancelar

- Alumno `DELETE /classes/{id}`: ≥12 h antes -> `cancelled` y devuelve crédito; <12 h -> 400.
- Profesor `DELETE /classes/teacher/{id}`: siempre devuelve crédito, notifica por email; segunda cancelación -> 400 y el crédito no se devuelve dos veces.
- `PATCH /classes/{id}/status` con `cancelled` aplica penalización tardía al alumno incluso si cancela el profesor (AUD-05).
- Profesor solo cambia estado de **sus** clases (otro profesor -> 404). Valor de estado inválido -> 422.

### Estados y contadores

- `classes_used` (Enrollment) sube con `completed` y `no_show`; pasar de `completed` a `confirmed` lo baja.
- **Créditos disponibles = `unlocked_credits` − clases no canceladas del enrollment** (`occupied`); se "ocupa" al **agendar**, no al completar. Agendar la 5ª de 4 -> 400.
- Completar: permitido hasta 72 h después del fin; **también clases futuras** (AUD-04).
- `finalize_past_classes`: `confirmed` pasada -> `finalized` (no cuenta como completada hasta que el profesor la marque); no confirmada pasada -> `no_show`. Corre solo por el job cada 10 min (Fase 5: ya no en `GET my-classes`; una clase terminada puede tardar hasta 10 min en reflejarse).
- `StudentProfile.total_completed_classes` (contador de por vida) se sincroniza con `sync_student_lifetime_class_counter`.

## Paquetes y créditos

- Paquete finito: `classes_count`, `price`, `price_per_class` (obligatorio, `price_per_class × classes_count == price`), `duration_minutes`. Ilimitado: `classes_count = NULL`, se compran **créditos prepagados** (`credits_requested`, ≥1) a precio unitario; `prepaid_unlimited_credits` baja al agendar y sube al cancelar; recarga con tipo `unlimited_recharge` (`credits_requested < 1` -> 400).
- Comprar exige haber **completado la prueba** con ese profesor (si no, 400), paquete activo y del profesor (si no, 404).
- **Cuotas** (`allow_installments`, `installment_count`, `installment_amount`; la cuota fijada a mano no puede dejar la última en ≤ 0; la última cuota = precio − cuota × (n−1)): cada cuota aprobada libera `ceil(clases/cuotas)` créditos con tope en el total del paquete (la última libera el resto) (`unlocked_credits`: 2 de 4 tras la 1ª, `payment_status=partially_paid`; tras la 2ª, 4 y `paid`). Sin cuota pagada no se pueden agendar los créditos restantes. Paquete sin cuotas + `installment_index` -> 400.
- Doble clic: la segunda notificación idéntica en <15 s se trata como duplicada (devuelve el pago existente); notificar con un paquete ya pagado -> 400.
- Pago rechazado: el alumno vuelve a `needs_package`, ve `last_rejected_payment.rejection_reason` y puede reintentar.
- **Renovación** (`type=renewal`): reutiliza el mismo enrollment y reinicia `classes_used`. Los créditos sobrantes **se suman** a los del paquete nuevo (disponibles = sobrantes + clases del paquete nuevo). Si venía de un paquete ilimitado, los prepagados sobrantes pasan al nuevo.
- **Cambio de paquete** (`type=package_change`): mismo paquete -> 400; **upgrade** cobra `(clases del nuevo − créditos disponibles) × price_per_class del nuevo` (ej.: P4 a $25 con 2 disponibles -> P8 a $25: 6 × 25 = $150) y el alumno queda con **todos los créditos del paquete nuevo disponibles** (8); las clases ya usadas no cuentan contra el nuevo (`unlocked_credits` = ocupadas + clases del nuevo, `classes_used` = 0). **Mismo nº de clases** sin consumir ninguna se trata como el caso A: cobra/reembolsa la diferencia de precio, no es gratis. **Bajada con clases usadas:** `diferencia = precio del nuevo − (price_per_class del actual × clases sin usar)`; paga si es positiva, reembolso si es negativa, y también queda con los créditos completos del nuevo; **downgrade/reembolso** exige `payment_info` con contacto (no vacío; solo espacios -> 422). `min_classes_before_package_change` (default 0) usa `classes_used`.
- **Paquete gratis (Fase 20):** el profesor ya no otorga directo: `POST /payments/manual-grant-requests` (enrollment propio, no cancelado, no pagado salvo renovación/cambio pendiente, sin otra solicitud pendiente; motivo ≥ 5 caracteres) y el staff resuelve en `PATCH /payments/manual-grant-requests/{id}/resolve` (aprobar o rechazar con motivo). Al aprobar: Payment manual de $0 (sin comisión ni billetera), `log_god_mode_action` (`manual_grant.approve`), no reactiva enrollments cancelados, renovación suma los sobrantes, cambio da los créditos completos, paquete ilimitado da 0 créditos, nunca baja `unlocked_credits`. Un `teacher_admin` no resuelve solicitudes de su propio perfil (403). Avisos: campana + correo al staff (`admin_payments`) y al profesor (`receipts`). `POST /payments/manual-grant` (directo) es solo staff.
- **Congelación del paquete (Fase 20):** con enrollments vivos (activos / renovación o cambio pendiente) o cohortes abiertas, `PATCH /packages/{id}` devuelve 409 si cambia precio, precio por clase, duración, nº de clases, `is_group` o las cuotas (crea un paquete nuevo). Así reembolsos y cuotas no cambian a mitad de ciclo.

## Dinero

- Método de pago debe estar habilitado en `PaymentConfig` (banco, PayPal, Binance, pago móvil). `GET /payments/config` lo expone a cualquier usuario con sesión (Fase 20: ya no es público).
- Aprobar (`PATCH /payments/{id}/validate`, acción `approve`): calcula comisión con `TeacherProfile.commission_rate` (**15 % por defecto**, 0–1), `amount_teacher = total − comisión`, `amount_platform = comisión`; acredita `TeacherWallet.available_balance` y `total_earned`. Ejemplos verificados: 100 -> 85/15; 33.33 -> 28.33/5.00; 0 % y 100 % funcionan.
- La comisión se **congela en el pago**: cambiarla después no altera pagos ya aprobados.
- Un pago no se aprueba dos veces. Rechazar exige `rejection_reason` y no acredita nada. Un alumno no puede validar; un profesor solo valida pagos de sus alumnos.
- `commission_rate` NULL rompe (AUD-11). `default_commission_rate` de la config **no se aplica** a profesores nuevos.
- **Reembolso** (`payment_type=refund`): al aprobarlo se descuenta de la billetera del profesor **solo su parte** (`monto × neto/total` del último pago aprobado del enrollment, con la comisión congelada en ese pago; la plataforma asume la suya: 100 pagados -> 85 al profesor, reembolso de 100 descuenta 85). `amount_teacher`/`amount_platform` del reembolso quedan en negativo. Si el saldo del profesor no cubre su parte (ya retiró) se **bloquea** (400 «contacta con soporte»), tanto al pedirlo como al aprobarlo. **Plazo:** 7 días desde la aprobación del último pago real del enrollment, solo en reembolsos voluntarios (bajada de paquete con devolución); los reembolsos por profesor suspendido o grupo cancelado no tienen plazo.
- **Retiros**: `POST /payments/request-withdrawal` (`amount > 0`, `payment_info`); no más que `available_balance` (con 85.00 disponible, 85.01 -> 400, 85.00 -> 201 y saldo 0.0); un solo retiro pendiente; el monto se reserva al solicitar. Staff `POST /payments/admin/withdrawals/{id}/process` con `complete` (suma `total_withdrawn`, guarda `reference`) o `reject` (devuelve saldo). Procesar dos veces -> 404 la segunda. Mínimo $10 solo en la UI (AUD-13). Listar pendientes: `GET /payments/admin/withdrawals/pending`.

## Disponibilidad

Semanal (Fase 26): filas `TeacherAvailability` (`day_of_week` LOCAL, `start_time_local`, `end_time_local` en hora de reloj "HH:MM" del profesor; fin <= inicio cruza la medianoche local, 00:00-00:00 = 24 h) interpretadas con la zona ACTUAL de `teacher_profiles.timezone` y expandidas a UTC por fecha con zoneinfo (el horario de verano mueve el UTC, no la hora local). Hora local inexistente (salto de primavera) se salta (se sujeta al instante del salto); ambigua (retroceso de otoño) = primera ocurrencia. Excepciones puntuales (vacaciones/bloqueos) siguen siendo instantes UTC + excepciones puntuales (vacaciones/bloqueos). Slots (`GET /availability/...`): rango disponible menos clases ocupadas (incluye `pending_trial`) con buffer. Rejilla y validación de reserva comparten motor (`core/slot_availability.py`): rangos, bloqueos y clases se cargan por SOLAPE con la ventana (una franja o clase que cruza 00:00 UTC cuenta en los dos días UTC); `?date=` es el día local en `?tz=` (sin `tz`, día UTC) y solo salen huecos que EMPIEZAN en ese día. Cambiar la zona horaria del profesor NO recalcula el horario semanal (conserva su hora local: "18:00-20:00" sigue siendo 18:00-20:00 en la zona nueva); sí reinterpreta sus excepciones puntuales (misma fecha y hora de reloj) y descarta la caché de huecos. `PUT /availability/me/weekly` con una zona distinta a la del perfil la cambia (mismo efecto). Las preferencias del ALUMNO siguen en UTC y se recalculan al cambiar de zona (`schedule_recalc.py`); su desfase de verano queda fijo hasta que las reguarde.

## Cohortes (clases grupales)

`GroupCohort` con cupos mínimo/máximo; alumnos con `Enrollment` en la cohorte; sesiones = `Class(class_type=group)` + `ClassParticipant`. Cerrar (`close_cohort`), cancelar (libera cupos y cancela enrollments, `cancel_future_cohort_sessions`), migrar a individual (`release_cohort_seat`). Las cohortes sí validan disponibilidad del profesor (`is_within_teacher_availability`).

## Chat, tareas, materiales, reseñas, soporte

- Chat directo alumno–profesor (vínculo vía `TeacherProfile.students`) y grupal por cohorte; REST + WebSocket global (token en query); se puede desactivar globalmente (`assert_chat_enabled`); retención `chat_retention_days` (90). Email al profesor por mensaje nuevo si aplica.
- Materiales: subida a Cloudinary con validación de magic bytes; `application/pptx` no es MIME real (los `.pptx` de navegador probablemente fallan).
- Reseñas: solo sobre clases `completed`. Tareas: asignación, entrega, calificación con email.
- Soporte: tickets con notificaciones al staff y respuesta por email.

## Cuenta

- Contraseña 8–128 caracteres; contraseñas unicode muy largas funcionan (se verificó una de 240 bytes). Username 3–50, único, minúsculas en registro (login lo distingue: AUD-16). Email sin normalizar (AUD-17). Login con contraseña en cuenta solo-Google -> 401.
- Recuperación: respuesta idéntica exista o no el email; token de un solo uso con caducidad.
- `DELETE /users/me` anonimiza (no comprueba saldo/paquetes/clases).
- **Bloqueo por cuenta (Fase 13, A1):** `LOGIN_MAX_FAILED` (8) contraseñas erróneas seguidas bloquean el login de esa cuenta `LOGIN_LOCK_MINUTES` (15); durante el bloqueo responde 429 aunque la contraseña sea correcta. Un login correcto o restablecer la contraseña reinicia el contador. Compromiso conocido: tras el bloqueo se revela que la cuenta existe, y un tercero puede bloquear una cuenta ajena 15 min (el límite por IP de 10/min lo frena).
- Rate limits: login 10/min, register 5/h, forgot-* 5/h, reset 10/h, google 20/min, google/register 10/h, change-password 10/h; global por IP 200/min (SEC-01).

## Corrección de clases `no_show` automáticas (NEG-02)

- `finalize_past_classes`: una clase `finalized` cuyo fin fue hace más de **72 h** (`CLASS_STATUS_WINDOW_HOURS`) pasa sola a `no_show` y **consume el crédito** (`classes_used` +1). `confirmed` pasada -> `finalized` -> `no_show` se resuelve en la misma pasada si el job estuvo caído.
- Dentro de las 72 h el profesor cambia el estado directo (`PATCH /classes/{id}/status`); después queda bloqueado.
- Pasadas las 72 h, el profesor o `teacher_admin` pide corregirla con `POST /support/class-corrections` (`class_id`, `requested_status` = `completed` | `cancelled`, `reason` ≥ 10 caracteres). Solo clases propias, en `no_show`, no externas, y sin otra solicitud pendiente.
- Resuelve **solo el `superadmin`** con `PATCH /admin/support-tickets/{id}/resolve` + `decision` (`approved` | `rejected`). Aprobada `completed`: no cambia el crédito. Aprobada `cancelled`: se devuelve el crédito. Rechazada: la clase no cambia. Requiere migración Alembic `d1e2f3a4b5c6` (nuevo valor de enum `class_correction` y columnas `class_id`, `requested_status`, `decision`).

## Pagos: quién aprueba (NEG-01)

- `PATCH /payments/{id}/validate` solo para `superadmin` y `teacher_admin`. Los profesores normales reciben 403 y ven sus pagos como «pendiente de revisión».
- Un `teacher_admin` recibe 403 al validar pagos cuyo profesor es él mismo (`is_own_payment` en `/payments/pending-review` e `/history`); los resuelve el `superadmin`.
- `PATCH /admin/teachers/{id}/commission`: un `teacher_admin` no puede cambiar su propia comisión (403); sí la de otros.
- Retiros: un `teacher_admin` recibe 403 al procesar un retiro suyo (`withdrawal.teacher_id` = su perfil); lo resuelve el `superadmin`.
- Los pagos de Modo Dios (`POST /god-mode/payments`, `PATCH /god-mode/payments/{id}`) son solo del `superadmin` (Fase 16): un `teacher_admin` ya no puede crearse pagos `approved`. Los datos de pago (`PATCH /payments/config`) **sí** los puede editar el `teacher_admin` (decisión del propietario: se revirtió la restricción de la Fase 16).
- `POST /payments/manual-grant` (otorgamiento directo sin pago) es solo staff desde la Fase 20; los profesores lo piden y el staff aprueba (ver «Paquete gratis»).

## Reservas y concurrencia (Fase 2)

- El alumno solo reserva/reagenda dentro de la disponibilidad declarada del profesor (staff y profesor pueden saltarla).
- `pending_trial` y sesiones grupales ocupan la agenda del profesor.
- La duración reservada debe ser la del paquete.
- Reservas, reagendados y cancelaciones toman `FOR UPDATE` sobre alumno/profesor/clase (sin restricción de exclusión en BD).
- Una clase futura no puede marcarse `completed`/`no_show`. Si cancela el profesor por `PATCH status`, no se penaliza al alumno.
- Fechas sin zona horaria -> 422. Retiro mínimo $10. Usuario/email sin distinguir mayúsculas. Valor 0 válido en reglas de negocio. `commission_rate` NULL = 15 %.

## Seguridad (Fase 3a)
- **Email verificado:** retiros (`request-withdrawal`), pagos (`notify-payment`) e inscripción a cohortes exigen `is_verified`. Se puede entrar sin verificar; Google solo se vincula a cuentas verificadas.
- **Borrar cuenta:** exige contraseña (o solo el usuario si la cuenta es solo-Google) y bloquea mientras haya saldo en la billetera, retiros pendientes, clases futuras, paquetes con clases disponibles, pagos en revisión o alumnos con paquete activo (profesor).
- **Chipi/TTS:** mensajes ≤ 2000 caracteres, historial ≤ 20, solo roles user/assistant; 20/min y 300/día por usuario (IP si anónimo). TTS 60/min por usuario, batch 6/min.
- **Logs del frontend:** stack ≤ 8000, extra ≤ 4000, 30/min por IP.
- **Chat WS:** frames ≤ 20 000 caracteres y 20 envíos por 10 s por conexión.

## Sesión (Fase 3b, SEC-05)
- La sesión vive en cookies HttpOnly fijadas por el backend: `tpm_access` (JWT), `tpm_refresh` (opaco, solo viaja a `/api/v1/auth`) y `tpm_session` (marca para el proxy del frontend). Producción: `COOKIE_DOMAIN=.tuprofemaria.com`, SameSite=Lax, Secure.
- `POST /auth/refresh` rota el refresh token (en BD solo el hash). Reusar uno ya rotado fuera de 10 s se trata como robo y revoca toda la cadena; dentro de 10 s se tolera (dos pestañas).
- Cambiar o restablecer la contraseña, o borrar la cuenta, revoca todas las sesiones (al cambiarla, la actual recibe cookies nuevas).
- Peticiones que mutan y traen cookies con un `Origin` ajeno -> 403. Las que usan `Authorization: Bearer` no están sujetas.
- Transición: el backend sigue aceptando `Authorization: Bearer` y `?token=` en el WS, y devuelve `access_token` en el JSON; el frontend nuevo ya no los usa.

## Control de correos (Fase 7)
- Todo correo sale por `core/email.py::_send(..., category)`, que consulta `core/email_settings.py`. 32 plantillas, 14 categorías (13 apagables y la de **esenciales**).
- **Esenciales** (verificar email, restablecer contraseña, recuperar usuario): nunca se apagan (422 si se intenta) ni se pausan, ni siquiera al llegar al límite diario.
- Solo el `superadmin` ve y cambia la configuración (`GET/PUT /admin/email-settings`); `teacher_admin` recibe 403. Por defecto todo está encendido y el límite diario es 100 (cuota gratuita de Resend).
- Contador diario en `email_log` (día UTC): solo los `sent` cuentan para la cuota. Los `skipped` (categoría apagada, `modo_ahorro`, `limite_diario`) y los `failed` se anotan aparte y disparan el banner del panel.
- Al llegar a `daily_limit` solo salen las esenciales. **Modo ahorro** (apagado por defecto): al llegar a `auto_saver_percent` % del límite se pausan las categorías de probabilidad *muy alta* y *alta* hasta las 00:00 UTC.
- Si el control o el contador fallan, el correo **sale igual** (nunca se pierde un correo por un fallo de conteo).
- La probabilidad de agotar la cuota por categoría es una **estimación** a partir del código, no una medición.

## Idiomas que habla el usuario (Fase 8)
- Dato nuevo `users.spoken_languages` (JSONB, por defecto `[]`), común a alumno y profesor. **No** es `TeacherProfile.languages` (los idiomas que el profesor *enseña*, base de la búsqueda de profesores); guardar uno nunca toca el otro.
- Se edita con `PATCH /users/me` (`spoken_languages`); `GET /users/me` lo devuelve. Validación solo en el servidor (`core/spoken_languages.py`): máximo 10, cada uno de 2 a 40 caracteres, elegido del catálogo `spoken_languages` (editable por el superadmin en `system_catalogs`, distinto del catálogo `languages`), sin repetidos ni distinguiendo mayúsculas o tildes (422). Se guarda con la ortografía del catálogo. Lista vacía válida.
- **Terminar el onboarding** (`onboarding_completed` de falso a verdadero) exige al menos un idioma (422 si no hay). Quien ya lo había terminado antes de la Fase 8 no se ve afectado: solo recibe un aviso suave en su panel y en su perfil.
- **Foto de perfil del alumno (Fase 13):** terminar el onboarding de un **alumno** también exige que la cuenta tenga foto (`users.avatar`, subida antes o enviada en el mismo `PATCH /users/me`); si no, 422 «Sube una foto de perfil…». Los profesores no la necesitan para este paso. Antes solo lo exigía la pantalla.
- **Guía interactiva del menú (2026-11-24):** `users.tour_completed` (falso en cuentas nuevas; la migración `f28a1b2c3d4e` dejó en verdadero a todas las existentes). `PATCH /users/me {tour_completed}` lo guarda (true al terminar/saltar la guía, false para repetirla); no depende del onboarding ni se valida. Solo el frontend decide a quién se muestra (alumno, profesor, teacher_admin; no superadmin).
- Quién lo ve: el perfil público del profesor (`GET /teachers/`, `/teachers/{username}`, landing) y el propio usuario; el de un alumno solo lo ve su profesor (`GET /teachers/me/students-full`). Ningún otro endpoint lo expone.
- Si la fila del catálogo no existe todavía (migración sin aplicar) se usa una lista por defecto en el código.

## Idiomas con nivel (Fase 10, amplía la Fase 8)
- Cada idioma que habla el usuario lleva un **nivel obligatorio**: `native` (nativo), `fluent` (fluido), `intermediate` (intermedio) o `basic` (básico). Formato guardado y devuelto: `[{"language": "Inglés", "level": "fluent"}]`.
- Al **guardar** (`PATCH /users/me`) se exige objeto `{language, level}` por idioma (422 si falta o es inválido el nivel; un texto suelto ya no vale). Terminar el onboarding exige ≥ 1 idioma, cada uno con su nivel.
- Datos de la Fase 8 (textos sueltos): se **leen** como `{language, level: null}` y la interfaz pide completar el nivel; no hay migración de datos.
- Directorio: `GET /teachers/?speaks=<idioma>` devuelve solo profesores aprobados que hablan ese idioma (sin distinguir mayúsculas ni tildes; vacío = sin filtro; máx. 40 caracteres) y se combina con `subject` y `language` (idioma que enseñan).
- Política de privacidad actualizada el 17 de noviembre de 2026 (nivel por idioma; versión en inglés añadida).

## Rendimiento, correos y cuotas (Fase 9)
- **Jobs por vencimiento:** finalizar clases, Meet, recordatorios, resumen de chat y sincronización de Calendar se programan para la hora exacta en que hay algo que hacer (ver `ARCHITECTURE.md`). Consecuencia visible: una clase se finaliza al terminar, no «dentro de los próximos 10 min»; el link de Meet sale justo al entrar en la ventana.
- **Fallos de un job por vencimiento (Fase 13, A6):** si un job falla (o alguno de sus elementos: recordatorio o Meet que no se pudo enviar/generar), se registra en la pantalla de Logs del admin («Job «x» falló (intento N de 5)») y se reintenta con espera creciente: `min_gap` x 2^(fallos-1), con tope de 6 h. A los 5 fallos seguidos deja de insistir hasta 24 h después y lo anota. La primera ejecución correcta reinicia el contador. El contador vive en memoria (un reinicio del proceso lo pone a 0).
- **Etapa de reserva sin escribir en GET:** `GET /payments/booking-status` y `GET /users/me/teachers` calculan la etapa sin cancelar nada (`heal=False`; si el paquete activo no se pagó ni tiene pago en revisión devuelven `needs_package` y `/me/teachers` oculta ese enrollment). Los POST (`book`, elegir paquete) siguen cancelándolo. Un barrido diario cancela los enrollments individuales `active` + `unpaid` de más de 24 h sin pago en revisión (los de cohorte no).
- **Aviso de chat al profesor, agrupado:** la regla de reactivación no cambia (`chat_reactivation_hours`: solo el mensaje de un alumno tras una conversación inactiva avisa), pero el correo sale `CHAT_DIGEST_DELAY_MINUTES` (10) después y **un solo correo por profesor**: si solo hay una conversación con mensajes sin leer, el correo de siempre; si hay varias, un resumen. Si el profesor ya leyó los mensajes en ese rato, no se envía nada.
- **Recordatorios de clase (Fase 27):** un único aviso por clase no cancelada ni externa (`confirmed`/`pending`/`pending_trial`) que empieza en las próximas 25 h y a más de 30 min, mientras `reminder_sent_at` sea nulo (idempotente). Una reserva con menos de 23 h de antelación lo recibe en el siguiente tick del job; una reservada con 24 h recibe uno solo; con menos de 30 min de margen no se avisa; no hay recordatorio de 1 h. Cada alumno recibe su aviso; el profesor recibe **un correo** con todas sus clases del tick (uno solo si es una). El texto dice «24 horas» en la ventana 23–25 h y las horas reales si no. Respeta la categoría `class_reminders` y el límite diario como siempre.
- **Zona horaria nunca nula (Fase 27):** `timezone` explícito `null`/vacío en el PATCH del perfil de profesor o alumno (y en `/users/me`) da 422; omitirlo vale. Las filas antiguas con NULL se leen con el fallback de siempre.
- **Cuota de materiales:** 500 MB por profesor (`MATERIALS_QUOTA_MB`; 0 = sin límite) sobre los materiales activos con archivo; subir uno que la supere da 413 sin llamar a Cloudinary; eliminar un material libera su espacio. `GET /materials/quota` devuelve `{used_bytes, limit_bytes, unlimited, remaining_bytes}`.
- **Paginación:** `limit` (defecto 200, máx. 500) y `offset` + cabecera `X-Total-Count` en los listados de pagos, retiros, tickets propios, alumnos del profesor, conversaciones, clases y cohortes, y (Fase 11) en los listados de apoyo del Modo Dios; en `my-classes`/clases del profesor y conversaciones los contadores siguen siendo del total.
- **Retención:** `error_logs` 30 días y `email_log` 60 días (job diario 03:05 UTC).
- **Solapes de cohorte (Fase 19):** al crear una sesión de cohorte (`_create_group_session`) y al auto-unir a un alumno a sesiones futuras tras aprobar su pago, se omite al alumno que ya tiene otra clase (con cualquier profesor, incl. `pending_trial`/`pending`/`confirmed`) o participa en otra sesión grupal a esa hora (`app/core/student_overlap.student_has_overlap`; del lado del alumno NO cuenta el margen de preparación del profesor). La respuesta de `POST /cohorts/{id}/sessions` incluye `skipped_participants` (opcional) y el omitido no recibe correo. Los choques del profesor en cohortes cuentan `pending_trial` (igual que `can_book_slot`) y usan cota inferior de 3 h; la creación toma `lock_booking_rows`.
- **Google Calendar y Preply (Fase 17):** las clases `external` (Preply) son de solo lectura: se importan (dedupe por `google_event_id`, único por profesor) pero la sync nunca las escribe en Google. **Regla: detener la sync (desconectar, token revocado/expirado, reconectar con otra cuenta) nunca cancela nada** (ni clases ni eventos de Google); solo se avisa al profesor si Google rechaza el acceso. Al desconectar se conservan `google_event_id`/`google_sync_hash`; al reconectar con otra cuenta se limpian en las clases propias para re-publicarlas sin borrar el calendario viejo. Con la sync activa sí se refleja el espejo (una `external` borrada en Google se cancela). Una cuenta de Google solo puede estar conectada a un profesor; se usa siempre el calendario `primary`. Reservar o reagendar comprueba el hueco exacto en Google (si responde; si no, se permite y se registra). `GET /availability/*/slots` limita 120/min por IP.

## Seguridad de cuenta y comunicación (Fase 21)
- **Email:** se guarda y compara en minúsculas. Cambiarlo deja la cuenta sin verificar, envía el enlace al correo nuevo y cierra las demás sesiones; las cuentas con Google no pueden cambiarlo. Verificar el email cierra las sesiones abiertas antes.
- **Usuario:** `^[a-z0-9_.-]{3,30}$`, minúsculas, sin nombres reservados (admin, soporte, root, api…); único sin distinguir mayúsculas. Nombre y apellido: letras, espacios, guion y apóstrofe, máx. 60.
- **Correos:** todo dato del usuario se escapa antes de entrar en una plantilla; el asunto es texto plano sin saltos.
- **Recuperación de cuenta:** forgot-password/username responden siempre igual y envían el correo en segundo plano.
- **Borrar cuenta de profesor:** perfil `suspended`, video/materiales borrados de Cloudinary, paquetes desactivados, token de Google borrado, datos de destino de retiros y de reembolsos borrados; no se cancela ninguna clase ni evento de Google. Los usuarios inactivos no aparecen en listados públicos.
- **Subidas:** avatar solo imagen (<= 5 MB); video solo video (<= 100 MB); la extensión sale del tipo validado; límite por usuario. Primer video (o perfil no aprobado): flujo de onboarding (`video_url`, perfil `pending`). Profesor aprobado con video: el nuevo queda en `video_pending_url/public_id`, el anterior sigue público; el staff recibe correo+notificación solo al crearse un pendiente (un reintento reemplaza el pendiente y borra su archivo anterior). Staff (`get_current_staff`; un teacher_admin no su propio video, 403) aprueba (`PATCH /admin/teachers/{id}/pending-video/approve`: promueve y borra el viejo) o rechaza con motivo (`.../reject`: marca el pendiente como rechazado y lo conserva, avisa al profesor por correo+notificación). El profesor puede apelar el video rechazado hasta 2 veces (`appeal_count >= 2` lo impide; `POST /teachers/me/appeal`, `kind='video'`); al resolver (`PATCH /admin/appeals/{id}/resolve`) aprobar promueve el pendiente y borra el viejo, rechazar borra el pendiente. Subir otro video reemplaza el pendiente rechazado (y vuelve a avisar al staff). Un teacher_admin no resuelve apelaciones sobre su propio perfil (403). Nunca se expone el pendiente en endpoints públicos.
- **Baneo/desactivación/borrado de cuenta:** cierran los websockets de chat del usuario (código 4401).
- **TTS de vocabulario:** profesor dueño, alumno asignado o superadmin; máx. 50 palabras por petición; 6/min y 60/día por usuario.
- **Soporte:** 5 tickets/hora por usuario (tickets y correcciones de clase); `teacher_admin` ve sus propios tickets.
- **Flow Tester:** solo superadmin y con `FLOW_TESTS_ENABLED=true`.

## Dinero (Fase 20)

- **Reembolsos = lo realmente pagado.** `refundable = Σ pagos aprobados no manuales del enrollment − reembolsos aprobados o pendientes`. Todo reembolso (profesor suspendido, grupo cancelado, bajada de paquete) se limita a eso; sin nada reembolsable -> 400. Profesor suspendido: exige pago aprobado y reembolsa lo pagado (sin uso) o `min(pagado/clases, precio por clase) × clases sin usar`. Grupo cancelado: todo lo reembolsable. Al aprobar un reembolso se vuelve a comprobar el tope.
- **Billetera atómica** (`app/core/wallet.py::wallet_apply`): `UPDATE col = col + x` con guarda `saldo + x >= 0`; la usan aprobar pago, reembolso, retiros y Modo Dios. CHECK `available_balance >= 0` en la BD.
- **Importes:** columnas de dinero `NUMERIC(12,2)` (`Money`, `asdecimal=False`: en Python y en el JSON siguen siendo `float`). Los importes de entrada rechazan NaN/inf (422); comisión 0–1.
- **Modo Dios:** editar un pago aprobado respeta la tasa congelada (`amount_teacher / amount_total`), no la comisión actual; si revertir o bajar el monto dejaría la billetera negativa -> 409; los reembolsos no se editan (monto/estado).
- **Estadísticas:** `total_revenue` excluye reembolsos y otorgamientos manuales.
- **`GET /payments/config`:** requiere sesión; `default_commission_rate` solo para staff (`null` para el resto); no crea la fila.
- `WithdrawalResponse` incluye `destination_details`, `rejection_reason`, `reference`, `processed_at`; `request-withdrawal` guarda `destination_method`.

## Estados de clase y matrícula (Fase 22)

- **Transiciones** (`CLASS_STATUS_TRANSITIONS`): abiertas (`pending`, `pending_trial`, `pending_payment`) a `confirmed`/`cancelled`/`completed`/`no_show`; `confirmed` a `cancelled`/`completed`/`no_show`/`finalized`; `finalized` a `completed`/`no_show`; `completed` y `no_show` entre sí y a `finalized`; `cancelled`/`expired`/`rescheduled`: ninguna. Reabrir una clase terminada o cancelada solo se hace reagendando. No se cancela una clase ya terminada o pasada. Todo cambio sobre clases terminadas respeta la ventana de 72 h.
- **Reagendar un `no_show`** (profesor/admin) a `confirmed` resta el crédito ya contado (`classes_used` -1).
- **Ciclo del paquete:** renovar o cambiar reinicia `classes_used` y `activated_at`; las clases anteriores a ese instante no suman al contador nuevo ni completan el enrollment.
- **Reservar:** `active`, `pending_package_change` y `pending_renewal` permiten usar los créditos pagados que sobran.
- **Renovar** exige el paquete actual totalmente pagado. **Cambio cancelado** anula su pago pendiente; aprobar un `package_change` sin cambio solicitado da 409.
- **Cohorte cancelada:** los enrollments quedan `cancelled` conservando `cohort_id`; el alumno pide el reembolso (tope = lo pagado) y la etapa es `needs_group_refund` hasta entonces.
- **Prueba sin confirmar:** al terminar pasa a `finalized` (con aviso al profesor); a las 72 h sin marcar pasa a `no_show` como cualquier clase (decisión del dueño).
- **Tareas:** solo se califica una entrega enviada de una tarea activa, con nota obligatoria.
