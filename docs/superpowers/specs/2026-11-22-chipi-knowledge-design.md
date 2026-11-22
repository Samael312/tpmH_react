# ChipiAI: conocimiento por pantalla y reglas generales (diseño)

Fecha: 2026-11-22 · Estado: pendiente de revisión del usuario

## Objetivo

Que Chipi responda a estudiantes, profesores, `teacher_admin` y superadmin cualquier duda sobre:

- cómo usar cada pantalla (pasos, botones, pestañas),
- las reglas de negocio de la plataforma,
- qué hacer en casos límite (pago rechazado, clase `finalized`, reembolso a 7 días, DST, etc.),

**aunque la pregunta no tenga que ver con la pantalla donde está** (ejemplo: un profesor en Materiales pregunta si puede regalar un paquete gratis).

Si la solución requiere a una persona, o Chipi no logra resolver tras varios mensajes, indica contactar a soporte. El superadmin **es** el soporte: a él nunca se le manda a soporte.

Chipi solo explica; no ejecuta acciones ni revela datos de otro rol.

## Estado actual

- `backend/app/core/chipi/prompts.py` arma el prompt con: base, plataforma, rol, mapa de navegación y `SCREEN_CONTEXTS` (45 entradas de 2-10 líneas; 52 páginas).
- `backend/app/api/v1/endpoints/chipi.py::_build_system_prompt` lo construye por mensaje. Modelo `gpt-4o-mini`, `max_tokens=500`, historial de 10.
- `frontend/components/chipi/ChipiWidget.tsx` mapea ruta → `screen` (`SCREEN_ROUTES`) y muestra «Habla con soporte» solo a `student`/`teacher`.
- Las reglas viven en `backend/doc/BUSINESS_RULES.md` (39 KB), `FLOWS.md`, `KNOWN_ISSUES.md`, `docs/USER_MANUAL.md`; Chipi no las lee. Meterlas enteras costaría ~20k tokens por mensaje.

## Diseño

### 1. Tres capas de conocimiento

| Capa | Qué contiene | Cuándo entra al prompt |
|---|---|---|
| A. Pantalla | Qué es, pasos, botones, casos límite propios, «cuándo escalar» | Siempre la de la pantalla actual |
| B. Índice de temas del rol | Una línea por tema (paquete gratis, reembolsos, retiros, cancelar clase…) | Siempre (~500-800 tokens) |
| C. Fichas de tema | Regla completa + casos límite + qué hacer | Hasta 3 por mensaje, elegidas por palabras clave |

La capa C responde preguntas fuera de tema. Selección sin LLM ni embeddings: coincidencia de palabras clave (normalizadas, sin tildes) en el mensaje actual y el último mensaje del usuario del historial. Si hay más de 3 coincidencias, gana el mayor número de palabras clave coincidentes; el empate lo decide el orden de la ficha. Las fichas no filtradas por rol nunca se incluyen.

### 2. Estructura en disco

```
backend/app/core/chipi/knowledge/
  __init__.py        # carga y cachea; API: get_screen_card(screen, role), get_topic_index(role), pick_topics(role, text)
  screens/           # un .md por pantalla (clave = valor de SCREEN_CONTEXTS)
  topics/            # un .md por tema
```

Cada `.md` lleva frontmatter simple:

```
---
roles: [teacher, teacher_admin]      # quién puede ver esta ficha
keywords: [paquete gratis, regalar, cortesia]
summary: Un profesor puede pedir un paquete gratis para un alumno (requiere aprobación del staff).
---
cuerpo: pasos, reglas, casos límite, cuándo escalar
```

`SCREEN_CONTEXTS` en `prompts.py` se reemplaza por la lectura de `screens/`. `get_navigation_map` se queda como está.

### 3. Escalado a soporte por rol

Se añade al prompt una sección según el rol:

