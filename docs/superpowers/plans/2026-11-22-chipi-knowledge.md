# ChipiAI: conocimiento por pantalla y reglas generales — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que Chipi responda cualquier duda de pantallas, reglas y casos límite a los 4 roles, también fuera del tema de la pantalla, y escale a soporte según el rol.

**Architecture:** Fichas `.md` con frontmatter en `backend/app/core/chipi/knowledge/` (`screens/` y `topics/`). Un cargador las cachea y filtra por rol. `build_system_prompt` combina: base + plataforma + rol + mapa + **ficha de pantalla** + **índice de temas** + **hasta 3 fichas de tema elegidas por palabras clave** + **política de soporte por rol**. Sin embeddings ni llamadas extra a OpenAI.

**Tech Stack:** Python/FastAPI, pytest (SQLite, sin `.env`), Next.js (solo `ChipiWidget.tsx`).

**Spec:** `docs/superpowers/specs/2026-11-22-chipi-knowledge-design.md`

## Global Constraints

- **Nunca `git commit`/`add`/merge/push** (regla del usuario). Cada tarea termina con: listar archivos cambiados y proponer el mensaje de commit en un bloque de código.
- Roles válidos en fichas y código: `public`, `student`, `teacher`, `teacher_admin`, `superadmin`. `role=None` del endpoint = `public`.
- Topes de tamaño (caracteres del cuerpo): ficha de pantalla ≤ 1.500; índice de temas por rol ≤ 3.000; ficha de tema ≤ 2.000; máximo 3 fichas de tema por mensaje.
- `max_tokens` de OpenAI pasa de 500 a **600** (aprobado por el usuario).
- Escalado: student/teacher/teacher_admin → sugerir «¿Chipi no resolvió tu duda? Habla con soporte» o «Nuevo ticket» cuando la solución es de soporte, no hay información fiable o el usuario lleva **≥ 3 mensajes** sin resolver. Superadmin **nunca** recibe esa sugerencia (él es soporte). `teacher_admin` se trata como profesor; lo solo-superadmin se explica como «pídeselo al superadmin vía soporte».
- Textos en español, tuteo. Nada de datos bancarios, contraseñas ni códigos. Fichas de dinero de plataforma solo para `superadmin`/`teacher_admin`.
- Desviación del spec (aprobada al escribir el plan): el test del superadmin comprueba que no aparezcan las frases «Habla con soporte» ni «Nuevo ticket» ni «crear un ticket», no la palabra «ticket», porque la pantalla de soporte del admin habla legítimamente de tickets.
- Comandos de test: `cd backend && ../venv/Scripts/python.exe -m pytest tests/audit/test_chipi_knowledge.py -q`.
- Formato de ficha:

```
---
roles: [teacher, teacher_admin]        # omitido = todos los roles
keywords: [paquete gratis, regalar]    # solo en topics/; minúsculas
summary: una línea (la usa el índice)
---
## Qué es / ## Pasos / ## Reglas / ## Casos límite / ## Cuándo escalar   (pantallas)
## Regla / ## Casos límite / ## Cuándo escalar                          (temas)
```

## Review Focus

1. Mensaje con mayúsculas y tildes («¿PUEDO REGALAR un paquete GRATIS?») debe activar la ficha igual que en minúsculas → Task 2.
2. Mensaje/historial vacío o pantalla desconocida (`"main"` o inventada) no debe romper ni añadir basura → Tasks 2 y 3.
3. Una ficha con frontmatter roto no debe tumbar el chat en producción (se omite y se registra) pero **sí** debe hacer fallar el test de validación → Task 1.
4. El historial lo manda el cliente (no es de confianza): solo los mensajes `user` cuentan para el contador y las palabras clave, y ni el mensaje ni el historial se copian al prompt como contenido de ficha → Task 3.
5. Un estudiante que escribe palabras clave de profesor/admin («comisión», «retiro») no debe recibir fichas de esos roles → Task 2.

---

### Task 1: Cargador de fichas

**Files:**
- Create: `backend/app/core/chipi/knowledge/__init__.py`, `backend/app/core/chipi/knowledge/screens/.gitkeep`, `backend/app/core/chipi/knowledge/topics/.gitkeep`
- Test: `backend/tests/audit/test_chipi_knowledge.py`

