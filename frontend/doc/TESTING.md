# Pruebas del frontend

## Tests automáticos (`npm test`, Vitest)
Dos proyectos (`vitest.config.ts`): **`unit`** (node, `tests/*.test.ts`: lógica pura, guards, cliente API, cookies, fechas/zonas horarias) y **`components`** (jsdom, `tests/components/**`: pantallas y componentes con Testing Library). 1881 pruebas en 113 archivos (cobertura 2026-11-24: líneas 97,9 %, funciones 96,1 %, ramas 92,8 %; el CI exige 97/90/92), sin red ni backend (la API se sustituye por `tests/components/fakeApi.ts`).

Capas de `tests/components/` (qué prueban):
- `pages.test.tsx` — **descubre solas todas las `app/**/page.tsx`** (62) y las monta en 3 escenarios: sin datos, con datos y API caída (500). Exige que no haya error fatal, ni pantalla en blanco, ni la pantalla de recuperación del `ErrorBoundary`. `/admin/users` está saltada (bug F12).
- `screenInventory.test.ts` (proyecto `unit`) — **inventario de pantallas**: falla si alguna `app/**/page.tsx` no está importada por una prueba de flujo (hoy sin exenciones; `EXEMPT` exige motivo). `pages.test.tsx` por sí solo no basta: solo comprueba que monta.
- `remainingScreens.test.tsx` — pantallas pequeñas con prueba propia: legales, 403, soporte (alumno y profesor), avisos del profesor, vista previa del perfil, Modo Dios, logs y landing.
- Archivos `*Coverage.test.tsx` (`adminSettings`, `adminTeachers`, `adminUsers`, `adminMaterials`, `navBar`, `studentDashboard`, `studentProfile`, `studentSchedule`, `studentChat`, `studentOnboarding`, `teacherOnboarding`, `teacherPackages`, `teacherProfile`, `teacherHomework`, `teacherLayout`, `classCard`, `godModeRunner`, `login`, `bannedCallbackBanner`) — cierran ramas y manejadores que los archivos de flujo no tocaban. Además `tests/apiExtra.test.ts`, `errorReporting.test.ts` y `landingServer.test.ts` (proyecto `unit`).
- `layouts.test.tsx` — guards y menús de los tres layouts (alumno, profesor, admin) por rol.
- `authPages`, `register`, `appShell` — login (roles, errores, Google), recuperar/restablecer contraseña, verificar correo, registro en dos pasos, páginas de error/404 y `Providers`.
- `packageCheckout`, `payments`, `changePackage` — compra, cuotas, ilimitados, cambio/mejora/rebaja con reembolso, recargas, métodos de pago.
- `classCard`, `classModals` — matriz de acciones de la tarjeta por rol/estado, reagendar (antelación mínima, tope, grupales), link de videollamada, panel de espera de grupo.
- `chat`, `support`, `ui`, `spokenLanguages`, `googleSignIn`, `landingCarousels`, `adminPanels`, `godModeRunner`, `godModePickers` — el resto de componentes. El Modo Dios se prueba con un test guiado por datos sobre **todas** las acciones del registro.
- Los bugs conocidos se dejan como `it.fails`/`it.skip` con su motivo: pasan mientras el bug exista y se ponen en rojo al corregirlo (entonces hay que cambiarlos por `it`).

Se verificó con **mutaciones** (romper la regla en producción y ver que el test falla) en `layouts`, `packageCheckout`, `classModals` y `chat`.

Helpers: `render.tsx` (`renderScreen(ui, {role, route, search})` monta el mismo árbol que `app/providers.tsx`), `fakeApi.ts` (`mockApi`, `mockApiError`, `callsTo`, `FIXTURE`), `richData.ts` (`seedRichData()` para pantallas con datos), `router.ts` (router simulado).
Cobertura (`npx vitest run --maxWorkers=3 --coverage`; con más hilos y cobertura a la vez `studentSchedule` falla por tiempo): líneas **97,93 %**, funciones **96,14 %**, ramas **92,82 %** (criterio del plan: 97 / 90 / 92, cumplido). Historial: líneas 35,7 % → 57,8 % → 62,7 % → 74,0 % → 96,3 % → 97,9 %. Lo que queda sin cubrir es sobre todo código inalcanzable o defensivo (manejadores tras botones deshabilitados, p. ej. el envío de una corrección con menos de 10 caracteres en `ClassCard` o las validaciones de `handleContinue` en el onboarding del profesor; fallbacks `||{}` y `??`) y `ChipiMascot3D` y `HeroScene` (WebGL/three.js, 0 %: no se prueban en jsdom a propósito).
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
Resumen: líneas 97,93 %, funciones 96,14 %, ramas 92,82 % (criterio cumplido). Sin cubrir quedan ramas defensivas y los dos archivos WebGL.
Pruebas de UI en navegador real aún necesarias (móvil, flujos largos, chat WebSocket, axe, landing 3D, rendimiento, WebKit): ver sección 2.5 del plan.

