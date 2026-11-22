---
roles: [superadmin, teacher_admin]
keywords: [banear, desbanear, baneado, baneados, expulsar, expulsion, reactivar estudiante, bloquear alumno, desactivar, activar usuario, suspender alumno]
summary: Banear, desactivar y reactivar usuarios.
---
## Regla
En /admin/students y /admin/users puedes activar, desactivar y banear. Un usuario baneado o inactivo no puede iniciar sesión ni usar tokens existentes, y se cierran sus conexiones de chat. En /admin/students el botón "Expulsar" pide el motivo de la expulsión (banea al alumno). Los baneados se listan en /admin/students/banned, donde "Reactivar estudiante" los desbanea.

## Casos límite
- Un usuario inactivo no aparece en listados públicos.
- Banear no cancela sus clases ni toca sus pagos.

## Cuándo escalar
Para eliminar datos de una cuenta, el propio usuario la borra desde su perfil; tú solo puedes desactivarla o banearla.
