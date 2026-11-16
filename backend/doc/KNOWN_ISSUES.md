# Bugs y deudas conocidos (estado a 2026-11-16, commit 848e6f3, NADA corregido aún)

Detalle y causas con archivo:línea en `../../ANALISIS.md` (§5–§8). Cada bug confirmado tiene un test `xfail(strict=True)` en
`backend/tests/audit/`: al corregirlo el test pasa a XPASS (falla la suite) -> quitar el `xfail`.
Severidad: 🔴 crítico · 🟠 alto · 🟡 medio · 🔵 bajo.

| ID | Sev | Resumen | Test | Estado |
|---|---|---|---|---|
| AUD-03 | 🔴 | Renovar paquete agotado deja `completed` sin créditos (`payments.py:1046/568`) | `test_findings::test_renewal_after_full_cycle_gives_new_credits` | abierto |
| AUD-01 | 🔴 | `book_class` y reagendados no validan disponibilidad del profesor | AUD-01 `test_booking_outside_teacher_availability_rejected`; AUD-06 (reagendar) `test_student_reschedule_outside_availability_rejected` | abierto |
| AUD-02 | 🔴 | Doble reserva: `pending_trial`/`group` no bloquean; sin lock ni constraint | `test_two_students_cannot_book_same_trial_slot` | abierto |
| AUD-12 | 🔴 | `get_pending_withdrawals` sin `@router.get` (`payments.py:2116`) -> 404 | `test_admin_can_list_pending_withdrawals` | abierto |
| AUD-14 | 🔴 | Reembolso no descuenta billetera del profesor | `test_refund_claws_back_teacher_wallet` | abierto |
| AUD-04 | 🟠 | Se puede completar una clase futura | `test_cannot_complete_future_class` | abierto |
| AUD-05 | 🟠 | `PATCH status=cancelled` penaliza al alumno aunque cancele el profesor | `test_teacher_status_cancel_does_not_penalize_student` | abierto |
| AUD-09 | 🟠 | `update_enrollment_counter` pisa `pending_renewal`/`cancelled` | `test_counter_update_keeps_pending_renewal_status` | abierto |
| AUD-07 | 🟠 | Duración no validada contra el paquete | `test_booking_duration_must_match_package` | abierto |
| AUD-08 | 🟡 | datetime naive -> 500 | `test_naive_datetime_does_not_crash` | abierto |
| AUD-10 | 🟡 | `get_business_rules` ignora el valor 0 (`or`) | `test_business_rules_accept_zero` | abierto |
| AUD-11 | 🟡 | `commission_rate` NULL -> TypeError | `test_commission_null_rate_falls_back_to_default` | abierto |
| AUD-13 | 🟡 | Mínimo de retiro ($10) solo en UI | `test_withdrawal_minimum_amount` | abierto |
| AUD-15 / SEC-03 | 🟠 | `teacher_admin` cambia su propia comisión; sin separación de funciones | `test_teacher_admin_cannot_change_own_commission` | abierto |
| AUD-16 | 🟡 | Login por username distingue mayúsculas | `test_login_username_case_insensitive` | abierto |
| AUD-17 | 🟡 | Email no normalizado (`A@x.com` ≠ `a@x.com`) | `test_email_case_duplicates_rejected` | abierto |
| AUD-18 | 🟡 | Reagendado grupal por profesor: falso conflicto (`student_id=None`) | skip (necesita cohorte) | sin reproducir |
| AUD-19 | 🟡 | Login con cuenta solo-Google -> 500 | `test_password_login_on_google_only_account_is_401` | abierto |
| AUD-20 | 🟡 | `/availability/featured-teacher/slots` pasa `Query` como `bypass_min_notice` -> 403 alumnos | `test_featured_teacher_slots_work_for_students` | abierto |
| AUD-21 | 🟡 | `unlimited_recharge` acepta `credits_requested` negativo (pago negativo) | `test_edge_cases::test_unlimited_recharge_negative_or_zero_rejected` | abierto (nuevo) |
| AUD-22 | 🔵 | Guarda anti doble clic (15 s) puede confundir la cuota 2 con la 1 si se notifica justo tras aprobar | `test_installments_unlock_credits_progressively` (envejece el pago para evitarlo) | abierto (nuevo) |
| AUD-23 | 🟠 | Sobre-reserva de créditos: 4 reservas simultáneas con 1 crédito libre se aceptan las 4 (sin lock de fila en `enrollments`). Confirmado en PostgreSQL real | `tests/audit/concurrency_live.py` (R2) | abierto (nuevo) |
| AUD-02b | 🟠 | Doble reserva del mismo horario con 2 alumnos simultáneos: 2 clases creadas (HTTP 201 ambos). Confirmado en PostgreSQL real | `concurrency_live.py` (R1) | abierto (confirma AUD-02) |
| SEC-01 | 🟠 | Rate-limit ve IP del proxy; memoria; falta `--proxy-headers` | — | abierto |
| SEC-02 | 🟠 | Chipi anónimo sin límites; `role` libre en history; TTS sin cuota | — | abierto |
| SEC-04 | 🟡 | Email sin verificar + vinculación Google sin `email_verified` | — | abierto |
| SEC-05 | 🟡 | JWT 7 d en cookie no HttpOnly, sin revocación, CSP `unsafe-inline` | — | abierto |
| SEC-06 | 🟡 | `/logs/frontend` anónimo sin tope (confirmado: acepta 200 KB), OAuth `state`, WS token en query, borrar cuenta, `application/pptx`, etc. | `test_error_logs_endpoint_accepts_anonymous_reports` (documenta) | abierto |

