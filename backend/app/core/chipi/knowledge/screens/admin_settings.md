---
roles: [superadmin, teacher_admin]
summary: Configuración de la plataforma
---
## Qué es
PANTALLA: Configuración de la plataforma
Ajustes globales, organizados en secciones: identidad de la plataforma
(nombre/tagline, modo single-tenant vs multi-tenant, profesor destacado),
métodos de pago aceptados de los alumnos, catálogos básicos (materias,
idiomas, objetivos), reglas de negocio (comisión, duración de clases,
antelación mínima) y apariencia.

## Pasos
Pestañas: Pagos (métodos y comisión por defecto), Plataforma (modo single-tenant, destacado, landing), Chats, Correos, Catálogos y Reglas de negocio → guardar cada bloque.

## Reglas
Plataforma, Chats y Correos: solo superadmin. Pagos, Catálogos y Reglas: también teacher_admin.

## Casos límite
La comisión por defecto no se aplica sola a profesores nuevos: ajusta la de cada uno.

## Cuándo escalar
Se resuelve desde el panel; si no hay pantalla que lo permita, Modo Dios (superadmin).
