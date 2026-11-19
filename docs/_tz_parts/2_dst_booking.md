# Parte 2 — DST en disponibilidad recurrente y precisión de reservas (backend)

Sondas: `backend/tests/tz_probes/test_dst_and_booking.py` → **25/25 pasan** (21 `test_bug_*` = bug confirmado hoy, 4 `test_ok_*` = controles).
Comando: `cd backend && venv\Scripts\python.exe -m pytest tests/tz_probes/test_dst_and_booking.py -q` (SQLite, sin `.env`).
"Ahora" se congela parcheando `datetime` en `app.core.timezone`, así el resultado no depende de la estación del año.

Severidad: 🔴 alta · 🟠 media · 🔵 baja. Evidencia: **SONDA** = test que pasa · **CÓDIGO** = trazado sin ejecutar.

## Causa raíz del DST

`TeacherAvailability` / `StudentSchedulePreference` guardan `HH:MM` **UTC** + `day_of_week`. La conversión
(`core/timezone.py:113-157`, `convert_local_time_to_utc`) usa el desfase de **la próxima ocurrencia de ese día a partir de HOY**
(`get_next_weekday_date`, l.113). Después `availability.py:426-433` y `class_logic.py:51-61` aplican ese UTC fijo a cualquier fecha.
Pasa lo mismo al revés: `convert_utc_time_to_local_string` (l.177) usa el desfase de hoy, y de eso depende el recálculo al cambiar de zona.

**Impacto medido (hora local que se ofrece / hora que el profesor eligió):**

| Profesor (guardó en invierno) | Semanas/año con 1 h de desfase | Qué ve el alumno |
|---|---|---|
| Europe/Madrid (CET↔CEST, 28-mar→31-oct-2027) | **31/52** (21/52 si guardó en verano) | Alumno de Caracas/Bogotá/México (sin DST): la misma hora UTC todo el año, así que no nota el cambio, pero el profesor sí: tiene clases a las 10:00 cuando él puso 09:00 |
| America/New_York (14-mar→7-nov-2027) | **34/52** | Alumno de Madrid: además, en las 3 semanas de marzo y la de oct/nov en que EE. UU. y la UE no coinciden, la diferencia entre los dos cambia otra vez |
| Sin DST (Caracas, Bogotá, Lima, México desde 2022) | 0 | — |

Son una o dos tandas al año de clases a una hora a la que el profesor no dijo que estaría. Puede que aparezca 1 h tarde o que esté ocupado.

## Hallazgos

