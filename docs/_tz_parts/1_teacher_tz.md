# Parte 1 — El profesor cambia de zona horaria (backend)

Alcance: `app/core/timezone.py`, `app/core/schedule_recalc.py`, `endpoints/availability.py`,
`endpoints/teachers.py` (`PATCH /teachers/me/profile`), `endpoints/users.py` (`PATCH /users/me`),
`core/class_logic.py::is_within_teacher_availability`.
Sondas: `backend/tests/tz_probes/test_teacher_tz_change.py`. **32/32 pasan** (21 `test_bug_*` = hallazgo
confirmado hoy; 11 `test_ok_*` = controles de lo que funciona).
Ejecutar: `cd backend && venv\Scripts\python.exe -m pytest tests/tz_probes/test_teacher_tz_change.py -q` (SQLite, sin `.env`).

Severidad: 🔴 alta · 🟠 media · 🔵 baja. Evidencia: **SONDA** = test que pasa · **CÓDIGO** = trazado sin ejecutar.

## Hallazgos

| # | Sev | Hallazgo | Evidencia |
|---|---|---|---|
| P1 | 🔴 | **Franjas semanales que cruzan la medianoche UTC están rotas** (caso típico: profe en Bogotá/Caracas/México con tardes, p.ej. 17-21 Bogotá = 22:00-02:00 UTC). (a) `GET /availability/{u}/slots` del lunes genera slots hasta el martes 02:00, pero busca clases/excepciones solo dentro del día UTC pedido (`availability.py:439,465` y filtro de excepciones): **una clase confirmada o un bloqueo del martes 00:00-02:00 se ofrecen como libres**. (b) La validación de reserva del alumno (`class_logic.py:49`, `enforce_availability=True` en `payments.py:555,687,774` y `classes.py:464`) solo mira filas con `day_of_week` del día UTC del inicio: **el slot martes 00:30 que se ofrece se rechaza al reservar** ("no está dentro de la disponibilidad"). La consulta del martes tampoco ve la parte nocturna de la fila del lunes. | SONDA `test_bug_wrapped_slot_ignores_next_day_classes_and_blocks`, `test_bug_wrapped_slot_after_midnight_rejected_by_booking_validation` |
| P2 | 🔴 | **`PATCH /teachers/me/profile` no valida `timezone`.** `"Foo/Bar"`/`"UTC+3"` → **500** (`ZoneInfo(new_tz)` sin capturar en `schedule_recalc.py:96`; la transacción se pierde). Si la tz vieja está vacía/None, no hay recalc y **se guarda la basura** con 200 (`teachers.py:166-168`, `schedule_recalc.py:133`). Luego rompe quien hace `ZoneInfo(teacher.timezone)` (cohortes `cohorts.py:384,444`: `"Foo/Bar" or "UTC"` no cae al respaldo). | SONDA `test_bug_profile_invalid_tz_crashes_500[Foo/Bar\|UTC+3]`, `test_bug_profile_invalid_tz_saved_when_old_tz_empty` |
| P3 | 🟠 | **`""` y `null` se aceptan y desactivan el recalc siguiente.** `setattr` guarda `""`/`None`; el `if new_timezone` salta el recalc, y el próximo cambio real (p.ej. → Tokio) tiene `old_tz` vacío → `if not old_tz` → **la disponibilidad queda con el UTC viejo** (09-11 Bogotá pasa a ser 23-01 Tokio). | SONDA `test_bug_profile_empty_tz_saved_then_next_change_skips_recalc[\|None]` |
| P4 | 🟠 | **La tz del cuerpo de `PUT /availability/me/weekly` (y de `POST /me/exceptions`) no se guarda ni se compara con `TeacherProfile.timezone`** (`availability.py:84,87`). El front manda `getMyDisplayTimezone()`. Si difiere del perfil (default `"UTC"`, navegador en otra tz, PATCH y PUT concurrentes desde dos pestañas), el recalc posterior usa como `old_tz` la del perfil y **corre el horario N horas** (09-11 Bogotá terminó en 14-16 Bogotá). | SONDA `test_bug_weekly_tz_mismatch_with_profile_breaks_later_recalc` · CÓDIGO (concurrencia: sin bloqueo ni versión) |
| P5 | 🟠 | **El recalc usa el offset DST de HOY, no el del día en que se guardó la franja** (`timezone.py:149,196` → `get_next_weekday_date` desde `now`). Franja guardada en verano en Madrid (09:00 = 07:00 UTC) y cambio a Bogotá en invierno → 07:00 UTC se lee como 08:00 Madrid → **queda 08:00 Bogotá para siempre**. Agrava el problema conocido "DST no se recalcula" (BUSINESS_RULES §Disponibilidad): el error de 1 h se vuelve permanente en la hora local. | SONDA `test_bug_dst_recalc_bakes_wrong_local_hour` |
| P6 | 🟠 | **Filas antiguas sin `local_day_of_week` se corren de día** al recalcular: el respaldo usa `day_of_week` (día UTC) como día local (`schedule_recalc.py:55`). Lunes 08:00 Tokio (= dom 23:00 UTC) → tras pasar a Bogotá queda **domingo** 08:00. Solo afecta si hay filas viejas con NULL (la columna es nullable). | SONDA `test_bug_legacy_row_without_local_day_shifts_day` |
| P7 | 🟠 | **El cambio de tz deja clases ya reservadas huérfanas sin avisar.** Las clases (instante UTC) correctamente no se mueven, pero la disponibilidad y excepciones sí: una clase puede quedar fuera del horario o **dentro de un bloqueo** que antes no la tocaba. El resumen `weekly_changes`/`exception_changes` de `recalculate_teacher_schedule_timezone` **se descarta** (`teachers.py:169`); la respuesta no trae avisos ni lista de clases afectadas. | SONDA `test_bug_tz_change_silently_orphans_booked_class` |
| P8 | 🟠 | **Crear un bloqueo/vacaciones encima de una clase confirmada → 201 sin aviso**; la clase sigue confirmada y el alumno no se entera (`availability.py:208` solo mira solape con otras excepciones). | SONDA `test_bug_block_exception_over_booked_class_accepted` |
| P9 | 🔵 | **El recalc reescribe también excepciones pasadas** (`schedule_recalc.py:98` sin filtro de fecha): el historial de bloqueos cambia de instante. | SONDA `test_bug_tz_change_rewrites_past_exceptions` |
| P10 | 🔵 | **`PATCH /users/me` acepta `timezone`** (`schemas/user.py:98`) pero `User` no tiene esa columna: 200 y no hace nada (ni perfil ni recalc). Engañoso para el front/API. | SONDA `test_bug_users_me_timezone_silently_ignored` |
| P11 | 🔵 | **Alias legados aceptados**: `"EST"` (offset fijo, sin DST) y `"Etc/GMT+3"` (= UTC−3, signo invertido) pasan `validate_timezone`. No hay lista blanca IANA canónica. | SONDA `test_bug_legacy_alias_tz_accepted` |
| P12 | 🔵 | **Validación de franjas semanales floja** (`schemas/availability.py`): `start == end` se guarda como **24 h**; `start > end` se toma como nocturna sin confirmar (18:00-09:00 = 15 h); solapes y duplicados se aceptan; minutos arbitrarios (09:07) generan slots a :07/:37. `24:00` sí se rechaza (422). | SONDA `test_bug_weekly_validation_gaps`, `test_ok_weekly_rejects_24_00` |
| P13 | 🔵 | **Excepción parcial no puede cruzar medianoche local** (22:00-02:00 → 400, `availability.py:199`): un extra nocturno exige dos excepciones. | SONDA `test_bug_partial_exception_cannot_cross_local_midnight` |
| P14 | 🔵 | **Día completo en día de cambio DST se reporta como parcial**: `is_full_day = duración ≥ 23:55` (`availability.py:571`); el 14-mar-2027 en Nueva York dura 23 h → `is_full_day=False` en la UI. | SONDA `test_bug_full_day_on_dst_day_reported_as_partial` |
| P15 | 🔵 | **`is_preferred` falla con preferencias que cruzan medianoche UTC**: comparación de strings `"22:00" <= t < "02:00"` siempre falsa, y filtra preferencias por el día UTC de la fecha pedida (`availability.py:532,543`). | CÓDIGO |
| P16 | 🔵 | **Instantánea `Class.teacher_timezone`/`student_timezone` no se usa**: la respuesta de clase la sobrescribe con la tz actual (`classes.py:189-190`). Tras un cambio, no se puede saber en qué tz se pactó la clase (emails/ICS usan la tz viva, lo cual sí es correcto para mostrar). | CÓDIGO |
| P17 | 🔵 | **No hay otro punto para cambiar la tz del profesor** (ni admin `PATCH /admin/users/{id}` ni God Mode): solo `PATCH /teachers/me/profile` (perfil y onboarding). Bien por consistencia, pero el staff no puede corregir una tz rota (P2/P3) sin tocar la BD. | CÓDIGO |

