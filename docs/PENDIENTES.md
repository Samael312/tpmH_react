# Pendientes (corte: 2026-11-24, para continuar el 2026-11-25)

Estado al cierre: commits `16e16f8` (TTS por idioma, pruebas de cambio de modo), `8d7c345` (guía interactiva), `a974e76`
(concurrency_live) y `21787be` (workflow backend partido en 3 jobs paralelos: `audit`, `probes`, `postgres`).
CI de `a974e76`: e2e, docs y frontend en verde; backend **cancelado** por el tope de 40 min (motivo del partido).
Al cierre aún no había runs de `21787be`.

## 1. Cerrar el CI (hacer primero)
- [ ] Revisar con `gh` (ruta: `"/c/Program Files/GitHub CLI/gh.exe" run list --limit 8`) que los runs de `21787be` (`audit`, `probes` y `postgres`) salgan en verde.
- [ ] Sin confirmar en CI hasta ahora: el arreglo de `backend/tests/audit/concurrency_live.py` (`ensure_payment_method`: crea o habilita un
      método de pago si la BD recién migrada no tiene `PaymentConfig`) y la migración `f28a1b2c3d4e` sobre PostgreSQL vacío.
- [ ] Mirar el resultado del job `webkit`/iPhone del workflow `e2e` (no bloquea; no se revisó en el último run).
- [ ] Si `audit` crece más allá de ~50 min: valorar `pytest-xdist` (cuidado con la cobertura y el inventario de rutas, que necesitan todo el conjunto).

## 2. Migraciones
- [ ] Aplicar `f27a1b2c3d4e` (`materials.language`) y `f28a1b2c3d4e` (`users.tour_completed`) en la BD de desarrollo.
      Sin `f28` la guía no funciona (el backend de desarrollo local ya carga el modelo nuevo).
- [ ] Repetirlo en producción al desplegar, en ese orden. `f28` deja en «vista» a todos los usuarios existentes.

## 3. Comprobaciones a ojo
- [x] Guía interactiva (2026-11-25, Playwright con viewport de iPhone 13 a 390 px, 12 pasos, contra el servidor semilla): la tarjeta queda sobre
      la barra inferior con el recorte en cada pestaña; el panel «Más» se abre solo y resalta Chat, Disponibilidad, Materiales, Tareas, Profesor y
      Soporte con la tarjeta arriba; el último paso «Terminar» cierra la guía y se queda en la misma ruta; sin errores de página. En escritorio
      también se vio con Chrome. Pendiente solo lo que no cubre el emulador: probar en un móvil físico (táctil real y teclado en pantalla).
- [x] Perfil → «Ver guía de la plataforma» (2026-11-25): no se reproduce. En escritorio (Chrome) y en móvil emulado la guía arranca en `/dashboard/profile`,
      avanza sin cambiar de ruta y «Saltar guía» la cierra sin salir de la página. El episodio del 2026-11-24 (acabar en `/dashboard`) quedó sin explicar;
      si reaparece, anotar los pasos exactos.
- [x] Aviso de hidratación de Next en dev (2026-11-25): causa encontrada. El diff cliente/servidor solo contiene `bis_skin_checked="1"`, un atributo que inyecta
      una extensión de seguridad del navegador en 53 elementos del DOM. No es de la app; en Playwright (sin extensiones) no aparece.
- [x] Audio TTS: sustituido por la prueba de Realtime (2026-11-25): escuchados español, francés, portugués y alemán; bien.
- [ ] Probar un vocabulario real en otros idiomas del catálogo (francés, portugués, alemán…) y ajustar `_ENGLISH_NAMES` si falta alguno.