| # | Sev | Hallazgo | Evidencia |
|---|---|---|---|
| D1 | 🔴 | **La disponibilidad recurrente se corre 1 h cuando cambia el horario de verano.** Un profesor de Madrid pone L 09:00-12:00 en noviembre y se guarda `08:00-11:00` UTC. En abril se ofrecen slots de **10:00 a 12:30** hora local, y el de las 09:00 desaparece. Con Nueva York pasa igual (09→10). Para el alumno de Caracas la hora no cambia (10:00), así que el problema solo lo nota el profesor. Código: `timezone.py:113-157`, `availability.py:426-433`. | SONDA `test_bug_madrid_winter_schedule_shifts_one_hour_in_summer`, `test_bug_newyork_shift_while_caracas_student_sees_constant` |
| D2 | 🟠 | **Si se guarda la semana cerca del cambio de hora, quedan desfases mezclados.** Guardando el jueves 22-oct-2026 L-D 09-12 en Madrid: de jueves a sábado se usa CEST (`07:00` UTC) y el resto de días CET (`08:00`). Desde noviembre, los jueves se ofrecen a las **08:00** locales. El horario queda incoherente hasta que el profesor vuelva a guardarlo. | SONDA `test_bug_saving_near_dst_mixes_offsets_in_same_week` |
| D3 | 🟠 | **Las cohortes con horario fijo fallan en cuanto la serie pasa el cambio de hora.** `_generate_recurring_dates` (`cohorts.py:43`) calcula bien la hora con DST (09:00 Madrid son 08:00 UTC en invierno y 07:00 en verano). Pero cada fecha se valida con `is_within_teacher_availability`, que usa el UTC fijo: las sesiones posteriores al 28-mar dan "fuera de tu disponibilidad" y `close_cohort` rechaza toda la serie. | SONDA `test_bug_recurring_cohort_sessions_after_dst_rejected` |
| D4 | 🟠 | **Una excepción en una hora que no existe se guarda con el fin antes que el inicio.** Ejemplo: 28-mar-2027 de 02:30 a 03:00 en Madrid. La comprobación `end_local <= start_local` (`availability.py:199`) compara la hora de reloj, no UTC: se guarda 01:30Z→01:00Z (duración negativa) y la excepción no bloquea nada. | SONDA `test_bug_exception_in_dst_gap_stored_with_negative_duration` |
| D5 | 🔵 | **Una excepción de "todo el día" en un día de 23 h se devuelve como `is_full_day=False`**, porque `_to_exception_response` exige al menos 23h55 (`availability.py:571`). La interfaz la muestra como franja horaria. El día de 25 h sí funciona. | SONDA `test_bug_full_day_exception_on_23h_day_not_full_day` · control `test_ok_full_day_exception_on_25h_day` |
| D6 | 🔴 | **En América, las franjas de tarde que pasan de medianoche UTC se ofrecen pero no se pueden reservar.** Un profesor de Bogotá con 17:00-21:00 queda guardado como L 22:00-02:00 UTC. El listado del lunes ofrece 00:00-01:30Z (19:00-20:30 Bogotá), pero `is_within_teacher_availability` (`class_logic.py:48-55`) busca el `day_of_week` del **martes** UTC y responde **409 "no está dentro de la disponibilidad"**. Pasa con todas las zonas UTC-3 a UTC-8 con horario de tarde o noche, es decir, el público principal de la plataforma. | SONDA `test_bug_evening_slots_after_midnight_utc_offered_but_rejected` |
| D7 | 🟠 | **En ese mismo tramo de después de medianoche, las clases ya reservadas no marcan el slot como ocupado.** `availability.py:462-467` solo busca clases (y excepciones, l.441-445) cuyo inicio cae dentro del día UTC pedido. Una clase el martes a la 01:00Z sale como libre en el listado del lunes. Hoy D6 impide la doble reserva, pero si se arregla D6 sin esto, habrá dobles reservas. | SONDA `test_bug_class_after_midnight_not_busy_in_previous_day_listing` |
| D8 | 🔵 | **Una preferencia del alumno que pasa de medianoche UTC nunca se marca como `is_preferred`.** Por ejemplo, Caracas L 19-21 queda como `23:00-01:00`: la comparación de cadenas `start <= t < end` (`availability.py:540-545`) nunca se cumple, y el martes ni siquiera se busca. Las preferencias tienen además el mismo corrimiento por DST que D1. | SONDA `test_bug_preference_crossing_midnight_utc_never_preferred` |
| T1 | 🟠 | **Se acepta una zona horaria inválida para el alumno.** `PATCH /users/me/student-profile` recibe un `dict` sin validar (`users.py:443-487`): guarda `"Mars/Olympus"` y responde 200. El recálculo de preferencias falla sin avisar (`schedule_recalc.py:82`) y los correos caen a UTC. | SONDA `test_bug_student_invalid_timezone_accepted` |
| T2 | 🟠 | **Con el profesor, una zona inválida da 500.** `UpdateTeacherProfileRequest.timezone` no tiene validador y `ZoneInfo(new_tz)` lanza una excepción en `schedule_recalc.py:96` que nadie captura. (Se solapa con la parte 1.) | SONDA `test_bug_teacher_invalid_timezone_500` |
| T3 | 🟠 | **El recálculo al cambiar de zona arrastra el error de DST.** `_recalc_weekly_rows` obtiene la hora local con el desfase de **hoy**. Si el profesor guardó en invierno y cambia de zona en verano, su 09:00 pasa a ser 10:00 de forma permanente (`schedule_recalc.py:57`, `timezone.py:177`). Las clases ya reservadas no cambian, porque son instantes y eso es correcto. `Class.student_timezone` es una foto del momento de reservar, pero las respuestas la sustituyen por la zona actual (`classes.py:189-190`), así que no hace daño. | CÓDIGO (sonda equivalente en la parte 1, `test_teacher_tz_change.py`) |
| B1 | 🔴 | **Fechas sin zona horaria (naive) → 500 fuera de `/payments/book` y de los reagendados.** `BookTrialRequest` (`/classes/trial`), `GodModeCreateClassRequest`, `GodModeRescheduleClassRequest` y `GroupSessionCreate` no validan la zona (`schemas/classes.py:42-60,178-224`, `schemas/cohorts.py:165`). Al comparar fechas con y sin zona se lanza un `TypeError`. En god mode solo pasa si hay otra clase a menos de 3 h. | SONDA `test_bug_staff_trial_naive_datetime_500`, `test_bug_god_mode_create_naive_500_when_class_nearby`, `test_bug_group_session_naive_500` |
| B2 | 🟠 | **Con desfase (+05:30) en esos mismos endpoints, `day_of_week` sale con el día local.** No se convierte a UTC. Ejemplo: 20:30Z del lunes enviado como 02:00+05:30 queda como "Martes". El instante en Postgres es correcto, pero el día guardado no. | SONDA `test_bug_staff_trial_offset_not_normalized_day_of_week`, `test_bug_god_mode_create_offset_day_of_week` |
| B3 | 🟠 | **Sesiones grupales sin comprobar fecha pasada ni conflictos del alumno.** `_create_group_session` (`cohorts.py:682-800`) acepta una fecha de **hace 2 días**. Ignora las `pending_trial` del profesor (l.768, al contrario que AUD-02) y no comprueba si los alumnos ya tienen otra clase a esa hora con otro profesor (el alumno queda con dos clases a la vez). `_check_recurring_slot_available` (l.113) también ignora las `pending_trial`. | SONDA `test_bug_group_session_in_past_accepted`, `test_bug_group_session_overlaps_pending_trial`, `test_bug_group_session_ignores_participant_other_class` |
| B4 | 🔵 | **Se puede reservar a cualquier minuto (por ejemplo 09:07), sin ajustarse a la rejilla de 30 min.** `can_book_slot` no comprueba que el inicio esté entre los slots ofrecidos. Esto deja huecos de 7 a 23 min que ya no se pueden ofrecer. | SONDA `test_bug_book_misaligned_start_accepted` |
| B5 | 🔵 | **No hay antelación máxima: se puede reservar dentro de 3 años** (no existe `max_booking_days`). Las clases que caen después de un cambio de horario o de zona heredan D1. | SONDA `test_bug_no_max_advance_booking` |
| B6 | 🔵 | **Carreras de reserva.** `lock_booking_rows` solo se aplica en book y en los reagendados de `classes.py`. God mode (crear y reagendar), `/classes/trial` y las sesiones grupales no lo usan, y en la BD no hay ninguna restricción de exclusión sobre `(teacher_id, rango)`. Dos peticiones de staff a la vez pueden reservar dos veces el mismo hueco. No se puede probar en SQLite. | CÓDIGO |
| B7 | 🔵 | **El listado de slots no marca como ocupadas las clases que el alumno tiene con otros profesores** (`availability.py:462`). El alumno elige un slot "libre" y recibe un 409 "Ya tienes una clase". | CÓDIGO |
| B8 | 🔵 | **Tareas: `due_date_utc` acepta fechas pasadas o sin zona horaria** (`schemas/homework.py:11,38`). En Postgres, una fecha sin zona se interpreta en la zona de la sesión (UTC), así que no rompe, pero una tarea puede nacer ya vencida. | CÓDIGO |

