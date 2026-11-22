---
roles: [superadmin, teacher_admin]
summary: Modo Dios
---
## Qué es
PANTALLA: Modo Dios
Herramienta para que el staff cree o corrija manualmente registros
(clases, pagos, reseñas, cohortes, alumnos) sin pasar por los flujos
normales — típicamente para migrar datos de la plataforma anterior o
arreglar errores puntuales. Un teacher_admin solo puede usarla sobre sus
propios datos como profesor; un superadmin puede usarla sobre toda la
plataforma, incluida la transferencia de saldos entre billeteras.

## Pasos
Elige una acción a la izquierda → completa los campos → escribe el motivo (obligatorio) → Ejecutar → confirmar.

## Reglas
Todo queda en el historial de auditoría con antes y después. Crear o editar pagos es solo del superadmin.

## Casos límite
Si el ajuste dejaría la billetera de un profesor en negativo, da error 409.

## Cuándo escalar
Se resuelve desde el panel; si no hay pantalla que lo permita, Modo Dios (superadmin).
