# Reglas de negocio vigentes (comportamiento ACTUAL, no el deseado)

Verificado con `tests/audit` salvo donde se indica. Los bugs conocidos que contradicen estas reglas están en `KNOWN_ISSUES.md`.

## Roles

| Rol | Puede |
|---|---|
| `student` | reservar, pagar (notificar), cancelar/reagendar sus clases, tareas, reseñas, chat, soporte |
| `teacher` | su agenda, disponibilidad, paquetes, alumnos, estados de sus clases, ver sus pagos como «pendiente de revisión» (**no aprueba ni rechaza**: solo staff), billetera y retiros, materiales/tareas |
| `teacher_admin` | todo lo de `teacher` + panel staff (`get_current_staff`): pagos, retiros, config, comisiones; **no valida los pagos de sus propias clases ni cambia su propia comisión** (lo hace el `superadmin`), God Mode solo sobre sus propios datos |
| `superadmin` | todo el panel, config de plataforma, comisiones, retiros, God Mode global |

Registro (`POST /auth/register`) solo admite `student`/`teacher`; los roles privilegiados se rechazan. Un profesor nace `pending` y necesita aprobación staff (`approved`; también `suspended`, etc.).
Un usuario `is_active=False` o `is_banned` recibe 403 (login y con token existente). Token de usuario borrado -> 401.

## Etapas de reserva (por pareja alumno–profesor) — `get_student_booking_stage`

`needs_trial` -> `trial_in_progress` -> `needs_package` -> `package_pending_payment` -> `ready`;
más `needs_renewal`, `renewal_pending`, `needs_group_refund`. Cada profesor exige su propia prueba.
Endpoint: `GET /payments/booking-status?teacher_username=`. **Efecto lateral:** cancela enrollments `unpaid` sin pago pendiente (escribe en un GET).

## Clases

Tipos: `trial` (no consume paquete; 25 min por defecto), `regular` (consume crédito), `group` (sesión grupal; `student_id` NULL, alumnos en `ClassParticipant`), `external` (importada de Google Calendar, sin alumno ni crédito).
Estados vivos: `pending_trial`, `confirmed`; terminales: `completed`, `cancelled`, `no_show`, `finalized` (confirmada ya pasada sin resolver). Estados heredados que ya no se producen pero siguen en validadores/`UPCOMING_STATUSES`: `pending`, `pending_payment`, `expired`, `rescheduled`.

### Duraciones y márgenes (configurables en `PlatformConfig`, defaults en `class_logic.py`)

- Opciones globales `[25, 50, 80, 110]`; regular/paquete por defecto `[50, 80, 110]`; prueba 25 min.
- **Buffer** (descuenta del final real, ocupa agenda): prueba 5 min, regular 10, grupal 10. Verificado: clase 10:00–10:50 bloquea hasta 11:00; 10:55 da 409, 11:00 OK.
- Antelación mínima para reservar: 1 h. Cancelar el alumno: ≥12 h. Reagendar el alumno: ≥12 h; staff: 0.
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
- `manual-grant` (profesor/staff da créditos sin pago): en paquete ilimitado da 0 créditos.

## Dinero

- Método de pago debe estar habilitado en `PaymentConfig` (banco, PayPal, Binance, pago móvil). `GET /payments/config` (público) lo expone.
- Aprobar (`PATCH /payments/{id}/validate`, acción `approve`): calcula comisión con `TeacherProfile.commission_rate` (**15 % por defecto**, 0–1), `amount_teacher = total − comisión`, `amount_platform = comisión`; acredita `TeacherWallet.available_balance` y `total_earned`. Ejemplos verificados: 100 -> 85/15; 33.33 -> 28.33/5.00; 0 % y 100 % funcionan.
- La comisión se **congela en el pago**: cambiarla después no altera pagos ya aprobados.
- Un pago no se aprueba dos veces. Rechazar exige `rejection_reason` y no acredita nada. Un alumno no puede validar; un profesor solo valida pagos de sus alumnos.
- `commission_rate` NULL rompe (AUD-11). `default_commission_rate` de la config **no se aplica** a profesores nuevos.
- **Reembolso** (`payment_type=refund`): al aprobarlo se descuenta de la billetera del profesor **solo su parte** (`monto × neto/total` del último pago aprobado del enrollment, con la comisión congelada en ese pago; la plataforma asume la suya: 100 pagados -> 85 al profesor, reembolso de 100 descuenta 85). `amount_teacher`/`amount_platform` del reembolso quedan en negativo. Si el saldo del profesor no cubre su parte (ya retiró) se **bloquea** (400 «contacta con soporte»), tanto al pedirlo como al aprobarlo. **Plazo:** 7 días desde la aprobación del último pago real del enrollment, solo en reembolsos voluntarios (bajada de paquete con devolución); los reembolsos por profesor suspendido o grupo cancelado no tienen plazo.
- **Retiros**: `POST /payments/request-withdrawal` (`amount > 0`, `payment_info`); no más que `available_balance` (con 85.00 disponible, 85.01 -> 400, 85.00 -> 201 y saldo 0.0); un solo retiro pendiente; el monto se reserva al solicitar. Staff `POST /payments/admin/withdrawals/{id}/process` con `complete` (suma `total_withdrawn`, guarda `reference`) o `reject` (devuelve saldo). Procesar dos veces -> 404 la segunda. Mínimo $10 solo en la UI (AUD-13). Listar pendientes: `GET /payments/admin/withdrawals/pending`.

## Disponibilidad

Semanal: filas `TeacherAvailability` (`day_of_week`, `start_time_utc`, `end_time_utc` en UTC "HH:MM") + excepciones puntuales (vacaciones/bloqueos). Slots (`GET /availability/...`): rango disponible menos clases ocupadas (incluye `pending_trial`) con buffer. Cambiar zona horaria recalcula disponibilidad y preferencias (`schedule_recalc.py`); el cambio de horario de verano **no** se recalcula.

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
- `POST /payments/manual-grant` (dar créditos sin pago) sigue permitido a profesores para sus alumnos: no mueve dinero.

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
