---
roles: [superadmin, teacher_admin]
keywords: [comision, comisiones, cambiar comision, porcentaje, tasa, comision por defecto, configuracion de pagos, metodos de pago, datos de pago]
summary: Comisión por profesor y configuración de métodos de pago.
---
## Regla
La comisión de cada profesor (0 a 1) se fija en /admin/teachers y vale 15 % si no tiene una propia. Se congela en cada pago aprobado, así que cambiarla no altera pagos pasados. El valor por defecto de la configuración no se aplica solo a profesores nuevos: ajusta la de cada uno.
Los datos y métodos de pago (banco, PayPal, Binance, pago móvil) se editan en Configuración > Pagos; los métodos deshabilitados se rechazan al pagar.

## Casos límite
- Un teacher_admin cambia la comisión de otros profesores, no la suya (la cambia el superadmin).
- El teacher_admin sí puede editar los datos de pago de la plataforma.

## Cuándo escalar
Si una comisión parece mal aplicada en un pago, revisa ese pago en Modo Dios (superadmin).
