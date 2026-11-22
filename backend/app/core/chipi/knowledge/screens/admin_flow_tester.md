---
roles: [superadmin]
summary: Flow Tester (herramienta interna de QA)
---
## Qué es
PANTALLA: Flow Tester (herramienta interna de QA)
Herramienta técnica para ejecutar flujos de prueba automatizados end-to-end
sobre el backend (registro, pagos, clases, etc.) y verificar que todo
funcione. No es una pantalla orientada a usuarios finales.

## Pasos
Elige un módulo o test → «Ejecutar solo este test» o «Ejecutar solo este módulo».

## Reglas
Solo superadmin, apagado por defecto y bloqueado en producción. «Incluir tests destructivos» es opcional.

## Casos límite
Úsalo solo con una rama de desarrollo de la base de datos.

## Cuándo escalar
Se resuelve desde el panel; si no hay pantalla que lo permita, Modo Dios (superadmin).
