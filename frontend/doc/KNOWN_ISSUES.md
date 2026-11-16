# Problemas conocidos del frontend (2026-11-16, nada corregido)

Backend: `../../backend/doc/KNOWN_ISSUES.md`. Informe completo: `../../ANALISIS.md`.

| # | Problema | Dónde |
|---|---|---|
| F1 | **Retiros pendientes del admin dan 404** (ruta backend sin decorador, AUD-12) | `hooks/useAdminData.ts:171` |
| F2 | JWT en cookie legible por JS (no HttpOnly), 7 días, CSP con `unsafe-inline`/`unsafe-eval` (SEC-05) | `store/authStore.ts`, `next.config.ts` |
| F3 | `proxy.ts` no verifica la firma del JWT (solo UX; correcto mientras el backend valide, como hace) | `proxy.ts`, `lib/auth.ts` |
| F4 | Cualquier 401 hace `window.location.href="/login"` y pierde formularios | `lib/api.ts` |
| F5 | Reglas del servidor duplicadas en la UI (mínimo de retiro $10, disponibilidad, duraciones); el backend no las aplica (AUD-01/13) | `teacher/wallet`, `student/schedule` |
| F6 | El texto de borrar cuenta contradice al backend (anonimiza y conserva pagos/clases) | `student/profile` |
| F7 | Login de cuenta solo-Google con contraseña da error genérico (backend 500, AUD-19) | `(public)/login` |
| F8 | Páginas gigantes: `student/schedule` 1796, `admin/settings` 1611, `teacher/materials` 1566 líneas | |
| F9 | `"mar12"` hardcodeado como profesor destacado por defecto | `next.config.ts:136` |
| F10 | 0 tests; sin script `test` | `package.json` |
| F11 | `/admin/flow-tester` presente en producción (el backend lo bloquea con `ENVIRONMENT=production`) | `app/(superadmin)/admin/flow-tester` |
| UX-01 | Con cookie `access_token` válida pero `localStorage` vacío (store sin `user`), `/teacher/*` queda en spinner infinito: el layout hace `router.push('/login')` y `proxy.ts` devuelve al dashboard por la cookie (bucle). Confirmado en navegador | `app/(teacher)/teacher/layout.tsx`, `proxy.ts` |
| UX-02 | Botones sin nombre accesible en login (ojo de contraseña, widget Chipi) | `(public)/login` |
| UX-03 | El dashboard del alumno dice «clase de prueba de 30 minutos»; el backend usa `trial_duration_minutes` (25 por defecto) | `student/dashboard` |
| UX-04 | `/admin/payments` → pestaña «Retiros (0)» siempre vacía por el 404 de AUD-12 (confirmado en red: `GET /payments/admin/withdrawals/pending` 404) | `admin/payments` |

Nota sobre `generated/API_CALLS.md`: de las 4 llamadas «sin ruta», solo `/payments/admin/withdrawals/pending` es un fallo real; las otras 3 son artefactos del regex (URLs con query o plantillas dinámicas).
