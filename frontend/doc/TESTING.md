# Pruebas del frontend

## Tests automáticos (`npm test`, Vitest, F10)
- `tests/auth.test.ts`, `tests/proxy.test.ts` (guards por rol con cookies `tpm_access`/`tpm_session`), `tests/api.test.ts` (cookies, un solo refresh en vuelo, sin bucles), `tests/csp.test.ts`. 22 tests, sin red ni backend. Falta Playwright (flujo login/logout en navegador real).

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
E2E en navegador (la extensión de Chrome no conectó en la auditoría): registro -> prueba -> pago -> agenda en móvil y escritorio, admin aprueba pago, retiro, chat WS, reagendado, zonas horarias; accesibilidad (axe/Lighthouse); rendimiento del landing 3D; tests de componentes/hooks (Vitest + Testing Library) y Playwright.

## E2E con Playwright (`npm run test:e2e`)
- `e2e/smoke.spec.ts` (8 pruebas, Chromium): portada, login (bueno y malo), ruta privada sin sesión, dashboard del alumno, idiomas con nivel (aviso, nivel obligatorio, guardado y persistencia), filtro «Habla» del directorio, onboarding de alumno nuevo y pestaña «Correos» del superadmin.
- `playwright.config.ts` levanta el **backend semilla** (`backend/tests/audit/run_server.py`: SQLite temporal, nunca una BD real; cuentas `admin`, `profe`, `alumno`, `nuevo` con contraseña `Password123`) y el frontend (`next dev`; en CI `build` + `start`). En Windows: `E2E_PYTHON=venv\Scripts\python.exe` (el comando corre dentro de `backend/`); la primera vez `npx playwright install chromium`.
- Vitest: 79 pruebas (incluye `tests/spokenLanguages.test.ts`, `tests/emailSettings.test.ts` y `tests/pagination.test.ts`).

## CI (`.github/workflows/frontend.yml`)
En cada PR que toque `frontend/`: `npm ci`, `npm run lint`, `npx tsc --noEmit`, `npm test` (Vitest) y `npm run build`. Playwright no corre en CI (necesita el backend con Python).
