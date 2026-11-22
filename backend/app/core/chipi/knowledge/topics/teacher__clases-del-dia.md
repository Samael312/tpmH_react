---
roles: [teacher, teacher_admin]
keywords: [marcar clase, completada, marcar como completada, confirmar prueba, clase del dia, cancelar clase, reagendar, meet, mis clases, agenda, marcar no asistio]
summary: Día a día: confirmar pruebas, marcar clases, cancelar y reagendar.
---
## Regla
Desde /teacher/dashboard ves tus próximas clases con el enlace de Meet. Confirmas las pruebas pendientes. Tras la clase la marcas completada o no asistió, hasta 72 horas después de su fin; no se puede marcar una clase futura.
Cancelar una clase siempre devuelve el crédito al alumno y se le avisa. Reagendar es acordado con el alumno y para ti no hay tope de reagendados.

## Casos límite
- No puedes cancelar una clase ya dada: márcala completada o no asistida.
- Una segunda cancelación da error y no devuelve el crédito dos veces.
- Solo cambias el estado de tus clases.
- Reagendar una clase que quedó en no asistió le resta el crédito ya contado.

## Cuándo escalar
Si una clase tiene un estado incorrecto y ya pasaron 72 horas, pide la corrección a soporte (ver clase finalizada y no asistió).
