---
roles: [teacher, teacher_admin]
keywords: [google calendar, calendario, preply, sincronizar, conectar google, eventos externos, sync, calendar]
summary: Conectar Google Calendar: sincronización y clases externas de Preply.
---
## Regla
Puedes conectar Google Calendar desde tu perfil (necesitas el email verificado). Tus clases se sincronizan al calendario principal y los eventos externos (como los de Preply) se importan como bloqueos de solo lectura: la plataforma nunca los modifica en Google.

## Casos límite
- Detener la sincronización (desconectar, token vencido, cambiar de cuenta) nunca cancela clases ni eventos; solo se te avisa si Google rechaza el acceso.
- Una cuenta de Google solo puede estar conectada a un profesor.
- Al reservar o reagendar se comprueba el hueco exacto en Google.

## Cuándo escalar
Si Google rechaza la conexión repetidamente, ticket a Soporte con el mensaje de error.
