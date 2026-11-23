# Trabajo pendiente: suite completa de pruebas (frontend + backend en paralelo)

Estado a noviembre de 2026. Este documento recoge lo que falta para tener una suite que pruebe **todas las pantallas del frontend** y, en paralelo, una suite equivalente del **backend**, ejecutables juntas.

## 0. Estado actual (frontend, cerrado el punto 1 y el inventario de 2.4)

- 1838 pruebas Vitest en 108 archivos, todas en verde. Cobertura: líneas **97,93 %**, funciones **96,14 %**, ramas **92,82 %** (criterio del plan: 97 / 90 / 92, cumplido).
- `tests/screenInventory.test.ts` falla si una `app/**/page.tsx` no tiene una prueba de flujo que la importe (hoy sin exenciones).
- Lo que sigue sin cubrir es sobre todo código inalcanzable o defensivo (manejadores tras botones deshabilitados, `||{}`/`??`) y los dos archivos WebGL.
- Playwright hecho: 4 proyectos (escritorio, móvil, WebKit, iPhone), smoke, barrido axe de 24 pantallas sin excepciones (se corrigieron `button-name`, `label`, `select-name` y `color-contrast`) y comprobación del canvas 3D.
- Pendiente real: flujos largos y chat WebSocket en Playwright, Lighthouse, y la suite del backend (secciones 2.4-2.5 y 3).

## 1. Punto de partida (frontend, al empezar el trabajo)

- 1520 pruebas Vitest en 84 archivos, todas en verde. Cobertura: líneas **96,3 %**, ramas **89,6 %**, funciones **81,1 %**.
- Smoke E2E con Playwright (8 pruebas, backend semilla SQLite) y 22 sondas de zona horaria (`__tz_probes__`).
- Detalle y metodología: `frontend/doc/TESTING.md`.
- Con cobertura, ejecutar con `--maxWorkers=3`. Con 4 hilos `studentSchedule` falla alguna vez por tiempo.

## 2. Pendiente en el frontend

### 2.1 Funciones sin cubrir (362 de 1814)
| Archivo | Sin cubrir | % funciones |
|---|---|---|
| `admin/settings` | 64 | 57 % |
| `teacher/cohorts` | 19 | 67 % |
| `student/schedule` | 17 | 69 % |
| `teacher/materials` | 16 | 75 % |
| `teacher/profile` | 15 | 78 % |
| `admin/payments` | 14 | 67 % |
| `teacher/packages` | 13 | 70 % |
| `student/classes` | 12 | 59 % |
| `student/profile` | 11 | 68 % |
| `admin/teachers` | 11 | 74 % |
| `GodModeActionRunner` | 10 | 66 % |
| `ClassCard` | 9 | 74 % |

Orden sugerido: `admin/settings` y `student/classes` primero (probablemente hay handlers reales sin ejercitar), luego `teacher/cohorts` y `teacher/materials`. Muchas del resto son callbacks mínimos (`onChange`, `.map`, `onClose`).

### 2.2 Ramas sin cubrir (874 de 8674)
`teacher/cohorts` 44, `admin/settings` 43, `student/schedule` 43, `teacher/profile` 43, `teacher/materials` 42, `student/profile` 42, `teacher/onboarding` 29, `teacher/packages` 28, `GodModeActionRunner` 28, `teacher/homework` 27, **`NavBar` 24 (68 %, el más flojo)**, `ClassCard` 20.
Casi todas son variantes de texto/estilo o estados raros (`a ?? b`, ternarios, `cond && <X/>`). Perseguir el 100 % de ramas rinde poco; apuntar a ≥ 92 % en estos archivos.

### 2.3 Sin probar a propósito
`ChipiMascot3D` y `HeroScene` (WebGL/three.js; no corren en jsdom). Cubrirlos solo con Playwright si se quiere (captura de pantalla o comprobar que el canvas monta).

