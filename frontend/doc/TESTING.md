# Pruebas del frontend

## Tests automáticos (`npm test`, Vitest)
Dos proyectos (`vitest.config.ts`): **`unit`** (node, `tests/*.test.ts`: lógica pura, guards, cliente API, cookies, fechas/zonas horarias) y **`components`** (jsdom, `tests/components/**`: pantallas y componentes con Testing Library). 1520 pruebas, sin red ni backend (la API se sustituye por `tests/components/fakeApi.ts`).

Capas de `tests/components/` (qué prueban):
- `pages.test.tsx` — **descubre solas todas las `app/**/page.tsx`** (62) y las monta en 3 escenarios: sin datos, con datos y API caída (500). Exige que no haya error fatal, ni pantalla en blanco, ni la pantalla de recuperación del `ErrorBoundary`. `/admin/users` está saltada (bug F12).
- `layouts.test.tsx` — guards y menús de los tres layouts (alumno, profesor, admin) por rol.
- `authPages`, `register`, `appShell` — login (roles, errores, Google), recuperar/restablecer contraseña, verificar correo, registro en dos pasos, páginas de error/404 y `Providers`.
- `packageCheckout`, `payments`, `changePackage` — compra, cuotas, ilimitados, cambio/mejora/rebaja con reembolso, recargas, métodos de pago.
- `classCard`, `classModals` — matriz de acciones de la tarjeta por rol/estado, reagendar (antelación mínima, tope, grupales), link de videollamada, panel de espera de grupo.
- `chat`, `support`, `ui`, `spokenLanguages`, `googleSignIn`, `landingCarousels`, `adminPanels`, `godModeRunner`, `godModePickers` — el resto de componentes. El Modo Dios se prueba con un test guiado por datos sobre **todas** las acciones del registro.
- Los bugs conocidos se dejan como `it.fails`/`it.skip` con su motivo: pasan mientras el bug exista y se ponen en rojo al corregirlo (entonces hay que cambiarlos por `it`).

Se verificó con **mutaciones** (romper la regla en producción y ver que el test falla) en `layouts`, `packageCheckout`, `classModals` y `chat`.

Helpers: `render.tsx` (`renderScreen(ui, {role, route, search})` monta el mismo árbol que `app/providers.tsx`), `fakeApi.ts` (`mockApi`, `mockApiError`, `callsTo`, `FIXTURE`), `richData.ts` (`seedRichData()` para pantallas con datos), `router.ts` (router simulado).
Cobertura (`npx vitest run --maxWorkers=4 --coverage`; con todos los hilos y cobertura a la vez la carga hace intermitentes algunos tests): líneas **96,3 %** (antes 74,0 %, 62,7 %, 57,8 %, 35,7 %): `components` 94 %, `hooks` 97 %, `lib` 93 %, `app` **96,9 %** (objetivo acordado 85–90 %, alcanzado). Hecho en esta tanda: `teacher/profile` 89 % (+`CalendarSync` 99 %), `teacher/cohorts` 97 %, `teacher/dashboard` 91 %, `teacher/packages` 95 %, `student/profile` 96 %, `student/classes` 93 %, `student/dashboard` 88 %, `student/homework` 96 %, `admin/teachers` 93 %, `admin/payments` 87 %, `admin/users` 99 %, `teacher/wallet` 100 %, `store/chatStore` 98 % (WebSocket falso: latido, reconexión, envío optimista), contenido legal y `global-error` 100 %, `teacher/students` 99,7 %, `admin/students` 100 %, `student/materials` 100 %, `register/google-complete` 100 %, `teacher/availability/ExceptionsSection` 99 %, `admin/support` 99 %, `admin/chat` 100 %, `admin/flow-tester` 100 % (polling de corridas), `student/teachers/[username]` 100 %, `PublicProfileView` 99 %, `teacher/availability` 100 %, `ChipiWidget` 100 %, `admin/classes` 100 %, `student/teachers` (lista) 96 %, `student/availability` 99 %, `LandingPageClient` 100 %, `ClassCard` 97 %, `admin/settings` 98 %, `teacher/profile` 99 %, `student/schedule` 96 %, `register` 99 %, `admin/dashboard` 99 %, `admin/payments` 95 %, `student/dashboard` 99 %, `teacher/payments` 99 %, `teacher/packages` 99 %, `admin/teachers` 99 %, `teacher/dashboard` 96 %. Pendiente: nada con sentido. `GodModeActionRunner` (95 %), `student/schedule` (96 %) y `teacher/dashboard` (96 %) tienen solo colas menores. `ChipiMascot3D` y `HeroScene` (0 %) son WebGL/three.js: no se prueban en jsdom a propósito. Con cobertura, usar `--maxWorkers=3`: con más hilos `studentSchedule` falla por tiempo.
Sondas de zonas horarias aparte: `npx vitest run --config __tz_probes__/vitest.config.ts` (24; ver `ANALISIS.md`).

