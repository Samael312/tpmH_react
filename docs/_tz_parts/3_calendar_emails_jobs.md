# Parte 3 — Google Calendar (Preply / busy / export), correos y jobs

Alcance: `backend/app/core/google_calendar.py`, `core/calendar_sync.py`, `api/v1/endpoints/availability.py`
(busy de Google), `classes.py`/`payments.py` (correos y hooks de Calendar), `core/scheduler.py`, `core/timezone.py`.
Método: lectura estática + 15 sondas SQLite con Google simulado en memoria (`FakeCalendar`, misma semántica
que la API real: `timeMin` filtra por fin, `timeMax` por inicio, freebusy recortado a la ventana).
Ninguna llamada real a Google ni a correo.

Sondas: `backend/tests/tz_probes/test_calendar_emails_jobs.py` → **15 passed** (11 `test_bug_*` = hallazgo
confirmado, 4 `test_ok_*` = comportamiento correcto verificado).
`cd backend && venv\Scripts\python.exe -m pytest tests/tz_probes/test_calendar_emails_jobs.py -q`

Severidad: 🔴 alta · 🟠 media · 🔵 baja. Evidencia: **SONDA** = test que pasa · **CÓDIGO** = trazado sin ejecutar.

## G — Google Calendar

| # | Sev | Hallazgo | Evidencia |
|---|---|---|---|
| G1 | 🔴 | **La sync trata las clases `external` (Preply) como propias y reescribe el evento original de Preply.** `sync_calendar_logic` (`google_calendar.py:745-803`) recorre todas las clases del profesor en la ventana sin excluir `ClassType.external`; como su `google_event_id` es el id del evento de Preply, hace `events().update()` sobre él (fuerza `timeZone: UTC`, pisa `location` con el link), en cada sync (cada 30 min con clase cerca). | SONDA `test_bug_g1_sync_rewrites_imported_preply_event` (update sobre `preply-1`, `updated_count == 1`) |
| G1b | 🔴 | **Si Google no deja editar ese evento (403: el profesor es invitado, no organizador), se entra en un bucle de duplicados.** `update_calendar_event` devuelve `False` (`:671`) → la sync borra `google_event_id` y **crea un evento propio** «Clase: Estudiante — Preply…» en el calendario del profesor (`:793-801`). La siguiente sync ya no reconoce el evento de Preply (el id cambió) → crea otra `Class` external, cancela la vieja, borra/crea otro evento propio… Cada sync: +1 fila `classes` y +1 evento basura en Google. | SONDA `test_bug_g1b_preply_update_forbidden_duplicates_every_sync` (2 syncs → 2 filas, 2 `insert`) |
| G2 | 🟠 | **Un evento de Preply en curso se reimporta como clase nueva en cada sync.** `list_calendar_events` usa `timeMin=now` (Google devuelve eventos cuyo **fin** > now), pero la consulta de existentes filtra `Class.start_time_utc >= time_min` (`:363-369`): la clase ya importada que empezó hace 10 min no se encuentra → `db.add(Class(...))` otra vez. Con el job cada 30 min durante clase en curso + botón manual, se duplican filas (agenda y estadísticas del profesor). | SONDA `test_bug_g2_ongoing_external_event_duplicated` (3 syncs → 3 filas mismo `google_event_id`) |
| G3 | 🟠 | **La reserva no valida el busy de Google.** Solo `GET /availability/{u}/slots` lo consulta (`availability.py:477`); `can_book_slot` (`class_logic.py:267`) no. Una reserva/reagenda por API, una lista de slots cacheada en el front o un evento creado en Google entre listar y reservar pisan la cita del profesor. Además las clases Preply >30 días no se importan (`SYNC_WINDOW_DAYS`), así que tampoco las bloquea `busy_from_classes`. | SONDA `test_bug_g3_booking_ignores_google_busy` (slot 15:00 `is_available=False`, `can_book_slot` → True) |
| G4 | 🟠 | **El busy de Google se pide solo para el día UTC `[D 00:00, D+1 00:00)`**, pero la disponibilidad puede cruzar la medianoche UTC (`build_weekly_range_utc` suma un día). Un profesor en Bogotá 17-21 h (22-02 UTC) ve libres los slots de 23:30 y 00:30 UTC aunque tenga un evento de Google 00:00-01:00 UTC. Mismo corte para `busy_from_classes` (`start >= day_start AND < day_end`, `availability.py:462-467`), aunque ahí `can_book_slot` lo atrapa al reservar; para Google no hay red (G3). | SONDA `test_bug_g4_google_busy_window_cut_at_utc_midnight` |
| G5 | 🔵 | **freebusy falla abierto y en silencio.** `HttpError` → `[]` (`:213-215`); un `errors` dentro de `calendars[id]` (notFound, 403 de calendario compartido) se ignora; token revocado → `[]` + `needs_reauth`. Todos los huecos aparecen libres y nadie avisa al alumno ni al profesor en ese momento. Decisión razonable (no romper reservas), pero no queda registro por slot. | SONDA `test_bug_g5_freebusy_fails_open` |
| G6 | 🔵 | **Eventos Preply rechazados (`responseStatus: declined` del propio profesor) o marcados «libre» (`transparency: transparent`) se importan igual** y bloquean la agenda (`_match_external_source`, `:313-332`), mientras freebusy de Google sí los ignora. Incoherencia entre las dos fuentes. | SONDA `test_bug_g6_declined_or_transparent_preply_imported` |
| G7 | 🔵 | **El import no normaliza a UTC** (`:388-389` guarda el `datetime` con el offset del evento, p. ej. +02:00). En Postgres (`timestamptz`) se guarda bien; en SQLite (harness de tests) se pierde el offset y la hora queda 2 h corrida. Solo afecta a tests/herramientas, pero conviene `.astimezone(UTC)`. | SONDA `test_ok_import_respects_event_offset…` (verifica el offset en memoria) + observado al ejecutar contra SQLite |
| G8 | 🔵 | **Cancelar/reagendar depende de una llamada inmediata a Google que puede fallar sin reintento propio.** Si `delete_calendar_event` falla (`classes.py:432/810/961`), el evento propio sigue en Google y **freebusy bloquea ese hueco a otros alumnos** hasta la siguiente sync (≤ 6 h si no hay clases cerca). Igual con el horario viejo si falla `update`. `google_event_id` no se limpia tras borrar con éxito (inocuo: la sync reintenta y Google da 404/410). | CÓDIGO |
| G9 | 🔵 | **1 llamada a freebusy (y posible refresco de token) por cada `GET /slots`**, sin caché. No hay datos obsoletos, pero sí latencia y cuota de Google; un calendario lento retrasa la lista de horarios (timeout 60 s). | CÓDIGO (`availability.py:477`) |

