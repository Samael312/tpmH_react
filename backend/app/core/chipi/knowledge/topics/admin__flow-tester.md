---
roles: [superadmin]
keywords: [flow tester, flow-tester, pruebas, probar flujos, tests de flujo, flow tests]
summary: Flow Tester: pruebas de flujo, solo desarrollo.
---
## Regla
/admin/flow-tester lanza pruebas de flujo contra la base de datos. Es solo del superadmin, está apagado por defecto (FLOW_TESTS_ENABLED=false) y se bloquea en producción. Solo acepta identificadores de prueba válidos.

## Casos límite
- Úsalo solo con una rama de desarrollo de la base de datos, nunca con datos reales.

## Cuándo escalar
Si no aparece o da error, revisa que la variable de entorno esté activa y que no sea producción.
