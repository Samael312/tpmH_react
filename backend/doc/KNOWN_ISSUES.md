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
| AUD-24 | 🟡 | Un profesor desactivado (`users.is_active=False`) ya no se lista (Fase 21) pero **sigue recibiendo reservas de prueba**: `POST /payments/book` solo comprueba `TeacherProfile.status`, no `is_active`. Hallado 2026-11-22 al invertir las sondas de `tenant_probes` | `tests/tenant_probes/test_multi_probes.py::test_deactivated_teacher_cannot_receive_bookings` (xfail) | **abierto** |
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
`transaction_reference` no único; DST en preferencias del alumno (la disponibilidad del profesor se corrigió en la Fase 26); `default_commission_rate` nunca se aplica.

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
- **Dependencias:** `requirements.txt` pasó de UTF-16 a UTF-8 y se quitaron 9 paquetes que nada usa ni necesita (`opencode-ai`, `opencode-cli`, `typer`, `rich`, `markdown-it-py`, `mdurl`, `shellingham`, `passlib`, `wsproto`; comprobado por cierre de dependencias desde el código de producción). `pytest`, `pytest-order` y `pytest-reportlog` **se quedan** a propósito: el «probador de flujos» del superadmin (`flow_tests.py`) los ejecuta dentro de la propia aplicación (se desactiva solo con `ENVIRONMENT=production`; si algún día no se usa en ningún entorno desplegado, se pueden separar en un `requirements-dev.txt`).
- **Tiempos de petición** (`app/core/request_timing.py`): cabecera `Server-Timing` en todas las respuestas y aviso `Peticion lenta: GET /ruta 2310 ms (200)` en el log (logger `app.slow_requests`) cuando pasan de `SLOW_REQUEST_MS` (1500; `0` lo desactiva). Sin escrituras en la base de datos. _Tests: `tests/audit/test_request_timing.py` (6)._
- **Paginación del Modo Dios** (`limit`/`offset` + `X-Total-Count`): historial de una entidad, profesores, alumnos de un profesor, enrollments de un alumno y cohortes de un profesor. El historial además ya no hace una consulta por fila para el nombre del autor. _Tests: `tests/audit/test_god_mode_pagination.py` (7)._ Los demás listados del Modo Dios ya llevaban `LIMIT` fijo (100 o 200) y el log general ya paginaba.
- **`/admin/users` en el frontend** (`useStudents`, `useBannedStudents`) pedía solo la primera página (50 filas) aunque el contador mostrara más: ahora recorre todas con `skip`. La pantalla «Edición de Usuarios» ya paginaba de verdad.

## Revisión de flujos (2026-11-17, `tests/audit/test_flow_review_fixes.py`)
- **Prueba gratis repetida (corregido):** una prueba `finalized` o `no_show` dejaba al alumno en `needs_trial` y podía reservar otra prueba gratis (confirmado: la segunda reserva daba 201). Ahora `finalized` es `trial_in_progress` y `no_show` cuenta como prueba usada.
- **Clase gratis al reagendar (corregido):** el alumno podía reagendar una clase `finalized` (ya recibida); volvía a `confirmed` sin gastar crédito. Ahora solo el profesor reagenda clases pasadas (backend y `ClassCard.tsx`).
- **Clase en curso oculta (corregido):** «próximas» filtraba por `start_time_utc >= ahora` y la clase desaparecía del dashboard al empezar, con su enlace de Meet. Ahora filtra por el fin.
- **Tanda 1 de mejoras (corregido):** las clases `external` (Preply) se quedan en `finalized` (antes pasaban a `no_show` a las 72 h); los layouts de alumno y profesor verifican el onboarding una vez por sesión, no en cada cambio de ruta (el perfil del profesor actualiza la zona horaria del store al guardar); el selector de idiomas muestra y deja quitar los idiomas que ya no están en el catálogo; el vencimiento del job de Meet solo cuenta profesores con Calendar conectado; un recordatorio sin destinatario se marca como tratado. _Tests: `test_due_jobs.py` (+4) y `spokenLanguages.test.ts` (+2)._

