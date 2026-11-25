---
roles: [superadmin]
keywords: [single tenant, single-tenant, multi tenant, multi-tenant, un solo profesor, modo de plataforma, profesor destacado, destacada, pasar a multi, pasar a single]
summary: Cambiar entre modo un solo profesor (single) y varios (multi).
---
## Regla
En /admin/settings > Plataforma (solo superadmin). Single: la plataforma gestiona solo a la profesora destacada y los alumnos no eligen profesor; exige una destacada válida. Pasar single a multi corre un reparo de vínculos alumno-profesor en la misma transacción: nadie pierde a su profesor.
Multi a single no borra nada, pero está bloqueado mientras haya alumnos con paquete vivo o clases futuras con profesores distintos de la destacada: el cambio da error (409) con la lista de alumnos y no se puede forzar. Mientras esté bloqueado, el interruptor aparece deshabilitado con un aviso con los alumnos afectados, y al elegir otra destacada se rechaza con un mensaje. Cuando esos alumnos terminen o se resuelvan, la opción se habilita de nuevo. En single los demás profesores quedan inhabilitados y solo se ven en paneles de admin.

## Casos límite
- Cambiar de destacada A a B dentro de single tiene el mismo bloqueo: no se puede mientras haya alumnos vivos con otros profesores que no sean la nueva destacada.
- Un teacher_admin no puede cambiar el modo ni la destacada.
- Si la destacada no está aprobada, nadie puede reservar.

## Cuándo escalar
Si el cambio se bloquea, revisa la lista de alumnos afectados que muestra el aviso y resuélvelos (clases, paquetes, reembolsos) antes de reintentar.
