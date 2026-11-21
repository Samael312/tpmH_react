# Auditoría de zonas horarias, horarios y agenda

Fecha: 2026-11-19 · Rama BD: Neon **dev** (`ep-patient-band…`) · Commit base: `136e301`

Alcance: cambio de zona del profesor y del alumno, horario de verano (DST), disponibilidad semanal,
vacaciones y bloqueos, días extra, bloqueo por clases, clases externas (Preply) importadas de Google
Calendar, exportación a Calendar, correos, jobs, validación de reservas y todo el front que muestra o
construye horas.

Detalle por área (con nombre de cada sonda, `archivo:línea` y arreglos finos): `docs/_tz_parts/1_teacher_tz.md`
(cambio de zona del profesor), `2_dst_booking.md` (DST y reservas), `3_calendar_emails_jobs.md`,
`4_frontend.md`, `5_live.md` (pruebas en vivo). En la columna **Orig.** de cada tabla están los ids de esos
informes.

Severidad: 🔴 alta · 🟠 media · 🔵 baja. Evidencia: **VIVO** = reproducido contra localhost + Neon dev ·
**SONDA** = test que pasa (= el bug existe hoy) · **CÓDIGO** = trazado sin ejecutar.

---

## 0. Veredicto

- **Lo básico funciona.** Las clases son instantes UTC: ningún cambio de zona (profesor o alumno) las
  mueve. El cambio de zona del profesor conserva su hora local semanal y el ida y vuelta (Bogotá → Madrid →
  Bogotá, Bogotá → Auckland → Bogotá) es idéntico. Las vacaciones de día completo bloquean el día local.
  Desfases extremos (−12, +5:30, +5:45, +14) bien. Cada destinatario recibe la hora en su zona.
- **Dos causas de fondo explican la mayoría de fallos graves:**
  1. **El horario semanal se trata por día UTC.** Una franja que cruza la medianoche UTC (el caso típico:
     tardes en América, 18-22 Bogotá = 23:00-03:00Z) se ofrece pero no se puede reservar, y en ese tramo
     las clases ya reservadas, los bloqueos y Google no ocupan el hueco. Además el front pide los huecos de
     un "día" que el backend interpreta como día UTC. **Afecta al público principal de la plataforma.**
  2. **El horario semanal se guarda como `HH:MM` UTC fijo.** Con el cambio de verano el profesor de
     Madrid/Nueva York ofrece 1 h más tarde de lo que eligió durante 31-34 semanas al año, y cada recálculo
     de zona lo deja corrido para siempre.
- **Google Calendar corrompe datos con Preply:** la sync reescribe los eventos de Preply y, si Google no le
  deja, crea una clase y un evento duplicados en cada sync.
- **Validación floja de zonas y fechas:** zonas inválidas dan 500 (profesor) o se guardan (alumno); fechas
  sin zona dan 500 en prueba de staff, God Mode y sesiones grupales.
- **Front:** varias pantallas agrupan por día UTC o usan la zona del navegador; editar una tarea corre su
  fecha de entrega en cada guardado.

---

## 1. Cómo se probó

| Capa | Qué | Resultado |
|---|---|---|
| Sondas backend | `backend/tests/tz_probes/` (SQLite, harness de `tests/audit`, Google simulado, "ahora" congelado) | **72/72 pasan** (53 bugs + 19 controles) |
| Sondas frontend | `frontend/__tz_probes__/` (vitest, zona del navegador simulada con `process.env.TZ`) | **19/19 pasan** (16 bugs + 3 controles) |
| API en vivo | `tests/tz_probes/setup_qa.py` + `live_probe.py` con cuentas `qa_tz_*` (profesor Bogotá, alumnos Madrid y Kolkata) | §2-§7, marcados VIVO |
| UI en vivo | Chrome | **No se pudo**: extensión no conectada. Front cubierto por sondas y código |
| Google en vivo | — | **No se pudo**: el profesor QA no tiene token. Cubierto por sondas con Google simulado |

---

## 2. Causa 1 — Franjas que cruzan la medianoche UTC

`/availability/{u}/slots?date=D` amplía la fila del día D hasta el día siguiente si cruza medianoche, pero
carga clases, excepciones y Google **solo dentro del día UTC D**. `is_within_teacher_availability`
(`class_logic.py:26-61`) solo mira filas con `day_of_week` del día UTC del inicio.