### 2.4 Suite completa «una prueba por pantalla»
Objetivo: que **cada ruta** del `app/` tenga su archivo de prueba con happy path, validaciones, errores de carga/envío y estados vacíos.
Tareas:
1. Inventario automático de rutas (`app/**/page.tsx`) frente a `tests/components/*.test.tsx`; falla si una pantalla no tiene prueba (test de «cobertura de pantallas»).
2. Cerrar las pantallas con funciones/ramas bajas de 2.1 y 2.2.
3. Playwright: ampliar el smoke con los flujos que Vitest no cubre: registro → clase de prueba → pago → agenda (móvil y escritorio), admin aprueba pago, retiro, chat WebSocket real, reagendado, zonas horarias.
4. Accesibilidad (axe) y rendimiento del landing 3D (Lighthouse). Detalle en 2.5.

### 2.5 Pruebas de UI en navegador real (siguen siendo necesarias)
Lo hecho en noviembre de 2026 (1838 pruebas en jsdom) cubre la lógica de cada pantalla: qué pasa al pulsar, escribir, fallar o venir vacía, validaciones, mensajes y permisos por rol. **No cubre lo que depende de un navegador real:**

| # | Hueco | Por qué jsdom no lo ve | Prueba propuesta |
|---|---|---|---|
| 1 | **Móvil** (el mayor) | No calcula layout: no detecta cortes, solapes ni botones no pulsables | Los flujos de abajo, también en viewport de móvil (p. ej. 390×844) |
| 2 | Flujos largos encadenados | Cada paso se prueba suelto y con mocks | Playwright con el backend semilla: registro → clase de prueba → pago → agenda; admin aprueba pago; retiro; reagendado |
| 3 | Chat con WebSocket real | Se probó con sockets simulados | Dos sesiones a la vez: mensaje, no leídos, reconexión |
| 4 | Accesibilidad | Teclado, foco en modales, contraste y etiquetas necesitan páginas reales | Barrido axe (`@axe-core/playwright`) sobre las pantallas principales |
| 5 | Landing 3D (`HeroScene`, `ChipiMascot3D`, 0 % en Vitest) | WebGL no corre en jsdom | Una prueba que compruebe que el canvas monta y no rompe en móvil |
| 6 | Rendimiento real | No se mide en jsdom | Lighthouse de la landing y de los listados grandes |
| 7 | Otros navegadores | Solo corre Chromium | Añadir WebKit (Safari/iOS) a `playwright.config.ts` |

Alcance recomendado: unos **8-10 flujos**, no cientos: 4-5 flujos largos (escritorio y móvil), 1 de chat con dos sesiones, 1 de la landing 3D y un barrido axe. Sin duplicar lo que Vitest ya prueba bien.
Orden: primero el flujo largo del alumno y su versión móvil; después chat, axe y WebKit.

### 2.6 Qué falta en UX para producción (valoración de noviembre de 2026)
**Base de la valoración:** sale del código, las pruebas y los documentos, no de haber usado la plataforma en un navegador o un móvil. UX estimada en 87/100 (`ANALISIS.md`). «Infalible» no existe; esto es lo que separa hoy la plataforma de estar lista para producción.

**Lo que ya está bien:** estados de carga, error con reintento y vacío en casi todas las pantallas; permisos por rol probados; zonas horarias auditadas (91 sondas, 22 en verde); errores del servidor mostrados al usuario; fallos de interfaz F12-F23 corregidos.

