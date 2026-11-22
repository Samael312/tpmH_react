---
roles: [superadmin]
keywords: [single tenant, single-tenant, multi tenant, multi-tenant, un solo profesor, modo de plataforma, profesor destacado, destacada, pasar a multi, pasar a single]
summary: Cambiar entre modo un solo profesor (single) y varios (multi).
---
## Regla
En /admin/settings > Plataforma (solo superadmin). Single: la plataforma gestiona solo a la profesora destacada y los alumnos no eligen profesor; exige una destacada válida. Pasar single a multi corre un reparo de vínculos alumno-profesor en la misma transacción: nadie pierde a su profesor.
Multi a single no borra nada; si hay alumnos con paquete vivo o clases futuras con otros profesores, el cambio avisa (409) y pide confirmar; si fuerzas, esos créditos quedan inutilizables hasta volver a multi o reembolsar.

## Casos límite
- Cambiar de destacada A a B dentro de single no tiene aviso previo.
- Un teacher_admin no puede cambiar el modo ni la destacada.
- Si la destacada no está aprobada, nadie puede reservar.

## Cuándo escalar
Antes de forzar multi a single, revisa la lista de alumnos afectados que muestra el aviso.
