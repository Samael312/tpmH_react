---
roles: [superadmin, teacher_admin]
keywords: [catalogos, catalogo, idiomas del catalogo, reglas de negocio, antelacion, ventana de cancelacion, duraciones, margen entre clases, configuracion, ajustes, retencion del chat, umbral de pocos creditos]
summary: Catálogos y reglas de negocio configurables.
---
## Regla
En /admin/settings editas catálogos (idiomas, idiomas hablados, etc.) y reglas de negocio: antelación mínima, ventanas de cancelación y reagendado, duraciones permitidas, márgenes entre clases, umbral de "pocos créditos" y retención del chat. Cuando no hay filas en BD se usan valores por defecto del código.

## Casos límite
- Estas pestañas están abiertas también al teacher_admin (decisión del propietario).
- Un valor 0 en una regla es válido.
- Plataforma, Chats y Correos son solo del superadmin.

## Cuándo escalar
Antes de bajar una ventana de cancelación, ten en cuenta que afecta a todas las clases futuras.