| # | Sev | Hallazgo | Orig. | Evidencia |
|---|---|---|---|---|
| C1 | ~~🔴~~ | **Corregido (Fase 24).** ~~Se ofrece y no se reserva.~~ Bogotá 18-22 → huecos 19:00-22:00 locales con `is_available:true`; reservarlos da **409** "fuera de disponibilidad" (23:00Z sí da 201). Todas las zonas UTC-3…UTC-8 con tarde, y Asia/Oceanía por la mañana. | P1, D6, V1 | VIVO + SONDA |
| C2 | ~~🔴~~ | **Corregido (Fase 24, junto con C1).** ~~Clase reservada tras medianoche UTC no ocupa el hueco** al consultar el día anterior (clase 677 a 01:00Z → 01:00 sigue libre). Hoy C1 lo tapa; **si se arregla C1 solo, habrá doble reserva.** | P1, D7, V2 | VIVO + SONDA |
| C3 | ~~🔴~~ | **Corregido (Fase 24).** ~~Bloqueo parcial tras medianoche UTC no se aplica~~ (3 huecos de más el martes 1-dic). | P1, V3 | VIVO + SONDA |
| C4 | ~~🟠~~ | **Corregido (Fase 17), verificado en la Fase 24** (ahora Google se pide para la ventana local pedida + bloque): el busy de Google cubre todo el rango ofrecido (día UTC + rangos que cruzan medianoche + margen), no solo `[D 00:00, D+1 00:00)`. Un evento 00:00-01:00Z ya bloquea esos huecos. | G4 | SONDA invertida |
| C5 | ~~🔴~~ | **Corregido (Fase 24): `/slots` acepta `tz` y `end_date`; el hook del front manda la zona.** ~~El front pide el día local como día UTC~~ (`?date=YYYY-MM-DD` sin zona, `useStudentData.ts:317`, backend `availability.py:403`). Caracas: el "lunes" muestra dom 20:00 → lun 20:00 y le falta lun 20:00-24:00. Madrid: el "lunes 30" muestra martes 00-03. Mismo en reagendar, God Mode y cohortes. | U1, V4 | VIVO + CÓDIGO |
| C6 | ~~🟠~~ | **Corregido (Fase 24, intervalos UTC concretos).** ~~`is_preferred` nunca marca preferencias que cruzan medianoche UTC** (comparación de cadenas `"23:30" <= t < "01:00"`). | D8, P15, V8 | VIVO + SONDA |

**Hecho en la Fase 24:** motor único `app/core/slot_availability.py` (rejilla y validación de reservas), ventana por días locales (`tz`), clases/excepciones/Google por solape. **Pendiente: DST (§3)**: el horario sigue guardado como `HH:MM` UTC fijo; no se rediseñó el almacenamiento.

**Arreglo original:** generar huecos y validar sobre las **fechas locales del profesor** que cubren el rango pedido;
el endpoint recibe `date` + `tz` del que mira y devuelve `[00:00, 24:00)` local. Cargar clases, excepciones
y Google para `[min(inicio de rango), max(fin de rango))`. Preferencias como intervalos, no cadenas.
C1 y C2 se arreglan **juntos**.

---

## 3. Causa 2 — Horario de verano (DST)

`TeacherAvailability` y `StudentSchedulePreference` guardan `HH:MM` UTC + `day_of_week`, convertidos con el
desfase de la próxima ocurrencia **desde hoy** (`timezone.py:113-157`). Luego ese UTC fijo se aplica a
cualquier fecha.