**Interfaces:**
- Produces:
  - `@dataclass(frozen=True) class Card: slug: str; roles: frozenset[str]; keywords: tuple[str, ...]; summary: str; body: str`
  - `ALL_ROLES: frozenset[str]` (los 5 roles)
  - `load_cards(kind: Literal["screens","topics"], base: Path | None = None) -> dict[str, Card]` (cacheado; `base` solo para tests, sin caché)
  - `get_screen_card(screen: str, role: str | None) -> str` (cuerpo, `""` si no existe o el rol no tiene acceso)
  - `all_screen_keys() -> set[str]`
  - `validate_cards(base: Path | None = None) -> list[str]` (lista de errores; vacía = ok)

- [ ] **Step 1: tests que fallan** en `test_chipi_knowledge.py`: `test_load_cards_parses_frontmatter` (tmp_path con una ficha → roles/keywords/summary/body correctos), `test_missing_roles_means_all_roles`, `test_get_screen_card_filters_by_role` (ficha `roles: [superadmin]` → `""` para `student`, cuerpo para `superadmin`), `test_unknown_screen_returns_empty`, `test_broken_frontmatter_is_skipped_not_raised` (load_cards omite y no lanza) y `test_validate_cards_reports_broken_frontmatter_and_oversize` (ficha de 1.600 caracteres en `screens` → error que nombra el slug).
- [ ] **Step 2:** ejecutar el archivo; esperado: FAIL por módulo inexistente.
- [ ] **Step 3:** implementar el cargador con frontmatter parseado a mano (sin dependencia nueva), `functools.lru_cache` para la carga por defecto, `logging.error` al omitir una ficha rota. `validate_cards` comprueba: frontmatter válido, `roles` ⊆ `ALL_ROLES`, `summary` no vacío, `keywords` no vacío en `topics`, tope de tamaño del cuerpo (1.500 pantallas, 2.000 temas) y las cabeceras `##` requeridas por tipo.
- [ ] **Step 4:** ejecutar el archivo; esperado: PASS.
- [ ] **Step 5:** informar archivos cambiados + mensaje de commit propuesto.

### Task 2: Índice de temas y selección por palabras clave

**Files:**
- Modify: `backend/app/core/chipi/knowledge/__init__.py`
- Test: `backend/tests/audit/test_chipi_knowledge.py`

**Interfaces:**
- Consumes: `Card`, `load_cards` (Task 1).
- Produces:
  - `normalize(text: str) -> str` (minúsculas, sin tildes, espacios colapsados)
  - `get_topic_index(role: str | None) -> str` (una línea `- slug: summary` por tema visible al rol; `""` si no hay)
  - `pick_topics(role: str | None, text: str, limit: int = 3, base: Path | None = None) -> list[Card]` (puntaje = nº de keywords contenidas en `normalize(text)`; solo puntaje > 0; orden por puntaje desc y luego por slug; filtra por rol)
  - `render_topics(cards: list[Card]) -> str`

- [ ] **Step 1: tests que fallan** (con fichas de prueba en `tmp_path` pasando `base`): `test_pick_topics_ignores_case_and_accents` («¿PUEDO REGALAR un paquete GRATIS?» con keyword `paquete gratis` → 1 ficha), `test_pick_topics_empty_text_returns_empty`, `test_pick_topics_respects_limit_and_score_order` (4 coincidencias → 3, la de más keywords primero), `test_pick_topics_filters_by_role` (ficha `roles: [teacher]` no sale para `student` aunque la keyword coincida), `test_topic_index_only_lists_visible_topics`.
- [ ] **Step 2:** ejecutar; esperado: FAIL.
- [ ] **Step 3:** implementar las funciones; sin LLM ni dependencias.
- [ ] **Step 4:** ejecutar; esperado: PASS.
- [ ] **Step 5:** informar archivos + mensaje de commit.

### Task 3: Prompt con capas, política de soporte y endpoint

**Files:**
- Modify: `backend/app/core/chipi/prompts.py` (`BASE_SYSTEM_PROMPT` regla 3, `build_system_prompt`), `backend/app/api/v1/endpoints/chipi.py` (`_build_system_prompt`), `backend/app/core/chipi/service.py` (`max_tokens=600` en las dos funciones)
- Test: `backend/tests/audit/test_chipi_knowledge.py`

