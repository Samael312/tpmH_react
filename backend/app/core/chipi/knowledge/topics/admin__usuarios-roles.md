---
roles: [superadmin, teacher_admin]
keywords: [usuarios, cambiar rol, rol de un usuario, editar usuario, edicion de usuarios, email del usuario, contrasena, usuario, estudiantes]
summary: Editar usuarios y cambiar roles.
---
## Regla
En /admin/users editas datos de usuarios (activar, desactivar, banear). El cambio de rol es solo del superadmin. Los registros públicos solo admiten estudiante y profesor; los roles privilegiados se asignan aquí.

## Casos límite
- Cambiar el email deja la cuenta sin verificar.
- Un usuario con rol teacher_admin es un profesor con acceso a parte del panel.

## Cuándo escalar
Para cambios que ninguna pantalla permite, usa Modo Dios con motivo.