## 4. TTS: decisiones abiertas
- [x] Asignación masiva de idioma a vocabularios existentes: no necesaria. Al lanzar se formatea la BD y se configura de cero.
- [x] Precio de `gpt-4o-mini-tts` frente a `tts-1` (2026-11-25): documentado en `backend/doc/RESOURCE_COSTS.md` §6 y en `tts_service.py`.
- [x] **Migración del TTS a la API Realtime (2026-11-25).** OpenAI apaga `tts-1`, `tts-1-hd` y `gpt-4o-mini-tts` el 2027-01-06; el
      sustituto, `gpt-realtime-2.1-mini`, no sirve para `/v1/audio/speech`. Hecho en `core/tts_service.py`: sesión Realtime por
      palabra (solo audio, voz `marin` para `nova`, idioma del vocabulario en la instrucción; sin idioma la palabra se dice en su
      propio idioma), audio en WAV (`core/storage.py::INTERNAL_AUDIO_TYPES`, no admitido como subida de usuario), cola global de
      `TTS_MAX_CONCURRENCY` (5, ajustable) sesiones simultáneas, tiempo máximo por palabra y 1 reintento. `speed` ya no se usa
      (solo en la clave de caché). Pruebas: `tests/audit/test_h1_tts_language.py` (servicio con sesión Realtime simulada: WAV válido, voces, cola de 5 en 5, reintento, tiempo máximo, lote con fallos).
      Prueba previa (4 palabras): ~$0,00038 por palabra (~$0,38 por 1000), latencia 3,5-5,6 s, sin cargo aparte por abrir sesión.
      Reproducción comprobada en Chromium y WebKit con un `<audio>` como el de `materials/page.tsx` (WAV servido con
      `Content-Type: audio/wav` y Range).
- [x] Cloudinary real (2026-11-25): un WAV subido con `core.storage.upload_file` (`resource_type="auto"`) queda como `video`/`wav`,
      se sirve con `Content-Type: audio/wav`, `Accept-Ranges: bytes` (responde 206 a `Range`) y CORS `*`; empieza por `RIFF…WAVE`.
      `media-src` de la CSP ya permite `res.cloudinary.com`. La prueba se borró de Cloudinary al terminar.
- [ ] Probar un vocabulario real de 20-50 palabras a través de la API
      (`POST /tts/vocabulary/{id}`) para medir el tiempo total con la cola de 5 y ver si la cuenta de OpenAI aguanta 5 sesiones a la vez.
- [ ] Confirmar el cargo real de las pruebas en el panel de uso de OpenAI (el coste de arriba es el calculado con las tarifas publicadas).
- [ ] Valorar un indicador de progreso en el frontend: un vocabulario de 50 palabras sin caché tarda ~40-50 s con la cola de 5
      (hoy la pantalla de materiales solo muestra «cargando»).

## 5. Deudas de negocio ya documentadas (`docs/TENANT_MODES_AUDIT.md`)
- [x] **T1: no es un fallo (2026-11-25).** En single los profesores no destacados quedan inhabilitados a propósito: el alumno no los ve ni los usa; solo aparecen en los paneles de admin. Sin cambios de código.
- [x] Cambiar el destacado de A a B **dentro** de single (2026-11-25): mismo bloqueo 409 que multi→single, sin `force`; la opción se habilita cuando no quedan alumnos vivos con otros profesores (`admin.py::update_platform_config`). El panel lo comprueba antes con `GET /admin/platform-config/single-blockers`: deshabilita el interruptor y rechaza elegir otra destacada.
- [x] `god_mode.py::god_mode_transfer_student` (2026-11-25): el vínculo destino se crea con `ensure_student_teacher_link` (tolera la carrera con la restricción única, sin 500) y todo (vínculo, lista del profesor, chat, reasignaciones y auditoría) se confirma en un único commit; antes `link_student_to_teacher` confirmaba a mitad.

## 6. Guía interactiva: menores diferidos de la revisión final (cerrado el 2026-11-25)
- [x] Girar el móvil a mitad de la guía (cruzar el corte `md`): `ProductTour` re-resuelve el paso en `resize` cuando el elemento medido deja de ser visible.
      Prueba nueva en `tests/components/productTour.test.tsx` (falla sin el arreglo).
- [x] El foco solo quedaba atrapado mientras estaba dentro de la tarjeta: ahora el resto de la página queda `inert` mientras la guía está abierta
      (el aislamiento se retira antes de devolver el foco). Prueba nueva (falla sin el arreglo).