**Interfaces:**
- Consumes: `get_screen_card`, `get_topic_index`, `pick_topics`, `render_topics` (Tasks 1-2).
- Produces:
  - `get_support_policy(role: str | None, user_turns: int) -> str` en `prompts.py`
  - `build_system_prompt(role, screen, user_data=None, platform_data=None, user_text: str = "", user_turns: int = 0) -> str` (parámetros nuevos con valor por defecto, compatible hacia atrás)
  - `_build_system_prompt(current_user, screen, db, user_text: str = "", user_turns: int = 0)` en `chipi.py`; `user_turns` = mensajes `user` del historial + 1; `user_text` = mensaje actual + último mensaje `user` del historial (nunca el de `assistant`).

- [ ] **Step 1: tests que fallan:** `test_superadmin_prompt_has_no_support_escalation` (no contiene «Habla con soporte», «Nuevo ticket» ni «crear un ticket»; sí contiene «eres el soporte»), `test_student_teacher_teacher_admin_prompts_have_escalation`, `test_escalation_threshold` (`user_turns=2` no incluye la orden de escalar por insistencia; `user_turns=3` sí), `test_topic_from_other_screen_is_included` (rol `teacher`, pantalla `materials_teacher`, texto sobre paquete gratis → aparece la ficha), `test_student_does_not_get_platform_money_topics`, `test_prompt_size_under_budget` (peor caso: la pantalla de ficha más grande + 3 fichas máximas ⇒ ≲ 16.000 caracteres), `test_chipi_endpoint_counts_only_user_messages` (la función auxiliar que calcula `user_turns` ignora `assistant`).
- [ ] **Step 2:** ejecutar; esperado: FAIL.
- [ ] **Step 3:** quitar la regla 3 fija del base y moverla a `get_support_policy`; añadir las capas en el orden: base, plataforma, rol, mapa, ficha de pantalla, índice de temas, fichas de tema, política. `public` recibe: «si necesita ayuda humana, tras iniciar sesión puede usar Soporte». Mantener `SCREEN_CONTEXTS` solo hasta Task 4.
- [ ] **Step 4:** ejecutar; esperado: PASS. Ejecutar también `python -m pytest tests/audit -q -k chipi` por si otros tests tocan el prompt.
- [ ] **Step 5:** informar archivos + mensaje de commit.

### Task 4: Migrar `SCREEN_CONTEXTS` a fichas y cubrir las 52 páginas

**Files:**
- Create: `backend/app/core/chipi/knowledge/screens/<clave>.md` — uno por cada clave de `SCREEN_CONTEXTS` (45) más `verify-email`, `privacy`, `terms`, `unauthorized`, `admin_chat`, `admin_classes`, `admin_materials`, `teacher_notifications`
- Modify: `backend/app/core/chipi/prompts.py` (eliminar `SCREEN_CONTEXTS` y `get_screen_context`), `frontend/components/chipi/ChipiWidget.tsx` (`SCREEN_ROUTES`: añadir `/privacy`, `/terms`, `/unauthorized`, `/admin/chat`, `/admin/classes`, `/admin/materials`, `/teacher/notifications`)
- Test: `backend/tests/audit/test_chipi_knowledge.py`

**Interfaces:**
- Consumes: `all_screen_keys`, `get_screen_card`.
- Produces: una ficha por cada valor de `SCREEN_ROUTES` + `choose_teacher` + `teacher_browse`.