| # | Sev | Hallazgo | Orig. | Evidencia |
|---|---|---|---|---|
| H1 | ✅ | **CORREGIDO Fase 26: horario semanal en hora local, expandido por fecha (test_f26)** ~~**El horario se corre 1 h con el cambio de verano.** Madrid 09-12 guardado en invierno → 10:00-13:00 desde el 29-mar-2027 (31/52 semanas; Nueva York 34/52). El calendario del alumno ya permite llegar a esas fechas. Alumnos sin DST (LatAm) no lo notan; el profesor sí.~~ | D1, U11, V5 | VIVO + SONDA |
| H2 | ✅ | **CORREGIDO Fase 26: sin UTC guardado no hay desfases mezclados** ~~**Guardar cerca del cambio de hora mezcla desfases** en la misma semana (jueves a 08:00 y resto a 09:00).~~ | D2 | SONDA |
| H3 | ✅ | **CORREGIDO Fase 26: cambiar de zona conserva la hora local, sin recalculo** ~~**El recálculo al cambiar de zona usa el desfase de hoy** → el error de 1 h queda permanente en la hora local (Madrid verano → Bogotá invierno: 09:00 pasa a 08:00 para siempre).~~ | P5, T3 | SONDA |
| H4 | ✅ | **CORREGIDO Fase 26: la validacion expande la disponibilidad por fecha** ~~**Cohortes con horario fijo se rechazan enteras** si la serie cruza el cambio de hora (las fechas se calculan bien; la validación usa el UTC fijo).~~ | D3 | SONDA |
| H5 | ✅ | **CORREGIDO Fase 26: el editor del profesor ya no convierte UTC (lib/weeklyLocal.ts); utcTimeToLocal queda solo para preferencias del alumno** ~~**`utcTimeToLocal` del front no usa la misma fecha de referencia que el backend** (zona del navegador, combina hora UTC): en la semana del cambio se ve 1 h corrido y **re-guardar lo corrompe**.~~ | U10 | SONDA |
| H6 | 🟠 | **Excepción en hora inexistente** (28-mar 02:30-03:00 Madrid) se guarda con fin antes que inicio y no bloquea nada. | D4 | SONDA |
| H7 | 🔵 | **Día completo en día de 23 h sale `is_full_day=False`** (umbral 23h55). | D5, P14 | SONDA |
| H8 | 🔵 | `localDateTimeToUtcIso` de una pasada (`ClassCard.tsx:104`) falla 1 h alrededor del cambio. Etiqueta "+Xh respecto a ti" usa el desfase de hoy. | U13, U15 | SONDA |

**Arreglo de fondo (HECHO en la Fase 26 para la disponibilidad del profesor; las preferencias del alumno siguen en UTC):** guardar disponibilidad y preferencias en **hora local + `local_day_of_week` + zona**
y calcular el UTC para cada fecha concreta (como ya hacen excepciones y `_generate_recurring_dates`).
La API devuelve también la hora local guardada y el front deja de reconvertir. Migración: rellenar los
campos locales con la zona actual; avisar a profesores con DST para que revisen su horario.
**Este rediseño resuelve a la vez la Causa 1 (§2)**: hacerlo como un único cambio del motor de huecos.

---

## 4. Cambio de zona del profesor y del alumno

| # | Sev | Hallazgo | Orig. | Evidencia |
|---|---|---|---|---|
| Z1 | ✅ | **CORREGIDO Fase 21 (menor 7): ahora 422 y no se guarda (sonda `test_fixed_profile_invalid_tz_*`).** ~~`PATCH /teachers/me/profile` con zona inválida → 500~~ (`ZoneInfoNotFoundError` sin capturar, `schedule_recalc.py:96`). Si la zona vieja estaba vacía, **guarda la basura** con 200 y luego rompe cohortes. | P2, T2, V6 | VIVO + SONDA |
| Z2 | 🟠 | **`PATCH /users/me/student-profile` guarda cualquier zona** (`"Mars/Olympus"`, `""`) con 200. Probable `RangeError` en el front; correos caen a UTC. | T1, V7 | VIVO + SONDA |
| Z3 | 🟠 | **CORREGIDO (Fase 27):** `timezone: null`/vacío/solo espacios en el PATCH del perfil de profesor da 422 (omitir el campo sigue valiendo); el PATCH `/users/me/student-profile` también valida (antes aceptaba cualquier cosa, incluso zonas inválidas) y `/users/me` rechaza `null`. Las filas antiguas con zona NULL se siguen leyendo igual (fallback sin cambios). Sonda invertida: `test_fixed_profile_null_tz_rejected`; tests en `tests/audit/test_f27_tz_null_reminders.py`. | P3 | CORREGIDO |
| Z4 | ✅ | **CORREGIDO Fase 26: PUT /me/weekly con otra zona pasa a ser la zona del perfil; ya no hay recalculo que corra el horario (POST /me/exceptions sigue sin comparar zona)** ~~**La zona del cuerpo de `PUT /me/weekly` y `POST /me/exceptions` no se compara con la del perfil**; el recálculo posterior parte de la del perfil y corre el horario N horas.~~ | P4 | SONDA |
| Z5 | 🔴 | **Front: el alumno cambia de zona y el store no se entera** hasta recargar (`dashboard/profile/page.tsx:325` no pasa `timezone`); la rejilla de preferencias **guarda con la zona vieja**. `getMyDisplayTimezone()` no es reactiva y las queries no se invalidan. | U8, U18 | CÓDIGO |
| Z6 | 🟠 | **Cambiar de zona (o crear un bloqueo) deja clases reservadas fuera de la disponibilidad o dentro del bloqueo sin avisar.** El resumen del recálculo se descarta (`teachers.py:169`). | P7, P8, V11 | VIVO + SONDA |
| Z7 | ✅ | **CORREGIDO Fase 26: el dia local ya no se recalcula; la columna local_day_of_week desaparece** ~~**Filas antiguas sin `local_day_of_week`** se corren de día al recalcular.~~ | P6 | SONDA |
| Z8 | 🔵 | Recálculo reescribe excepciones **pasadas**. | P9 | SONDA |
| Z9 | 🔵 | `PATCH /users/me` acepta `timezone`, responde 200 y no hace nada. | P10 | SONDA |
| Z10 | 🔵 | Alias legados aceptados (`EST` sin DST, `Etc/GMT+3` = UTC−3). `TIMEZONE_OPTIONS` corto (16), con alias `America/Buenos_Aires`, distinta lista en perfil del alumno; zona fuera de lista se envía pero se ve "Seleccionar…". | P11, U17 | SONDA |
| Z11 | 🔵 | `Class.teacher_timezone` en la respuesta es la zona **actual**; `student_timezone` la de reserva: inconsistente (hoy inocuo). | P16, V12 | VIVO |
| Z12 | 🔵 | El staff no puede corregir la zona de un profesor (ni admin ni God Mode). | P17 | CÓDIGO |

