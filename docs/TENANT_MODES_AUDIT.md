# Auditoría de modos single-tenant y multi-tenant

Fecha: 2026-11-19 · Rama BD: Neon **dev** (`ep-patient-band…`) · Commit base: `136e301`

Modo de la plataforma = `PlatformConfig.is_single_tenant` + `PlatformConfig.featured_teacher_id`
(+ respaldo `FEATURED_TEACHER_USERNAME` del `.env`). Se cambia en `/admin/settings`
(`PATCH /admin/platform-config`, `backend/app/api/v1/endpoints/admin.py:1057`).

## 0. Veredicto

- **Camino feliz de cada modo: funciona.** `tests/flow` pasa entero en multi (109/109) y en
  single (ver §1). Registro, login, landing, agenda y vínculos básicos se comportan como dicen
  los docs.
- **Los fallos están en los bordes y en el cambio de modo.** Tres causas de fondo explican casi
  todo:
  1. **El profesor destacado se resuelve de 6 formas distintas** (BD / BD+env / BD+env+`"mar12"`,
     con o sin `approved`). Según la pantalla, el mismo alumno ve a un profesor distinto o a ninguno.
  2. **El vínculo alumno↔profesor tiene dos fuentes de verdad** (`StudentTeacherLink` para el alumno,
     `TeacherProfile.students` para el profesor) que varios flujos desincronizan.
  3. **Cambiar de modo no valida ni migra nada** (salvo un backfill parcial single→multi).
- **Seguridad transversal grave:** `teacher_admin` (un profesor con permisos de staff) puede cambiar
  el modo, la cuenta de cobro de toda la plataforma y aprobarse dinero a sí mismo.

Severidad: 🔴 alta · 🟠 media · 🔵 baja. Evidencia: **VIVO** = reproducido contra el servidor
local + Neon dev · **SONDA** = test SQLite que pasa (ver §7) · **CÓDIGO** = trazado sin ejecutar.

---

## 1. Cómo se probó

| Capa | Qué | Resultado |
|---|---|---|
| Regresión | `pytest tests/flow --run-flow-tests` contra Neon dev | multi: **109 passed** · single (destacado `mar12`): **107 passed, 2 skipped** · los 2 de compra completa con destacado `flowtest_teacher`: **3 passed** |
| Regresión | `pytest tests/audit` (SQLite) | **607 passed, 1 skipped** |
| Sondas nuevas | 54 tests SQLite escritos para esta auditoría (17 single, 25 multi, 12 transición) | **54/54 pasan** = cada bug descrito existe hoy |
| API en vivo | script `probe.py` con cuentas `flowtest_*` y 2 alumnos QA nuevos | §2-§5, marcados VIVO |
| UI en vivo | Chrome (extensión) en `localhost:3000`, ambos modos | §2-§5, marcados VIVO |
| Estático | 4 agentes: backend single, backend multi, frontend/UX, transición | ~70 hallazgos, deduplicados aquí |

No se probaron en vivo los flujos que reservan o pagan (envían correos reales); quedan cubiertos por sondas.

---

## 2. Transversal: profesor destacado (afecta a single y a la transición)

| Sitio | Fuente | Respaldo env | Respaldo `"mar12"` | Exige `approved` |
|---|---|---|---|---|
| `payments.py:91` `_get_featured_teacher` (book, booking-status) | BD | sí | no | **no** |
| `availability.py:276` (slots, `featured-teacher/username`) | BD | sí | no (const. muerta l.273) | solo slots |
| `public.py:25,98` landing | BD | sí | **sí** | sí |
| `users.py:631` `/users/me/teachers` | BD | **no** | no | no |
| `core/chipi/context.py:53` | BD | no | no | no |
| `core/platform_config.py:98` `/admin/platform-config` | BD | no | no | no |
| Front `useFeaturedTeacher` (`useStudentData.ts:597`) | **env primero** | — | — | código muerto |

| # | Sev | Hallazgo | Evidencia |
|---|---|---|---|
| F1 | 🔴 | **Destacado no aprobado aceptado y reservable.** `PATCH` acepta `pending`/`suspended`/rechazado; `booking-status` ofrece prueba con él; `book` da 201 con suspendido. Landing queda vacía. Profesor que borra su cuenta sigue `approved` y reservable ("Usuario eliminado"). | VIVO (`ili02` pending → `needs_trial` con ili02, landing `[]`) · SONDA (suspendido → 201) |
| F2 | 🟠 | **Destacado vacío → pantallas en desacuerdo.** Config dice `None`; slots/booking/landing usan `mar12` del `.env`; `/users/me/teachers` = `[]`; `/dashboard/teachers` spinner infinito. | VIVO (los 4 endpoints + captura spinner 20 s) |
| F3 | 🟠 | **Se puede guardar single sin destacado**, y desde la UI **no se puede vaciar** el destacado (`settings/page.tsx:588` manda `null`, el back solo limpia con `""`, `admin.py:1084`). | CÓDIGO + VIVO (vía API `""` sí limpia) |
| F4 | 🔵 | `NEXT_PUBLIC_FEATURED_TEACHER_USERNAME` no se usa; `frontend/doc/README.md:21` dice default `"mar12"`, `next.config.ts:70` dice `""`. Sin fila de config `users.py:631` trata como multi y el resto como single. | CÓDIGO |

