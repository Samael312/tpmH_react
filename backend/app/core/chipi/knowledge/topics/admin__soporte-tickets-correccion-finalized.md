---
roles: [superadmin, teacher_admin]
keywords: [soporte, tickets, responder ticket, correccion de clase, no_show, finalizada, corregir clase, resolver correccion, ticket abierto, decision]
summary: Responder tickets y resolver correcciones de clases no asistidas.
---
## Regla
En /admin/support respondes los tickets (el usuario recibe email). Las correcciones de clase llegan como tickets de tipo corrección: el profesor pide pasar una clase no_show a completada o cancelada, con motivo. La decisión la toma solo el superadmin (aprobar o rechazar): aprobada completada no cambia el crédito; aprobada cancelada devuelve el crédito; rechazada deja la clase igual.

## Casos límite
- Las clases pasan solas a no asistió a las 72 horas sin marcar y consumen el crédito.
- Cada usuario puede abrir como máximo 5 tickets por hora.
- Un teacher_admin ve la bandeja de staff y su propia bandeja Mi soporte.

## Cuándo escalar
Si una corrección requiere cambios que la decisión no cubre, usa Modo Dios con motivo.
