---
roles: [superadmin]
summary: Buscar cualquier clase para reagendarla o cancelarla
---
## Qué es
PANTALLA: Clases (admin)
Solo superadmin. Busca cualquier clase con filtros por profesor, estado y rango
de fechas (días en UTC). Cada clase permite "Reagendar" (elige nueva fecha y
confirma) o "Cancelar".

## Pasos
Filtra por profesor, alumno, estado y fechas (UTC) → «Reagendar» → «Confirmar reagendado», o «Cancelar clase».

## Reglas
Solo superadmin. Se avisa por correo; el servidor valida choques de horario.

## Casos límite
Las clases «externa» (Google Calendar) son de solo lectura.

## Cuándo escalar
Se resuelve desde el panel; si no hay pantalla que lo permita, Modo Dios (superadmin).