## Hallazgos A1-A4 de `docs/TENANT_MODES_AUDIT.md` §6 (corregidos el 2026-11-21, Fase 16)
Un `teacher_admin` tenía poderes de dinero y de plataforma que no le tocaban. Ahora `require_superadmin` (en `auth/dependencies.py`) protege:
- **A1:** `PATCH /admin/platform-config` (modo single/multi y destacado).
- **A2 (revertido por decisión del propietario):** `PATCH /payments/config` (datos de pago: banco, PayPal, Binance, WhatsApp…) vuelve a ser de staff (`get_current_staff`): el `teacher_admin` puede editarlo; `test_payment_config_editable_by_teacher_admin`. Riesgo aceptado: puede cambiar a dónde pagan los alumnos.
- **A3:** `POST /god-mode/payments` y `PATCH /god-mode/payments/{id}`; además un `teacher_admin` recibe 403 al procesar su propio retiro.
- **A4:** `/chat/admin/conversations*`, reagendar y borrar clases desde el panel admin, y descarga de materiales de otros profesores. Banear/desbanear alumnos, cambiar el estado de profesores y editar usuarios **siguen abiertos** al `teacher_admin` (solo el cambio de rol es del superadmin).
- **A5 (reseñas propias en Modo Dios): no es bug, decisión del propietario.** Se deja como está.

## Transición single/multi (Fase 18, corregido 2026-11-21, `tests/audit/test_f18_tenant_transition.py`)
T2/T5: backfill atómico, completo (cualquier profesor) y re-ejecutable; T3: reservar en single ya no quita al alumno del profesor anterior; `/users/me/teachers` usa la destacada resuelta; single sin destacada -> 400; multi->single con alumnos de otros profesores -> 409 salvo `force=true`; creadores de links tolerantes a la restricción única.
Pendiente: T1 (créditos con otros profesores invisibles en single; `legacy` en `/me/teachers`), pre-check al cambiar destacada A->B dentro de single, y `god_mode.py::transfer` aún crea el link sin savepoint.

## Revisión de los flujos de `teacher_admin` (verificada)
- **Panel staff** (`get_current_staff`): superadmin y `teacher_admin`. Solo `superadmin` (`require_superadmin`; ampliado en la Fase 16, ver arriba): cambiar roles (`PATCH /admin/users/{id}` con `role`; el resto de la edición de usuarios es de staff; solo alterna `teacher`/`teacher_admin`), `email-settings`, resolver correcciones de clase, transferir alumnos (Modo Dios) y cambiar la comisión propia. Las páginas del frontend ocultan lo que solo ve el superadmin (`EmailSettingsPanel`, `EmailQuotaBanner`).
- **Pagos:** valida los de otros profesores; los propios dan 403 y se marcan `is_own_payment`. Con `manual-grant` puede crear la concesión de cualquier enrollment, pero la valida el superadmin.
- **Modo Dios:** las 14 acciones de escritura y los 9 listados de apoyo comprueban que la entidad sea suya (`_require_*_scope` o comprobación directa). `lookup/class-durations` y el log general (`/audit-log`) son de lectura para todo el staff a propósito.
- **Tests que lo cubren:** `test_permissions_money`, `test_findings`, `test_class_correction`, `test_f7_email_settings`, `test_god_mode_pagination` (16 pasan).
- **Corregido al revisar los flujos de profesor:** un `teacher_admin` se trataba como no-profesor en 3 sitios: al cambiar su `username` no se actualizaba `TeacherProfile.user_username` (`users.py`; test en `test_permissions_money.py`), el correo de respuesta a su ticket enlazaba a `/dashboard/support` en vez de `/teacher/support` (`admin.py`) y su ticket se etiquetaba «Estudiante» en la notificación (`support.py`).
- **Mejora menor pendiente:** `GET /god-mode/audit-log` hace una consulta por fila para el nombre del autor (máx. 200 filas); el historial por entidad ya va por lotes.

