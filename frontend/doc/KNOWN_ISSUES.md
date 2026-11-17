# Problemas conocidos del frontend (auditoría de 2026-11-16; casi todo corregido en las Fases 1–4)

Backend: `../../backend/doc/KNOWN_ISSUES.md`. Informe completo: `../../ANALISIS.md`.

| # | Problema | Dónde |
|---|---|---|
| F1 | **Retiros pendientes del admin dan 404** (ruta backend sin decorador, AUD-12) | `hooks/useAdminData.ts:171` | **corregido** (Fase 1) |
| F2 | JWT en cookie legible por JS, 7 días, CSP con `unsafe-inline`/`unsafe-eval` (SEC-05) | `store/authStore.ts`, `lib/csp.ts` | **corregido** (Fase 3b): sesión en cookies HttpOnly; CSP con nonce por petición en `proxy.ts` (script-src sin `unsafe-inline`; `style-src` conserva `unsafe-inline`). Costo: todas las páginas son dinámicas (`await connection()` en `app/layout.tsx`) |
| F3 | `proxy.ts` no verifica la firma del JWT (solo UX; correcto mientras el backend valide, como hace) | `proxy.ts`, `lib/auth.ts` |
| F4 | Cualquier 401 hace `window.location.href="/login"` y pierde formularios | `lib/api.ts` | **corregido** (Fase 4) |
| F5 | Reglas del servidor duplicadas en la UI (mínimo de retiro $10, disponibilidad, duraciones); el backend no las aplica (AUD-01/13) | `teacher/wallet`, `student/schedule` | **corregido** (Fase 4) |
| F6 | El texto de borrar cuenta contradice al backend (anonimiza y conserva pagos/clases) | `student/profile` | **corregido** (Fase 4) |
| F7 | Login de cuenta solo-Google con contraseña da error genérico (backend 500, AUD-19) | `(public)/login` | **corregido** en el backend (Fase 1: 401) |
| F8 | Páginas gigantes: `student/schedule` 1796, `admin/settings` 1611, `teacher/materials` 1566 líneas | |
| F9 | `"mar12"` hardcodeado como profesor destacado por defecto | `next.config.ts:136` | **corregido** (Fase 4) |
| F10 | 0 tests; sin script `test` | `package.json` | **corregido** (Vitest, 47 tests, y Playwright: `npm run test:e2e`, ver `frontend/e2e/`) |
| F11 | `/admin/flow-tester` presente en producción (el backend lo bloquea con `ENVIRONMENT=production`) | `app/(superadmin)/admin/flow-tester` |
| UX-01 | Con cookie `access_token` válida pero `localStorage` vacío (store sin `user`), `/teacher/*` queda en spinner infinito: el layout hace `router.push('/login')` y `proxy.ts` devuelve al dashboard por la cookie (bucle). Confirmado en navegador | `app/(teacher)/teacher/layout.tsx`, `proxy.ts` | **corregido** (Fase 4) |
| UX-02 | Botones sin nombre accesible en login (ojo de contraseña, widget Chipi) | `(public)/login` | **corregido** (Fase 4) |
| UX-03 | El dashboard del alumno dice «clase de prueba de 30 minutos»; el backend usa `trial_duration_minutes` (25 por defecto) | `student/dashboard` | **corregido** (Fase 4) |
| UX-04 | `/admin/payments` → pestaña «Retiros (0)» siempre vacía por el 404 de AUD-12 (confirmado en red: `GET /payments/admin/withdrawals/pending` 404) | `admin/payments` | **corregido** (Fase 4) |
Nota sobre `generated/API_CALLS.md`: de las 4 llamadas «sin ruta», solo `/payments/admin/withdrawals/pending` es un fallo real; las otras 3 son artefactos del regex (URLs con query o plantillas dinámicas).

## Fase 11
- Los listados cargan **todas** las páginas del servidor (`fetchAllPages`, también `/admin/users` con `skip` y el Modo Dios), no una por una: ya no se cortan a 200 filas, pero con miles de filas la carga inicial crece. Si algún listado lo necesita, pasarlo a `useInfiniteQuery` con filtros en el servidor.
- Buscadores que llaman a la API usan `useDebouncedValue` (400 ms): auditoría de chats y alumnos del admin. El resto filtra en el cliente.
- Modelo 3D comprimido a 6,65 MB (Fase 11); la textura normal bajó de 4096 a 1024 px, sin diferencia visible en la mascota de la landing.
