---
roles: [superadmin, teacher_admin]
keywords: [aprobar pago, validar pago, pagos pendientes, rechazar pago, pago, reembolso, paquete gratis, solicitud de paquete, paquetes gratis, aprobar solicitud]
summary: Aprobar o rechazar pagos, reembolsos y solicitudes de paquete gratis.
---
## Regla
En /admin/payments (Pagos y Retiros) revisas los pagos pendientes y pulsas "Confirmar pago" o "Rechazar". Rechazar exige un motivo y no acredita nada; un pago no se aprueba dos veces. Al aprobar, se calcula la comisión del profesor (congelada en ese pago) y se acredita su billetera.
Reembolsos: se limitan a lo realmente pagado y, al aprobarlos, se descuenta de la billetera solo la parte del profesor; voluntarios con plazo de 7 días desde el pago aprobado. La pestaña Paquetes gratis lista las solicitudes de los profesores: apruébalas (pago manual de $0, sin comisión) o recházalas con motivo.

## Casos límite
- Si el saldo del profesor no cubre su parte del reembolso (ya retiró), se bloquea: no se puede aprobar.
- Un teacher_admin aprueba pagos de otros profesores, no los de sus propios alumnos (esos los aprueba el superadmin) ni las solicitudes de paquete gratis de su propio perfil.
- Aprobar un cambio de paquete sin cambio solicitado da error 409.

## Cuándo escalar
Para corregir un pago ya aprobado usa Modo Dios (solo superadmin), con motivo.
