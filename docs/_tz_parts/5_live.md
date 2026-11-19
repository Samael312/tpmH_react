# Parte 5: pruebas en vivo de zonas horarias y agenda

Fecha: 2026-11-19 · Backend `localhost:8000` (el que ya estaba levantado) · BD Neon **dev** (`ep-patient-band-akv3610u`, comprobado en `backend/.env` antes de empezar) · Modo de la plataforma: multi, sin tocar.

Scripts: `backend/tests/tz_probes/setup_qa.py` (crea las cuentas QA por ORM) y `backend/tests/tz_probes/live_probe.py <fase>` (API por HTTP). Las respuestas en crudo están en `backend/tests/tz_probes/out/*.json`.

**UI (Chrome): no se pudo probar.** `tabs_context_mcp` falló dos veces con "Browser extension is not connected" y `list_connected_browsers` devolvió `[]`. No hay capturas. Los hallazgos de frontend salen de leer el código y van marcados **CÓDIGO**.

**Google Calendar y la importación de Preply: no se pudieron probar en vivo.** El profesor QA no tiene token de Google, así que `get_teacher_busy_ranges` no devuelve nada.

## Escenario montado

- Profesor `qa_tz_teacher` en `America/Bogota` (UTC−5, sin horario de verano).
- Horario semanal, de lunes a viernes:
  - 09:00-12:00 local (14:00-17:00Z).
  - 18:00-22:00 local (23:00-03:00Z). Este tramo **cruza la medianoche UTC**. Se usa 18-22 y no 20-23 porque 20-23 en Bogotá es 01-04Z, que no cruza.
- Excepciones (ids 15-21):
  - Vacaciones de día completo el 2-dic.
  - Vacaciones en rango del 14 al 16-dic.
  - Bloqueo parcial el martes 1-dic de 20:00 a 21:00 local (01:00-02:00Z del 2-dic).
  - Bloqueo parcial el jueves 3-dic de 10:00 a 11:00.
  - Disponibilidad extra el sábado 5-dic de 14:00 a 17:00.
- Alumnos:
  - `qa_tz_student_mad` en `Europe/Madrid`, con prueba completada y paquete de 10 clases de 50 min pagado.
  - `qa_tz_student_kol` en `Asia/Kolkata` (+5:30).
- Reglas: antelación mínima 1 h, margen regular 10 min, paso de 30 min. Cada clase ocupa 60 min en la agenda.

## Hallazgos

