# Auditoría TZ — Parte 4: frontend (estático + sondas)

Fecha: 2026-11-19 · Commit base: `136e301` · Alcance: `frontend/lib/{tzFormat,scheduleUtc,timezones}.ts` y toda
pantalla que muestra o construye horas (disponibilidad, agenda, reservas, reagendar, tareas, cohortes, God Mode, perfil/onboarding).

Severidad: 🔴 alta · 🟠 media · 🔵 baja. Evidencia: **SONDA** = test vitest que pasa (= el bug existe hoy) ·
**CÓDIGO** = trazado sin ejecutar.

Sondas: `frontend/__tz_probes__/` (config propia, fuera de `npm test`):
`cd frontend && npx vitest run --config __tz_probes__/vitest.config.ts` → **19/19 pasan** (16 bugs + 3 controles).
`helpers.ts` lleva copias literales de funciones no exportadas (citan su archivo:línea) y un puerto TS de
`backend/app/core/timezone.py::convert_local_time_to_utc` para simular el guardado. La zona "del navegador" se simula
cambiando `process.env.TZ` en caliente.

---

## 1. Hallazgos

| # | Sev | Hallazgo | Evidencia |
|---|---|---|---|
| U1 | 🔴 | **Reserva por día UTC, no por día local.** El alumno elige "lunes 23" en su calendario local y el front manda `?date=2026-11-23` sin zona (`hooks/useStudentData.ts:317`); el backend lo lee como día **UTC** (`availability.py:403`, `.replace(tzinfo=UTC)`). En Caracas (−4) la lista del "lunes" muestra los huecos de **dom 20:00 → lun 20:00** y **faltan los de lun 20:00-24:00** (aparecen al elegir el martes). Ningún consumidor filtra por `getDateKeyTz`: `schedule/page.tsx:350`, `RescheduleModal.tsx:391`, `GodModeAvailabilityPicker.tsx:104`, `cohorts/page.tsx:1133`. En Asia (+) pasa al revés (madrugada del día siguiente). | CÓDIGO (contrato front↔back) |
| U2 | 🔴 | **"Mis clases" (profesor y alumno) agrupa por día UTC.** `toUtcDateStr` = `toISOString().split("T")[0]` y el filtro usa `c.start_time_utc.slice(0,10)` (`teacher/dashboard/page.tsx:42,600,613`; `dashboard/classes/page.tsx:322,491`). Una clase lun 21:00 Caracas sale en el **martes**; "Hoy" cambia a mañana a las 20:00 Caracas; la tira usa `getUTCDate/getUTCDay`. | SONDA U4 (3 tests) |
| U3 | 🟠 | **En domingo la tira semanal salta a la semana siguiente.** `getWeekDates` hace `getUTCDate() - getUTCDay() + 1`; con `getUTCDay()=0` (domingo) da el lunes de **mañana**: el domingo de hoy no aparece (mismo código en ambos dashboards). | SONDA U4 |
| U4 | 🔴 | **Editar una tarea corre la fecha de entrega en cada guardado.** `EditHomeworkModal` precarga `due_date_utc.slice(0,10)` / `.slice(11,16)` (fecha/hora **UTC**) y al guardar la reinterpreta como **hora del navegador** (`teacher/homework/page.tsx:370-382`). Caracas: abrir y guardar sin tocar → +4 h; Madrid → −1/−2 h. Acumulativo. | SONDA U7 |
| U5 | 🟠 | **Tareas en zona del navegador, no del perfil.** Crear (`homework/page.tsx:621`) usa `new Date("YYYY-MM-DDTHH:MM:00")` (zona del dispositivo); mostrar sin `timeZone` en `homework/page.tsx:864-867,907-909` y en el alumno `dashboard/homework/page.tsx:132,289,409`. Profesor de viaje → vence a otra hora; además "Vence hoy a las…" usa el navegador. | SONDA U7 (2º test) + CÓDIGO |
| U6 | 🟠 | **Reagendar: "hoy" sale deshabilitado todo el día en LatAm.** `RescheduleCalendar` compara `new Date("YYYY-MM-DD")` (medianoche UTC) con `new Date(today.toDateString())` (medianoche local) → hoy cuenta como pasado en husos negativos (`RescheduleModal.tsx:105`). Es el BUG-03 ya corregido en `schedule/page.tsx:134` pero no aquí (también lo usa God Mode). Mismo bug en el calendario de tareas (`homework/page.tsx:172`): no se puede poner una tarea para hoy. `isToday` (`RescheduleModal.tsx:106`) usa `toISOString` → desde las 20:00 Caracas marca mañana. | SONDA U5 |
| U7 | 🟠 | **Fecha elegida mostrada un día antes.** `formatDateHuman` hace `new Date("2026-11-23").toLocaleDateString()` sin zona → en Caracas "domingo, 22 de noviembre" (`RescheduleModal.tsx:219-225`, `GodModeAvailabilityPicker.tsx:32-35`). Ya existe `formatCalendarDateHuman` que lo hace bien. | SONDA U6 |
| U8 | 🔴 | **Cambio de zona del alumno no llega al store.** `dashboard/profile/page.tsx:325-336` hace `setUser({...})` **sin `timezone`** (el profesor sí lo hace, `teacher/profile/page.tsx:646`). El layout relee la zona solo una vez por sesión (`dashboard/layout.tsx:69,87`) y `user` persiste en localStorage. Resultado: hasta recargar, `getMyDisplayTimezone()` sigue con la zona vieja en reservas, preferencias, reagendar… y la **rejilla de preferencias guarda con la zona vieja** (`dashboard/availability/page.tsx:172`). Mientras, `ClassCard` usa `class_.student_timezone` del servidor → dos zonas distintas en la misma pantalla. | CÓDIGO |
| U9 | 🟠 | **Rejilla semanal pierde la hora 23:00.** Al guardar, 23:00-24:00 se envía como `end_time_local:"23:59"` (`teacher/availability/page.tsx:106,118`); al recargar, `parseInt("23:59")=23` y el bucle `h < 23` no incluye 23:00 (`:67-76`; solo se contempla `"00:0x"`). Guardar de nuevo la **borra**. Igual en preferencias del alumno (`dashboard/availability/page.tsx:79-86,121,132`). | SONDA U1 |
| U10 | 🟠 | **`utcTimeToLocal` no usa la misma fecha de referencia que el backend.** El backend toma la próxima fecha del día **local** en la zona del perfil y combina la hora **local**; el front toma la próxima fecha en la zona del **navegador** y combina la hora **UTC** (`scheduleUtc.ts:7-23`). Si el día UTC ≠ día local (tardes en América) el instante es 24 h anterior; en la semana del cambio de hora se ve 1 h corrido (NY: dom 22:00 guardado el jue 5-mar se ve 21:00) y **re-guardar lo corrompe**. Viajero (navegador ≠ perfil) agrava el desfase de día. | SONDA U2 |
| U11 | 🟠 | **Horario semanal guardado como "HH:MM UTC" fijo → se corre 1 h tras el cambio de hora.** Madrid lun 09:00 guardado en enero se muestra (y se reserva) 10:00 en julio. El front muestra fielmente lo que hay; el arreglo es de backend (guardar hora local + zona, o renormalizar en cada DST). Cruzar con partes de backend. | SONDA U3 |
| U12 | 🟠 | **Cohortes / sesiones grupales en zona del navegador.** `toLocaleString` sin `timeZone` en `teacher/cohorts/page.tsx:471,649,854,1209`, `GroupWaitingPanel.tsx:88`, `schedule/page.tsx:853` (`toLocaleDateString()` sin locale ni zona). En la misma página, el calendario de horario fijo usa la zona del perfil (`:174`): pueden discrepar. | CÓDIGO |
| U13 | 🔵 | **`localDateTimeToUtcIso` de una sola pasada** (`ClassCard.tsx:104-125`, reagendar inline cuando no hay `onReschedule`): falla 1 h en las horas de alrededor del cambio (NY 8-mar 05:00 → 06:00 EDT; Madrid 25-oct 01:30 → 02:30). | SONDA U8 |
| U14 | 🔵 | **God Mode: `datetime-local` → zona del navegador** (`GodModeActionRunner.tsx:139-140,436`; `start_date` de cohorte, `review_date`). La etiqueta del picker mezcla navegador y perfil: `toLocaleString(...)` sin zona + "(hora local: …)" con zona del perfil (`:297`); listados `:206` sin zona. | CÓDIGO |
| U15 | 🔵 | **Etiqueta "+Xh respecto a ti"** usa el offset de hoy, no el del día de la clase (marzo: Madrid/Caracas da +5h para una clase de abril que será +6h) y redondea 45 min a ".8" (`ClassCard.tsx:128-163`). | SONDA U9 |
| U16 | 🔵 | **"Hoy" de los calendarios usa el reloj del navegador** (`schedule/page.tsx:75,133`, `CalendarPicker.tsx:33,48`, `RescheduleModal.tsx:44`). Viajero: puede elegir/deshabilitar el día equivocado cerca de medianoche. La fecha "Horarios disponibles — …" (`schedule/page.tsx:320`) está bien (medianoche local), salvo DST a medianoche. | CÓDIGO |
| U17 | 🔵 | **`TIMEZONE_OPTIONS` corto (16) y con alias legado.** Todas válidas, pero `America/Buenos_Aires` es alias *backward*. Faltan zonas de público probable: Guayaquil, Panamá, La Paz, Asunción, Montevideo, Santo Domingo, Puerto Rico, Centroamérica, Denver/Phoenix, Toronto, Lisboa, Berlín/Roma, Canarias, Kolkata, Sídney. El onboarding precarga la zona del navegador; si no está en la lista el `<select>` muestra "Seleccionar zona horaria..." pero envía la detectada (invisible para el usuario). El perfil del alumno usa otra lista distinta (`DEFAULT_TIMEZONES`, `dashboard/profile/page.tsx:56`). `TIMEZONE_TO_COUNTRY` mapea teléfono por zona → sin zona en lista cae en +58. | SONDA U10 + CÓDIGO |
| U18 | 🔵 | **`getMyDisplayTimezone()` no es reactiva** (lee `getState()`): tras cambiar la zona, los componentes no se re-renderizan hasta otro cambio; las queries de clases/slots no se invalidan (sus claves no llevan la zona) → `ClassCard` sigue con `teacher_timezone` viejo hasta el siguiente refetch. Fechas de admin/pagos/notificaciones/chat sin `timeZone` (navegador): inocuo pero inconsistente. | CÓDIGO |

