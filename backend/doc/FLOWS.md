# Flujos de punta a punta (qué endpoint/función interviene)

Rutas completas con rol y archivo:línea: `generated/API_REFERENCE.md`. Reglas: `BUSINESS_RULES.md`.
Todas las rutas llevan prefijo `/api/v1`.

## 1. Registro y login
1. `POST /auth/register` (`auth.py` `register`) -> crea `User` + `StudentProfile` o `TeacherProfile` (`pending`); email de bienvenida.
2. `POST /auth/login` (`login`) con `login` = username **o** email (sin distinguir mayúsculas) -> cookies HttpOnly `tpm_access` (JWT: `sub`, `role`, `exp`; `ACCESS_TOKEN_EXPIRE_MINUTES`, 7 días por defecto hasta cerrar la transición, 30 min previstos) y `tpm_refresh` (30 días, rotación con detección de reutilización en `refresh_tokens`). El token también va en el JSON y se acepta como Bearer durante la transición (SEC-05).
3. Google: `POST /auth/google` (GSI id_token con `iss` y `email_verified` comprobados; si el email existe y está verificado -> login y vincula `google_id`; si no -> pide completar) y `POST /auth/google/register`.
   Verificación de email: enlace de 24 h al registrarse (`/auth/verify-email`, `/auth/resend-verification`); retiros, pagos y cohortes la exigen.
4. Recuperar: `/auth/forgot-password` -> email con token -> `/auth/reset-password` (revoca las sesiones); `/auth/forgot-username`. Renovar: `POST /auth/refresh`; salir: `POST /auth/logout`.
5. El frontend no ve el token (cookie HttpOnly): guarda el usuario en `authStore` y `proxy.ts` decide con las cookies `tpm_access` (rol) y `tpm_session` (hay refresh vigente). Un 401 intenta `/auth/refresh` una vez antes de mandar al login (F4).

## 2. Alta y aprobación de profesor
Registro `teacher` -> onboarding (`/teacher/onboarding`: perfil, vídeo, zona horaria, disponibilidad) -> staff cambia estado en `admin.py` (`/admin/teachers/...`) -> email `send_teacher_status_update_email`. Solo `approved` recibe reservas.

## 3. Prueba -> paquete -> clases (alumno)
1. **Prueba**: reservada por el alumno con `POST /payments/book` (si su etapa es `needs_trial` se crea la prueba) o por staff con `POST /classes/trial` `class_type=trial`, estado `pending_trial`/`confirmed`. Tras `completed` -> etapa `needs_package`.
2. **Comprar**: `POST /payments/notify-payment` `{type:"package", package_id, payment_method, [installment_index], [credits_requested]}` crea `Enrollment` (`unpaid`) + `Payment` (`pending_review`) con `amount_total`. Email al staff.
3. **Aprobar**: `PATCH /payments/{id}/validate` `{action:"approve"}` (solo `superadmin` y `teacher_admin`; los pagos de los alumnos del propio `teacher_admin` los aprueba el `superadmin`: NEG-01; los profesores solo ven «pendiente de revisión») -> `_apply_commission` (comisión), acredita `TeacherWallet`, `Enrollment.unlocked_credits`/`status=active`/`payment_status`, email recibo. Rechazar: `{action:"reject", rejection_reason}` -> email de fallo.
4. **Agendar**: `POST /payments/book` (`payments.py` `book_class`) -> bloqueo de fila de alumno y profesor -> `can_book_slot` (choques, antelación y disponibilidad declarada) -> `Class(regular, confirmed)`; email al alumno y al profesor; evento Calendar si el profesor lo conectó (`calendar_sync.sync_class_created`).
5. **Meet**: el job `generate_meet_links` (por vencimiento) crea el link `meet_link_autogen_minutes` antes de la clase (30 por defecto); se programa para esa hora exacta, sin sondeo.
6. **Después de la clase**: el job `finalize_expired_classes` (se despierta al terminar la clase) -> `finalized`; el profesor la marca `completed`/`no_show` con `PATCH /classes/{id}/status` dentro de 72 h; si no, pasa sola a `no_show` y el profesor puede pedir la corrección con un ticket (NEG-02). Las clases `external` se quedan en `finalized`. `update_enrollment_counter` actualiza `classes_used` y puede pasar el enrollment a `completed`.
7. **Una prueba por profesor**: una prueba `finalized` sigue «en curso» y una `no_show` cuenta como usada (lleva a elegir paquete).

