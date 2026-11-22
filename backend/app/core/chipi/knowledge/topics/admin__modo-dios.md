---
roles: [superadmin, teacher_admin]
keywords: [modo dios, god mode, corregir creditos, editar pago, editar clase, editar inscripcion, correccion manual, auditoria, motivo, ajustar creditos]
summary: Modo Dios: correcciones manuales con motivo y auditoría.
---
## Regla
En /admin/god-mode editas directamente clases, pagos, inscripciones y créditos. Cada cambio exige un motivo y queda en la auditoría. Editar un pago aprobado respeta la comisión congelada; si revertirlo dejaría la billetera del profesor en negativo, da error 409. Los reembolsos no se editan.

## Casos límite
- Crear o editar pagos en Modo Dios es solo del superadmin.
- Un teacher_admin solo puede tocar sus propios datos.
- Úsalo para casos que ninguna pantalla normal resuelve (créditos mal calculados, estados incorrectos).

## Cuándo escalar
Antes de usarlo, comprueba si la pantalla normal (Pagos, Clases) ya lo resuelve.
