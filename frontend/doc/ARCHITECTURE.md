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
next.config.ts  cabeceras de seguridad estáticas (HSTS, X-Frame DENY...), rewrites · lib/csp.ts + proxy.ts: CSP con nonce por petición
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
CSP con nonce y `'strict-dynamic'` en script-src (`'unsafe-eval'` solo en desarrollo; en producción `style-src` (elementos `<style>`/`<link>`) usa nonce sin `'unsafe-inline'` y `style-src-attr 'unsafe-inline'` permite solo los atributos `style="…"` que escribe React; en desarrollo `style-src` conserva `'unsafe-inline'` por el HMR); sin `dangerouslySetInnerHTML`; sin `console.log`; React escapa el HTML.
Pendiente: cookie HttpOnly (ver KNOWN_ISSUES).

## Build y calidad (verificado 2026-11-16)
`npx tsc --noEmit` 0 errores · `npx eslint .` limpio · `npx next build` 60 rutas · 0 tests.

## Listados paginados (Fase 11)
`lib/pagination.ts` → `fetchAllPages(path, { params, rows })`: el backend devuelve como mucho `limit` filas (200 por defecto) y el total en `X-Total-Count`; las pantallas filtran y suman sobre la lista completa, así que los hooks de listados piden página a página hasta completar el total (una sola petición si hay menos de 200 filas; tope de seguridad de 5000). Lo usan los hooks de pagos, retiros, ingresos, tickets, alumnos, clases, cohortes, conversaciones y los listados de admin. Paginación incremental con «Cargar más» solo tendría sentido donde la pantalla no filtre ni sume en el cliente.

**«Cargar más» (Fase 13-14):** `hooks/useLoadMoreList.ts` + `lib/loadMore.ts::fetchPage` + `components/ui/LoadMoreButton.tsx`, de 50 en 50 con `useInfiniteQuery`. Acepta `params` (filtros que van al servidor; inclúyelos en la `queryKey`) y, para respuestas que no son una lista con `X-Total-Count`, `rows`/`totalOf`/`offsetParam` (p. ej. `/admin/users`: `{ total, active_count, users }` con `skip`). Devuelve `total` y `firstBody` para los contadores: nunca se cuentan las filas cargadas. Desde la Fase 14 (E6) lo usan también los listados del admin: alumnos y baneados (`/admin/users`, con `active_count`), directorio de profesores (`/admin/teachers`, «solo con vídeo» = `has_video` en el servidor), tickets de soporte y el historial de pagos (que solo se pide al abrir su pestaña). Los selectores que necesitan la lista entera (profesor destacado en ajustes) usan `useAllTeachers`, que sigue con `fetchAllPages`.

## Fuentes y caché (Fase 11)
Inter, Poppins (600/700/800) y DM Sans (400/500/600) se cargan con `next/font/google` en `app/layout.tsx` (se descargan en el build y se sirven desde el propio sitio; Tailwind las usa por las variables `--font-poppins` y `--font-dm-sans`). `public/` lleva `Cache-Control` de 7 días. El modelo 3D `public/models/Chipi_Waving.glb` pesa 22 MB (13 MB de texturas JPEG y 9 MB de geometría): ver `CORRECCIONES.md` (Fase 11).

## Imágenes (Fase 11)
`next.config.ts` usa un cargador propio (`images.loader: "custom"`, `lib/imageLoader.ts`): las URLs de `res.cloudinary.com/.../image/upload/...` se reescriben con `f_auto,q_auto,c_limit,w_<ancho>` para que las optimice el CDN de Cloudinary (AVIF/WebP según el navegador) y el servidor de Railway no gaste CPU ni RAM; el resto (logo local, avatares de Google y ui-avatars) se sirve tal cual con un `?w=` inocuo. La lógica está en `lib/cloudinaryImage.ts` (`tests/cloudinaryImage.test.ts`). Las URLs con transformaciones propias, los vídeos y los PDF no se tocan. Los `<img>` sueltos (avatares de hosts arbitrarios) llevan `loading="lazy"`.