## Ejecutadas
- `npx tsc --noEmit` ✅ · `npx eslint .` ✅ · `npx next build` ✅ (60 rutas).
- Guards de ruta (`proxy.ts`) con `curl` y JWT forjados contra `next dev`:
  sin cookie, `/dashboard`, `/teacher/dashboard`, `/admin/dashboard` -> 307 `/login`;
  student -> solo `/dashboard`; teacher -> solo `/teacher/*`; superadmin -> solo `/admin/*`; el resto -> 307 `/unauthorized`;
  `/login` con sesión -> dashboard del rol; token expirado -> `/login`; ruta inexistente -> 404.
- CSP con nonce: tras `npx next build` y servir, el header `content-security-policy` trae `nonce-…` + `strict-dynamic` y los 18–19 `<script>` de `/login` y `/` llevan `nonce=` (verificado con curl; **no** probado en un navegador real).
- Cabeceras presentes: CSP, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, HSTS.

## Entorno local para probar a mano
Ver `../../backend/doc/TESTING.md` (servidor semilla `python -m tests.audit.run_server` + `npx next dev -p 3000` con `NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1`). Cuentas `admin` / `profe` / `alumno`, contraseña `Password123`.

## Pendiente
Plan completo (funciones y ramas sin cubrir por archivo, suite «una prueba por pantalla», E2E, accesibilidad y ejecución conjunta con el backend): `../../docs/PLAN_SUITE_COMPLETA.md`.
Resumen: líneas 96,3 %, ramas 89,6 %, funciones 81,1 %. Lo más flojo en funciones: `admin/settings` (57 %) y `student/classes` (59 %); en ramas: `NavBar` (68 %). `ChipiMascot3D` y `HeroScene` (WebGL) no se prueban en jsdom a propósito.
Pruebas de UI en navegador real aún necesarias (móvil, flujos largos, chat WebSocket, axe, landing 3D, rendimiento, WebKit): ver sección 2.5 del plan.

## E2E con Playwright (`npm run test:e2e`)
- `e2e/smoke.spec.ts` (8 pruebas, Chromium): portada, login (bueno y malo), ruta privada sin sesión, dashboard del alumno, idiomas con nivel (aviso, nivel obligatorio, guardado y persistencia), filtro «Habla» del directorio, onboarding de alumno nuevo y pestaña «Correos» del superadmin.
- `playwright.config.ts` levanta el **backend semilla** (`backend/tests/audit/run_server.py`: SQLite temporal, nunca una BD real; cuentas `admin`, `profe`, `alumno`, `nuevo` con contraseña `Password123`) y el frontend (`next dev`; en CI `build` + `start`). En Windows: `E2E_PYTHON=venv\Scripts\python.exe` (el comando corre dentro de `backend/`); la primera vez `npx playwright install chromium`.

## CI (`.github/workflows/frontend.yml`)
En cada PR que toque `frontend/`: `npm ci`, `npm run lint`, `npx tsc --noEmit`, `npm test` (Vitest) y `npm run build`. Playwright no corre en CI (necesita el backend con Python).