**Funciona bien (Google):**
- Paginación (`nextPageToken`) y recurrentes (`singleEvents=True`) en `list_calendar_events`; cancelados excluidos (sin `showDeleted`, más `status == cancelled`).
- Eventos de todo el día (`date`) no se importan; freebusy de Google los convierte en instantes correctos en la zona del calendario.
- Eventos con su propio `timeZone`/offset: `dateTime` se parsea con offset → instante correcto, también en el día del cambio de hora (SONDA `test_ok_import…`).
- Eventos propios (`tpmh_managed`) nunca se reimportan como Preply.
- Export: `start/end` en `dateTime` UTC + `timeZone: "UTC"` (SONDA `test_ok_export_event_body_in_utc`); cambiar la zona del profesor no afecta a clases ni eventos (todo guardado en UTC). Reagendar llama a `sync_class_updated`; cancelar a `delete`.

## E — Correos y avisos

| # | Sev | Hallazgo | Evidencia |
|---|---|---|---|
| E1 | 🟠 | **Reagendar no reinicia `reminder_sent_at`.** Si el recordatorio de 24 h ya salió y la clase se mueve (p. ej. a dentro de 4 días), nunca se envía el recordatorio del horario nuevo: `_due_reminders` ya no la cuenta. Ningún endpoint de reagenda (`classes.py:497/722/864/910`, God Mode) toca el campo. | SONDA `test_bug_e1_reschedule_keeps_reminder_sent` |
| E2 | 🟠 | **Solo existe recordatorio de 24 h (ventana 23-25 h)**: una clase reservada con < 23 h de antelación (el mínimo es 1 h) no recibe ninguno; no hay recordatorio de 1 h; las pruebas `pending_trial` (sin confirmar por el profesor) tampoco, aunque se dan igual. | SONDA `test_bug_e2_short_notice_and_trial_never_reminded` |
| E3 | 🟠 | **La hora de los correos no indica la zona** («20 de noviembre de 2026 · 10:00», `timezone.py:339-351`). Si el perfil del destinatario se quedó en el `UTC` por defecto (`student.py:13`, `teacher.py:22`) o la zona es inválida (los schemas de PATCH no la validan, `schemas/teacher.py:65`), `format_local_datetime` cae a UTC **en silencio** y el correo parece hora local. Riesgo real de llegar 1-6 h tarde/temprano. | SONDA `test_bug_e3_email_time_without_zone_label_and_silent_utc_fallback` |
| E4 | 🔵 | **No hay correo de «tarea por vencer»** (ni ningún aviso de `due_date_utc`): solo entregada/calificada. El límite se aplica con `utc_now() > due_date_utc` (`homework.py:308`), correcto en UTC. | CÓDIGO |
| E5 | 🔵 | Los correos de reagenda/cancelación usan la zona **actual** del destinatario (no un snapshot de cuando reservó). Es lo deseable; solo se nota si alguien cambia de zona entre dos correos de la misma clase. | CÓDIGO (`classes.py:260-294`) |

