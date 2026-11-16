# Checklist de correcciones

Lista de trabajo viva: se marca `[x]` al corregir. El diagnóstico (descripción, evidencia, severidad) está en `ANALISIS.md` (informe congelado) y el estado detallado en `backend/doc/KNOWN_ISSUES.md` y `frontend/doc/KNOWN_ISSUES.md`. Aquí solo van el orden, el esfuerzo y cómo verificar.

**Al cerrar un punto:** (1) marcar la casilla; (2) pasar su test `xfail` a normal en `backend/tests/audit`; (3) actualizar `KNOWN_ISSUES.md` (y `BUSINESS_RULES.md` si cambia una regla); (4) `cd backend && python doc/generate_docs.py`.

Esfuerzo: S (<2 h) · M (medio día) · L (1–2 días). Una fase = una rama y un PR.

---

## Fase 0 — Preparación

- [ ] Rama de desarrollo en Neon (no ejecutar `tests/flow` ni `concurrency_live.py` contra datos reales)
- [ ] Rotar secretos que hayan salido de la máquina (DB, OpenAI, Resend, Cloudinary, Google, `SECRET_KEY`)
- [ ] Línea base: `python -m pytest tests/audit -q` → 81 passed, 1 skipped, 20 xfailed
- [ ] Decisiones de negocio: ¿`finalized` se auto-completa? · ¿al renovar se arrastran créditos? · ¿quién aprueba pagos/retiros/comisiones? · ¿cuántos workers?

## Fase 1 — Críticos rápidos (dinero y rutas rotas)

- [ ] **AUD-12** (S) ruta `get_pending_withdrawals` sin `@router.get` · verif.: `test_withdrawals_pending_real_path` + pestaña Retiros
- [ ] **AUD-03** (M) renovar paquete agotado · verif.: xfail en `test_findings`
- [ ] **AUD-14** (M) reembolso descuenta billetera · verif.: xfail en `test_findings`
- [ ] **AUD-21** (S) `credits_requested` > 0 · verif.: `test_unlimited_recharge_negative_or_zero_rejected`
- [ ] **AUD-20** (S) `bypass_min_notice` recibe `Query` · verif.: `test_featured_teacher_slots_work_for_students`
- [ ] **AUD-19** (S) login cuenta solo-Google → 401, no 500

Salida: xfails de la fase en verde.

## Fase 2 — Reservas y concurrencia

- [ ] **AUD-01** (M) validar disponibilidad del profesor en servidor (reservas y reagendados)
- [ ] **AUD-02 / 02b** (L) doble reserva: `pending_trial`/`group` bloquean + lock de fila o restricción de exclusión (migración Alembic) · verif.: `concurrency_live.py` R1
- [ ] **AUD-23** (M) sobre-reserva de créditos: `FOR UPDATE` sobre `enrollment` · verif.: R2
- [ ] **Idempotencia** (M) `validate_payment` y `process_withdrawal_v2` con transición atómica · verif.: R3, R4
- [ ] **Cancelación** (S) idempotente explícita, crédito devuelto una vez · verif.: R5
- [ ] **AUD-22** (S) guarda anti doble clic identifica la cuota por número
- [ ] **AUD-04** · [ ] **AUD-05** · [ ] **AUD-06** · [ ] **AUD-07** · [ ] **AUD-08** · [ ] **AUD-09** · [ ] **AUD-10** · [ ] **AUD-11** · [ ] **AUD-13** · [ ] **AUD-15** · [ ] **AUD-16** · [ ] **AUD-17** · [ ] **AUD-18** (agrupar por módulo: pagos, cuotas, cohortes, notificaciones)

Salida: `python -m tests.audit.concurrency_live` termina con 0 FALLO.

## Fase 3 — Seguridad

- [ ] **SEC-01** (M) `--proxy-headers` + IP real; rate-limit compartido si hay >1 worker
- [ ] **SEC-02** (M) Chipi: rate-limit, tope de tamaño, solo `role` user/assistant; TTS con cuota
- [ ] **SEC-03** (M) `teacher_admin` sin aprobar sus propios pagos ni fijar su comisión
- [ ] **SEC-04** (M) verificación de email; Google solo con `email_verified`
- [ ] **SEC-05** (L) JWT en cookie HttpOnly, vida corta + refresco, CSP sin `unsafe-*`
- [ ] **SEC-06** (M) tope en `/logs/frontend`, `state` OAuth, token WS fuera de la query, `application/pptx`, borrado de cuenta

Salida: repetir sondas (200 KB y `role: system` en Chipi → rechazados).

## Fase 4 — Frontend / UX

- [ ] **UX-01** (M) bucle con cookie válida y `localStorage` vacío (`teacher/layout.tsx`, `proxy.ts`)
- [ ] **UX-02** (S) `aria-label` en ojo de contraseña y widget Chipi
- [ ] **UX-03** (S) duración de prueba desde `trial_duration_minutes`
- [ ] **UX-04** (S) error visible si falla la carga de retiros
- [ ] **F4** (M) un 401 no pierde formularios
- [ ] **F5** (M) reglas del servidor (mínimo retiro, duraciones) leídas de la configuración
- [ ] **F6** (S) texto de borrar cuenta alineado con el comportamiento real
- [ ] **F9** (S) quitar `"mar12"` hardcodeado
- [ ] **F10** (L) tests de frontend (Vitest + Playwright mínimo) y script `test`

## Fase 5 — Coste y rendimiento

- [ ] (M) pool real en lugar de `NullPool` (`pool_pre_ping`, `pool_recycle`) o pooler de Neon · objetivo `/users/me` < 400 ms (hoy ≈1,7 s; medir con `latency.py`)
- [ ] (L) eager loading en N+1 y paginación en listados
- [ ] (M) sacar `finalize_past_classes` y la escritura de `get_student_booking_stage` de los GET
- [ ] (M) jobs `async` bloqueantes → `def`/threadpool; espaciar jobs para que Neon se suspenda
- [ ] (M) subidas de 100 MB por streaming a Cloudinary
- [ ] (S) evaluar alternativas a Railway (`backend/doc/RESOURCE_COSTS.md`)

## Fase 6 — Pruebas y documentación

- [ ] Actualizar `tests/flow` obsoletos (regla D7, `payment_method`, cohorte sin pago confirmado, disponibilidad por hora) · ver `backend/doc/TESTING.md`
- [ ] Concurrencia en CI sobre PostgreSQL para PRs de reservas/pagos
- [ ] Paso de migraciones Alembic en el despliegue (no se ejecutan solas)
- [ ] Regenerar docs y cerrar IDs en `KNOWN_ISSUES.md`

---

**Orden:** 0 → **1** → **2** → 3 y 4 en paralelo → 5 → 6 (continua).
