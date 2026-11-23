# Informe: subida de cobertura del backend (2026-11-23)

Resume lo hecho, los bugs encontrados, la reestimación de puntuaciones y lo pendiente. Las cifras de cobertura son **medidas**; las puntuaciones son **estimaciones razonadas**, no mediciones.

## 1. Lo realizado

- Cobertura de líneas del backend: **77,5 % → 97 %** (12.614 sentencias, 374 sin cubrir). Suite completa: **1364 pruebas en verde, 1 omitida** (1114 antes). `python -m pytest tests/audit -q --ignore=tests/audit/concurrency_live.py --cov=app`; ~72 min con la máquina cargada.
- 18 archivos nuevos en `backend/tests/audit/` (`test_g1_*` … `test_g18_*`). **No se modificó código de producción.**

| Archivo | Cubre |
|---|---|
| `test_g1`, `test_g2` | Modo Dios: acciones, dinero, reseñas, traspaso de alumno, `lookup/*` (`god_mode.py` 31 % → 98,8 %) |
| `test_g3` | Cohortes (`cohorts.py` 40 % → ~98 %) |
| `test_g4`, `test_g5` | Notificar pago, reembolsos, concesiones manuales, billetera |
| `test_g6` | Administración |
| `test_g7` | Tareas, reseñas, materiales (almacenamiento simulado) |
| `test_g8` | Disponibilidad y paquetes |
| `test_g9` | Usuarios (perfil, avatar, preferencias, borrado de cuenta) y profesores (vídeo, apelaciones, alumnos) |
| `test_g10` | Clases: sesión grupal, prueba, listados, estados, enlace Meet, cancelaciones |
| `test_g11`, `test_g12` | Google Calendar con cliente simulado (OAuth, reintentos, sync, importación Preply), `calendar_sync`, `timezone` |
| `test_g13` | Trabajos del planificador: recordatorios, Meet, paquetes por vencer, purgas, reintentos, arranque |
| `test_g14` | Chat: REST, lógica, auditoría de staff, gestor de sockets y **WebSocket con dos sesiones** (entrega, catch-up, topes, cierre por cuenta desactivada) |
| `test_g15` | `flow_tests.py` (subproceso de pytest **simulado**: nunca lanza la suite real) y `logs.py` |
| `test_g16` | Recálculo de zonas, huecos, catálogos y reglas de negocio, soporte, vínculos alumno-profesor |
| `test_g17` | Storage (Cloudinary simulado), Chipi (OpenAI simulado), landing pública, `main.py` |
| `test_g18` | Validadores de esquemas Pydantic |

- CI: `--cov-fail-under` sube de 75 a **95** en `.github/workflows/backend.yml`. Docs regenerados (`doc/generate_docs.py`); actualizados `backend/doc/TESTING.md`, `backend/doc/KNOWN_ISSUES.md` y `docs/PLAN_SUITE_COMPLETA.md`.
- Seguridad de las pruebas: ninguna toca la BD Neon real ni la red (Google, Cloudinary, OpenAI y subprocesos simulados).

## 2. Bugs y hallazgos

| # | Hallazgo | Estado |
|---|---|---|
| 1 | **Aviso de cuota de Google que se borra solo.** En `core/google_calendar.py::sync_calendar_logic`, con cuota agotada se guarda `token.last_error = "Límite de cuota…"` y se hace `break`; como `error_count` sigue en 0, `if error_count == 0: token.last_error = None` lo borra en la misma ejecución. El profesor y el admin nunca ven el aviso. | **Abierto**, sin corregir. Fijado por `test_g11::test_sync_logic_error_kinds`; al arreglarlo, ese assert cambia. |
| 2 | **Código inalcanzable** en `endpoints/teachers.py::submit_appeal` (líneas 556-561): el estado «apelaciones agotadas» ya se rechaza antes. | **Abierto**; conviene borrar la rama. |
| 3 | **Ramas defensivas duplicadas** en `god_mode.py` (~8 líneas) que repiten comprobaciones previas. | Abierto, bajo impacto. |

No se hallaron fallos de seguridad ni de dinero en las rutas que ahora tienen prueba. Cada prueba nueva fija el comportamiento actual (no hubo que cambiar reglas).

## 3. Reestimación de puntuaciones (0-100)

Misma rúbrica de `ANALISIS.md` (columna nueva «Tras cobertura backend»). Estimación razonada: las pruebas dan confianza en el comportamiento, no miden producción ni carga.

| Aspecto | Tras Playwright y accesibilidad | **Tras cobertura backend** | Por qué |
|---|---|---|---|
| Robustez | 91 | **93** | Chat (entrega, catch-up, topes), planificador (fallos y reintentos) y Google (errores y cuota) ahora tienen prueba y destaparon el bug 1. Limita: un worker, jobs en memoria, 374 líneas sin cubrir (`payments.py` en reembolsos de borde). |
| Profesionalidad | 94 | **96** | 97 % de cobertura backend con umbral de CI en 95 %, 18 archivos documentados, hallazgos registrados. Limita: `backend.yml` y `e2e.yml` aún no ejecutados en GitHub, `concurrency_live` sin correr. |
| Seguridad | 91 | **91** | Sin cambios de código; más pruebas de permisos (roles en chat/WS, 403 en admin, rutas de staff) pero ningún cierre nuevo. Limita: Bearer y `?token=` activos hasta el lanzamiento, sin 2FA. |
| Escalabilidad | 80 | **80** | Nada medido bajo carga; sin Redis ni más de un worker. |
| UX | 90 | **90** | Sin cambios de interfaz. |

## 4. Pendiente

**Backend (≈374 líneas, 3 %):**
- `payments.py` (~67): reembolsos, cohortes, cuotas, recargas de ilimitado, duplicados de notificación.
- `class_logic.py` (22), servicios de IA y voz (`chipi/service.py` 23, `tts_service.py` 23, `ai_debug.py` 15, `chipi/prompts.py` 13, `chipi/context.py` 7), OAuth de `calendar.py` (14) y `auth.py` (12), restos de `users.py`, `teachers.py`, `cohorts.py`, `chat.py`.
- Corregir los bugs 1 y 2 (y su prueba).
- El 100 % exacto no es realista: parte es código inalcanzable.

**Inventario «una prueba por ruta»:** test que falle si una de las 211 rutas de `generated/API_REFERENCE.md` no tiene prueba.

**Interfaz y navegador:**
- Chat WebSocket con dos sesiones en Playwright; zonas horarias en el navegador; registro por la pantalla real; Lighthouse en listas grandes; rerun de WebKit/iPhone de los flujos largos.
- Script de ejecución conjunta (backend + Vitest + Playwright).
- Ejecutar `backend.yml` y `e2e.yml` en GitHub.

**Frontend:** ramas restantes (~7 %), `ChipiMascot3D`, `HeroScene`, `app/layout.tsx`.

**Cierre:** relanzar la audit completa (backend con cobertura, Vitest, Playwright) y reestimar de nuevo.

**Limpieza:** directorio sobrante `C:\c` (de un `mv` anterior) que debe borrarse a mano.
