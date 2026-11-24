# Guía interactiva post-onboarding — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar a las cuentas nuevas de alumno y profesor, tras el onboarding, un recorrido con fondo oscurecido que enfoca cada opción del menú, con «Saltar guía» y botón para repetirla desde el Perfil.

**Architecture:** Columna `users.tour_completed` (migración que marca a los existentes como vistos) expuesta por `/users/me`. Un `TourHost` montado dentro del NavBar decide si abrir `ProductTour` (overlay + recorte + tarjeta, componente propio). Los ítems del menú se marcan con `data-tour="nav-<href>"`; en móvil la guía abre el panel «Más» mediante un store mínimo.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic (pytest, SQLite en tests); Next 16 / React 19 / zustand / Vitest + Testing Library / Playwright.

**Spec:** `docs/superpowers/specs/2026-11-24-guided-tour-design.md`

## Global Constraints

- Sin dependencias nuevas en `frontend/package.json` (spec: «componente propio»).
- Roles con guía: `student`, `teacher`, `teacher_admin`. `superadmin` nunca la ve.
- Migración: `users.tour_completed` BOOLEAN NOT NULL, `server_default` false; todos los usuarios existentes quedan en `true`. `down_revision = 'f27a1b2c3d4e'`.
- Texto de la interfaz en español; cada paso ≤ 25 palabras; último paso dice «Puedes repetir esta guía desde tu perfil».
- Botones: «Siguiente», «Atrás», «Saltar guía». Teclado: Esc = saltar, ←/→ = navegar.
- Overlay por encima del BottomSheet (`z-[70]`): usar `z-[80]`.
- `frontend/AGENTS.md`: Next 16 tiene cambios incompatibles; solo se usa React/zustand/`usePathname` ya presentes. No hay API de Next nueva en este plan.
- Los commits los hace el usuario: **no ejecutar `git commit`** ni `git add`; cada tarea termina con «archivos listos» y la propuesta de mensaje.
- Backend con `backend/venv/Scripts/python.exe`; nunca ejecutar `tests/flow` ni `tests/load`.

## Review Focus

- Sidebar y pestañas móviles están **ambos en el DOM** (uno con `display:none`): la guía debe elegir el elemento visible, nunca el oculto (test con `getClientRects` simulado).
- Elemento ausente (chat desactivado, rol sin ese ítem): el paso se omite y la guía termina sin error ni bucle.
- Si todos los pasos con target faltan, quedan solo bienvenida y cierre; no se cuelga.
- Fallo del `PATCH` al terminar/saltar: la guía se cierra igual (no bloquea) y no hay excepción sin capturar.
- Cierre de pestaña a medias: no se marca como vista (solo se marca al terminar/saltar).
- Usuario con `tour_completed` indefinido (store viejo de localStorage): **no** se muestra la guía.
- Admin o `onboarding_completed=false`: no se muestra. En los E2E los usuarios semilla ya nacen con la guía vista, o el overlay bloquearía todos los clics.

---

### Task 1: Backend — campo `tour_completed`

**Files:**
- Modify: `backend/app/models/user.py` (junto a `onboarding_completed`)
- Modify: `backend/app/schemas/user.py` (`UserResponse`, `UpdateProfileRequest`)
- Create: `backend/alembic/versions/f28a1b2c3d4e_user_tour_completed.py`
- Test: `backend/tests/audit/test_h2_tour_completed.py`

**Interfaces:**
- Produces: `User.tour_completed: bool` (default False); `GET/PATCH /users/me` devuelven `tour_completed: bool`; `PATCH /users/me {"tour_completed": bool}` lo guarda.

- [ ] **Step 1: Write the failing tests** en `test_h2_tour_completed.py` (usa fixtures `client`, `world`, `db`, `hdr`, `API` como `test_h1_tts_language.py`; carga la migración con el patrón `_load_migration` / `_run_migration` de `tests/audit/test_f17_google_preply.py`):
  - `test_new_user_starts_with_tour_not_completed`: `GET /users/me` del alumno de `world` → `json()["tour_completed"] is False`.
  - `test_patch_sets_and_clears_tour_completed`: `PATCH /users/me {"tour_completed": true}` → 200 y `GET` da `True`; luego `false` → `False`.
  - `test_patch_tour_completed_does_not_touch_onboarding`: tras el PATCH, `onboarding_completed` no cambia.
  - `test_migration_marks_existing_users_as_seen`: motor `sqlite://` con tabla `users (id INTEGER PRIMARY KEY)` y 3 filas; `upgrade()` → las 3 filas con `tour_completed = 1`; una fila insertada después sin la columna explícita queda en `0` (server_default); `downgrade()` quita la columna.