**Funciona bien (correos):** cada destinatario recibe la hora en **su** zona (alumno en la suya, profesor en la suya, también en el digest y en grupos); los cambios de hora (DST) se resuelven con `zoneinfo` (SONDA `test_ok_email_dst_and_recipient_tz`: Madrid 01:30 UTC del 28-mar → 03:30). La campana de auto-`no_show` usa la zona del profesor.

## J — Jobs

| # | Sev | Hallazgo | Evidencia |
|---|---|---|---|
| J1 | 🔵 | **`AsyncIOScheduler()` sin `timezone`** (`scheduler.py:24`): los `CronTrigger` (purgas «03:00 UTC», liberar enrollments 03:10, aviso de crédito bajo lunes 14:00) corren en la zona local del servidor. En Render suele ser UTC, pero el comentario promete UTC y en cualquier otro host (o en local) se desplazan y siguen el DST local. Los `DateTrigger` sí van en UTC (instantes aware). | SONDA `test_bug_j1_cron_jobs_use_server_local_tz` |
| J2 | 🔵 | `release_stale_enrollments` corre una vez al día: un enrollment «de más de 24 h» se libera entre 24 y 48 h. | CÓDIGO (`scheduler.py:383`, cron diario) |
| J3 | 🔵 | Meet solo para `confirmed` (no `pending_trial`): si el profesor confirma la prueba después de `inicio − meet_link_autogen_minutes`, el job la recoge al recalcular (`start > now`), bien; pero si confirma con la clase ya empezada, se queda sin link automático. | CÓDIGO (`scheduler.py:246-252`) |
| J4 | 🔵 | `_due_calendar_sync` mide «clase cerca» solo con `confirmed`; las clases `external` (Preply) cuentan, lo que **multiplica G1/G2** (sync cada 30 min durante cada clase de Preply). | CÓDIGO (`scheduler.py:507-525`) |

**Funciona bien (jobs):** los vencimientos se calculan en UTC aware y con precisión de segundo (`_due_finalize` = fin + 1 s, `_due_reminders` = inicio − 25 h; SONDA `test_ok_due_triggers_are_utc_and_precise`); `finalize_past_classes` compara `end_time_utc < now` en UTC; las `external` se quedan en `finalized`; reagendar dispara `request_reschedule()` vía hooks de sesión, así que los `DateTrigger` se recalculan.

## Arreglos sugeridos

1. **G1/G1b:** en `sync_calendar_logic` filtrar `Class.class_type != ClassType.external` en `classes_in_window` (las externas son de solo lectura). Limpiar datos: clases external con `google_event_id` `own-*` / eventos `tpmh_managed` cuyo título contenga «Preply».
2. **G2:** en `import_external_classes_for_teacher` buscar existentes por `google_event_id IN (ids devueltos)` (o filtrar por `end_time_utc > time_min`), y añadir índice único `(teacher_id, google_event_id)`.
3. **G3/G4:** extraer «busy de Google para [start, end)» y llamarlo también desde `can_book_slot` (con margen de la clase); en `/slots` pedir freebusy para `[min(rango.start), max(rango.end))` de la disponibilidad del día, no solo el día UTC (y lo mismo para `booked`).
4. **G5/G6:** registrar en `ErrorLog`/`token.last_error` los `errors` de freebusy; en el import saltar eventos con `transparency == "transparent"` o con el asistente `self` en `declined`.
5. **G7:** `start_dt = start_dt.astimezone(UTC)` al importar.
6. **E1:** poner `reminder_sent_at = None` en todo reagendado que cambie `start_time_utc`.
7. **E2:** decidir regla: recordatorio inmediato si se reserva con < 23 h (o recordatorio de 1-2 h); incluir `pending_trial` o avisar al profesor de que tiene pruebas sin confirmar.
8. **E3:** añadir la zona al texto (`10:00 (hora de Bogotá, GMT-5)`), validar `timezone` con `validate_timezone` en los PATCH de perfil y, si la zona es `UTC` por defecto, decirlo explícitamente.
9. **J1:** `AsyncIOScheduler(timezone=UTC)` (o `timezone=UTC` en cada `CronTrigger`).