- [x] `server_default="false"` en el modelo frente a `sa.false()` en la migración: no es un problema; `alembic/env.py` no activa `compare_server_default`,
      así que `autogenerate` no lo compara, y el repo mezcla ambas formas.
- [x] El test «saltar a mitad de la espera de un paso Más» se confirmó: quitando la comprobación `run !== runRef.current` falla (`forceMoreOpen` queda en true).
- [x] Reglas nuevas anotadas en `frontend/doc/KNOWN_ISSUES.md` (sección «Guía interactiva»), `PAGES_AND_UX.md` y `ARCHITECTURE.md`.
- Extra: en escritorio un paso «Más» ahora cierra el panel móvil que hubiera quedado abierto (`settle`); prueba nueva.

## 6b. Guía interactiva: orden en escritorio (hecho el 2026-11-25)
- [x] En escritorio los pasos siguen ahora el orden de la barra lateral (`DESKTOP_ORDER` en `tourSteps.ts`; `TourHost` lo elige al abrir según el ancho).
      En móvil se mantiene el orden de pestañas y «Más». Pruebas en `tests/tourSteps.test.ts` y `tests/components/tourHostOrder.test.tsx`.

## 7. Riesgos de mantenimiento
- [x] Cobertura de ramas del frontend subida a 94,0 % (suelo 92 %) el 2026-11-25: pruebas nuevas de `lib/tzFormat.ts` (de 70 % a casi 100 %) y
      casos límite de `chatStore` (`tests/components/chatStoreEdge.test.tsx`) y de `teacher/cohorts` (`teacherCohortsGaps.test.tsx`, de
      44 a 25 ramas sin cubrir). `teacher/materials` (de 38 a 21), `dashboard/schedule` (41 a 28), `admin/settings` (41 a 33) y `teacher/profile` (37 a 23): ficheros
      `*Gaps.test.tsx`. Queda margen de 1,8 puntos; lo que falta en esas páginas son guardas defensivas y `??` por defecto. `admin/payments` (21 a 9). `teacher/onboarding` (24 a 20; lo que
      queda son validaciones que el botón desactivado hace inalcanzables). y `dashboard/profile` del alumno (22 a 19).
      Trabajo de ramas cerrado el 2026-11-25: lo que queda son guardas y valores por defecto sin forma de alcanzarlos desde la interfaz.
- [x] Playwright ya no exige `E2E_PYTHON`: `playwright.config.ts` usa `backend/venv` o `backend/.venv` si existen y, si no, `python` (2026-11-25).
      `E2E_PYTHON` sigue mandando cuando se define.
- [ ] Un `uvicorn --reload` o `next dev` local en los puertos 8000/3000 impide que Playwright arranque su backend semilla
      (`reuseExistingServer: false`): detenerlo antes de lanzar los E2E.
- [ ] Flaky de Vitest (2026-11-25): `studentSchedule.test.tsx` › «un error al reservar la prueba se muestra» falló 2 de 5 veces al correr el
      fichero entero (timeout de 4 s en un `findBy`) y 0 de 6 corriéndolo solo; el fichero no está modificado. Probable lentitud acumulada del
      renderizado de la página, no lógica. Si reaparece en el CI, subir el `timeout` de ese test o partir el fichero.
- [ ] Flaky local de WebKit en `a11y.spec.ts` (2026-11-25): en una pasada de 24,6 min con Chromium, móvil y WebKit seguidos, el botón de
      login quedó sin habilitar en `/dashboard/homework` (falló también el reintento), `/teacher/dashboard` y `/teacher/profile`
      (pasaron al reintentar). Repetido solo `a11y.spec.ts --project=webkit`: 24 de 24 en verde (3 min). Causa sin investigar (`next dev`
      compilando en frío con la máquina cargada). El job `webkit` del CI (compilación de producción) pasa. Si reaparece, mirar la traza
      (`npx playwright show-trace`) para ver qué petición de login queda colgada.
