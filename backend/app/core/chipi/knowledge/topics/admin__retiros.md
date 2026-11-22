---
roles: [superadmin, teacher_admin]
keywords: [retiro, retiros, procesar retiro, retiro pendiente, completar retiro, rechazar retiro, pagar al profesor, referencia de retiro]
summary: Procesar los retiros de los profesores.
---
## Regla
Los retiros pendientes están en /admin/payments, pestaña Retiros. "Marcar Pagado" pide confirmar que ya transferiste y una referencia opcional (nº de operación, hash); eso guarda la referencia del pago y suma al total retirado; rechazar exige motivo y devuelve el saldo al profesor. El pago al profesor lo haces fuera de la plataforma antes de marcarlo completado.

## Casos límite
- Un retiro se procesa una sola vez; el segundo intento falla.
- Un teacher_admin no puede procesar su propio retiro: lo hace el superadmin.
- Cada profesor puede tener un solo retiro pendiente y el monto no supera su saldo.

## Cuándo escalar
Si el listado no carga o un retiro no se puede procesar, revisa Logs en el panel.
