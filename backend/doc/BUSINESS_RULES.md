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
**Una sola prueba por profesor:** una prueba `finalized` (ya pasó, sin marcar) sigue en `trial_in_progress`; una prueba `no_show` (el alumno faltó, o pasaron 72 h sin marcarla) cuenta como prueba usada y lleva a `needs_package`, igual que `completed` (decisión del dueño, 2026-11-17).
Endpoint: `GET /payments/booking-status?teacher_username=`. **Efecto lateral:** cancela enrollments `unpaid` sin pago pendiente (escribe en un GET).

## Clases

Tipos: `trial` (no consume paquete; 25 min por defecto), `regular` (consume crédito), `group` (sesión grupal; `student_id` NULL, alumnos en `ClassParticipant`), `external` (importada de Google Calendar, sin alumno ni crédito).
Estados vivos: `pending_trial`, `confirmed`; terminales: `completed`, `cancelled`, `no_show`, `finalized` (confirmada ya pasada sin resolver). Estados heredados que ya no se producen pero siguen en validadores/`UPCOMING_STATUSES`: `pending`, `pending_payment`, `expired`, `rescheduled`.

### Duraciones y márgenes (configurables en `PlatformConfig`, defaults en `class_logic.py`)

- Opciones globales `[25, 50, 80, 110]`; regular/paquete por defecto `[50, 80, 110]`; prueba 25 min.
- **Buffer** (descuenta del final real, ocupa agenda): prueba 5 min, regular 10, grupal 10. Verificado: clase 10:00–10:50 bloquea hasta 11:00; 10:55 da 409, 11:00 OK.
- Antelación mínima para reservar: 1 h. Cancelar el alumno: ≥12 h. Reagendar el alumno: ≥12 h; staff: 0.
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
- **Recordatorios de clase:** cada alumno recibe su aviso por clase; el profesor recibe **un correo** con todas sus clases de la ventana de 23–25 h (uno solo si es una).
- **Cuota de materiales:** 500 MB por profesor (`MATERIALS_QUOTA_MB`; 0 = sin límite) sobre los materiales activos con archivo; subir uno que la supere da 413 sin llamar a Cloudinary; eliminar un material libera su espacio. `GET /materials/quota` devuelve `{used_bytes, limit_bytes, unlimited, remaining_bytes}`.
- **Paginación:** `limit` (defecto 200, máx. 500) y `offset` + cabecera `X-Total-Count` en los listados de pagos, retiros, tickets propios, alumnos del profesor, conversaciones, clases y cohortes, y (Fase 11) en los listados de apoyo del Modo Dios; en `my-classes`/clases del profesor y conversaciones los contadores siguen siendo del total.
- **Retención:** `error_logs` 30 días y `email_log` 60 días (job diario 03:05 UTC).