## Funciona bien

- Conversión local→UTC con día UTC correcto en offsets extremos: Bogotá (−5, cruza a día siguiente), Tokio (+9), Kolkata (+5:30), Kiritimati (+14), `Etc/GMT+12` (−12), y franja local nocturna 22:00-02:00 (`test_ok_put_weekly_extreme_offsets`, 6 casos).
- Recalc al cambiar de tz preserva **hora local** y `local_day_of_week`, y recalcula `day_of_week` UTC, incluso con cambio de día (Bogotá→Tokio, Tokio→UTC−12, Kolkata↔Kiritimati) (`test_ok_tz_change_preserves_local_time_and_day`).
- Idempotente: misma tz dos veces o tz distinta con mismo offset (Bogotá→Lima) no cambia nada (`test_ok_same_tz_twice_and_same_offset_is_noop`).
- Clases ya reservadas **no se mueven** (instante UTC) y su snapshot `teacher_timezone` no se toca (`test_ok_booked_class_instant_not_moved_by_tz_change`).
- Excepciones de día completo bloquean el **día LOCAL** (00:00 local → 00:00 local siguiente), una fila por día en rangos `end_date` (`test_ok_full_day_block_covers_local_day_multi_day`). Al cambiar de tz se reinterpretan con la misma fecha/hora local (decisión de diseño coherente: "vacaciones el 17 de agosto" sigue siendo el 17).
- Las preferencias del alumno no se tocan cuando cambia la tz del profesor (solo con la tz del propio alumno).
- `PUT /me/weekly` y `POST /me/exceptions` sí validan la tz del cuerpo (400 si inválida) y `end_date < date`.