## E2E con Playwright (`npm run test:e2e`)
- Cuatro proyectos: `chromium` (escritorio), `mobile-chrome` (Pixel 5), `webkit` (Safari escritorio) y `mobile-safari` (iPhone 13). Uno solo: `npx playwright test --project=mobile-safari`. La primera vez: `npx playwright install chromium webkit`.
- `e2e/smoke.spec.ts` (8 pruebas × 4 proyectos): portada, login (bueno y malo), ruta privada sin sesión, dashboard del alumno, idiomas con nivel, filtro «Habla» del directorio, onboarding de alumno nuevo y pestaña «Correos» del superadmin. Las pruebas con efecto son idempotentes porque los proyectos comparten backend.
- `e2e/a11y.spec.ts` (axe-core, WCAG 2 A/AA, 24 pantallas de los cuatro roles × 4 proyectos): falla ante cualquier violación `serious`/`critical`; `KNOWN` (excepciones con su motivo) está vacío. Con `A11Y_DUMP=ruta.jsonl` vuelca todas las violaciones con su HTML. Los tonos de texto con poco contraste se corrigen en un solo bloque al final de `app/globals.css`; si una pantalla nueva falla por contraste, ajusta ahí o usa un tono más oscuro.
- `e2e/landing.spec.ts`: el canvas WebGL monta en escritorio, no se carga three.js en móvil (decisión M17) y no hay desbordamiento horizontal.
- `e2e/flows.spec.ts` (flujo largo, 6 pasos × 4 proyectos): alumno nuevo → elige profesor → reserva la clase de prueba → el profesor la confirma y completa (por API) → compra «Paquete 4» por transferencia → el superadmin aprueba el pago en pantalla → el alumno agenda una clase y la reagenda → el profesor pide un retiro y el superadmin lo marca como pagado. Cada proyecto crea su alumno con el gancho `/__e2e__/student/{usuario}`; el paso de completar la clase usa `/__e2e__/age-class/{id}` (una clase solo se completa cuando ya empezó). Ambos ganchos viven solo en `backend/tests/audit/run_server.py`, nunca en la aplicación.
- `e2e/tour.spec.ts` (guía interactiva, 1 prueba × proyecto): una cuenta nueva (`/__e2e__/student/{usuario}?tour=1`, un alumno por proyecto) ve la guía, «Saltar guía» no la repite tras recargar, y «Ver guía de la plataforma» en el perfil la abre y se recorre hasta «Terminar» (en móvil abre el panel «Más»). El resto de usuarios semilla nacen con la guía ya vista para que el overlay no bloquee los clics. Si ejecutas Playwright en Windows usa `E2E_PYTHON=venv\Scripts\python.exe` (el `python` global no tiene las dependencias).
- `e2e/lighthouse.spec.ts` (proyecto `lighthouse`, solo Chromium): Lighthouse sobre portada, login y registro con suelos de rendimiento 0,7, accesibilidad 0,9, buenas prácticas 0,85 y SEO 0,9. Hay que correrlo contra la compilación de producción: `CI=true npx playwright test --project=lighthouse` (contra `next dev` sale muy bajo). Medido el 2026-11-23: rendimiento 1,00, accesibilidad 0,95-0,98, buenas prácticas 0,92-1,00, SEO 1,00, LCP 1,1 s, TBT 40-60 ms, CLS 0. No cubre listas grandes (haría falta sembrar muchos datos).
- `playwright.config.ts` levanta el **backend semilla** (`backend/tests/audit/run_server.py`: SQLite temporal, nunca una BD real, límite de intentos de login desactivado solo ahí; cuentas `admin`, `profe`, `alumno`, `nuevo` con contraseña `Password123`) y el frontend (`next dev`; en CI `build` + `start`). Un reintento por prueba (la primera visita a cada ruta compila en frío). En Windows: `E2E_PYTHON='C:\ruta\absoluta\venv\Scripts\python.exe'` (el comando corre dentro de `backend/`; una ruta relativa con `/` falla bajo cmd.exe).
- Los helpers de login esperan `networkidle` (WebKit rellenaba antes de hidratar) y pulsan `button[type=submit]` (el botón de Google también se llama «Iniciar sesión»).
- Pendiente: chat WebSocket con dos sesiones, zonas horarias en navegador, registro por la pantalla de registro (el flujo largo crea el alumno por gancho) y Lighthouse sobre listas grandes.

## CI (`.github/workflows/frontend.yml`)
En cada PR que toque `frontend/`: `npm ci`, `npm run lint`, `npx tsc --noEmit`, `npm test` (Vitest) y `npm run build`. Playwright corre en su propio workflow, `.github/workflows/e2e.yml` (backend semilla + `next build`/`start`, 4 proyectos y Lighthouse; sube el informe como artefacto).
