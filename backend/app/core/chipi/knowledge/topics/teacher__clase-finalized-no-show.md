---
roles: [teacher, teacher_admin]
keywords: [finalizada, finalizado, no_show, no show, no asistio, 72 horas, corregir clase, correccion, marque la clase, pasaron 72, aviso clase]
summary: Clases finalizadas sin marcar, paso automático a no asistió y cómo corregirlo.
---
## Regla
Una clase confirmada que ya pasó queda finalizada hasta que la marques. Tienes 72 horas desde su fin; pasado ese plazo pasa sola a no asistió y consume el crédito del alumno. Te llega un aviso en Avisos (menú lateral).
Pasadas las 72 horas ya no puedes cambiarla tú: desde la clase pides la corrección a soporte (completada o cancelada) con un motivo de al menos 10 caracteres.

## Casos límite
- Solo se corrigen clases propias, en no asistió, no externas y sin otra solicitud pendiente.
- Si el superadmin aprueba completada, el crédito no cambia; si aprueba cancelada, se devuelve el crédito; si rechaza, la clase queda igual.
- Las pruebas sin confirmar siguen la misma regla de 72 horas.
- Máximo 5 tickets por hora.

## Cuándo escalar
La corrección pasada la ventana siempre la decide soporte: guía al profesor a pedirla desde la clase.
