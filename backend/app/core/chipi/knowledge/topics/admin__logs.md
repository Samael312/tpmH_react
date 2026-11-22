---
roles: [superadmin, teacher_admin]
keywords: [logs, errores, error del servidor, registro de errores, fallo, job fallo, ver logs]
summary: Logs de errores del backend y del frontend.
---
## Regla
/admin/logs muestra los errores del backend y del frontend. También ahí aparecen los fallos de los jobs programados (por ejemplo "Job x falló (intento N de 5)"). Los errores se conservan 30 días.

## Casos límite
- Un job que falla 5 veces seguidas deja de insistir 24 horas.
- Los logs del frontend tienen límites de tamaño y de frecuencia por IP.

## Cuándo escalar
Para un error recurrente que no entiendes, revisa la fecha y la pantalla que lo origina antes de actuar.