**Arreglo:** una sola `resolve_featured_teacher(db, require_approved=True)` usada por los 6 sitios,
sin `"mar12"`; `PATCH` exige destacado `approved` si el estado final es single; al suspender/borrar
al destacado, avisar o bloquear.

---

## 3. Modo SINGLE

| # | Sev | Hallazgo | Evidencia |
|---|---|---|---|
| S1 | 🔴 | **El profesor anterior pierde al alumno.** En single, `_sync_student_teacher_username` (`payments.py:358-374`) saca al alumno de `teacher.students` del profesor previo. Si el alumno tiene paquete con B y reserva prueba con A (destacado), B recibe 403 en chat y ya no puede asignar material/tareas; al reservar con el paquete de B, el que pierde es A (ping-pong). | SONDA |
| S2 | 🟠 | **Marketplace abierto en single.** `/teachers/` lista a todos; `/dashboard/teachers/<otro>` muestra perfil con **Chat, Agendar y WhatsApp** (Agendar reserva con el destacado, no con ese profesor); el alumno abre chat con cualquier profesor (incluidas cuentas de test no listadas); `cohorts/{id}/enroll` acepta cohortes de otros profesores. | VIVO (perfil `old12` en single, chat con `lt_teacher_0` 200, `/teachers/` = 3) |
| S3 | 🟠 | **El backend acepta registro de profesores en single** (`auth.py:129-145`, `348-356`); el front solo oculta el selector. | CÓDIGO · VIVO (selector oculto) |
| S4 | 🟠 | **Reembolso por profesor suspendido imposible desde la UI**: el aviso manda a "Tus profesores", que en single redirige al perfil, y el modal solo existe en la vista multi. | CÓDIGO |
| S5 | 🟠 | **Landing single con datos inventados**: "100+ estudiantes · 1000+ horas" vs "50+ estudiantes" más abajo, "Certificada · Bilingüe" fijo, bio/idiomas inventados si falta, "5.0" con 0 reseñas. | VIVO (captura hero) |
| S6 | 🔵 | Chipi en single describe materias/nº de profesores de toda la plataforma (`chipi/context.py:26`). | SONDA |
| S7 | 🔵 | `/dashboard/teachers` en single descarga directorio completo + reseñas de todos antes de redirigir (~8 s en dev). | VIVO (red) |
| S8 | 🔵 | Área de profesor no destacado no avisa de que no recibirá alumnos; puede crear paquetes que nadie ve. | CÓDIGO |
| S9 | 🔵 | Textos fijos: onboarding "tus profesores" (`onboarding/page.tsx:265`). | CÓDIGO |

Funciona bien (VIVO): landing con un profesor, registro sin selector de rol, dashboard con banner
"primera clase gratis", `/dashboard/teachers` → redirige al destacado, desvincular → 400.

---

## 4. Modo MULTI

