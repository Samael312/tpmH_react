---
roles: [superadmin]
keywords: [correos, correo, limite diario, modo ahorro, resend, cuota de correos, plantillas, categorias de correo, emails, banner de correos]
summary: Control de correos: categorías, límite diario y modo ahorro.
---
## Regla
En /admin/settings > Correos (solo superadmin) activas o apagas categorías de correo y fijas el límite diario (100 por defecto, cuota gratuita de Resend). Al llegar al límite solo salen los esenciales (verificar email, restablecer contraseña, recuperar usuario), que nunca se apagan. El modo ahorro pausa categorías de alta probabilidad al llegar a un porcentaje del límite, hasta las 00:00 UTC.

## Casos límite
- Los correos omitidos o fallidos se anotan aparte y disparan un banner en el panel.
- Si el control de correos falla, el correo sale igual.

## Cuándo escalar
Para ver qué correos se omitieron, revisa el registro de correos en el panel.