- [ ] **Step 2: Run** `cd backend && venv/Scripts/python.exe -m pytest tests/audit/test_h2_tour_completed.py -q -p no:cacheprovider` → FAIL (campo/migración inexistentes).
- [ ] **Step 3: Implement.** Modelo: `tour_completed = Column(Boolean, nullable=False, default=False, server_default="false")`. Schemas: `tour_completed: bool = False` en `UserResponse`; `tour_completed: Optional[bool] = None` en `UpdateProfileRequest` (el bucle `setattr` de `update_profile` ya lo aplica). Migración `f28a1b2c3d4e`: `op.add_column('users', sa.Column('tour_completed', sa.Boolean(), nullable=False, server_default=sa.false()))` y a continuación `op.execute("UPDATE users SET tour_completed = true")` (en SQLite `true` funciona como 1); `downgrade` → `op.drop_column`.
- [ ] **Step 4: Run** el archivo de test → todos PASS; `venv/Scripts/python.exe -m alembic heads` → `f28a1b2c3d4e (head)`; y `venv/Scripts/python.exe -m pytest tests/audit/test_g18_schema_validators.py tests/audit/test_g1_auth_users.py -q -p no:cacheprovider` (o el archivo de usuarios existente que corresponda; buscarlo con Grep `users/me`) → PASS.
- [ ] **Step 5: Archivos listos** (sin commit). Mensaje propuesto: `Backend: users.tour_completed (migración marca existentes como vistos)`.

---

### Task 2: Frontend — datos y lógica de la guía (sin UI)

**Files:**
- Modify: `frontend/store/authStore.ts` (interfaz `User`: `tour_completed?: boolean;`)
- Create: `frontend/components/tour/tourSteps.ts`
- Create: `frontend/components/tour/tourStore.ts`
- Create: `frontend/components/tour/resolveTarget.ts`
- Test: `frontend/tests/tourSteps.test.ts`, `frontend/tests/resolveTarget.test.ts`

**Interfaces:**
- Produces (`tourSteps.ts`):
  - `interface TourStep { id: string; target: string | null; title: string; body: string; more?: boolean }`
  - `navTarget(href: string): string` → `` `[data-tour="nav-${href}"]` ``
  - `STUDENT_STEPS: TourStep[]`, `TEACHER_STEPS: TourStep[]`, `stepsForRole(role?: string): TourStep[]` (student → STUDENT; teacher/teacher_admin → TEACHER; resto → `[]`).
- Produces (`tourStore.ts`): `useTourStore` (zustand, sin persistir): `{ forceMoreOpen: boolean; setForceMoreOpen(v: boolean): void }`.
- Produces (`resolveTarget.ts`): `resolveVisibleTarget(selector: string): HTMLElement | null` (primer match con `getClientRects().length > 0`); `waitForVisibleTarget(selector: string, timeoutMs?: number): Promise<HTMLElement | null>` (reintenta con `requestAnimationFrame` hasta `timeoutMs`, por defecto 600).

- [ ] **Step 1: Write failing tests.**
  - `tourSteps.test.ts`: `stepsForRole("student")` empieza por un paso con `target === null` (bienvenida) y termina por uno con `target === null` cuyo `body` contiene «Puedes repetir esta guía desde tu perfil»; cada `body` ≤ 25 palabras; `stepsForRole("superadmin")` y `stepsForRole(undefined)` → `[]`; alumno cubre Inicio, Horario, Clases, Perfil, Chat, Disponibilidad, Materiales, Tareas, Profesor, Soporte (targets `navTarget("/dashboard...")`); profesor cubre Clases, Horario, Estudiantes, Perfil, Chat, Avisos, Materiales, Tareas, Paquetes, Grupos, Ganancias, Soporte; los ítems que en móvil viven en «Más» llevan `more: true` (alumno: chat, availability, materials, homework, teachers, support; profesor: chat, notifications, materials, homework, packages, cohorts, wallet, support); los `id` son únicos.
  - `resolveTarget.test.ts`: con dos elementos `[data-tour="x"]`, uno con `getClientRects` → `[]` y otro con una caja, `resolveVisibleTarget` devuelve el segundo (simular `getClientRects` por elemento, porque jsdom devuelve siempre vacío); sin visibles → `null`; `waitForVisibleTarget` resuelve cuando el elemento aparece a los ~100 ms (timers falsos) y `null` si nunca aparece.