## Lógica sin ID
`finalized` no se auto-resuelve; doble contabilidad de créditos (`occupied` vs `classes_used`; el aviso de bajo crédito usa la segunda);
`get_student_booking_stage` escribe en un GET; `finalize_past_classes` en cada `GET my-classes`; rama muerta en `finalize_past_classes`;
`manual-grant` ilimitado = 0 créditos; `cancel_class_admin` no notifica grupales; sin idempotencia fuerte en `validate_payment`/`process_withdrawal_v2`;
`transaction_reference` no único; DST en disponibilidad recurrente; `default_commission_rate` nunca se aplica.

## Código muerto / deuda
Endpoints heredados `/packages/request-renewal`, `/request-package-change`, `/cancel-package-change`; docstring que cita `/cohorts/migrate-to-individual` (no existe);
`featured_teacher="mar12"` sin uso (`availability.py:488`, `next.config.ts`); `Enrollment.renewal_count`/`previous_enrollment_id`, `Class.payment_expires_at` sin uso;
imports duplicados en `availability.py`; `requirements.txt` UTF-16 con `opencode-*` y `pytest*`; app no arranca sin `OPENAI_API_KEY`;
jobs de 24 h/7 d pueden no correr con reinicios frecuentes; migraciones con prefijo `a1b2c3d4e5f6_*` duplicado; archivos gigantes (`payments.py` 2130 líneas).

## Decisiones de negocio pendientes (preguntadas al dueño, sin respuesta)
1. ¿`finalized` se auto-completa tras N horas o decide siempre el profesor?
2. Al renovar un paquete activo, ¿se arrastran los créditos sobrantes?
3. ¿Quién aprueba pagos/retiros y cambia comisiones: solo `superadmin` o también `teacher_admin`/profesor?
4. ¿Despliegue con más de un worker?
5. ¿Corregir por lotes quitando el `xfail` de cada test?

## Resultados de concurrencia en vivo (PostgreSQL/Neon, `python -m tests.audit.concurrency_live`)
- R1 mismo horario x2 alumnos: **FALLO** (2 clases). R2 créditos x4: **FALLO** (sobre-reserva).
- R3 aprobar el mismo pago x4: OK (la billetera se acredita una sola vez). R4 retiro simultáneo x4: OK (1 pendiente, saldo 0).
- R5 cancelar la misma clase x3: las 3 respuestas son 200, pero el crédito no queda negativo (`classes_used=0`): operación idempotente, sin daño observado.
- Chipi: acepta mensaje de 200 KB (9,6 s de OpenAI) y `role: system` en el historial sin validar (SEC-02 confirmado). `/logs/frontend` acepta 50 KB anónimo (SEC-06 confirmado).
- UI: `/admin/payments` pestaña Retiros llama a `GET /payments/admin/withdrawals/pending` -> 404 (AUD-12 confirmado en navegador).
- UX-01 (frontend/doc/KNOWN_ISSUES.md): cookie válida + `localStorage` vacío deja `/teacher/*` en spinner infinito.

