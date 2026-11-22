---
roles: [superadmin]
keywords: [chat, chats, auditoria de chats, moderar, revisar conversacion, conversacion, reagendar clase ajena, clases de otros, materiales de otros, descargar materiales]
summary: Auditar chats y gestionar clases y materiales ajenos (solo superadmin).
---
## Regla
Auditoría de chats (/admin/chat): lees conversaciones; las que tienen contenido privado piden un motivo de revisión que queda registrado. Clases (/admin/classes): buscas cualquier clase por profesor, estado o fechas (UTC) y la reagendas o cancelas. Materiales (/admin/materials): ves y descargas los materiales de cualquier profesor.

## Casos límite
- Estas acciones son solo del superadmin; el teacher_admin recibe 403.
- Reagendar desde aquí no tiene tope ni antelación mínima.

## Cuándo escalar
Úsalo con motivo claro: el acceso a chats queda registrado.