- [ ] **Step 2: Run** `cd frontend && npx vitest run tests/tourSteps.test.ts tests/resolveTarget.test.ts` → FAIL.
- [ ] **Step 3: Implement** los tres módulos con las firmas de arriba. Los textos van en español, tuteo neutro, una frase por opción (ej. Horario: «Mira tus clases por día y semana y reserva nuevas»). Los targets usan los `href` de `NavBar.tsx` (`STUDENT_*`/`TEACHER_*`, líneas ~28-56).
- [ ] **Step 4: Run** de nuevo → PASS; `npx tsc --noEmit 2>&1 | grep -v "^e2e/"` sin salida.
- [ ] **Step 5: Archivos listos.** Mensaje: `Frontend: pasos, store y resolución de objetivos de la guía`.

---

### Task 3: Frontend — `ProductTour` (overlay, tarjeta, teclado)

**Files:**
- Create: `frontend/components/tour/ProductTour.tsx`
- Test: `frontend/tests/components/productTour.test.tsx`

**Interfaces:**
- Consumes: `TourStep`, `resolveVisibleTarget`, `waitForVisibleTarget`, `useTourStore` (Task 2).
- Produces: `export default function ProductTour(props: { steps: TourStep[]; open: boolean; onFinish: () => void; onSkip: () => void }): JSX.Element | null`.
  - Comportamiento por paso `i` (al entrar y al cambiar): `setForceMoreOpen(false)`; si `target` es nulo → tarjeta centrada sobre fondo oscuro; si no, resolver visible; si no hay y `more` → `setForceMoreOpen(true)` y `waitForVisibleTarget`; si sigue sin haber → **omitir** el paso en la dirección de navegación (adelante: siguiente; atrás: anterior; pasado el último → `onFinish`, antes del primero → quedarse en el primer paso válido).
  - Recorte: `div` con `box-shadow: 0 0 0 9999px rgba(15,23,42,.6)` sobre el rectángulo del target (+8 px de margen), recalculado en `resize`/`scroll`; capa transparente a pantalla completa que absorbe clics. Tarjeta: arriba del target si este está en la mitad inferior de la pantalla, si no al lado/debajo; ancho `min(92vw, 22rem)`.
  - A11y: tarjeta `role="dialog" aria-modal="true" aria-labelledby`, texto con `aria-live="polite"`, foco inicial en «Siguiente», Tab cicla dentro de la tarjeta, al cerrar devuelve el foco al elemento previo; Esc → `onSkip`; ←/→ → atrás/siguiente; `prefers-reduced-motion` sin transiciones. Contador «n de N» con N = pasos sin target + pasos con target visible o `more` al abrir. Último paso: botón «Terminar» (→ `onFinish`). Al desmontar o cerrar: `setForceMoreOpen(false)`.

- [ ] **Step 1: Write failing tests** (`productTour.test.tsx`, con `steps` de prueba y elementos `data-tour` creados en el DOM; `getClientRects` simulado):
  - `avanza y retrocede`: bienvenida → «Siguiente» muestra el segundo título → «Atrás» vuelve al primero.
  - `Saltar guía llama onSkip` y `Esc llama onSkip`; `ArrowRight` avanza.
  - `terminar llama onFinish` en el último paso (texto «Terminar»).
  - `omite un paso cuyo elemento no existe`: con 3 pasos y el del medio sin target en el DOM, «Siguiente» desde el primero muestra el tercero.
  - `si todos los pasos con target faltan` solo se recorren bienvenida y cierre y se termina sin lanzar.
  - `elige el elemento visible entre dos con el mismo data-tour` (el oculto no recibe el recorte: comprobar que el recorte tiene la posición del visible).
  - `abre «Más» en móvil`: paso `more:true` cuyo elemento aparece solo tras `setForceMoreOpen(true)` (el test suscribe al store y lo inserta) → no se omite y el store queda en `true` mientras el paso está activo, y en `false` al cerrar.
  - `foco`: el foco inicial está en «Siguiente»; Tab desde el último botón vuelve al primero.
  - `open=false` no renderiza nada.
