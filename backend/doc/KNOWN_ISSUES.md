# Bugs y deudas conocidos (auditoría de 2026-11-16; corregidos casi todos en las Fases 1–5, ver la columna Estado)

Detalle y causas con archivo:línea en `../../ANALISIS.md` (§5–§8). Cada bug confirmado tiene un test `xfail(strict=True)` en
`backend/tests/audit/`: al corregirlo el test pasa a XPASS (falla la suite) -> quitar el `xfail`.
Severidad: 🔴 crítico · 🟠 alto · 🟡 medio · 🔵 bajo.

| ID | Sev | Resumen | Test | Estado |
|---|---|---|---|---|
| AUD-03 | 🔴 | Renovar paquete agotado deja `completed` sin créditos | `test_findings::test_renewal_after_full_cycle_gives_new_credits` | **corregido** (Fase 1) |
| AUD-01 | 🔴 | `book_class` y reagendados no validan disponibilidad del profesor | AUD-01 `test_booking_outside_teacher_availability_rejected`; AUD-06 (reagendar) `test_student_reschedule_outside_availability_rejected` | corregido (Fase 2) |
| AUD-02 | 🔴 | Doble reserva: `pending_trial`/`group` no bloquean; sin lock ni constraint | `test_two_students_cannot_book_same_trial_slot` | corregido (Fase 2) |
| AUD-12 | 🔴 | `get_pending_withdrawals` sin `@router.get` -> 404 | `test_admin_can_list_pending_withdrawals` | **corregido** (Fase 1) |
| AUD-14 | 🔴 | Reembolso no descuenta billetera del profesor | `test_findings::test_refund_claws_back_teacher_wallet`, `test_money_calcs` | **corregido** (Fase 1) |
| AUD-04 | 🟠 | Se puede completar una clase futura | `test_cannot_complete_future_class` | corregido (Fase 2) |
| AUD-05 | 🟠 | `PATCH status=cancelled` penaliza al alumno aunque cancele el profesor | `test_teacher_status_cancel_does_not_penalize_student` | corregido (Fase 2) |
| AUD-09 | 🟠 | `update_enrollment_counter` pisa `pending_renewal`/`cancelled` | `test_counter_update_keeps_pending_renewal_status` | corregido (Fase 2) |
| AUD-07 | 🟠 | Duración no validada contra el paquete | `test_booking_duration_must_match_package` | corregido (Fase 2) |
| AUD-08 | 🟡 | datetime naive -> 500 | `test_naive_datetime_does_not_crash` | corregido (Fase 2) |
| AUD-10 | 🟡 | `get_business_rules` ignora el valor 0 (`or`) | `test_business_rules_accept_zero` | corregido (Fase 2) |
| AUD-11 | 🟡 | `commission_rate` NULL -> TypeError | `test_commission_null_rate_falls_back_to_default` | corregido (Fase 2) |
| AUD-13 | 🟡 | Mínimo de retiro ($10) solo en UI | `test_withdrawal_minimum_amount` | corregido (Fase 2) |
| AUD-15 / SEC-03 | 🟠 | `teacher_admin` cambia su propia comisión; sin separación de funciones | `test_teacher_admin_cannot_change_own_commission` | **corregido** (Fase 1: comisión propia y pagos propios; resto de SEC-03 sigue en Fase 3) |
| AUD-16 | 🟡 | Login por username distingue mayúsculas | `test_login_username_case_insensitive` | corregido (Fase 2) |
| AUD-17 | 🟡 | Email no normalizado (`A@x.com` ≠ `a@x.com`) | `test_email_case_duplicates_rejected` | corregido (Fase 2) |
| AUD-18 | 🟡 | Reagendado grupal por profesor: falso conflicto (`student_id=None`) | skip (necesita cohorte) | sin reproducir |
| AUD-19 | 🟡 | Login con cuenta solo-Google -> 500 | `test_password_login_on_google_only_account_is_401` | **corregido** (Fase 1) |
| AUD-20 | 🟡 | `/availability/featured-teacher/slots`: la ruta genérica `/{teacher_username}/slots` la tapaba (404) y además pasaba `Query()` como `bypass_min_notice` | `test_featured_teacher_slots_work_for_students` | **corregido** (Fase 1) |
| AUD-21 | 🟡 | `unlimited_recharge` acepta `credits_requested` negativo (pago negativo) | `test_edge_cases::test_unlimited_recharge_negative_or_zero_rejected` | **corregido** (Fase 1) |
| AUD-22 | 🔵 | Guarda anti doble clic (15 s) puede confundir la cuota 2 con la 1 si se notifica justo tras aprobar | `test_installments_unlock_credits_progressively` (envejece el pago para evitarlo) | corregido (Fase 2) (nuevo) |
| AUD-23 | 🟠 | Sobre-reserva de créditos: 4 reservas simultáneas con 1 crédito libre se aceptan las 4 (sin lock de fila en `enrollments`). Confirmado en PostgreSQL real | `tests/audit/concurrency_live.py` (R2) | corregido (Fase 2) (nuevo) |
| AUD-02b | 🟠 | Doble reserva del mismo horario con 2 alumnos simultáneos: 2 clases creadas (HTTP 201 ambos). Confirmado en PostgreSQL real | `concurrency_live.py` (R1) | corregido (Fase 2) (confirma AUD-02) |
| SEC-01 | 🟠 | Rate-limit veía la IP del proxy | `test_f3_security::test_proxy_headers_*`, `test_launch_configs_*` | **corregido** (Fase 3a): `--proxy-headers --forwarded-allow-ips=*` en `railway.toml` y `Dockerfile`; sigue 1 worker (limitador y scheduler en memoria) |
| SEC-02 | 🟠 | Chipi anónimo sin límites; `role` libre en history; TTS sin cuota | `test_f3_security.py` (Chipi/TTS) | **corregido** (Fase 3a): `role` solo user/assistant, mensaje ≤ 2000, historial ≤ 20, 20/min y 300/día por usuario (IP si anónimo), TTS 60/min y batch 6/min, errores sin detalles |
| SEC-04 | 🟡 | Email sin verificar + vinculación Google sin `email_verified` | `test_f3_email_verification.py` | **corregido** (Fase 3a): token de 24 h guardado como hash, `/auth/verify-email` y `/auth/resend-verification`; Google exige `iss` y `email_verified`, solo vincula cuentas verificadas; bug que dejaba `is_verified` siempre False; retiros/pagos/cohortes exigen verificado. Requiere migración `a7b8c9d0e1f2` |
| SEC-05 | 🟡 | JWT 7 d en cookie no HttpOnly, sin revocación, CSP `unsafe-inline` | `test_f3_auth_cookies.py` | **corregido** (Fase 3b, salvo CSP): cookies HttpOnly `tpm_access`/`tpm_refresh`/`tpm_session`, refresh con rotación y detección de reutilización (`refresh_tokens`), `/auth/refresh` y `/auth/logout`, comprobación de `Origin`, WS por cookie, cambio/restablecimiento de contraseña y borrado de cuenta revocan sesiones. CSP con nonce en scripts (frontend). **Pendiente:** retirar Bearer/`?token=` y el token del JSON (transición) y bajar `ACCESS_TOKEN_EXPIRE_MINUTES` a 30, cuando el frontend nuevo esté en producción. Requiere migración `b8c9d0e1f2a3` |
| SEC-06 | 🟡 | `/logs/frontend` anónimo sin tope, OAuth `state`, WS token en query, borrar cuenta, `application/pptx`, etc. | `test_f3_security.py` | **parcial** (Fase 3a): logs con tope (stack 8000, extra 4000) y 30/min; `state` OAuth firmado y validado; MIME pptx real; borrar cuenta exige contraseña/confirmación y sin saldo/clases/paquetes pendientes; WS con tope de 20 000 caracteres y 20 envíos/10 s. el WS ya acepta la cookie (Fase 3b); `?token=` se retira al cerrar la transición |

