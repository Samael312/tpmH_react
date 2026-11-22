---
roles: [superadmin, teacher_admin]
summary: Estudiantes baneados
---
## Qué es
PANTALLA: Estudiantes baneados
Listado de estudiantes con la cuenta suspendida/baneada y el motivo, con
opción de revertir el baneo si corresponde.

## Pasos
Lista de baneados → «Reactivar estudiante» → confirmar.

## Reglas
Reactivar devuelve el acceso; no cambia sus pagos ni clases.

## Casos límite
Si falla la carga, usa «Reintentar».

## Cuándo escalar
Se resuelve desde el panel; si no hay pantalla que lo permita, Modo Dios (superadmin).