| # | Sev | Hallazgo | Evidencia |
|---|---|---|---|
| V1 | 🔴 | **Los huecos de 00:00 a 03:00Z del tramo nocturno se ofrecen pero no se pueden reservar.** `/slots` amplía la fila del lunes 23:00-03:00Z hasta el martes. En cambio, `is_within_teacher_availability` (`class_logic.py:26`) solo busca filas con `day_of_week == start.weekday()` del instante pedido. Resultado: de 19:00 a 22:00 en Bogotá (los 5 días laborables) se ve libre y al reservar responde 409 "Ese horario no está dentro de la disponibilidad del profesor". Le pasa a cualquier profesor cuyo tramo local cruce la medianoche UTC: América por la tarde-noche, Asia/Oceanía por la mañana. | VIVO: `POST /payments/book` 2026-12-01T01:00Z (lunes 20:00 Bogotá) **409**; 2026-12-04T02:00Z (jueves 21:00) **409**. Los dos aparecen con `is_available:true` en `GET /slots?date=2026-11-30` y `?date=2026-12-03`. La reserva a las 23:00Z (lunes 18:00) dio **201**. |
| V2 | 🔴 | **Una clase reservada después de la medianoche UTC no ocupa el hueco cuando se consulta el día anterior.** `/slots` solo carga clases con `start_time_utc` dentro del día UTC pedido (`availability.py`, paso 5), pero la fila del día anterior genera huecos hasta las 03:00Z. Hoy el alumno no puede reservar ahí (V1), pero clases de God Mode, de reagendados o de antes de un cambio de zona sí. Si se arregla V1 sin arreglar esto, habrá **doble reserva visible**. | VIVO: clase 677 insertada por ORM a las 2026-12-01T01:00Z. `GET /slots?date=2026-11-30` sigue mostrando `01:00 is_available:true` (y 00:30, 01:30). |
| V3 | 🔴 | **Un bloqueo parcial que cae después de la medianoche UTC no se aplica.** Mismo filtro por día UTC, esta vez con las excepciones: el bloqueo del martes 20:00-21:00 Bogotá (2-dic 01:00-02:00Z) no se carga al pedir `date=2026-12-01`. | VIVO: se ofrecen 3 huecos de más (19:30, 20:00 y 20:30 del martes 1-dic, hora de Bogotá); 50 ofrecidos frente a 47 esperados, para los dos alumnos. Las vacaciones de día completo sí funcionan, porque se solapan con el día UTC. |
| V4 | 🟠 | **El selector manda la fecha local como si fuera fecha UTC.** `useAvailableSlots(date…)` pide `?date=YYYY-MM-DD` y el backend lo trata como día UTC. Lo que se muestra ese día local es en realidad otro rango. Ejemplos: el alumno de Madrid que elige "lunes 30" ve horarios del **martes 01 00:00-03:00**; el de Kolkata ve el martes de 04:30 a 07:30 bajo el título "lunes 30". Para alumnos en UTC−x (América), los huecos de su propia tarde-noche salen al elegir el día siguiente. Cada instante aparece una sola vez, sin duplicados, pero mal agrupado por día. | VIVO: fase `slots`, `ui_view_local`. CÓDIGO: `schedule/page.tsx:201` y `useStudentData.ts:318`. |
| V5 | 🟠 | **Cambio de horario de verano: la disponibilidad semanal queda fija en UTC.** Profesor en Madrid con 09-12 y 18-22 (guardado en invierno, UTC+1). El 29-mar-2027 se le ofrece **10:00-13:00 y 19:00-23:00 local**, una hora más tarde que lo que declaró. La documentación lo reconoce (BUSINESS_RULES §Disponibilidad, KNOWN_ISSUES), pero es alcanzable hoy: el calendario del alumno no tiene límite de fechas y el backend acepta marzo de 2027. Profesor en Bogotá con alumnos en Madrid o Nueva York: sus horas locales sí cambian 1 h, que es lo correcto porque el instante no cambia. | VIVO: fase `dst`, `out/dst_teacher_madrid.json` (26-mar: 09:00/08:00Z; 29-mar: 10:00/08:00Z). |
| V6 | 🟠 | **`PATCH /teachers/me/profile` con una zona inválida da 500.** En `_recalc_exception_rows`, `ZoneInfo()` lanza `ZoneInfoNotFoundError`, que no es `ValueError`. Se hace rollback y el perfil queda intacto. | VIVO: `{"timezone":"Mars/Olympus"}` → **500**; la zona sigue en `America/Bogota`. |
| V7 | 🟠 | **`PATCH /users/me/student-profile` guarda cualquier zona, incluida la vacía.** Recibe un `dict` sin validar. Con `"Mars/Olympus"` guardado, el front usa `getMyDisplayTimezone()` → `toLocaleTimeString({timeZone})` → `RangeError`, así que es probable que se rompan las pantallas de agenda del alumno (no verificado en el navegador). | VIVO: `Mars/Olympus` → **200** y se guarda; `""` → **200**. Se restauró `Asia/Kolkata`. CÓDIGO: `lib/tzFormat.ts:37`. |
| V8 | 🟠 | **`is_preferred` nunca marca preferencias que cruzan la medianoche UTC.** Compara cadenas `"23:30" <= t < "01:00"` y filtra por el `day_of_week` del día pedido. | VIVO: preferencia de Madrid martes 00:30-02:00 (guardada como lunes 23:30-01:00Z). Los huecos 23:30Z, 00:00Z y 00:30Z del 30-nov dan `is_preferred:false`. El tramo normal (Kolkata 12:30-15:30Z) sí marca 14:00, 14:30 y 15:00. |
| V9 | 🔵 | **Se puede reservar fuera de la rejilla de 30 min.** Una clase a las 09:07 se aceptó y fragmenta la agenda: bloquea los huecos de 09:00, 09:30 y 10:00. | VIVO: 14:07Z del 7-dic → **201** (clase 678). |
| V10 | 🔵 | **Si `end_time_utc` no cuadra con la duración, se acepta en silencio.** El servidor recalcula el fin, lo cual es correcto, pero no avisa. | VIVO: se envió 14:00-16:00 con 50 min → **201**; guardado 14:00-14:50 (clase 679). |
| V11 | 🔵 | **El cambio de zona del profesor no avisa de nada.** `recalculate_teacher_schedule_timezone` devuelve `weekly_changes` y `exception_changes`, pero el endpoint los descarta. Además, las clases ya reservadas quedan fuera de la nueva disponibilidad sin ningún aviso: al pasar a Madrid, la clase 676 cae a las 00:00 local. | VIVO: fase `tz_teacher_madrid`; el PATCH devuelve solo el perfil. |
| V12 | 🔵 | **`ClassResponse.teacher_timezone` muestra la zona actual del profesor, no la guardada en la clase.** En BD sigue `America/Bogota` y la API devuelve `Europe/Madrid`. `student_timezone` se queda con la zona del momento de reservar, de modo que las dos se comportan distinto. Hoy el front no usa estos campos para mostrar horas. | VIVO + BD: clases 675 y 676. CÓDIGO: `classes.py:189`. |
| V13 | 🔵 | **Una franja semanal con fin anterior al inicio se acepta y se interpreta como que cruza la medianoche local.** Sábado 22:00-02:00 Bogotá se guardó como domingo 03:00-07:00Z y los huecos se ofrecen bien. El editor del front no puede crearla (termina en "23:59", y con eso se pierde el hueco de las 23:00). | VIVO: fase `invalid_tz`; luego se restauró el horario. |