## Corregidos en la Fase 1 (cálculos de dinero, `tests/audit/test_money_calcs.py`)
- **Cuotas regalaban créditos:** `_installment_credit_amount` liberaba `ceil(clases/cuotas)` por cuota sin tope (1 clase y 3 cuotas liberaba 1+1+1; 5 clases y 4 cuotas, 2+2+2=6). Ahora el acumulado nunca supera `classes_count`.
- **Última cuota negativa:** `installment_amount` fijado a mano podía dejar la última cuota en 0 o negativa. El schema de paquete lo rechaza (422).
- **Cambio a paquete de igual nº de clases y mayor precio era gratis** (`deficit == 0`). Ahora, sin clases consumidas, se cobra la diferencia de precio (caso A).
- **Cambio de paquete con clases usadas:** el alumno pagaba el paquete nuevo completo pero recibía menos créditos (las clases usadas contaban contra el nuevo) y, al bajar, el enrollment podía quedar `completed` sin nada. Ahora queda con los créditos completos del paquete nuevo.

## Lógica sin ID
doble contabilidad de créditos (`occupied` vs `classes_used`; el aviso de bajo crédito usa la segunda);
`get_student_booking_stage` ya no escribe en los GET (Fase 9: `heal=False`; los POST siguen curando y un barrido diario cancela los enrollments sin pagar); `finalize_past_classes` ya no corre en los GET (Fase 5; solo su job por vencimiento); rama muerta en `finalize_past_classes`;
`manual-grant` ilimitado = 0 créditos; `cancel_class_admin` no notifica grupales; sin idempotencia fuerte en `validate_payment`/`process_withdrawal_v2`;
`transaction_reference` no único; DST en disponibilidad recurrente; `default_commission_rate` nunca se aplica.

