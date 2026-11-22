---
roles: [teacher, teacher_admin]
keywords: [aprobar pago, validar pago, pago pendiente, pendiente de revision, no puedo aprobar, rechazar pago, pagos de mis alumnos, pagos]
summary: Quién aprueba los pagos de tus alumnos.
---
## Regla
Los profesores no aprueban ni rechazan pagos: en /teacher/payments ves los pagos de tus alumnos como "pendiente de revisión" y los valida el staff. Cuando se aprueban, tu parte (menos comisión) se acredita en tu billetera.

## Casos límite
- Si eres teacher_admin, validas los pagos de otros profesores pero no los de tus propios alumnos: esos los aprueba el superadmin.
- Un pago no se aprueba dos veces.

## Cuándo escalar
Si un pago de tu alumno lleva mucho pendiente, ticket a Soporte.