- [ ] **Step 1: test que falla:** `test_every_frontend_screen_has_a_card` — parsea `frontend/components/chipi/ChipiWidget.tsx` con la regex `\["(/[^"]*)",\s*"([^"]+)"\]`, añade `choose_teacher` y `teacher_browse`, y exige `valor ∈ all_screen_keys()`. Otro: `test_every_page_is_routed` — para cada `page.tsx` bajo `frontend/app` (ignorando grupos `(x)`), la ruta se resuelve a una clave que no sea el fallback genérico (`teacher_home` por `/teacher`, `admin_home` por `/admin`, salvo la propia home). Otro: `test_all_cards_validate` (`validate_cards() == []`).
- [ ] **Step 2:** ejecutar; esperado: FAIL.
- [ ] **Step 3:** convertir cada entrada existente a ficha (mismo texto, cabeceras requeridas; `roles` según el prefijo de la clave) y crear las 8 nuevas leyendo su `page.tsx`. Borrar `SCREEN_CONTEXTS` y actualizar el comentario de `SCREEN_ROUTES` para apuntar a `knowledge/screens/`.
- [ ] **Step 4:** ejecutar; esperado: PASS (los tests de Task 3 siguen pasando).
- [ ] **Step 5:** informar archivos + mensaje de commit.

### Task 5: Widget — soporte para `teacher_admin`

**Files:**
- Modify: `frontend/components/chipi/ChipiWidget.tsx:190` (`canReportToSupport`)
- Test: comprobación manual + `cd frontend && npx tsc --noEmit`

- [ ] **Step 1:** `canReportToSupport = student | teacher | teacher_admin`; superadmin sigue sin botón.
- [ ] **Step 2:** `npx tsc --noEmit` sin errores nuevos. Verificar en el navegador (servidor local con datos semilla, `python -m tests.audit.run_server`) que `teacher_admin` ve el enlace y superadmin no.
- [ ] **Step 3:** informar archivos + mensaje de commit.

### Task 6: Contenido — temas de estudiante

**Files:**
- Create: `backend/app/core/chipi/knowledge/topics/student__<slug>.md` con `roles: [student]`
- Fuentes: `backend/doc/BUSINESS_RULES.md`, `FLOWS.md`, `docs/USER_MANUAL.md` (§Alumno y §Errores típicos), `backend/doc/KNOWN_ISSUES.md`

**Slugs:** `registro-login-verificacion`, `prueba-gratis`, `reservar-clase`, `cancelar-reagendar`, `paquetes-creditos`, `renovar-cambiar-paquete`, `pagos-comprobantes`, `reembolsos`, `estados-de-clase`, `zonas-horarias-horario-verano`, `clases-grupales`, `chat-tareas-materiales`, `resenas`, `borrar-cuenta`, `idiomas-nivel`, `google-calendar-meet`, `soporte`.

- [ ] **Step 1: test que falla:** `test_student_topics_answer_core_questions` — para cada par (pregunta, slug esperado) como `("¿cuánto tengo para cancelar una clase sin perder el crédito?", "student__cancelar-reagendar")`, `("me rechazaron el pago", "student__pagos-comprobantes")`, `("¿qué pasa si el profesor no se conecta?", "student__estados-de-clase")`, `pick_topics("student", pregunta)` incluye el slug. Mínimo 12 pares, uno por tema con riesgo de confusión.
- [ ] **Step 2:** ejecutar; esperado: FAIL.
- [ ] **Step 3:** redactar cada ficha con las tres cabeceras (Regla / Casos límite / Cuándo escalar), valores exactos de las reglas (plazos, horas, porcentajes tal como están en `BUSINESS_RULES.md`; no inventar nada que no esté ahí), keywords de 4-8 formas de preguntarlo, y `summary` de una línea.
- [ ] **Step 4:** ejecutar el archivo completo; esperado: PASS (incluye `validate_cards`).
- [ ] **Step 5:** informar archivos + mensaje de commit.

### Task 7: Contenido — temas de profesor (y `teacher_admin`)

**Files:**
- Create: `topics/teacher__<slug>.md` con `roles: [teacher, teacher_admin]`
- Fuentes: las mismas + §Profesor del manual, NEG-01/NEG-02 de `BUSINESS_RULES.md`, Fases 16, 17, 20 de `CORRECCIONES.md`

**Slugs:** `alta-aprobacion`, `disponibilidad-slots`, `paquetes-precios`, `paquete-gratis-regalo`, `cohortes`, `clases-del-dia`, `clase-finalized-no-show`, `billetera-retiros`, `comisiones`, `pagos-pendientes-revision`, `reembolsos`, `google-calendar-preply`, `materiales-tareas`, `video-perfil-revision`, `resenas`, `zonas-horarias-horario-verano`, `soporte`.

