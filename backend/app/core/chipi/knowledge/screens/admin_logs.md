---
roles: [superadmin, teacher_admin]
summary: Logs de errores
---
## Qué es
PANTALLA: Logs de errores
Registro técnico de errores ocurridos en el sistema, filtrable por usuario/
fecha, para diagnóstico técnico del equipo.

## Pasos
Filtra por origen (Backend, Frontend, Seguridad), gravedad o usuario; busca por pantalla o endpoint; abre el detalle.

## Reglas
Se conservan 30 días. Los fallos de jobs aparecen aquí.

## Casos límite
Un job que falla 5 veces seguidas deja de insistir 24 h.

## Cuándo escalar
Se resuelve desde el panel; si no hay pantalla que lo permita, Modo Dios (superadmin).