**Arreglo:** validador común (`validate_timezone` + rechazar `""`/`null`, lista de `zoneinfo` sin alias) en
los esquemas de profesor y alumno (este último pasa a Pydantic). Weekly/exceptions usan la zona del perfil
(409 si el cuerpo difiere). Respuesta del PATCH con clases afectadas. Front: `setUser({...user, timezone})`,
hook reactivo de zona e `invalidateQueries` de clases y huecos. Migración de `local_day_of_week` NOT NULL.

---

## 5. Reservas y validación de fechas

Validación de `POST /payments/book` (VIVO): sin zona 422 ✔ · fuera de disponibilidad, vacaciones, bloqueo,
solape, pasado, demasiado pronto 409 ✔ · duración ≠ paquete 400 ✔ · desfase `-05:00` normalizado ✔.

| # | Sev | Hallazgo | Orig. | Evidencia |
|---|---|---|---|---|
| R1 | 🔴 | **Fechas sin zona → 500** en `/classes/trial` (staff), God Mode crear/reagendar y sesiones grupales (sin `require_timezone`). | B1 | SONDA |
| R2 | 🟠 | Con desfase (+05:30) en esos endpoints, `day_of_week` se guarda con el día local. | B2 | SONDA |
| R3 | 🟠 | **Sesiones grupales**: aceptan fecha pasada, ignoran `pending_trial` y no comprueban otras clases de los alumnos. | B3 | SONDA |
| R4 | ~~🟠~~ | **Corregido (Fase 17):** `can_book_slot` consulta freebusy del hueco exacto si el profesor tiene Calendar activo (falla abierto con log si Google no responde; al reagendar ignora el evento de la propia clase). | G3 | SONDA invertida |
| R5 | 🔵 | Reserva fuera de la rejilla de 30 min (09:07 → 201, fragmenta la agenda). | B4, V9 | VIVO + SONDA |
| R6 | 🔵 | Sin antelación máxima (se reserva a 3 años). | B5 | SONDA |
| R7 | 🔵 | Sin `lock_booking_rows` en God Mode, prueba de staff y grupales; sin restricción de exclusión en BD. | B6 | CÓDIGO |
| R8 | 🔵 | Lista de huecos no marca clases del alumno con otros profesores (elige "libre" → 409). | B7 | CÓDIGO |
| R9 | 🔵 | `end_time_utc` incoherente se acepta y se recalcula sin avisar. | V10 | VIVO |
| R10 | 🔵 | Franjas semanales: `start == end` = 24 h, solapes y duplicados aceptados, minutos arbitrarios. Excepción parcial no puede cruzar medianoche local. | P12, P13, V13 | SONDA |
| R11 | 🔵 | Tareas: `due_date_utc` acepta pasado y sin zona. | B8 | CÓDIGO |