## Seguridad y comunicación (corregido el 2026-11-21, Fase 21, `tests/audit/test_f21_security.py`)
- Cambiar el email desde `PATCH /users/me` no exigía verificación ni cerraba sesiones, y era sensible a mayúsculas: ahora minúsculas, `is_verified=False`, correo de verificación y revocación del resto de sesiones. Verificar el email también revoca las sesiones anteriores.
- Los correos insertaban nombres, mensajes, motivos y comentarios sin escapar (HTML inyectable): ahora se escapan todos los argumentos de `send_*` en un solo punto (`core/email.py`).
- El Flow Tester lo podía lanzar cualquier staff con ids arbitrarios de pytest: ahora solo superadmin, `FLOW_TESTS_ENABLED` (apagado por defecto) e ids `tests/flow/...`.
- Borrar la cuenta de un profesor dejaba el perfil público, el video, los paquetes y el token de Google: ahora se suspende y limpia (sin cancelar clases ni eventos).
- **Corregido (Fase 23):** un profesor aprobado que sube un video nuevo ya NO vuelve a `pending`: el nuevo va a `video_pending_*` y el anterior sigue público hasta que el staff lo apruebe. Si el staff lo rechaza, el profesor puede apelar UNA vez (`TeacherAppeal.kind='video'`); el archivo pendiente se conserva hasta resolver la apelación (aprobar: se promueve; rechazar: se borra) o hasta que suba otro video (reemplaza el pendiente; no se puede subir mientras la apelación está en revisión).
- **Corregido (Fase 23):** al banear o desactivar a un usuario se cierran sus websockets de chat al instante (`chat_manager.close_user`). Borrar la cuenta propia también cierra sus sockets de chat.
- **Abierto:** el token de acceso (JWT) ya emitido sigue valiendo hasta que caduque aunque se revoquen las sesiones de refresh; solo se cortan las renovaciones.
- **Abierto:** `admin.py` no cierra los sockets de chat al banear (se cierran en la siguiente comprobación, <= 20 s); `cohorts.py` conserva un mensaje con voseo («No tenés acceso a este grupo»).

## Solapes de cohortes (corregido el 2026-11-21, Fase 19)
- Crear una sesión de cohorte o aprobar el pago de un alumno que se auto-une a sesiones futuras podía dejarlo con dos clases a la vez (otra clase con otro profesor u otra sesión grupal). Ahora se omite al alumno en conflicto (`student_has_overlap`); `skipped_participants` informa al profesor al crear la sesión. En la auto-unión por pago el alumno simplemente no se agrega a esa sesión (sin aviso).
- Los choques del profesor en cohortes ignoraban `pending_trial` (y sin cota inferior); unificado con `can_book_slot`. `_create_group_session` toma `lock_booking_rows` (caso 11b).
- `can_book_slot` ya no cuenta el margen de preparación del OTRO profesor como tiempo ocupado del alumno.
- Pendiente menor: el alumno omitido sigue inscrito y pagado en la cohorte; el profesor debe reagendar con él.

