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
- [ ] Guía interactiva en un móvil real o emulado: colocación de la tarjeta, panel «Más» animado y recorte. Las pruebas cubren la
      lógica pero no se vio en un navegador. El 2026-11-24 se vio en escritorio con la extensión de Chrome (12 pasos, recorte,
      tarjeta arriba/al lado, scroll del menú, cierre «¡Listo!»); la versión móvil no se llegó a ver (la ventana no se achicó y la
      extensión se desconectó).
- [ ] Reproducir a mano: Perfil → «Ver guía de la plataforma». En la demo, tras pulsarlo el navegador terminó en `/dashboard` sin
      guía visible. Causa desconocida (¿clic mío, overlay de errores de Next o desconexión?). Si se reproduce, es un bug real.
- [ ] Aviso de hidratación de Next en dev («1 Issue», `A tree hydrated but some attributes…`): ya salía en `/login`, antes de que
      hubiera guía, y sube a 3 en el perfil. Parece ajeno a la guía (¿atributos que inyecta la extensión de Chrome?); comprobar con
      la extensión desactivada y mirar el diff del error.
- [ ] Audio TTS en español: escuchar los mp3 de «pera» generados con `tts-1` y con `gpt-4o-mini-tts`
      (en el scratchpad de la sesión del 2026-11-24: `old_tts1_pera.mp3`, `new_mini_pera_es.mp3`, `new_mini_pera_es_speed.mp3`).
- [ ] Probar un vocabulario real en otros idiomas del catálogo (francés, portugués, alemán…) y ajustar `_ENGLISH_NAMES` si falta alguno.

## 4. TTS: decisiones abiertas
- [ ] Los vocabularios existentes quedan sin idioma (suenan como antes) hasta que el profesor lo elija en «Editar palabras».
      Opción: asignación masiva de idioma (script o pantalla de admin).
- [ ] Verificar el precio de `gpt-4o-mini-tts` frente a `tts-1` antes de generar audios en volumen
      (ver `backend/doc/RESOURCE_COSTS.md`, que hoy solo describe `tts-1`).

## 5. Deudas de negocio ya documentadas (`docs/TENANT_MODES_AUDIT.md`)
- [ ] **T1:** en modo single, los créditos con otros profesores quedan invisibles e inusables en la interfaz.
- [ ] Cambiar el profesor destacado de A a B **dentro** de single no pasa por el aviso 409 con `affected_students`.
- [ ] `backend/app/api/v1/endpoints/god_mode.py::transfer` crea el vínculo alumno-profesor sin savepoint.

## 6. Guía interactiva: menores diferidos de la revisión final
- [ ] Girar el móvil a mitad de la guía (cruzar el corte `md` de 768 px): `measure` no vuelve a buscar el elemento visible y el recorte
      acaba en (-8, -8). Arreglo: re-resolver el target en `resize`.
- [ ] El foco solo queda atrapado mientras está dentro de la tarjeta; con un clic en el fondo, Tab entra al menú. Arreglo: `inert`
      en el resto de la página mientras la guía está abierta.
- [ ] `server_default="false"` en el modelo frente a `sa.false()` en la migración: inofensivo en PostgreSQL, pero `alembic autogenerate`
      podría marcarlo como diferencia.
- [ ] El test «saltar a mitad de la espera de un paso Más» se ajustó por razonamiento y no se vio fallar antes del arreglo.
      Para confirmarlo: quitar la comprobación `run !== runRef.current` en `ProductTour.tsx` y comprobar que falla.
- [ ] Reglas nuevas aún sin entrada en `frontend/doc/KNOWN_ISSUES.md` (no hay bugs abiertos de la guía conocidos; solo los menores anteriores).

## 6b. Guía interactiva: mejora de orden en escritorio
- [ ] En escritorio los pasos siguen el orden de las pestañas móviles (Inicio, Horario, Clases, Perfil, Chat, Disponibilidad, Materiales,
      Tareas, Profesor, Soporte), no el de la barra lateral (Inicio, Chat, Horario, Disponibilidad, Mis Clases, Materiales, Tareas,
      Profesores, Soporte, Mi Perfil). La tarjeta salta arriba y abajo. Opción: ordenar los pasos según el menú que haya en pantalla
      (en escritorio, el orden de `STUDENT_*`/`TEACHER_*` de `NavBar.tsx`; en móvil, tabs principales y luego «Más»). Cuidado con los
      tests de `tourSteps.test.ts`, que fijan el orden actual.

## 7. Riesgos de mantenimiento
- [ ] Cobertura de ramas del frontend en 92,79 % con suelo de 92 %: cualquier componente nuevo sin pruebas puede romper el CI.
- [ ] Playwright en Windows necesita `E2E_PYTHON=venv\Scripts\python.exe` (anotado en `frontend/doc/TESTING.md`).
- [ ] Un `uvicorn --reload` o `next dev` local en los puertos 8000/3000 impide que Playwright arranque su backend semilla
      (`reuseExistingServer: false`): detenerlo antes de lanzar los E2E.