- [ ] **Step 1: test que falla:** `test_teacher_topics_answer_core_questions` con mínimo 12 pares, incluido `("¿puedo regalar un paquete gratis a un alumno?", "teacher__paquete-gratis-regalo")` evaluado con `role="teacher"` y también con el texto en mayúsculas; y `test_teacher_cannot_see_admin_only_topics`.
- [ ] **Step 2–5:** igual que Task 6. Las reglas solo-superadmin (cambiar modo, Modo Dios, configuración global) se redactan como «pídeselo al superadmin vía soporte» cuando el rol es `teacher_admin`.

### Task 8: Contenido — temas de admin

**Files:**
- Create: `topics/admin__<slug>.md` con `roles: [superadmin]` (o `[superadmin, teacher_admin]` donde `BUSINESS_RULES.md`/Fase 16 lo permita)
- Fuentes: §Administrador del manual, NEG-01, Fase 16, Fase 18, `docs/TENANT_MODES_AUDIT.md`

**Slugs:** `aprobar-pagos-reembolsos`, `retiros`, `comisiones-configuracion`, `aprobar-profesores-video`, `baneos`, `modo-dios`, `single-multi-transicion`, `soporte-tickets-correccion-finalized`, `flow-tester`, `logs`, `usuarios-roles`, `catalogos-reglas`.

- [ ] **Step 1: test que falla:** `test_admin_topics_answer_core_questions` (mínimo 8 pares) y `test_admin_prompt_never_tells_to_open_a_ticket` (todas las fichas `roles: [superadmin]` no contienen «Habla con soporte» ni «crear un ticket»).
- [ ] **Step 2–5:** igual que Task 6. «Cuándo escalar» en estas fichas indica la pantalla del panel que lo resuelve, no soporte.

### Task 9: Contenido — enriquecer las fichas de pantalla

**Files:**
- Modify: `knowledge/screens/*.md` (lotes: públicas y estudiante, profesor, admin)
- Fuentes: `frontend/doc/PAGES_AND_UX.md`, el `page.tsx` de cada pantalla (botones y pestañas reales), `docs/USER_MANUAL.md`

- [ ] **Step 1: test que falla:** `test_screen_cards_have_steps_and_escalation` — toda ficha de pantalla, salvo `unauthorized`, `main` y las legales (`privacy`, `terms`), tiene las cinco cabeceras (`## Qué es`, `## Pasos`, `## Reglas`, `## Casos límite`, `## Cuándo escalar`) y ≤ 1.500 caracteres.
- [ ] **Step 2:** ejecutar; esperado: FAIL con la lista de fichas incompletas.
- [ ] **Step 3:** por lote, leer el `page.tsx` y escribir pasos con los **nombres reales** de botones/pestañas; enlazar a los temas relevantes por nombre (sin duplicar su contenido).
- [ ] **Step 4:** ejecutar; esperado: PASS.
- [ ] **Step 5:** informar archivos + mensaje de commit.

### Task 10: Cierre — docs y comprobación de extremo a extremo

**Files:**
- Modify: `CLAUDE.md` (línea de mantenimiento), `backend/doc/KNOWN_ISSUES.md` (decisión: Catálogos y Reglas siguen abiertos al `teacher_admin`; quitar el «abierto menor»), `backend/doc/FLOWS.md` §11 (Chipi), `docs/superpowers/specs/2026-11-22-chipi-knowledge-design.md` (desviación del test del superadmin)
- Test: manual

- [ ] **Step 1:** añadir en `CLAUDE.md`: «Al cambiar una regla o una pantalla, actualiza su ficha en `backend/app/core/chipi/knowledge/` y ejecuta `tests/audit/test_chipi_knowledge.py`».
- [ ] **Step 2:** `cd backend && python doc/generate_docs.py` y `../venv/Scripts/python.exe -m pytest tests/audit -q` (los xfail previos no cuentan como fallo).
- [ ] **Step 3:** prueba manual con el servidor semilla: 3 preguntas por rol, incluida «¿puedo regalar un paquete gratis?» desde Materiales como profesor; comprobar que superadmin nunca recibe la sugerencia de soporte y que un estudiante la recibe tras 3 mensajes sin resolver.
- [ ] **Step 4:** informar archivos + mensaje de commit.