## 2. Funciona bien

- `lib/tzFormat.ts`: todas las funciones de mostrar pasan `timeZone` explícito; `getMyDisplayTimezone` prioriza el perfil.
  Medias horas y 45 min (Kolkata, Kathmandu) correctos (SONDA control).
- `formatCalendarDateHuman` (mediodía UTC) no se mueve de día en ninguna zona, ni en UTC+14/−11 (SONDA control).
- `utcTimeToLocal` fuera de las semanas de DST coincide con el backend, también con Kolkata 09:00 ↔ 03:30Z.
- Booking (`schedule/page.tsx`): horas de slot con `formatTimeTz` en zona del perfil; `isPast` compara strings (BUG-03 corregido).
- Excepciones/vacaciones/días extra (`ExceptionsSection.tsx:116-126`): envía fecha + hora local + `timezone` del perfil; muestra con `timeZone`.
- Paquetes de horario fijo: envía hora local y el backend convierte; candidatos agrupados con `getDateKeyTz` (`cohorts/page.tsx:174`).
- `ClassCard`: hora, día y mes con la zona de quien mira (`class_.teacher_timezone`/`student_timezone`).
- Rejillas semanal/preferencias usan `local_day_of_week` (no el día UTC) y empiezan en lunes, igual que el backend (0=lunes).
- Profesor: al guardar perfil actualiza la zona del store.