## Validación de `POST /payments/book` (alumno de Madrid, enrollment 689)

| Caso | Código | Comentario |
|---|---|---|
| Fecha sin zona | **422** | "La fecha debe incluir zona horaria" ✔ |
| Inicio desalineado (09:07) | **201** | V9 |
| Fuera de disponibilidad (13:00 local) | 409 | ✔ |
| Dentro de vacaciones (2-dic) | 409 | ✔ (mensaje genérico de disponibilidad) |
| Dentro del bloqueo parcial (3-dic 10:00) | 409 | ✔ |
| Solape con la clase A (+30 min) | 409 | ✔ "El profesor ya tiene una clase…" |
| Fin − inicio ≠ duración | **201** | V10, el fin se recalcula |
| Fecha pasada | 409 | Mensaje de antelación, no de "pasado" |
| Demasiado pronto (+20 min) | 409 | ✔ |
| Desfase explícito `-05:00` | 201 | Guardado bien como 15:00Z ✔ |
| Duración 80 con paquete de 50 | 400 | ✔ |

## Funciona bien

- `PUT /availability/me/weekly` convierte bien a UTC, incluido el corrimiento de día: Auckland lunes 09-12 queda como domingo 20-23Z con `local_day_of_week=0`.
- Las excepciones se convierten con la fecha real, sin ambigüedad de horario de verano. Los rangos de varios días crean una fila por día.
- En los días sin cruce de medianoche UTC, los instantes ofrecidos coinciden **exactamente** con lo esperado, y vistos desde Madrid y desde Kolkata son los mismos. Las vacaciones 14-16-dic dan 12/12 y la semana con el profesor en Madrid 47/47.
- La disponibilidad extra del sábado aparece. Las vacaciones de día completo bloquean también el tramo nocturno.
- Al cambiar el profesor de zona (Bogotá → Madrid, Bogotá → Auckland), se conserva la hora local semanal (09-12 / 18-22) tal como dice BUSINESS_RULES. Las excepciones mantienen fecha y hora de reloj. El ida y vuelta (Bogotá → Madrid → Bogotá y Bogotá → Auckland → Bogotá) es **idéntico**, sin deriva.
- Las clases reservadas **conservan su instante UTC** tras cualquier cambio de zona del profesor o del alumno.
- Las preferencias del alumno se recalculan conservando la hora local (Madrid → Kolkata → Madrid es idéntico).
- El editor de disponibilidad del profesor (CÓDIGO) pinta las filas con `local_day_of_week` y la zona del perfil.

## Datos creados en Neon dev (para limpiar)

- Usuarios (`is_test_account=True`, contraseña `QaTz!2026audit`, correo `@audit-tpm.invalid`):
  - 77 `qa_tz_teacher` (TeacherProfile 11).
  - 78 `qa_tz_student_mad` (StudentProfile 60).
  - 79 `qa_tz_student_kol` (StudentProfile 61).
- StudentTeacherLink 38 y 39; `TeacherProfile(11).students = [60, 61]`.
- Package 966 y Enrollment 689 (10 créditos; quedan 5 ocupados).
- Clases:
  - 674: prueba completada, creada por ORM.
  - 675, 676, 678, 679, 680: reservadas por API.
  - 677: creada por ORM, alumno Kolkata.
- Excepciones 15-21.
- Filas `TeacherAvailability` de `teacher_id=11`; los ids actuales salieron del último PUT de restauración.
- Preferencias 6 y 7 del alumno 60.
- Correos: las 5 reservas `201` dispararon correos al profesor y al alumno, a direcciones `.invalid`.

## Estado final

- Profesor en `America/Bogota`, con el horario semanal y las excepciones QA originales.
- `qa_tz_student_mad` en `Europe/Madrid` y `qa_tz_student_kol` en `Asia/Kolkata`.
- Modo de la plataforma sin tocar (multi, destacado id 1).