| # | Sev | Hallazgo | Evidencia |
|---|---|---|---|
| M1 | 🔴 | **Dashboard no sabe tratar 0 ni 2+ profesores.** 0 → `needs_teacher` no está en el tipo `BookingStage`, no hay CTA "elige profesor", ofrece "Agendar clase". 2+ → backend 400 → fallback "ready" → "Agendar primera clase", sin banner de prueba gratis (`dashboard/page.tsx:139`, `useStudentData.ts:379`). | VIVO (qa_tenant_s2 y s1, capturas) |
| M2 | 🔴 | **"Agendar" desde el perfil de B reserva con A.** `teachers/[username]/page.tsx:240` no pasa `?teacher=`; la agenda autoselecciona el profesor vinculado. | CÓDIGO |
| M3 | 🔴 | **"Ver perfil" de la landing multi va a `/teachers/<u>` (no existe)** y `proxy.ts:51` (`startsWith("/teacher")`) lo trata como zona de profesor: alumno → 403, anónimo → login. Login no acepta `?next=`. | VIVO (403) |
| M4 | 🟠 | **Profesor desactivado/borrado sigue listado y reservable**: listado, landing, slots, reserva y `link_teacher` no miran `User.is_active`. | SONDA |
| M5 | 🟠 | **Pagar a profesor suspendido**: `notify-payment`, `/packages/teacher/{u}`, cohortes y `classes/trial` no miran su estado; créditos nacen congelados. | SONDA |
| M6 | 🟠 | **Editar un paquete con compras vivas** cambia créditos, duración exigida y base de reembolso (`packages.py:121-171`). | SONDA |
| M7 | 🟠 | **Reembolso por suspensión paga el precio completo** aunque se pagó 1 de 2 cuotas o nada (`payments.py:2133-2254`); sale de la billetera del profesor. | SONDA |
| M8 | 🟠 | **Prueba creada por staff no vincula** (`classes.py:503`, `god_mode.py:779`): el profesor no ve al alumno, chat 403. | SONDA |
| M9 | 🟠 | **Desvincular deja vivos** prueba pendiente, material y chat por id (`users.py:733-791`). | SONDA |
| M10 | 🟠 | Landing ignora el interruptor de WhatsApp (`public.py:129` sin `hide_whatsapp`); el directorio sí lo respeta. **También en single.** | VIVO |
| M11 | 🟠 | Landing multi: "Profesores activos" = nº de la muestra aleatoria (≤5), "+2 ver todos" fijo (`public.py:27,123`). | CÓDIGO |
| M12 | 🟡 | Transferencia de alumno: el reembolso posterior lo paga el profesor nuevo; con `remove_old_link=false` se desincroniza link vs `students`. | SONDA |
| M13 | 🔵 | `GET /chat/admin/conversations` con `teacher_username`+`student_username` → **500** (doble `join(User)` sin alias, `chat.py:523`). | VIVO |
| M14 | 🔵 | Error de carga en `/dashboard/teachers` se ve como "No hay profesores" (sin `LoadError`); directorio hace 1+N peticiones. `hasTrial` cuenta pruebas de cualquier profesor (`dashboard/page.tsx:175`). Texto "Mi Profesor" en singular. | CÓDIGO / VIVO (texto) |
| M15 | 🔵 | Vincularse con un clic expone email/teléfono del alumno al profesor. Chipi toma un enrollment cualquiera con 2+ profesores. `featured-teacher/*` responde en multi. | SONDA / VIVO |

Funciona bien: sin IDOR entre profesores con rol `teacher` (clases, paquetes, materiales, tareas,
cohortes, billetera); crédito de A no se puede usar con B; vincular es idempotente; listado
excluye cuentas de test.

---

## 5. Transición entre modos

> **Fase 18 (2026-11-21): T2, T3 (parte de `_sync`), T4 (validación/confirmación en backend + panel) y T5 corregidos**; ver `backend/doc/BUSINESS_RULES.md`. Pendientes: T1 (`legacy` en `/me/teachers`) y pre-check de A->B. La tabla siguiente describe el estado previo.

Hoy el `PATCH` no valida nada. Única migración: al pasar single→multi, crea links para alumnos con
historial con el **`featured_teacher_id` anterior** si no era NULL (`admin.py:1114-1165`, commit por
fila, incluye historial cancelado). multi→single y cambio de destacado: **nada**.

| Entidad | single → multi | multi → single | destacado A → B (single) |
|---|---|---|---|
| Links | backfill solo del destacado previo de BD; si venía del `.env` o hubo destacados anteriores → **alumnos huérfanos** con paquete activo (`needs_teacher`) | links quedan pero **ocultos**; `DELETE` → 400 (VIVO) | A desaparece de "Tus profesores" |
| Paquetes/créditos | ok | visibles en "Mis paquetes", **inutilizables desde Horario** (solo destacado); por API `book`/renovar con T2 → 201/200 | idem; además B ofrece **2ª prueba gratis** |
| `teacher.students` | ok | al reservar con el destacado, T2 pierde al alumno (S1) | A pierde al alumno al reservar con B |
| Clases futuras | siguen | siguen con T2 (profesor sin chat ni lista) | siguen con A |
| Chat | backfill crea conversación | sigue + puede abrir con cualquiera | A → 403 tras el ping-pong |
| Jobs / avisos | — | siguen saliendo para T2 | idem |
| Cachés front | `usePlatformTenantMode` 10 min, featured 5 min, `my-teachers` 60 s, ISR landing 60 s (en `next dev` es inmediato, VIVO); el admin solo invalida su propia clave; default `?? true` (single) si falla la API | | |

