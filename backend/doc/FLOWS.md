# Flujos de punta a punta (qué endpoint/función interviene)

Rutas completas con rol y archivo:línea: `generated/API_REFERENCE.md`. Reglas: `BUSINESS_RULES.md`.
Todas las rutas llevan prefijo `/api/v1`.

## 1. Registro y login
1. `POST /auth/register` (`auth.py` `register`) -> crea `User` + `StudentProfile` o `TeacherProfile` (`pending`); email de bienvenida.
2. `POST /auth/login` (`login`) con `login` = username **o** email -> `{access_token}` JWT (claims `sub`=user id, `role`, `exp` 7 días).
3. Google: `POST /auth/google` (GSI id_token; si el email existe -> login y vincula `google_id`; si no -> pide completar) y `POST /auth/google/register`.
4. Recuperar: `/auth/forgot-password` -> email con token -> `/auth/reset-password`; `/auth/forgot-username`.
5. Frontend guarda el token en cookie `access_token` (js-cookie) y en `authStore`; `proxy.ts` redirige por rol.

## 2. Alta y aprobación de profesor
Registro `teacher` -> onboarding (`/teacher/onboarding`: perfil, vídeo, zona horaria, disponibilidad) -> staff cambia estado en `admin.py` (`/admin/teachers/...`) -> email `send_teacher_status_update_email`. Solo `approved` recibe reservas.

## 3. Prueba -> paquete -> clases (alumno)
1. **Prueba**: reservada por el alumno con `POST /payments/book` (si su etapa es `needs_trial` se crea la prueba) o por staff con `POST /classes/trial` `class_type=trial`, estado `pending_trial`/`confirmed`. Tras `completed` -> etapa `needs_package`.
2. **Comprar**: `POST /payments/notify-payment` `{type:"package", package_id, payment_method, [installment_index], [credits_requested]}` crea `Enrollment` (`unpaid`) + `Payment` (`pending_review`) con `amount_total`. Email al staff.
3. **Aprobar**: `PATCH /payments/{id}/validate` `{action:"approve"}` (staff o profesor del alumno) -> `_apply_commission` (comisión), acredita `TeacherWallet`, `Enrollment.unlocked_credits`/`status=active`/`payment_status`, email recibo. Rechazar: `{action:"reject", rejection_reason}` -> email de fallo.
4. **Agendar**: `POST /payments/book` (`payments.py` `book_class`) -> `can_book_slot` -> `Class(regular, confirmed)`; email al alumno y al profesor; evento Calendar si el profesor lo conectó (`calendar_sync.sync_class_created`).
5. **Meet**: job `generate_upcoming_meet_links` crea el link unos 30 min antes (`meet_link_autogen_minutes`).
6. **Después de la clase**: job `finalize_expired_classes` -> `finalized`; el profesor la marca `completed`/`no_show` con `PATCH /classes/{id}/status`; `update_enrollment_counter` actualiza `classes_used` y puede pasar el enrollment a `completed`.

## 4. Cancelar / reagendar
- Alumno cancela: `DELETE /classes/{id}` -> `can_cancel_class` (≥12 h) -> `cancel_class_and_refund` (devuelve crédito).
- Profesor cancela: `DELETE /classes/teacher/{id}` (siempre devuelve crédito).
- Staff cancela: `cancel_class_admin` (no notifica a participantes grupales).
- Reagendar: `PATCH /classes/{id}/reschedule` (alumno, regla 12 h), `reschedule_class_teacher`, y variante admin (`classes.py` ~418/780/833). Estado resultante: `resolve_status_after_reschedule`. Ninguno valida disponibilidad declarada (AUD-01).

## 5. Renovación y cambio de paquete
`notify-payment` con `type`: `renewal` (mismo enrollment, AUD-03), `package_change` (upgrade: paga diferencia; downgrade/`full_refund`: pide `payment_info`), `unlimited_recharge` (más créditos prepagados). Al aprobar (`validate_payment`) se aplican créditos/estado. Endpoints heredados `/packages/request-renewal`, `/request-package-change`, `/{id}/cancel-package-change` **no los usa el frontend** (código muerto con menos protecciones).

## 6. Dinero del profesor
Billetera `TeacherWallet` (`available_balance`, `total_earned`, `total_withdrawn`) se acredita al aprobar pagos. Retiro: `POST /payments/request-withdrawal` -> staff `POST /payments/admin/withdrawals/{id}/process` (`complete`/`reject`) -> email `send_withdrawal_processed_email`. `GET /payments/admin/withdrawals/pending` **sin decorador, devuelve 404** (AUD-12).

## 7. Cohortes (grupal)
Profesor crea cohorte (`cohorts.py`) -> alumnos se inscriben (Enrollment ligado a la cohorte, pago como paquete) -> al llegar al mínimo o cierre manual (`close_cohort`) se generan sesiones `Class(group)` + `ClassParticipant` -> cancelar (`cancel_cohort`) libera cupos, cancela futuras (`cancel_future_cohort_sessions`) y avisa. Migrar a individual: `release_cohort_seat`.

## 8. Disponibilidad y slots
Profesor edita semanal/excepciones (`availability.py`); alumno pide slots (`GET /availability/slots` requiere login) -> `get_available_slots_utc` resta clases ocupadas y buffer; el frontend (`lib/scheduleUtc.ts`, `lib/tzFormat.ts`) convierte a hora local. `/availability/featured-teacher/slots` roto para alumnos (AUD-20).

## 9. Calendar / Meet
Profesor conecta Google Calendar (`calendar.py` OAuth; `state`=id de perfil sin verificar) -> `sync_calendar_logic` (30 min) lee busy e importa eventos externos (Preply, etc.) como `Class(external)`; eventos creados por la plataforma se marcan con `extendedProperties` para no reimportarlos.

## 10. Chat
`/chat/...` REST (listar, mensajes, leer) + WebSocket global (`chat_ws.py`, `ChatConnectionManager`). Direct: `get_direct_conversation_or_404`; grupal por cohorte. Entrega/lectura con `mark_delivered_by_id`/`mark_read`; reconexión `catch_up_deliveries`.

## 11. Chipi (IA) y TTS
`POST /chipi/chat` (anónimo permitido) arma system prompt por rol/pantalla (`core/chipi/*`, contexto en vivo desde BD) y llama a OpenAI. `/tts/*` genera audio de palabras y lo cachea en Cloudinary (`TTS_CACHE_FOLDER`).

## 12. Admin / God Mode
`admin.py`: profesores, comisiones, config de plataforma/pagos, catálogos, tickets, notificaciones, logs. `god_mode.py`: edición directa de entidades con motivo obligatorio y auditoría (`log_god_mode_action` -> `god_mode_audit`); `teacher_admin` limitado a sus datos; editar un pago revierte la billetera.

## 13. Errores y logs
Excepciones -> `error_logs` (`core/error_log.py`); frontend reporta a `POST /logs/frontend` (anónimo, sin tope: SEC-06); UI admin `/admin/logs`.
