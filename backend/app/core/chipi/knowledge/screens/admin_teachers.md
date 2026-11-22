---
roles: [superadmin, teacher_admin]
summary: Gestión de profesores
---
## Qué es
PANTALLA: Gestión de profesores
Listado de profesores con su estado (pendiente/aprobado/rechazado). Desde
aquí se aprueban o rechazan postulaciones nuevas y se gestionan perfiles
existentes.

## Pasos
Filtra por estado; abre un profesor → Aprobar, Rechazar o Suspender / Reactivar; fija la Comisión; revisa video pendiente y apelaciones.

## Reglas
Comisión de 0 a 1 (0.15 = 15 %). Máx. 2 apelaciones por profesor. El teacher_admin no revisa su propio video.

## Casos límite
Sin video no se puede aprobar. «Solo con video sin revisar» filtra los pendientes.

## Cuándo escalar
Se resuelve desde el panel; si no hay pantalla que lo permita, Modo Dios (superadmin).