**Pendiente, por prioridad:**
1. **Móvil (mayor riesgo).** Buena parte de los alumnos entrará desde el teléfono y nadie ha comprobado en un navegador real que se vea y se use bien: teclado virtual, modales largos (pagos, agenda), tira semanal.
2. **Flujos de dinero recorridos de principio a fin.** Registro → clase de prueba → pago → agenda → clase → cierre → retiro. Cada paso está probado suelto, no encadenado. Un fallo mudo en un pago o una cuota es lo más caro para la confianza (el análisis lo lista como «pagos y paquetes sin recorrer completos»).
3. **Verificación de email y recuperación de cuenta (SEC-04).** Sin verificar el correo, un error al escribirlo deja al alumno sin acceso y sin saberlo.
4. **Accesibilidad.** Teclado, foco en modales, contraste y etiquetas; sin barrido con axe se desconoce el estado.
5. **Fallos en producción.** Existe `global-error`, pero no consta monitorización de errores del navegador (tipo Sentry); sin ella el equipo se entera por quejas.
6. **Rendimiento percibido.** Landing 3D y listados grandes sin medir; el 3D ya se desactiva en móvil y con movimiento reducido, falta medirlo en conexión lenta.
7. **Pulido ya anotado.** Voseo en los textos legales frente al tuteo del resto; validaciones inalcanzables desde la interfaz (F21); 2FA; un solo worker y tareas en memoria (un aviso o recordatorio podría perderse en un reinicio o bajo carga).

**Recomendación antes de lanzar:**
1. Pasada exploratoria en móvil y de los flujos de dinero (con la extensión de Chrome o a mano).
2. Convertir lo útil en pruebas repetibles (Playwright, incluido WebKit).
3. Barrido de accesibilidad y monitorización de errores en producción.
4. **Piloto con pocos usuarios reales** antes de abrirlo a todos: es lo que más información da sobre UX y no lo sustituye ninguna prueba.

## 3. Pendiente en el backend (en paralelo)

Según `backend/doc/TESTING.md`, aún no está probado:
- Concurrencia real (doble reserva, aprobación o retiro): necesita PostgreSQL.
- Cohortes y AUD-18; DST con fechas fijas.
- Integraciones externas (Google, Cloudinary, Resend, OpenAI) con dobles de prueba.
- WebSocket del chat; rate-limit tras proxy; carga.
- `pip-audit` / `npm audit`.

Objetivo simétrico al frontend: un archivo de prueba por grupo de rutas de `generated/API_REFERENCE.md` (211 rutas), con inventario automático que falle si una ruta no tiene prueba, y medición de cobertura (`pytest --cov`) con umbral.

## 4. Ejecución conjunta

Propuesta de un único punto de entrada (script o job de CI) que lance ambas suites a la vez:

| Tramo | Comando | Entorno |
|---|---|---|
| Frontend unitario/componentes | `cd frontend && npx vitest run --maxWorkers=3 --coverage` | sin `.env` |
| Frontend zonas horarias | `cd frontend && npx vitest run --config __tz_probes__/vitest.config.ts` | sin `.env` |
| Backend auditoría | `cd backend && venv/Scripts/python.exe -m pytest tests/audit -q` | SQLite, sin `.env` |
| E2E | `cd frontend && E2E_PYTHON='venv\Scripts\python.exe' npm run test:e2e` | levanta backend semilla + `next dev` |

Reglas:
- Las suites unitarias (frontend y backend) corren **en paralelo** y no comparten estado.
- El E2E corre **después** (usa los puertos del backend semilla y de `next dev`).
- **Nunca** ejecutar `tests/flow` ni `tests/load` sin una rama de desarrollo de Neon: los `.env` apuntan a la BD real.
- CI actual: `frontend.yml` corre lint, `tsc`, Vitest y build; no corre Playwright ni la suite de backend. Pendiente: workflow que ejecute los cuatro tramos con umbrales de cobertura.

## 5. Criterios de cierre
- Cada pantalla del frontend y cada ruta del backend tiene prueba (inventario automático en verde).
- Frontend: funciones ≥ 90 %, ramas ≥ 92 %, líneas ≥ 97 %.
- Backend: umbral de cobertura acordado y medido en CI.
- E2E con los flujos de 2.4 en verde.
- Un solo comando local y un solo job de CI que lanzan todo.