## Corregidos en la Fase 5 (coste y rendimiento)
- Engine principal con pool (antes `NullPool`); `finalize_past_classes` fuera de los GET de agenda; jobs del scheduler como `def` (ya no bloquean el event loop).
- N+1 en 9 listados (`/classes/teacher/classes`, `/packages/teacher/enrollments`, `/payments/pending-review`, `/payments/history`, `/admin/support-tickets`, `/admin/teachers`, `/teachers/`): vigilados por `tests/audit/test_perf_queries.py`.
- Paginación `limit`/`offset` + `X-Total-Count` (`app/core/pagination.py`) en 4 listados y, después, en `my-payments`, `my-income`, `my-withdrawals`, `withdrawals/pending`, `support/tickets/me`, `teachers/me/students(-full)`, `chat/conversations`, `classes/my-classes`, `classes/teacher/classes` y `cohorts/teacher` (en clases y conversaciones los contadores siguen siendo del total). Un job diario (`purge_old_logs`, `app/core/retention.py`) purga `error_logs` (30 días, `ERROR_LOG_RETENTION_DAYS`) y `email_log` (60 días, `EMAIL_LOG_RETENTION_DAYS`); 0 la desactiva. **Pendiente:** `god_mode` y listados de admin; el frontend no pagina de verdad (recibe como máximo 200).
- Subidas a Cloudinary por streaming y en hilo (`upload_file_stream`). La cuota por profesor se hizo en la Fase 9.

## Fase 9 (jobs por vencimiento, correos agrupados, cuotas)
- Jobs de Meet, finalizar clases, recordatorios, resumen de chat y sincronización de Calendar por vencimiento (`DateTrigger`): Neon puede suspenderse. Ver `ARCHITECTURE.md` y `tests/audit/test_due_jobs.py`.
- `get_student_booking_stage(..., heal=False)` en `GET /payments/booking-status` y `GET /users/me/teachers`; `release_stale_unpaid_enrollments` (job diario, 24 h de margen, sin tocar cohortes ni enrollments con pago en revisión).
- Correos agrupados: resumen de chat por profesor (`core/chat_digest.py`) y un recordatorio por profesor con todas sus clases de la ventana. Quedan sin agrupar las demás categorías.
- Cuota de materiales por profesor (`MATERIALS_QUOTA_MB`, 500 por defecto): 413 antes de tocar Cloudinary; `GET /materials/quota`. Los materiales anteriores no tienen `file_size` y cuentan 0. El vídeo de presentación es único (al subir otro se borra el anterior).
- `preDeployCommand = "alembic upgrade head"` en `railway.toml` (sin verificar en Railway: ver `docs/OPERATIONS.md`).
- **Pendiente:** carrera de dos subidas simultáneas que sumen más que la cuota (puede pasarse por una subida); el resumen de chat y los jobs solo funcionan con un worker.

## Fase 10 (idiomas con nivel, filtro, Playwright)
- `users.spoken_languages` pasa a `[{language, level}]` (`native|fluent|intermediate|basic`); al guardar el nivel es obligatorio; los textos sueltos de la Fase 8 se leen con `level = null` (sin migración de datos) y la interfaz pide completarlos.
- Filtro `GET /teachers/?speaks=<idioma>` (en Python, sin tildes ni mayúsculas, solo profesores aprobados) y selector «Habla» en el directorio del alumno.
- Playwright (`npm run test:e2e`, 8 pruebas contra el backend semilla en SQLite).

## Código muerto / deuda
Endpoints heredados `/packages/request-renewal`, `/request-package-change`, `/cancel-package-change`; docstring que cita `/cohorts/migrate-to-individual` (no existe);
`featured_teacher="mar12"` sin uso (`availability.py:488`, `next.config.ts`); `Enrollment.renewal_count`/`previous_enrollment_id`, `Class.payment_expires_at` sin uso;
imports duplicados en `availability.py`; `requirements.txt` UTF-16 con `opencode-*` y `pytest*`; app no arranca sin `OPENAI_API_KEY`;
jobs de 24 h/7 d pueden no correr con reinicios frecuentes; migraciones con prefijo `a1b2c3d4e5f6_*` duplicado; archivos gigantes (`payments.py` 2130 líneas).