- [ ] **Step 2: Run** `npx vitest run tests/components/productTour.test.tsx` → FAIL.
- [ ] **Step 3: Implement** `ProductTour.tsx` con las reglas de arriba (estilo Tailwind del proyecto: rosa `pink-500`, tarjeta `rounded-2xl bg-white shadow-2xl`, fuente `font-black` en títulos).
- [ ] **Step 4: Run** de nuevo → PASS.
- [ ] **Step 5: Archivos listos.** Mensaje: `Frontend: componente ProductTour (overlay, foco y teclado)`.

---

### Task 4: Frontend — `TourHost` y conexión con NavBar y layouts

**Files:**
- Create: `frontend/components/tour/TourHost.tsx`
- Modify: `frontend/components/layout/NavBar.tsx` (añadir `data-tour={`nav-${href}`}` a: `SidebarLink`/`Link` del sidebar, `Link` de las pestañas principales y `Link` del panel «Más»; el `moreOpen` de `BottomTabBar` pasa a `moreOpen || forceMoreOpen` leyendo `useTourStore`; `DashboardSidebar` renderiza `<TourHost />`)
- Modify: `frontend/app/(student)/dashboard/layout.tsx` y `frontend/app/(teacher)/teacher/layout.tsx` (en el `setUser({...latestUser, ...})` que copia `onboarding_completed`, copiar también `tour_completed: userData.tour_completed ?? latestUser.tour_completed`)
- Modify: `frontend/tests/components/fakeApi.ts` (`makeUser`: sin `tour_completed`, para no activar la guía en los tests existentes)
- Test: `frontend/tests/components/tourHost.test.tsx`

**Interfaces:**
- Consumes: `ProductTour`, `stepsForRole`, `navTarget`, `useTourStore`, `useAuthStore`, `api`.
- Produces: `export default function TourHost(): JSX.Element | null`. Abre la guía cuando `stepsForRole(user.role).length > 0 && user.onboarding_completed === true && user.tour_completed === false`. `finish`/`skip` hacen `setUser({ ...user, tour_completed: true })` y luego `api.patch("/users/me", { tour_completed: true }).catch(() => {})`.

- [ ] **Step 1: Write failing tests** (`tourHost.test.tsx`, usando `renderScreen`/`signIn` de `tests/components/render.tsx`; `mockApi("patch", "/users/me", ...)` y `callsTo`):
  - `alumno con tour_completed=false y onboarding hecho ve la guía` (texto de bienvenida).
  - `no aparece`: `tour_completed` indefinido; `true`; `onboarding_completed=false`; rol `superadmin`.
  - `Saltar guía`: hace `PATCH /users/me` con `{tour_completed: true}`, el store queda en `true` y la guía desaparece.
  - `PATCH que falla` (`mockApiError`): la guía igualmente se cierra y no hay error no capturado.
  - `terminar` hace el mismo PATCH.
  - `cada target de STUDENT_STEPS y TEACHER_STEPS existe en el NavBar renderizado` para sus roles (renderizar `NavBar` por rol, ítems sin chat desactivado; permitir ausentes solo los de chat/soporte si la configuración los oculta; el resto deben existir en el DOM). Este test es el que protege el acople `data-tour`.
  - `repetir`: con `tour_completed=true`, hacer `setUser({...user, tour_completed:false})` en el store abre la guía.
- [ ] **Step 2: Run** `npx vitest run tests/components/tourHost.test.tsx` → FAIL.
- [ ] **Step 3: Implement** `TourHost` y los cambios en NavBar y layouts según Files/Interfaces. No introducir un `useEffect` que lance la guía: es derivado puro del store (sin estado propio salvo el de `ProductTour`).
- [ ] **Step 4: Run** `npx vitest run tests/components/tourHost.test.tsx tests/components/navBarCoverage.test.tsx tests/components/layouts.test.tsx tests/components/teacherLayoutCoverage.test.tsx` → PASS (los existentes no cambian de comportamiento).
- [ ] **Step 5: Archivos listos.** Mensaje: `Frontend: TourHost conectado al menú y a los layouts`.

---

### Task 5: Frontend — botón «Ver guía de la plataforma» en el Perfil