## 4. Cancelar / reagendar
- Alumno cancela: `DELETE /classes/{id}` -> `can_cancel_class` (≥12 h) -> `cancel_class_and_refund` (devuelve crédito una sola vez).
- Profesor cancela: `DELETE /classes/teacher/{id}` (siempre devuelve crédito).
- Staff cancela: `cancel_class_admin` (no notifica a participantes grupales).
- Reagendar: `PATCH /classes/{id}/reschedule` (alumno: regla 12 h, dentro de la disponibilidad declarada y nunca una clase ya pasada), `PATCH /classes/teacher/{id}/reschedule` (también `finalized` y `no_show`) y variante admin. Estado resultante: `resolve_status_after_reschedule`.

## 5. Renovación y cambio de paquete
`notify-payment` con `type`: `renewal` (mismo enrollment; suma los créditos sobrantes), `package_change` (upgrade: paga diferencia; downgrade/`full_refund`: pide `payment_info`), `unlimited_recharge` (más créditos prepagados). Al aprobar (`validate_payment`) se aplican créditos/estado. Endpoints heredados `/packages/request-renewal`, `/request-package-change`, `/{id}/cancel-package-change` **no los usa el frontend** (código muerto con menos protecciones).

## 6. Dinero del profesor
Billetera `TeacherWallet` (`available_balance`, `total_earned`, `total_withdrawn`) se acredita al aprobar pagos. Retiro: `POST /payments/request-withdrawal` -> staff `POST /payments/admin/withdrawals/{id}/process` (`complete`/`reject`) -> email `send_withdrawal_processed_email`. `GET /payments/admin/withdrawals/pending` lista los retiros pendientes.

## 7. Cohortes (grupal)
Profesor crea cohorte (`cohorts.py`) -> alumnos se inscriben (Enrollment ligado a la cohorte, pago como paquete) -> al llegar al mínimo o cierre manual (`close_cohort`) se generan sesiones `Class(group)` + `ClassParticipant` -> cancelar (`cancel_cohort`) libera cupos, cancela futuras (`cancel_future_cohort_sessions`) y avisa. Migrar a individual: `release_cohort_seat`.

## 8. Disponibilidad y slots
Profesor edita semanal/excepciones (`availability.py`); alumno pide slots (`GET /availability/slots` requiere login) -> `get_available_slots_utc` resta clases ocupadas y buffer; el frontend (`lib/scheduleUtc.ts`, `lib/tzFormat.ts`) convierte a hora local. `/availability/featured-teacher/slots` va declarada antes de `/{teacher_username}/slots` (si no, esta la tapa).

## 9. Calendar / Meet
Profesor conecta Google Calendar (`calendar.py` OAuth; `state` firmado y con caducidad) -> `sync_calendar_logic` (job por vencimiento: cada 30 min con clase en curso o en las próximas 3 h, si no cada 6 h, y nada sin profesores conectados) lee busy e importa eventos externos (Preply, etc.) como `Class(external)`; eventos creados por la plataforma se marcan con `extendedProperties` para no reimportarlos.

## 10. Chat
`/chat/...` REST (listar, mensajes, leer) + WebSocket global (`chat_ws.py`, `ChatConnectionManager`; autentica por cookie, tope de 20 000 caracteres y 20 envíos/10 s). El aviso por email al profesor sale agrupado 10 min después (`core/chat_digest.py`). Direct: `get_direct_conversation_or_404`; grupal por cohorte. Entrega/lectura con `mark_delivered_by_id`/`mark_read`; reconexión `catch_up_deliveries`.

## 11. Chipi (IA) y TTS
`POST /chipi/chat` (anónimo permitido; mensaje ≤ 2000, historial ≤ 20 solo `user`/`assistant`, 20/min y 300/día) arma system prompt por rol/pantalla (`core/chipi/*`, contexto en vivo desde BD) y llama a OpenAI. `/tts/*` genera audio de palabras y lo cachea en Cloudinary (`TTS_CACHE_FOLDER`).

## 12. Admin / God Mode
`admin.py`: profesores, comisiones, config de plataforma/pagos, catálogos, tickets, notificaciones, logs. `god_mode.py`: edición directa de entidades con motivo obligatorio y auditoría (`log_god_mode_action` -> `god_mode_audit`); `teacher_admin` limitado a sus datos; editar un pago revierte la billetera.

## 13. Errores y logs
Excepciones -> `error_logs` (`core/error_log.py`, purga a los 30 días); frontend reporta a `POST /logs/frontend` (anónimo, 30/min, stack ≤ 8000 y extra ≤ 4000: SEC-06); UI admin `/admin/logs`. Cada respuesta lleva `Server-Timing` y las peticiones lentas (`SLOW_REQUEST_MS`) se avisan en el log.