## Google Calendar y Preply (corregido el 2026-11-21, Fase 17)
- La sync empujaba las clases `external` (Preply) a Google: reescribía el evento de Preply y, si Google daba 403, creaba eventos propios y filas `Class` duplicadas en cada sync (G1/G1b). Ahora las `external` son de solo lectura (no entran en el bucle de push) y un error 403/5xx al editar un evento propio ya no se toma por «el evento no existe».
- Un evento de Preply en curso se reimportaba en cada sync (G2): ahora se buscan los existentes por `google_event_id` y hay índice único parcial `(teacher_id, google_event_id)`. La migración `e4a1b2c3d4f5` borra duplicados conservando el más antiguo; los que tienen pagos/participantes/tickets o no son `external` solo pierden `google_event_id`.
- `calendar_id` ya no guarda el email de la plataforma: es `"primary"` (los valores antiguos con `@` se tratan como `primary`; migración `e5b2c3d4e5f6`). Una cuenta de Google solo puede estar conectada a un profesor (índice único en `google_account_sub`, 409 en el callback); las filas antiguas no tienen `sub` hasta que el profesor reconecta.
- Tras conectar se lanza una sync en segundo plano. Al desconectar, perder el acceso (RefreshError) o cambiar de cuenta NO se cancela nada (regla del dueño); las clases `external` (Preply) sobrantes pueden seguir bloqueando huecos hasta que pase su fecha. Se avisa al profesor (campana `calendar_reauth_required` + correo, categoría `teacher_status_support`) y `POST /calendar/toggle` no reactiva un token con `needs_reauth`.
- La sync omite el `update` si nada cambió (`classes.google_sync_hash`, migración `e6c3d4e5f6a7`), solo procesa a los profesores con clase propia en curso/próximas 3 h o con última sync > 5,5 h, aísla fallos por profesor y distingue permiso (403) de cuota (429/403 `rateLimitExceeded`, que sí se reintenta). Las `external` ya no aceleran el job de sync (J4).
- `GET /availability/*/slots`: límite 120/min por IP; un freebusy fallido NO se cachea; el busy de Google cubre todo el rango ofrecido (G4). `can_book_slot` comprueba el hueco exacto en Google (G3, falla abierto con log).
- **Pendiente / límites:** (1) un evento propio borrado a mano en Google ya no se recrea hasta que la clase cambie (antes se recreaba en cada sync; el coste era una llamada por clase). (2) La consulta a Google en `can_book_slot` añade latencia a cada reserva de profesores con Calendar conectado (timeout de la API 60 s; usa sesión propia para no soltar el lock de reserva). (3) Siguen abiertos G6 (declined/transparent), G8 (borrado fallido), caché de freebusy por `GET /slots` y el resto del rediseño UTC (C1-C3, C5).

## Dinero (corregido el 2026-11-21, Fase 20, `tests/audit/test_f20_money.py`)

- NaN/inf en retiros, comisión, config y precios -> 422 (el manejador de validación ya no devuelve `input`, que con NaN rompía en 500); saldo con CHECK >= 0.
- Reembolsos ya no usan el precio actual del paquete sino lo pagado, con tope (D2/D3); `update_package` congela precio/duración/clases/cuotas con alumnos vivos o cohortes abiertas (409), lo que también congela el importe de las cuotas (M17).
- Billetera con escrituras atómicas y `Numeric(12,2)` (D4); Modo Dios no deja saldo negativo, usa la tasa congelada y no edita reembolsos (M8/M9); `total_revenue` sin reembolsos ni otorgamientos (M10); `GET /payments/config` autenticado (S5).
- Otorgamiento manual: ahora es solicitud del profesor + aprobación del staff (D5).
- **Efecto a tener en cuenta:** un cambio a un paquete más barato de un alumno cuyo paquete actual fue un otorgamiento manual ($0 pagados) ya no genera reembolso (400 «no hay ningún pago aprobado»); antes inventaba un reembolso de dinero no cobrado.
- **Límite conocido:** tras varias renovaciones, «pagado» suma los ciclos anteriores; el tope sigue impidiendo reembolsar más de lo cobrado en total, pero el reparto por ciclo no es exacto.

## Estados de clase y matrícula (corregido el 2026-11-21, Fase 22, `tests/audit/test_f22_states.py`)