**Files:**
- Create: `frontend/components/tour/ReplayTourButton.tsx` (`export default function ReplayTourButton(): JSX.Element | null`; pone `tour_completed: false` en el store; no renderiza nada si el rol no tiene guía)
- Modify: `frontend/app/(student)/dashboard/profile/page.tsx` (columna derecha, antes de la sección «Seguridad», ~línea 839)
- Modify: `frontend/app/(teacher)/teacher/profile/page.tsx` (columna derecha, antes de «Seguridad», ~línea 1265)
- Test: `frontend/tests/components/replayTour.test.tsx`

**Interfaces:** Consumes `useAuthStore`, `stepsForRole`. Produces el botón con texto «Ver guía de la plataforma».

- [ ] **Step 1: Write failing tests:** botón visible para alumno y profesor, ausente para `superadmin`; al pulsarlo el store queda con `tour_completed === false`; en `studentProfile.test.tsx`/`teacherProfile.test.tsx` no se rompe nada (se ejecutan en el Step 4).
- [ ] **Step 2: Run** `npx vitest run tests/components/replayTour.test.tsx` → FAIL.
- [ ] **Step 3: Implement** el botón y montarlo en ambos perfiles.
- [ ] **Step 4: Run** `npx vitest run tests/components/replayTour.test.tsx tests/components/studentProfile.test.tsx tests/components/studentProfileCoverage.test.tsx tests/components/teacherProfile.test.tsx tests/components/teacherProfileCoverage.test.tsx tests/components/teacherProfileExtra.test.tsx` → PASS.
- [ ] **Step 5: Archivos listos.** Mensaje: `Frontend: botón para repetir la guía desde el perfil`.

---

### Task 6: E2E, semilla, docs y Chipi

**Files:**
- Modify: `backend/tests/audit/run_server.py` (en `mk(...)` y en la creación de usuarios E2E de la línea ~121: `tour_completed=True`; añadir el alumno `guia` con onboarding completo y `tour_completed=False`, su `StudentProfile` y contraseña `Password123`; `nuevo` conserva `onboarding_completed=False` y recibe `tour_completed=False`)
- Modify: `frontend/e2e/flows.spec.ts` (tras el onboarding del alumno nuevo, si aparece «Saltar guía» pulsarlo antes de seguir)
- Create: `frontend/e2e/tour.spec.ts`
- Modify: `frontend/doc/PAGES_AND_UX.md`, `frontend/doc/ARCHITECTURE.md`, `backend/doc/BUSINESS_RULES.md`; regenerar con `cd backend && venv/Scripts/python.exe doc/generate_docs.py`
- Modify: fichas de Chipi `backend/app/core/chipi/knowledge/screens/` de perfil de alumno y de profesor (dónde repetir la guía)
- Test: `frontend/e2e/tour.spec.ts`

**Interfaces:** Consumes todo lo anterior. Produces la prueba punta a punta.

- [ ] **Step 1: Write the failing e2e** (`tour.spec.ts`, mismo `login` que `flows.spec.ts`): `guia` inicia sesión → aparece «Bienvenida» (texto del primer paso) → «Saltar guía» → desaparece; recargar → no reaparece; en Perfil, «Ver guía de la plataforma» la abre otra vez y se puede recorrer hasta «Terminar» con «Siguiente» (mismo test en proyectos escritorio y móvil: en móvil el recorrido abre «Más»).
- [ ] **Step 2: Run** `cd frontend && npx playwright test e2e/tour.spec.ts --project=chromium --project=mobile-chrome` → FAIL (sin semilla).
- [ ] **Step 3: Implement** semilla, ajuste de `flows.spec.ts` y documentación. Chipi: añadir una línea en cada ficha; luego `cd backend && venv/Scripts/python.exe -m pytest tests/audit/test_chipi_knowledge.py -q -p no:cacheprovider`.
- [ ] **Step 4: Verificación completa:** e2e anterior en `chromium` y `mobile-chrome` → PASS; además `npx playwright test e2e/smoke.spec.ts e2e/flows.spec.ts --project=chromium` → PASS (la semilla no deja overlays); `cd backend && venv/Scripts/python.exe -m pytest tests/audit tests/tenant_probes -q -p no:cacheprovider -x` → PASS; `cd frontend && npx vitest run` → PASS con los umbrales de cobertura de `frontend.yml` (97/90/92); `npx tsc --noEmit 2>&1 | grep -v "^e2e/"` sin salida.
- [ ] **Step 5: Archivos listos.** Mensaje: `E2E y docs: guía interactiva (semilla, prueba punta a punta, Chipi)`.