**Arreglo:** tipo compartido `AwareUTCDatetime` en **todos** los esquemas con fechas; `can_book_slot` exige
inicio alineado a la rejilla, consulta Google y `max_booking_days`; grupales con antelación, `pending_trial`
y conflictos por participante; `lock_booking_rows` en todas las rutas que crean clases.

---

## 6. Google Calendar (Preply), correos y jobs

| # | Sev | Hallazgo | Orig. | Evidencia |
|---|---|---|---|---|
| G1 | ~~🔴~~ | **Corregido (Fase 17):** la sync excluye `ClassType.external`; el evento de Preply nunca se toca. | G1 | SONDA invertida |
| G2 | ~~🔴~~ | **Corregido (Fase 17):** sin push de externas no hay bucle; además un error 403/5xx al editar un evento propio ya no se interpreta como «no existe» (no se recrea). | G1b | SONDA invertida |
| G3 | ~~🟠~~ | **Corregido (Fase 17):** existentes por `google_event_id IN (ids)` sin filtro de inicio + índice único `(teacher_id, google_event_id)` (migración `e4a1b2c3d4f5`, limpia duplicados) + `IntegrityError` ignorado. | G2 | SONDA invertida |
| G4 | 🔵 | Eventos de Preply rechazados o "libres" se importan y bloquean (freebusy los ignora). | G6 | SONDA |
| G5 | 🔵 | **Parcial (Fase 17):** el import normaliza a UTC (G7) y un freebusy fallido ya no se cachea en `/slots` (G5); sigue sin caché la llamada por `GET /slots` y el borrado fallido sigue bloqueando el hueco hasta la sync. Original: freebusy falla abierto sin registro; 1 llamada por `GET /slots` sin caché; borrado fallido en Google bloquea el hueco hasta la siguiente sync; el import no normaliza a UTC (`astimezone`). | G5, G7-G9 | SONDA / CÓDIGO |
| G6 | ~~🔵~~ | **Corregido (Fase 17):** `_due_calendar_sync` ya no cuenta las `external` como «clase cerca». | J4 | CÓDIGO |
| E1 | 🟠 | **Reagendar no reinicia `reminder_sent_at`**: el horario nuevo no recibe recordatorio. | E1 | SONDA |
| E2 | 🟠 | **CORREGIDO (Fase 27):** un único recordatorio para toda clase `confirmed`/`pending`/`pending_trial` no externa que empiece en las próximas 25 h y a más de 30 min; las reservas tardías lo reciben en el siguiente tick (`_due_reminders` vence ya). Idempotente con `reminder_sent_at`. Sin recordatorio de 1 h; con < 30 min no se avisa. Sonda invertida: `test_fixed_e2_short_notice_reminded`. | E2 | CORREGIDO |
| E3 | 🟠 | **Los correos no dicen la zona** y una zona vacía/inválida cae a UTC en silencio. | E3 | SONDA |
| E4 | 🔵 | Sin aviso de tarea por vencer. | E4 | CÓDIGO |
| J1 | 🔵 | `AsyncIOScheduler()` sin `timezone`: los cron "03:00 UTC" corren en la zona del servidor. | J1 | SONDA |
| J2 | 🔵 | `release_stale_enrollments` libera entre 24 y 48 h; prueba confirmada con la clase empezada no recibe Meet. | J2, J3 | CÓDIGO |

Funciona bien: paginación, recurrentes, todo el día y desfases/DST en la importación; exportación en UTC;
eventos propios no se reimportan; jobs por vencimiento precisos al segundo.

**Arreglo:** externas de solo lectura en la sync; buscar existentes por `google_event_id IN (…)` + índice
único `(teacher_id, google_event_id)`; limpiar duplicados ya creados; saltar `declined`/`transparent`;
`reminder_sent_at = None` al reagendar; zona en el texto del correo; `AsyncIOScheduler(timezone=UTC)`.

---

## 7. Frontend (resto)