- **Corregido:** E1 (clases del ciclo viejo llenaban el contador nuevo), E2/TE-02 (reabrir canceladas, cancelar completadas, no_show reagendado contado dos veces), E3 (`book` con `pending_renewal`), E4 (cancelar cambio dejaba el pago aprobable; endpoints heredados eliminados), E5 (cohorte cancelada perdía `cohort_id` y el reembolso), E6 (prueba sin confirmar quemaba la prueba gratis), m1, m3, TE-06.
- **m2 (tope de reagendados):** resuelto en la Fase 25 (`Class.student_reschedule_count`).
- **Abierto:** el inicio de ciclo reutiliza `Enrollment.activated_at` con 2 s de tolerancia frente a `Class.created_at` (sin columna nueva). Una clase reservada menos de 2 s antes de aprobar una renovación cuenta como del ciclo nuevo.
- **Abierto (E6):** a las 72 h sin marcar una prueba sigue pasando a `no_show` (quema la prueba gratis), incluso si nunca se confirmó: distinguirlas exige una marca en el esquema o revertir la decisión del dueño de 2026-11-17 (cambio de una línea en `finalize_past_classes`: cancelar las `trial` en vez de `no_show`).
- Modo Dios con `reset_classes_used` en el movimiento de cohorte no refresca `activated_at`.

## Medianoche UTC (corregido el 2026-11-21, Fase 24, `tests/audit/test_f24_midnight_utc.py`)
- C1-C3, C5, C6 de `docs/TIMEZONE_AUDIT.md` corregidos (se ofrecía y se rechazaba con 409; clases/bloqueos tras 00:00Z no bloqueaban; el front pedía el día local como UTC; `is_preferred` en franjas que cruzan 00:00Z). C4 verificado. Contrato: `/slots?date=&tz=&end_date=`.
- **Corregido (Fase 26):** DST en la disponibilidad del profesor (H1-H5): se guarda en hora local y se expande por fecha. **Pendiente:** las preferencias del ALUMNO (`StudentSchedulePreference`) siguen en `HH:MM` UTC con el desfase de la fecha de guardado; solo afectan al resalte `is_preferred`, no a reservas. Horas locales inexistentes/ambiguas en la franja semanal: se saltan / primera ocurrencia (ver `BUSINESS_RULES.md`). Sigue sin haber rejilla alineada a 30 min en la validación de reserva (R5): se acepta cualquier minuto dentro de un rango.
- El alumno (check de solape propio) y los participantes de grupo siguen usando la ventana ±3 h por inicio; vale con las duraciones actuales (máx. 110 + margen).

- **Zona nula y recordatorios tardíos (Fase 27, corregido):** `timezone: null` ya no se guarda por API (422) y las reservas con < 23 h reciben un recordatorio (una clase que empieza en < 30 min no recibe ninguno; no hay recordatorio de 1 h). _Tests: `test_f27_tz_null_reminders.py`._

## Hallazgos de la subida de cobertura (2026-11-23, `tests/audit/test_g1_*` … `test_g18_*`)

- **Cuota de Google agotada borra su propio aviso:** en `core/google_calendar.py::sync_calendar_logic`, cuando Google responde con cuota agotada se guarda `token.last_error = "Límite de cuota…"` y se hace `break`. Como `error_count` sigue en 0, la línea `if error_count == 0: token.last_error = None` lo borra en la misma ejecución, así que el aviso nunca se ve. Abierto. _Test que lo fija: `test_g11_google_calendar.py::test_sync_logic_error_kinds`._
- **Código inalcanzable en `teachers.py::submit_appeal` (líneas 556-561):** el estado «agotado» ya se rechaza antes, así que esa rama no se puede ejecutar. Abierto; conviene borrarla.
- **God mode:** quedan ramas sin cobertura en `god_mode.py` (8 líneas) que son comprobaciones defensivas duplicadas de otras previas.
- **Cobertura que sigue sin llegar al 100 %:** ver `backend/doc/TESTING.md` (lista de lo pendiente: bloques de `payments.py` con ramas de reembolso/cohorte, `class_logic.py`, `ai_debug.py`, servicios de OpenAI/TTS y algunos caminos de OAuth de Google).
