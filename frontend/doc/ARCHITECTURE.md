# Arquitectura del frontend

## Stack
Next.js 16 (App Router, standalone en Docker: `node server.js`), React 19, TypeScript, Tailwind 3, TanStack Query 5,
Zustand 5 (+`persist`), axios, js-cookie, three.js (landing 3D), lucide-react. Sin librería de tests.

## Carpetas
```
app/            rutas (grupos (auth) (public) (student) (superadmin) (teacher)); ver generated/ROUTES.md
  providers.tsx QueryClient (staleTime 60 s, gcTime 5 min, sin refetch al enfocar), Toaster, ErrorBoundary, reporte global de errores
components/     admin/ auth/ chat/ chipi/ classes/ god-mode/ landing/ layout/ legal/ payments/ student/ support/ teacher/ ui/
hooks/          datos por rol con React Query: useStudentData, useTeacherData, useAdminData, useChat, useGodMode, useSupport, useBusinessRules...
store/          authStore (user + login/logout), chatStore (WS global en memoria), chatWidgetPresenceStore, toastStore
lib/            api.ts (axios), auth.ts (decode JWT), scheduleUtc.ts / tzFormat.ts / timezones.ts (horas), errorReporting.ts, godModeActions.ts...
proxy.ts        guard de rutas por rol (antes "middleware")
next.config.ts  CSP + cabeceras de seguridad (HSTS, X-Frame DENY...), rewrites, perfil destacado
```

## Sesión y autenticación
- Login -> `authStore.login(token, user)`: cookie `access_token` (`js-cookie`, `expires: 7`, `secure: true`, **no HttpOnly**). La cookie es la única fuente de verdad del token; el store persiste solo `user` en localStorage.
- `lib/api.ts`: el interceptor de request añade `Authorization: Bearer <cookie>`; el de response sincroniza `user` si la respuesta trae `id/username/role` del mismo usuario; **cualquier 401 (salvo `/auth/login`) -> `logout()` + `window.location.href="/login"`**; el resto de errores se reportan a `POST /logs/frontend` (4xx = warning, 5xx = error).
- `proxy.ts` decodifica el JWT **sin verificar la firma** (solo UX): sin token o expirado -> `/login`; rol incorrecto -> `/unauthorized`; con sesión válida, `/login` y `/register` redirigen al dashboard del rol.
  Mapa: `/dashboard/*` = `student`; `/teacher/*` = `teacher`, `teacher_admin`; `/admin/*` = `superadmin`, `teacher_admin`. El onboarding de profesor lo resuelve el layout con una llamada a la API.
  **Verificado** con tokens forjados (ver TESTING.md). Un token con firma falsa pasa el guard; la API lo rechaza con 401 y se hace logout.
- Google: GSI en `components/auth`, `POST /auth/google`, y `/register/google-complete` para cuentas nuevas.

## Estado y datos
React Query para datos del servidor (un hook por rol); Zustand solo para sesión, chat y toasts.
Chat: un único WebSocket por sesión (`store/chatStore.ts`, `/chat/ws`) arrancado desde los layouts de student/teacher; mensajes optimistas `sending -> sent -> delivered/read`.

## Fechas y zonas horarias
Backend en UTC. `lib/scheduleUtc.ts` (`getNextWeekdayDate`, `utcTimeToLocal`…) replica la lógica del backend para horarios semanales; `lib/tzFormat.ts` formatea con la zona del usuario.
Las pantallas pesadas (`student/schedule`, ~1800 líneas) duplican reglas del backend (estado de reserva, duraciones): al cambiar reglas, revisa ambos lados (`hooks/useBusinessRules.ts` trae las configurables).

## Seguridad
CSP con `'unsafe-inline'` y `'unsafe-eval'` en script-src; sin `dangerouslySetInnerHTML`; sin `console.log`; React escapa el HTML.
Pendiente: cookie HttpOnly (ver KNOWN_ISSUES).

## Build y calidad (verificado 2026-11-16)
`npx tsc --noEmit` 0 errores · `npx eslint .` limpio · `npx next build` 60 rutas · 0 tests.
