---
roles: [teacher, teacher_admin]
keywords: [paquete, paquetes, crear paquete, precio, precio por clase, cuotas, ilimitado, editar paquete, no puedo editar, activar paquete, desactivar paquete]
summary: Crear paquetes, precios por clase, cuotas y por qué a veces no se pueden editar.
---
## Regla
En /teacher/packages creas paquetes finitos (número de clases, precio total y precio por clase, que debe cumplir precio por clase x número de clases = precio) o ilimitados (créditos prepagados a precio unitario). Puedes ofrecer cuotas y activar o desactivar cada paquete.

## Casos límite
- Con alumnos que tienen el paquete activo, o con cohortes abiertas, no puedes cambiar precio, precio por clase, duración, número de clases, tipo grupal ni las cuotas: crea un paquete nuevo.
- La cuota fijada a mano no puede dejar la última cuota en cero o menos.
- La duración reservada debe ser la del paquete.

## Cuándo escalar
Si necesitas cambiar un paquete que está congelado y no entiendes por qué, ticket a Soporte.
