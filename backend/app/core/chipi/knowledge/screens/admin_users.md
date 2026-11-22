---
roles: [superadmin, teacher_admin]
summary: Edición masiva de usuarios
---
## Qué es
PANTALLA: Edición masiva de usuarios
Tabla con TODOS los usuarios de la plataforma (estudiantes, profesores y
staff) para editar en bloque: rol, información de contacto (teléfono,
zona horaria) y permisos. Los cambios se acumulan por fila y se guardan
todos juntos con el botón de guardar — no es edición inmediata campo por
campo.

## Pasos
Filtra por rol y estado; edita celdas (teléfono, nacionalidad, estado, rol) o usa «Cambiar valor en lote» → Aplicar → guardar.

## Reglas
El cambio de rol es solo del superadmin. «Descartar todo» o «Revertir» deshacen cambios sin guardar.

## Casos límite
Cambiar el email deja la cuenta sin verificar.

## Cuándo escalar
Se resuelve desde el panel; si no hay pantalla que lo permita, Modo Dios (superadmin).
