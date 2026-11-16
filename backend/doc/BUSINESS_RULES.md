# Reglas de negocio vigentes (comportamiento ACTUAL, no el deseado)

Verificado con `tests/audit` salvo donde se indica. Los bugs conocidos que contradicen estas reglas están en `KNOWN_ISSUES.md`.

## Roles

| Rol | Puede |
|---|---|
| `student` | reservar, pagar (notificar), cancelar/reagendar sus clases, tareas, reseñas, chat, soporte |
| `teacher` | su agenda, disponibilidad, paquetes, alumnos, estados de sus clases, **validar pagos de sus alumnos**, billetera y retiros, materiales/tareas |
| `teacher_admin` | todo lo de `teacher` + panel staff (`get_current_staff`): pagos, retiros, config, comisiones (ver SEC-03), God Mode solo sobre sus propios datos |
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
- `finalize_past_classes`: `confirmed` pasada -> `finalized` (no cuenta como completada hasta que el profesor la marque); no confirmada pasada -> `no_show`. Corre por job cada 10 min y en cada `GET my-classes`.
- `StudentProfile.total_completed_classes` (contador de por vida) se sincroniza con `sync_student_lifetime_class_counter`.

## Paquetes y créditos

- Paquete finito: `classes_count`, `price`, `price_per_class` (obligatorio, `price_per_class × classes_count == price`), `duration_minutes`. Ilimitado: `classes_count = NULL`, se compran **créditos prepagados** (`credits_requested`, ≥1) a precio unitario; `prepaid_unlimited_credits` baja al agendar y sube al cancelar; recarga con tipo `unlimited_recharge` (`credits_requested ≤ 0` hoy se acepta: AUD-21).
- Comprar exige haber **completado la prueba** con ese profesor (si no, 400), paquete activo y del profesor (si no, 404).
- **Cuotas** (`allow_installments`, `installment_count`, `installment_amount`): cada cuota aprobada libera créditos proporcionales (`unlocked_credits`: 2 de 4 tras la 1ª, `payment_status=partially_paid`; tras la 2ª, 4 y `paid`). Sin cuota pagada no se pueden agendar los créditos restantes. Paquete sin cuotas + `installment_index` -> 400.
- Doble clic: la segunda notificación idéntica en <15 s se trata como duplicada (devuelve el pago existente); notificar con un paquete ya pagado -> 400.
- Pago rechazado: el alumno vuelve a `needs_package`, ve `last_rejected_payment.rejection_reason` y puede reintentar.
- **Renovación** (`type=renewal`): reutiliza el mismo enrollment. Si estaba agotado queda sin créditos tras aprobar (AUD-03); si estaba activo pierde los sobrantes (`unlocked_credits = 0`).
- **Cambio de paquete** (`type=package_change`): mismo paquete -> 400; **upgrade** cobra solo la diferencia (4 clases faltantes × `price_per_class` = 100 en el test; al aprobar `unlocked_credits` = nuevas clases); **downgrade/reembolso** exige `payment_info` con contacto (no vacío; solo espacios -> 422). `min_classes_before_package_change` (default 0) usa `classes_used`.
- `manual-grant` (profesor/staff da créditos sin pago): en paquete ilimitado da 0 créditos.

## Dinero

- Método de pago debe estar habilitado en `PaymentConfig` (banco, PayPal, Binance, pago móvil). `GET /payments/config` (público) lo expone.
- Aprobar (`PATCH /payments/{id}/validate`, acción `approve`): calcula comisión con `TeacherProfile.commission_rate` (**15 % por defecto**, 0–1), `amount_teacher = total − comisión`, `amount_platform = comisión`; acredita `TeacherWallet.available_balance` y `total_earned`. Ejemplos verificados: 100 -> 85/15; 33.33 -> 28.33/5.00; 0 % y 100 % funcionan.
- La comisión se **congela en el pago**: cambiarla después no altera pagos ya aprobados.
- Un pago no se aprueba dos veces. Rechazar exige `rejection_reason` y no acredita nada. Un alumno no puede validar; un profesor solo valida pagos de sus alumnos.
- `commission_rate` NULL rompe (AUD-11). `default_commission_rate` de la config **no se aplica** a profesores nuevos.
- **Reembolso**: pone `amount_teacher = 0` y **no descuenta** la billetera (AUD-14).
- **Retiros**: `POST /payments/request-withdrawal` (`amount > 0`, `payment_info`); no más que `available_balance` (con 85.00 disponible, 85.01 -> 400, 85.00 -> 201 y saldo 0.0); un solo retiro pendiente; el monto se reserva al solicitar. Staff `POST /payments/admin/withdrawals/{id}/process` con `complete` (suma `total_withdrawn`, guarda `reference`) o `reject` (devuelve saldo). Procesar dos veces -> 404 la segunda. Mínimo $10 solo en la UI (AUD-13). Listar pendientes está roto (AUD-12).

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

- Contraseña 8–128 caracteres; contraseñas unicode muy largas funcionan (se verificó una de 240 bytes). Username 3–50, único, minúsculas en registro (login lo distingue: AUD-16). Email sin normalizar (AUD-17). Login con cuenta solo-Google -> 500 (AUD-19).
- Recuperación: respuesta idéntica exista o no el email; token de un solo uso con caducidad.
- `DELETE /users/me` anonimiza (no comprueba saldo/paquetes/clases).
- Rate limits: login 10/min, register 5/h, forgot-* 5/h, reset 10/h, google 20/min, google/register 10/h, change-password 10/h; global por IP 200/min (SEC-01).