## Funciona bien

- `/payments/book` y `RescheduleClassRequest` rechazan las fechas sin zona (422) y pasan a UTC las que traen desfase (+05:30), con el `day_of_week` correcto (`test_ok_book_offset_normalized_and_naive_rejected`).
- `end_time_utc` del cliente se ignora siempre: se recalcula a partir de `duration_minutes` o de la duración de la prueba. La duración regular tiene que coincidir con la del paquete (AUD-07).
- La antelación mínima es coherente en su límite: reservar justo en `ahora + min_booking_hours` se permite y un segundo antes no. `too_soon` usa el mismo criterio (`test_ok_min_notice_boundary_consistent`).
- Una excepción de bloqueo (vacaciones) impide reservar (`test_ok_book_inside_block_exception_rejected`).
- Los solapes se comprueban en los dos sentidos e incluyen el margen de preparación (D5 fix). La clase con otro profesor bloquea al alumno en la reserva. `pending_trial` ocupa hueco en las reservas individuales. Las clases canceladas o caducadas liberan el slot.
- Las excepciones puntuales se convierten con la fecha real, así que no les afecta el DST (salvo D4/D5). El día de 25 h funciona.
- `_generate_recurring_dates` calcula cada ocurrencia con la zona y la fecha reales (DST correcto). Solo falla la validación (D3).
- Las clases son instantes UTC, así que un cambio de zona del alumno o del profesor no las mueve. Los correos usan la zona actual de quien los recibe.

