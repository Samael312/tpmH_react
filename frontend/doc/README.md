# Documentación del frontend (Next.js 16 / React 19)

> **Para el próximo Claude/desarrollador: lee esto primero.** Describe el comportamiento ACTUAL (commit `848e6f3`, 2026-11-16).
> Antes de escribir código Next.js lee también `frontend/AGENTS.md`: esta versión de Next tiene cambios incompatibles
> (p. ej. el middleware se llama `proxy.ts`); la guía vive en `node_modules/next/dist/docs/`.
> Backend: `../../backend/doc/README.md`.

| Documento | Contenido | Mantenimiento |
|---|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Stack, carpetas, auth/sesión, cliente API, estado, fechas/zonas horarias, seguridad, build | a mano |
| [`PAGES_AND_UX.md`](PAGES_AND_UX.md) | Qué hace cada pantalla por rol, flujos de usuario y UX notable | a mano |
| [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md) | Problemas del frontend y desalineaciones con el backend | a mano |
| [`TESTING.md`](TESTING.md) | Verificaciones ejecutadas, cómo levantar el entorno local, qué falta | a mano |
| [`generated/ROUTES.md`](generated/ROUTES.md) | Todas las páginas, archivo, rol del guard, líneas | **generado** |
| [`generated/COMPONENTS.md`](generated/COMPONENTS.md) | components/hooks/store/lib con exports y cuántos archivos los usan (detecta huérfanos) | **generado** |
| [`generated/API_CALLS.md`](generated/API_CALLS.md) | Llamadas a la API por archivo y las que NO casan con ninguna ruta del backend | **generado** |

Regenerar: `cd backend && python doc/generate_docs.py`.

Comandos: `npm run dev` · `npm run build` · `npm run lint` · `npx tsc --noEmit`. No hay script de tests.
Variables: `NEXT_PUBLIC_API_URL` (default `http://localhost:8000/api/v1`), `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_FEATURED_TEACHER_USERNAME` (default `"mar12"`).