## Arreglos sugeridos

1. **P1**: en slots y en `is_within_teacher_availability`, consultar filas de `day_of_week ∈ {d−1, d}` (la del día anterior aporta su tramo post-medianoche) y ampliar la ventana de clases/excepciones/Google a `[day_start, max(range_end))`. Mejor aún: guardar franjas por hora local + tz y expandir a instantes por fecha (resuelve también P5/DST). Test de regresión: las dos sondas P1 invertidas.
2. **P2/P3/P11**: validador Pydantic en `UpdateTeacherProfileRequest.timezone` (y `StudentProfileUpdate`) con `validate_timezone`, rechazar `""`/`null` (422) y, si se quiere, exigir nombres de `zoneinfo.available_timezones()` sin alias `Etc/*`/`EST`.
3. **P4**: en `PUT /me/weekly` y `POST /me/exceptions` usar `TeacherProfile.timezone` (ignorar o exigir que el cuerpo coincida, 409 si no). Opcional: guardar la tz de origen en cada fila (`source_timezone`) y recalcular desde ella.
4. **P5**: guardar la hora local (`start_time_local`, `end_time_local`) en la fila y recalcular desde ella, no desde el UTC con el offset de hoy.
5. **P6**: migración que rellene `local_day_of_week` en filas NULL (con la tz actual del profesor) y hacerla NOT NULL.
6. **P7/P8**: tras el recalc (y al crear un bloqueo), calcular clases futuras confirmadas que quedan fuera de disponibilidad o dentro de bloqueos; devolverlas en la respuesta y notificar al profesor (o pedir confirmación).
7. **P9**: recalcular solo excepciones con `end_time_utc > now`.
8. **P10**: quitar `timezone` de `UpdateProfileRequest` o redirigirlo al perfil correspondiente con recalc.
9. **P12-P15**: validar `start < end` salvo nocturna explícita, rechazar solapes, limitar a múltiplos de 15/30 min; permitir excepción nocturna; `is_full_day` guardado como columna; comparar preferencias como intervalos de `datetime`.
