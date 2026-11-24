# Guía interactiva post-onboarding — diseño

Fecha: 2026-11-24 · Estado: pendiente de revisión del usuario

## Objetivo
Tras completar el onboarding, un usuario nuevo (alumno o profesor) ve una guía con el fondo oscurecido que enfoca cada
opción del menú y explica para qué sirve. Se puede saltar en cualquier momento y volver a abrir desde el Perfil.

## Decisiones tomadas (con el usuario)
- Roles: alumno y profesor, cada uno con su recorrido. Admin y superadmin quedan fuera.
- Alcance: **solo el menú** (sin navegar entre pantallas). El motor queda listo para añadir tours por pantalla después.
- Implementación: **componente propio**, sin librería nueva.
- Memoria: **base de datos** (no localStorage) + botón para repetirla.
- Usuarios existentes: **no la ven**; solo cuentas nuevas.

## Fuera de alcance
Tours por pantalla; guía para admin; textos generados por IA; analítica de pasos.

## 1. Datos y backend
- `users.tour_completed` BOOLEAN NOT NULL DEFAULT false. Migración: añade la columna y hace
  `UPDATE users SET tour_completed = true` (todos los existentes). Downgrade: elimina la columna.
- Un solo campo cubre «vista» y «saltada».
- `UserUpdate` acepta `tour_completed: Optional[bool]`; `GET/PATCH /users/me` lo devuelven (schema de usuario).
- Sin reglas extra: cualquier usuario puede ponerlo en true o false (false = «quiero verla otra vez»).
- Admin/superadmin: el frontend no lanza la guía; el campo existe pero no se usa.

## 2. Cuándo arranca
- Condición: rol student/teacher/teacher_admin, `onboarding_completed === true`, `tour_completed === false`, y no estar en
  una ruta de pantalla completa (onboarding).
- Lo evalúa el layout de cada rol una vez por sesión de layout (misma técnica que el chequeo de onboarding).
- Profesor: se lanza igual aunque su cuenta esté pendiente de aprobación; solo se muestran los pasos cuyo elemento
  exista en el DOM.
- Terminar o saltar: `PATCH /users/me {tour_completed: true}` y actualizar el store de auth. Si el PATCH falla, se
  cierra igual y se reintenta en la siguiente carga (no bloquea al usuario).
- Cerrar la pestaña a medias no marca nada: vuelve a salir.

## 3. Componentes (frontend)
- `components/tour/ProductTour.tsx`: overlay + recorte + tarjeta. Props: `steps`, `open`, `onFinish`, `onSkip`.
- `components/tour/tourSteps.ts`: pasos por rol `{ id, target, title, body }` en español. `target` es un selector
  `[data-tour="..."]`; el paso de bienvenida y el de cierre no tienen target (tarjeta centrada, sin recorte).
- `components/tour/useProductTour.ts`: estado (paso actual), pasos válidos, scroll al elemento, medición con
  `getBoundingClientRect` + `ResizeObserver`/`resize`.
- `NavBar.tsx`: añadir `data-tour="nav-<href>"` a cada ítem del sidebar y de las pestañas inferiores; el panel «Más» se
  controla con un evento/ctx para abrirse y cerrarse desde la guía.
- Botón «Ver guía de la plataforma» en Perfil de alumno y de profesor: `tour_completed=false` en el store → el layout la
  abre (sin PATCH hasta que termine o salte).

## 4. Comportamiento
- Pasos: bienvenida → una opción del menú por paso → cierre («Puedes repetir esta guía desde tu perfil»).
- Escritorio: resalta ítems del sidebar. Móvil: resalta las pestañas; al llegar a las opciones de «Más», abre el
  BottomSheet y resalta cada ítem; lo cierra al terminar.
- Un paso cuyo target no exista (menú cambiado, rol sin ese ítem, barra colapsada) se omite sin error.
- Controles: Siguiente, Atrás, Saltar guía, indicador «n de N». Teclado: Esc = saltar, ←/→ = navegar.
- Accesibilidad: tarjeta `role="dialog"` con `aria-modal`, foco atrapado y devuelto al cerrar, `aria-live="polite"`
  en el texto; `prefers-reduced-motion` desactiva la animación.
- El overlay bloquea clics fuera de la tarjeta (los ítems resaltados no navegan durante la guía).

## 5. Textos
- Una lista por rol en `tourSteps.ts`. Alumno: Inicio, Horario, Clases, Perfil, Chat, Disponibilidad, Materiales, Tareas,
  Profesor, Soporte. Profesor: Clases, Horario, Estudiantes, Perfil, Chat, Avisos, Materiales, Tareas, Paquetes, Grupos,
  Ganancias, Soporte. Un párrafo corto (≤ 25 palabras) por opción, tuteo neutro como el resto de la app.

## 6. Pruebas
- Backend (`tests/audit`): campo en `/users/me`, PATCH true/false, la migración deja a los existentes en true (revisión del
  SQL de la migración), usuarios nuevos nacen en false.
- Vitest: avanzar/retroceder/saltar/terminar; paso omitido si falta el target; Esc y flechas; foco atrapado; móvil abre
  «Más»; el layout no la lanza si `tour_completed` es true, si el onboarding no está completo ni para admin.
- Perfil: el botón reabre la guía.
- Playwright (smoke): cuenta nueva ve la guía; «Saltar guía» no reaparece tras recargar.

## 7. Documentación
`frontend/doc/PAGES_AND_UX.md`, `frontend/doc/ARCHITECTURE.md` (componente nuevo), `backend/doc` (regenerar con
`generate_docs.py`), y fichas de Chipi (`screens/` de perfil y dashboard: dónde repetir la guía) + test de conocimiento.

## 8. Riesgos
- `data-tour` en el NavBar acopla la guía a ese componente: lo cubre el test de «paso omitido» y un test que comprueba
  que cada target de `tourSteps` existe en el NavBar renderizado.
- Layouts de alumno/profesor son largos; la lógica de arranque va en un hook aparte para no crecerlos.