| # | Sev | Hallazgo | Orig. | Evidencia |
|---|---|---|---|---|
| F1 | 🔴 | **"Mis clases" (profesor y alumno) agrupa por día UTC** (`toISOString().split("T")[0]`, `slice(0,10)`): clase lun 21:00 Caracas sale el martes; "Hoy" pasa a mañana desde las 20:00. | U2 | SONDA |
| F2 | 🟠 | **En domingo la tira semanal salta a la semana siguiente** (`getUTCDay()=0`). | U3 | SONDA |
| F3 | 🔴 | **Editar una tarea corre la fecha de entrega en cada guardado** (precarga UTC, guarda como navegador: Caracas +4 h por guardado). | U4 | SONDA |
| F4 | 🟠 | Tareas en zona del navegador al crear y mostrar. | U5 | SONDA |
| F5 | 🟠 | **"Hoy" deshabilitado en LatAm** en reagendar y en el calendario de tareas (BUG-03 corregido en `schedule` pero no aquí). | U6 | SONDA |
| F6 | 🟠 | Fecha elegida mostrada un día antes (`new Date("YYYY-MM-DD")` sin zona) en reagendar y God Mode. | U7 | SONDA |
| F7 | 🟠 | **La rejilla semanal pierde la hora 23:00** al recargar (`"23:59"` → 23) y al volver a guardar la borra. Igual en preferencias. | U9 | SONDA |
| F8 | 🟠 | Cohortes y sesiones grupales muestran en zona del navegador. | U12 | CÓDIGO |
| F9 | 🔵 | God Mode `datetime-local` en zona del navegador; "hoy" de los calendarios con reloj del navegador. | U14, U16 | CÓDIGO |

Funciona bien: `lib/tzFormat.ts` siempre pasa `timeZone`; `formatCalendarDateHuman` estable en toda zona;
excepciones, horario fijo y `ClassCard` usan la zona del perfil; rejillas usan `local_day_of_week` y lunes.

**Arreglo:** `getDateKeyTz(…, myTz)` en todas las agrupaciones; utilidades únicas
`localDateTimeToUtcIso(date, time, tz)` (dos pasadas) y `splitUtcToLocal(iso, tz)` para formularios;
"hoy" = `getDateKeyTz(now, myTz)`; `formatCalendarDateHuman` en vez de `new Date("YYYY-MM-DD")`;
fin de día `"24:00"`/`"00:00"` en la rejilla.

---

## 8. Orden de arreglo propuesto

| Fase | Qué | Por qué primero |
|---|---|---|
| **1** | Z1-Z4, Z9 (validar zonas), R1-R2 (`AwareUTCDatetime`) | Cambios pequeños, cortan 500 y datos basura |
| **2** | G1-G3 (+ limpieza de duplicados en Neon) | Hoy corrompe datos en cada sync |
| **3** | **Motor de huecos por fecha local** (§2 + §3): C1-C6, H1-H6, R4 (Google en la reserva), migración hora local | Causa raíz de casi todos los 🔴; C1 y C2 deben ir juntos |
| **4** | Front: C5 (`date`+`tz`), F1-F3, Z5, F5-F7, H5 | Depende de la API de la fase 3 para C5 y H5 |
| **5** | Z6 (avisos de clases afectadas), E1-E3, R3, R5-R8 | Calidad y avisos |
| **6** | Resto 🔵 (Z7-Z12, H7-H8, G4-G6, J1-J2, F4, F8-F9, R9-R11) | |

Al arreglar un bug su sonda empezará a fallar: invertir el assert y moverla a `tests/audit/` (backend) o a
los tests del front. Actualizar `BUSINESS_RULES.md` (DST, medianoche UTC) y `KNOWN_ISSUES.md`.

---

## 9. Reproducir y datos de prueba

- Backend: `cd backend && venv\Scripts\python.exe -m pytest tests/tz_probes -q` (72 tests, SQLite; ~3 min).
- Frontend: `cd frontend && npx vitest run --config __tz_probes__/vitest.config.ts` (19 tests, fuera de `npm test`).
- En vivo (solo Neon dev): `backend/tests/tz_probes/setup_qa.py` y `live_probe.py <fase>`; respuestas en
  `tests/tz_probes/out/*.json`.
- **Datos que quedaron en Neon dev** (`is_test_account=True`, correos `@audit-tpm.invalid`): usuarios 77
  `qa_tz_teacher` (TeacherProfile 11), 78 `qa_tz_student_mad` (StudentProfile 60), 79 `qa_tz_student_kol`
  (StudentProfile 61); links 38-39; paquete 966; enrollment 689; clases 674-680; excepciones 15-21;
  preferencias 6-7; disponibilidad del profesor 11. Estado final restaurado; modo de la plataforma sin tocar.
