---
roles: [teacher, teacher_admin]
summary: Clases grupales (cohortes)
---
## Qué es
PANTALLA: Clases grupales (cohortes)
El profesor gestiona sus cohortes de clases grupales, cada una basada en un
paquete grupal ya creado.
Estados de una cohorte: "Llenándose" (aceptando inscripciones, sin fecha
fija) → "Confirmada"/cerrada (el profesor definió fecha y ya no acepta más
inscripciones) → "En curso" → "Completada" (o "Cancelada" si nunca se
llenó).
Acciones:
- "Cerrar cohorte" → fija la fecha de inicio y bloquea nuevas
  inscripciones; a partir de ahí puede agendar sesiones grupales
- "Agendar sesión grupal" → crea una clase para todos los inscritos de esa
  cohorte
- Tomar asistencia por sesión → marcar cada alumno como "asistió" o "no
  asistió"
- "Actualizar lista de integrantes" → refresca quiénes están inscritos
- Cancelar la cohorte → si no se llenó el cupo mínimo o el profesor decide
  no dictarla

## Pasos
«Nuevo grupo» → elige paquete grupal → «Crear Grupo»; después «Agendar sesión». «Cerrar con integrantes actuales» fija el cupo.

## Reglas
Requiere un paquete marcado como grupal. «Abortar / Cancelar» libera cupos y cancela sesiones futuras.

## Casos límite
Alumno con otra clase a esa hora se omite de la sesión. «Reabrir» vuelve a abrir el cupo.

## Cuándo escalar
Si no se resuelve, abrir un ticket: enlace «Habla con soporte» del chat o «Nuevo ticket» en Soporte.