| # | Sev | Hallazgo |
|---|---|---|
| T1 | 🔴 | multi→single / A→B: créditos pagados con otros profesores quedan invisibles e inusables en la UI (también su reembolso). |
| T2 | 🔴 | Backfill single→multi incompleto → huérfanos con paquete activo. |
| T3 | 🔴 | = S1: `teacher.students` salta entre profesores; el profesor sigue dando clases sin acceso al alumno. |
| T4 | 🟠 | Toggle sin validación ni confirmación; select de destacado solo visible en single. |
| T5 | 🟠 | Backfill no atómico (`teacher_students.py:41`) y demasiado amplio. |

**Arreglo propuesto:**
1. Pre-check en `PATCH`: 409 con lista de alumnos afectados (enrollments vivos o clases futuras con
   profesores ≠ nuevo destacado) salvo `force=true`; modal en `/admin/settings` con esos conteos.
2. Backfill idempotente y en una transacción: un link por cada par (alumno, profesor) en
   enrollments no cancelados o clases futuras — sin depender del destacado previo. Ofrecerlo
   también como script.
3. En single, `/users/me/teachers` incluye profesores con paquete vivo marcados `legacy` (consumir
   y reembolsar sí; prueba/renovación nueva no).
4. Que `link_student_to_teacher` no quite al alumno del profesor anterior (o solo si no tiene nada
   vivo con él).
5. Un único hook de modo en el front; al guardar, invalidar todas sus claves.

---

## 6. Seguridad: `teacher_admin` (ambos modos)

| # | Sev | Hallazgo | Evidencia |
|---|---|---|---|
| A1 | 🔴 ✅ corregido 2026-11-21 | Cambia modo y se pone de destacado (`admin.py:1060`, `get_current_staff`). | VIVO (200) |
| A2 | 🔴 ↩ revertido por decisión del propietario 2026-11-21 (el `teacher_admin` SÍ edita los datos de pago) | Cambia `PaymentConfig` global → todos los alumnos le pagan a él (`payments.py:457`). | VIVO (200) |
| A3 | 🔴 ✅ corregido 2026-11-21 | Modo Dios: se crea pagos `approved` a sí mismo, aprueba pagos propios que `validate` le niega (NEG-01) y procesa su propio retiro (`god_mode.py:1104-1307`, `payments.py:1509`). | SONDA |
| A4 | 🟠 ✅ corregido 2026-11-21 | Fuera de Modo Dios: lee chats de otros profesores, suspende profesores, banea alumnos ajenos (cancela paquetes con todos), reagenda/cancela clases ajenas, descarga materiales ajenos. | SONDA / CÓDIGO |
| A5 | 🟠 no es bug, decisión del propietario | Crea/edita/borra reseñas propias en Modo Dios (`god_mode.py:1311-1448`). | CÓDIGO |

**Estado (2026-11-21):** A1, A3 y A4 corregidos con `require_superadmin` (Fase 16 en `CORRECCIONES.md`; en A4 banear/desbanear, estado de profesores y edición de usuarios quedan abiertos al `teacher_admin`, solo el rol es del superadmin); A2 se revirtió: `PATCH /payments/config` vuelve a ser de staff por decisión del propietario; A5 se deja como está, no es bug, decisión del propietario.

**Arreglo (aplicado):** `require_superadmin` en modo/destacado, `payments/config`, retiros y todo lo que mueve
dinero o reseñas; o aplicar el `_require_*_scope` del Modo Dios a las rutas de staff.

---

## 7. Orden de arreglo sugerido

1. **A1-A3** (seguridad, cambios de una línea de dependencia).
2. **F1-F3** (resolución única del destacado + validación del toggle).
3. **M2, M3** (enlaces del front, pequeños y de mucho impacto).
4. **S1/T3** (no quitar alumnos de `teacher.students`) y **M8** (vincular en pruebas de staff/cohortes).
5. **T1, T2** (pre-check + backfill + `legacy` en single).
6. **M1** (dashboard multi por profesor), **M10** (WhatsApp), **M4-M7**.
7. Resto (🔵).

## 8. Reproducir

- Sondas SQLite (no tocan BD real): `cd backend && venv\Scripts\python.exe -m pytest tests/tenant_probes -q`
  (54 tests, ver `backend/tests/tenant_probes/README.md`). Al arreglar un bug su sonda falla:
  invertir el assert y moverla a `tests/audit/`.
- Estado final de Neon dev: **multi, destacado `mar12`** (igual que al empezar). La vuelta
  single→multi ejecutó el backfill real: 0 links nuevos (19 antes y después).
- Datos que quedaron en Neon dev: alumnos `qa_tenant_s1`/`qa_tenant_s2` (`is_test_account=True`),
  links de `qa_tenant_s1` con `lt_teacher_0/1`, conversaciones 70, 71, 73.