- **student / teacher / teacher_admin:** si la solución es de soporte, o la duda no se resolvió, o el usuario insiste/repite, o Chipi no tiene información fiable → indicar el botón «¿Chipi no resolvió tu duda? Habla con soporte» o «Nuevo ticket» en Soporte. El servidor inyecta «El usuario lleva N mensajes en esta conversación»; con N ≥ 3 sin resolución, Chipi debe proponer soporte.
- **superadmin:** nunca sugerir ticket. Indicar la pantalla del panel que lo resuelve; si no hay forma, decirlo con honestidad.
- `teacher_admin` se trata como profesor (puede crear tickets; los atiende el superadmin). Lo que solo puede hacer el superadmin (cambiar modo single/multi, Modo Dios, configuración de plataforma) se explica como «pídeselo al superadmin vía soporte».

### 4. Frontend

- `ChipiWidget.tsx`: `canReportToSupport` incluye `teacher_admin`; superadmin sigue sin botón.
- `SCREEN_ROUTES` debe cubrir las 52 páginas; las que falten se añaden con su ficha.

### 5. Privacidad y límites

- Las fichas de dinero de plataforma (cuentas, aprobación de pagos, comisiones de otros) llevan `roles: [superadmin, teacher_admin]` según corresponda; no entran en prompts de estudiante o profesor.
- Nada de datos bancarios, contraseñas ni códigos (regla ya en el prompt base).
- Chipi no promete acciones que no puede ejecutar.

### 6. Presupuesto de tokens

- Capa A: ≤ 1.500 caracteres por pantalla.
- Capa B: ≤ 3.000 caracteres por rol.
- Capa C: ≤ 3 fichas de ≤ 2.000 caracteres.
- Prompt total por mensaje ≲ 4k tokens. `max_tokens` de respuesta pasa de 500 a 600 para dar espacio a pasos numerados (a confirmar).

### 7. Tests (`backend/tests/audit/test_chipi_knowledge.py`)

- Cada pantalla de `SCREEN_ROUTES` (frontend, parseado) tiene su ficha.
- Cada ficha tiene `roles`, `keywords`, `summary`; ninguna supera su tope de tamaño.
- `pick_topics`: «¿puedo regalar un paquete gratis?» como profesor devuelve la ficha de paquete gratis desde cualquier pantalla; como estudiante no devuelve fichas de profesor.
- Prompt de superadmin no contiene «Habla con soporte», «Nuevo ticket» ni «crear un ticket» (la palabra «ticket» sí puede aparecer: la pantalla de soporte del admin habla de tickets); prompt de student/teacher/teacher_admin contiene la política de escalado.
- Ningún prompt de student/teacher contiene fichas de dinero de plataforma.
- Prompt total bajo el tope para el peor caso (pantalla más grande + 3 fichas máximas).
- Sin llamadas a OpenAI: los tests prueban el prompt, no la respuesta.

### 8. Contenido

Lo redacto yo a partir de `BUSINESS_RULES.md`, `FLOWS.md`, `KNOWN_ISSUES.md`, `USER_MANUAL.md` y `frontend/doc/PAGES_AND_UX.md`, en lenguaje de usuario (tuteo), y lo dejo para que el usuario lo revise. Se procede por lotes: estudiante → profesor → admin; temas primero, pantallas después.

### 9. Mantenimiento

Añadir en `CLAUDE.md`: al cambiar una regla o una pantalla, actualizar su ficha en `core/chipi/knowledge/`.

## Fuera de alcance

- Embeddings / RAG.
- Que Chipi ejecute acciones.
- Cambios en el modelo de OpenAI.
- Medir la calidad real de las respuestas (se hará a mano con preguntas de prueba tras implementarlo).

## Decisiones tomadas

- Catálogos y Reglas de negocio de `/admin/settings` siguen abiertos al `teacher_admin` (decisión del usuario, 2026-11-22; solo se anota en `KNOWN_ISSUES.md`).
- Opción A (archivos curados), no RAG.
- Superadmin = soporte, sin escalado.