## Arreglos sugeridos

1. **D1/D2/D3/T3 (raíz):** guardar la disponibilidad y las preferencias en **hora local + zona del profesor o alumno** (`start_time_local`, `end_time_local`, `local_day_of_week`, `timezone`) y calcular el UTC **para cada fecha concreta** al generar slots y al validar, igual que ya se hace con las excepciones y con `_generate_recurring_dates`. Hasta tener la migración, el recálculo de zona puede leer esos campos locales y no volver a calcular nada a partir del UTC. Migración: rellenar los campos locales con la zona actual y el desfase de la fecha de `updated_at` (aproximado). Avisar a los profesores con DST para que revisen su horario.
2. **D6/D7:** generar los slots y validar sobre las **fechas locales** del profesor que cubren el día UTC pedido, o como mínimo consultar también las filas de `day_of_week-1` cuyo rango pasa de medianoche y ampliar la búsqueda de clases y excepciones a `[day_start, max(range_end))`. `is_within_teacher_availability` tiene que aceptar un rango que empezó el día UTC anterior.
3. **D4/D5:** construir las excepciones en UTC y comparar `end_utc <= start_utc`. Rechazar las horas que no existen (comprobar el viaje de ida y vuelta con `fold`). Guardar `is_full_day` como columna en vez de deducirlo de la duración.
4. **D8:** guardar las preferencias como rangos que pueden pasar de medianoche y comparar en minutos desde medianoche con la vuelta al día siguiente, o bien en hora local (punto 1).
5. **B1/B2/B8:** un tipo compartido `AwareUTCDatetime` (validador `require_timezone` y `astimezone(UTC)`) para **todos** los esquemas de entrada con fechas: `BookTrialRequest`, god mode, `GroupSessionCreate`, `CohortCloseRequest.start_date`, `HomeworkCreate/Update`.
6. **T1/T2:** `validate_timezone` en `update_student_profile` (cambiarlo a un esquema Pydantic) y un `field_validator` en `UpdateTeacherProfileRequest.timezone`. Que el registro u onboarding también valide.
7. **B3:** en `_create_group_session`, aplicar la antelación mínima y no aceptar fechas pasadas (`now + min_booking_hours`), incluir las `pending_trial` y comprobar los conflictos de cada participante con `can_book_slot(student_id=...)` o una consulta conjunta.
8. **B4/B5:** exigir que `start` coincida con un slot de `get_all_slots_utc` (o con `(start - range_start) % step == 0`) y añadir `max_booking_days` a `PlatformConfig`.
9. **B6:** `lock_booking_rows` en god mode, en la prueba creada por staff y en las sesiones grupales. A más largo plazo, una restricción `EXCLUDE USING gist (teacher_id WITH =, tstzrange(start, end+buffer) WITH &&)` en Postgres.
10. Actualizar `BUSINESS_RULES.md` (DST, medianoche UTC) y `KNOWN_ISSUES.md` con D1-D8 y B1-B3.
