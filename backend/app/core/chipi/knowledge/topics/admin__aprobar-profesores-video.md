---
roles: [superadmin, teacher_admin]
keywords: [aprobar profesor, rechazar profesor, suspender profesor, profesores pendientes, video pendiente, aprobar video, rechazar video, apelacion, apelaciones, nuevo profesor]
summary: Aprobar profesores, suspenderlos y revisar videos y apelaciones.
---
## Regla
En /admin/teachers apruebas o rechazas postulaciones nuevas, suspendes profesores y fijas su comisión. Si un profesor aprobado subió un video nuevo, ves "Video nuevo pendiente" en su detalle: Aprobar (sustituye al anterior) o Rechazar con motivo (se conserva el anterior y el profesor puede apelar). Aprobar o rechazar una apelación también se hace desde su detalle; cada profesor tiene un máximo de 2 apelaciones ("Apelaciones agotadas 2/2") y después debe subir un video nuevo.

## Casos límite
- Suspender a un profesor congela a sus alumnos con paquete.
- Un teacher_admin no revisa su propio video ni apelaciones sobre su perfil: las resuelve el superadmin.
- El correo y la notificación al staff solo salen cuando se crea un video pendiente.

## Cuándo escalar
Si un archivo de video no se puede ver o aprobar, revisa Logs en el panel.