## 3. Arreglos sugeridos

1. **U1**: mandar la zona al pedir slots (`&tz=<perfil>`) y que el backend calcule `[00:00, 24:00)` local → UTC
   (o pedir 2 días UTC y filtrar en el front con `getDateKeyTz(slot.start_time_utc, myTz) === date`).
2. **U2/U3**: reemplazar `toUtcDateStr`/`slice(0,10)` por `getDateKeyTz(…, myTz)`; construir la semana desde el día local
   (`(dow+6)%7` para que domingo cierre la semana actual).
3. **U4/U5/U13/U14**: una sola utilidad `localDateTimeToUtcIso(date, time, tz)` en `lib/tzFormat.ts` (dos pasadas) +
   `splitUtcToLocal(iso, tz)` para precargar formularios; usarla en tareas, ClassCard y God Mode; mostrar con `formatDateHumanTz/formatTimeTz`.
4. **U6/U7/U16**: "hoy" = `getDateKeyTz(new Date().toISOString(), myTz)` y comparar strings; `formatDateHuman` → `formatCalendarDateHuman`.
5. **U8/U18**: el perfil del alumno debe hacer `setUser({...user, timezone})`; `getMyDisplayTimezone` como hook
   (`useAuthStore(s => s.user?.timezone)`) y `invalidateQueries()` de clases/slots al cambiar la zona.
6. **U9**: al hidratar, tratar `"23:59"` como 24 (`endsWith(":59") → +1`), o mandar `"00:00"` y que el backend lo acepte como fin de día.
7. **U10/U11**: que el backend devuelva también `start_time_local`/`end_time_local` (los guardó) y el front deje de reconvertir;
   o pasar a `getNextWeekdayDate` la fecha local del perfil y combinar la hora local. De fondo, guardar el horario semanal en hora local + zona.
8. **U12**: `formatDateHumanTz`/`formatTimeTz` con `myTz` en cohortes y `GroupWaitingPanel`.
9. **U17**: lista única (o `Intl.supportedValuesOf("timeZone")` con buscador), quitar alias legados (`America/Argentina/Buenos_Aires`),
   y si la zona guardada no está en la lista añadirla como opción en vez de mostrar el placeholder.