## Decisiones de negocio pendientes (preguntadas al dueño, sin respuesta)
Todas resueltas (ver «Decisiones de negocio acordadas» en `CORRECCIONES.md`): `finalized` pasa a `no_show` a las 72 h (NEG-02); los créditos sobrantes se suman al renovar; solo `superadmin`/`teacher_admin` aprueban pagos; un solo worker. Quedan las decisiones técnicas apartadas al final de `CORRECCIONES.md`.

## Resultados de concurrencia en vivo ANTES de la Fase 2 (histórico; hoy R1–R5 deben dar 0 FALLO, PostgreSQL/Neon, `python -m tests.audit.concurrency_live`)
- R1 mismo horario x2 alumnos: **FALLO** (2 clases). R2 créditos x4: **FALLO** (sobre-reserva).
- R3 aprobar el mismo pago x4: OK (la billetera se acredita una sola vez). R4 retiro simultáneo x4: OK (1 pendiente, saldo 0).
- R5 cancelar la misma clase x3: las 3 respuestas son 200, pero el crédito no queda negativo (`classes_used=0`): operación idempotente, sin daño observado.
- Chipi: acepta mensaje de 200 KB (9,6 s de OpenAI) y `role: system` en el historial sin validar (SEC-02 confirmado). `/logs/frontend` acepta 50 KB anónimo (SEC-06 confirmado).
- UI: `/admin/payments` pestaña Retiros llama a `GET /payments/admin/withdrawals/pending` -> 404 (AUD-12 confirmado en navegador).
- UX-01 (frontend/doc/KNOWN_ISSUES.md): cookie válida + `localStorage` vacío deja `/teacher/*` en spinner infinito.



## Corregidos en la Fase 3a (seguridad backend, `tests/audit/test_f3_*.py`)
- **JWT sin `sub` -> 500:** un JWT firmado con la misma clave pero sin `sub` (p. ej. el `state` de OAuth) rompía `get_current_user`. `decode_access_token` ahora solo acepta tokens con `sub` numérico y sin `typ`.
- **Google:** `verify_google_token` valida `iss` y `email_verified`; el email se normaliza a minúsculas; no se puede reclamar una cuenta ya vinculada a otro Google.
- **Verificación de email suave:** las cuentas existentes quedan verificadas en la migración; las nuevas reciben el enlace al registrarse. Aviso con «Reenviar enlace» en los paneles de alumno y profesor (`VerifyEmailBanner`) y página `/verify-email`.
- **tests/flow:** 29 -> 0 obsoletos revisados (ver `TESTING.md`).

## Fase 11 (rendimiento)
- **Índices (migración `b1d5e6f7a8c9`, `app/models/indexes.py`):** hasta ahora solo había índices en las claves primarias y en tablas de logs/tokens/chat; las claves foráneas de `classes`, `payments`, `enrollments`, `materials`, `homework`, etc. y `teacher_profiles.user_id`/`student_profiles.user_id` (se consultan en casi cada petición) no tenían ninguno, y PostgreSQL no los crea solo. 26 índices nuevos; `tests/audit/test_performance_indexes.py` comprueba que modelo y migración coinciden. **Pendiente medir** con `EXPLAIN ANALYZE` en Neon cuando haya volumen.
- **Timeouts a servicios externos:** OpenAI 30 s con 1 reintento (el SDK traía 600 s), Cloudinary (conexión 10 s, lectura 120 s; antes sin límite), revocar token de Google 10 s, intercambio OAuth 15 s. Resend (30 s), `httpx` (5 s) y la API de Calendar (60 s) ya tenían el suyo. Falta: el refresco del token de Google usa el valor por defecto de `google-auth` (120 s).
- **gzip en la API** (`GZipMiddleware`, registrado el primero para que vea el cuerpo completo; `tests/audit/test_gzip.py`).
- **CSP:** `style-src`/`font-src` ya no abren Google Fonts (las fuentes salen del propio sitio con `next/font`); `style-src` permite `https://accounts.google.com/gsi/style`, la hoja del botón de Google, que estaba bloqueada.
- **Dependencias:** `requirements.txt` está en UTF-16 y lleva herramientas de prueba y paquetes sin uso aparente (`opencode-cli`, `passlib`, `pytest-order`, `pytest-reportlog`, `wsproto`) en la imagen de producción. Pendiente separar `requirements-dev.txt` y confirmar cada uno antes de borrar.
