# Checklist de correcciones

Lista de trabajo viva: se marca `[x]` al corregir. El diagnóstico (descripción, evidencia, severidad) está en `ANALISIS.md` (informe congelado) y el estado detallado en `backend/doc/KNOWN_ISSUES.md` y `frontend/doc/KNOWN_ISSUES.md`. Aquí solo van el orden, el esfuerzo y cómo verificar.

**Al cerrar un punto:** (1) marcar la casilla; (2) pasar su test `xfail` a normal en `backend/tests/audit`; (3) actualizar `KNOWN_ISSUES.md` (y `BUSINESS_RULES.md` si cambia una regla); (4) `cd backend && python doc/generate_docs.py`.

Esfuerzo: S (<2 h) · M (medio día) · L (1–2 días). Una fase = una rama y un PR.

---

## Fase 0 — Preparación

- [x] Rama de desarrollo en Neon (`backend/.env` ya apunta a ella)
- [x] Rotar secretos: aplazado por decisión del usuario (no hace falta por ahora)
- [x] Línea base: `python -m pytest tests/audit -q` → 81 passed, 1 skipped, 20 xfailed
- [x] Decisiones de negocio (ver abajo)

### Decisiones de negocio acordadas

- **Clases `finalized`:** pasadas 72 h sin que el profesor la marque, se marca `no_show` automáticamente (consume el crédito). El profesor o `teacher_admin` puede pedir el cambio con un ticket a soporte, describiendo la situación y los motivos; **soporte aprueba o rechaza**. Si se aprueba `completed`, no cambia el crédito; si se aprueba `cancelled`, se devuelve el crédito.
- **Renovación:** los créditos sobrantes **se suman** a los del paquete nuevo.
- **Aprobación de pagos:** solo `superadmin` y `teacher_admin` ven las cuentas de dinero y aprueban/rechazan pagos. Los profesores normales **no** aprueban nada: solo ven «pendiente de revisión». Un `teacher_admin` no aprueba pagos de su propio profesor (los aprueba el `superadmin`). `teacher_admin` (único, dueño de la plataforma) puede aprobar todos los demás pagos y cambiar su propia comisión.
- **Reembolsos:** plazo máximo de **7 días desde la aprobación del pago** (también en bajadas de paquete con devolución). Si el profesor ya retiró y su saldo no cubre el reembolso, **se bloquea** y se avisa al usuario de que contacte con soporte.
- **Workers:** 1 solo proceso `uvicorn` (el scheduler APScheduler es interno; con N workers se duplicaría). Añadir `--proxy-headers` (Fase 3); escalar solo separando el scheduler en otro servicio.

## Fase 1 — Críticos rápidos (dinero y rutas rotas)

- [x] **AUD-12** (S) ruta `get_pending_withdrawals` sin `@router.get` · verif.: `test_withdrawals_pending_real_path` + pestaña Retiros
- [x] **AUD-03** (M) renovar paquete agotado: reactivar y **sumar** los créditos sobrantes · verif.: xfail en `test_findings`
- [x] **AUD-14** (M) reembolso descuenta billetera; **plazo 7 días desde la aprobación** (incluye bajadas con devolución); si el saldo no cubre → bloquear y avisar «contacta con soporte» · verif.: xfail en `test_findings`
- [x] **AUD-21** (S) `credits_requested` > 0 · verif.: `test_unlimited_recharge_negative_or_zero_rejected`
- [x] **AUD-20** (S) `bypass_min_notice` recibe `Query` · verif.: `test_featured_teacher_slots_work_for_students`
- [x] **NEG-01** (L) pagos: quitar la aprobación a profesores normales (UI y API; solo ven «pendiente de revisión»); `superadmin`/`teacher_admin` aprueban; nadie aprueba el pago de su propio profesor · verif.: tests nuevos de permisos (relacionado con SEC-03)
- [x] **NEG-02** (L) `finalized` → `no_show` automático a las 72 h + ticket de soporte para corregirlo (categoría nueva, aprobación por soporte, crédito según decisión)
- [x] **AUD-19** (S) login cuenta solo-Google → 401, no 500

Salida: xfails de la fase en verde.

## Fase 2 — Reservas y concurrencia

- [x] **AUD-01** (M) validar disponibilidad del profesor en servidor (reservas y reagendados)
- [x] **AUD-02 / 02b** (L) doble reserva: `pending_trial`/`group` bloquean + lock de fila o restricción de exclusión (migración Alembic) · verif.: `concurrency_live.py` R1
- [x] **AUD-23** (M) sobre-reserva de créditos: `FOR UPDATE` sobre `enrollment` · verif.: R2
- [x] **Idempotencia** (M) `validate_payment` y `process_withdrawal_v2` con transición atómica · verif.: R3, R4
- [x] **Cancelación** (S) idempotente explícita, crédito devuelto una vez · verif.: R5
- [x] **AUD-22** (S) guarda anti doble clic identifica la cuota por número
- [x] **AUD-04** · [x] **AUD-05** · [x] **AUD-06** · [x] **AUD-07** · [x] **AUD-08** · [x] **AUD-09** · [x] **AUD-10** · [x] **AUD-11** · [x] **AUD-13** · [x] **AUD-15** · [x] **AUD-16** · [x] **AUD-17** · [x] **AUD-18** (agrupar por módulo: pagos, cuotas, cohortes, notificaciones)

Salida: `python -m tests.audit.concurrency_live` termina con 0 FALLO. **Pendiente de correr por el usuario contra Neon dev** (la restricción de exclusión no se creó: se usó `FOR UPDATE` sobre alumno y profesor). AUD-18 sin reproducir en API, pero se blindó `can_book_slot` con `student_id None`.

## Fase 3 — Seguridad

- [ ] **SEC-01** (M) `--proxy-headers` + IP real; rate-limit compartido si hay >1 worker
- [ ] **SEC-02** (M) Chipi: rate-limit, tope de tamaño, solo `role` user/assistant; TTS con cuota
- [x] **SEC-03** (M) `teacher_admin` sin aprobar sus propios pagos ni fijar su comisión
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
