---
roles: [superadmin, teacher_admin]
summary: Validación de pagos (staff)
---
## Qué es
PANTALLA: Validación de pagos (staff)
Cola de notificaciones de pago enviadas por estudiantes (sin comprobante ni
captura, solo la confirmación de que ya transfirieron, con referencia
opcional) esperando aprobación o rechazo, en toda la plataforma.

## Pasos
Pestañas: Pagos, Retiros, Paquetes gratis, Profesores e Historial. «Confirmar pago» o «Rechazar» (con motivo); «Marcar Pagado» en retiros; «Aprobar» o rechazar solicitudes de paquete gratis.

## Reglas
Rechazar exige motivo. Pagos y retiros propios del teacher_admin los resuelve el superadmin.

## Casos límite
Reembolso bloqueado si el saldo del profesor no cubre su parte.

## Cuándo escalar
Se resuelve desde el panel; si no hay pantalla que lo permita, Modo Dios (superadmin).
