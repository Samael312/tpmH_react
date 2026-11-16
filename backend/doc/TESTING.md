# Pruebas del backend

## Suite de auditoría `tests/audit/` (sin `.env`, sin PostgreSQL)

```bash
cd backend
python -m pytest tests/audit -q          # ~6 min (bcrypt lento). Una parte: -k nombre
```
- Usa la app FastAPI real en proceso con **SQLite temporal**, `JSONB -> JSON`, datetimes emulados como aware (como Postgres), `resend.Emails.send` mockeado y variables dummy. Emails de prueba `@audit-tpm.com`. **Nunca toca una BD real.**
- Archivos: `conftest.py` (fixtures `client`, `world`, `db`, helpers `hdr`, `future`, `_mk_user`), `helpers.py` (`book`, `approve`, `ready_student`, `complete_trial`, `set_status`…), `test_booking_flow.py` (flujo feliz), `test_findings.py` (hallazgos AUD-xx; `xfail(strict=True)` = bug abierto), `test_edge_cases.py` (límites de tiempo, entradas hostiles, ilimitados, cuotas, cambios de paquete, retiros, roles).
- Estado al 2026-11-16: `test_findings`+`test_booking_flow` = 37 passed / 1 skipped / 19 xfailed; `test_edge_cases` = 44 passed / 1 xfailed (AUD-21).
- Al corregir un bug: el test `xfail` pasa a XPASS (error por `strict`) -> quita el decorador.

## Servidor local para probar con navegador

```bash
cd backend && python -m tests.audit.run_server          # API en :8000, SQLite recreada en cada arranque
cd frontend && NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1 NEXT_PUBLIC_GOOGLE_CLIENT_ID=x npx next dev -p 3000
```
Cuentas semilla (contraseña `Password123`): `admin` (superadmin), `profe` (teacher aprobado, disponibilidad 08–20 UTC todos los días, paquete "Paquete 4" 4 clases/100), `alumno` (student); emails `<usuario>@audit-tpm.com`. Emails y OpenAI/Google/Cloudinary no funcionan (mock/dummy).

## Suite de integración `tests/flow/` (requiere entorno real)
PostgreSQL local + `.env` (`DATABASE_URL`, `SECRET_KEY`, `ENVIRONMENT=development`, claves dummy) + `alembic upgrade head`, luego `pytest tests/flow --run-flow-tests`. Ver `tests/flow/README.md`. **Nunca contra producción.** No se ha ejecutado en esta auditoría.

## Regenerar documentación
`python doc/generate_docs.py` (ver `README.md`).

## Qué NO está probado todavía
Concurrencia real (doble reserva/aprobación/retiro: necesita PostgreSQL), cohortes y AUD-18, DST con fechas fijas, integraciones externas (Google, Cloudinary, Resend, OpenAI), WebSocket de chat, E2E de UI con navegador (la extensión de Chrome no estaba conectada), accesibilidad/rendimiento, carga y rate-limit tras proxy, `pip-audit`/`npm audit`, tests de frontend.

## Estado de `tests/flow` (ejecutado contra la BD Neon real, noviembre 2026)
Dos rondas completas (109 tests): 1.ª ronda 53 OK / 50 fallos / 6 errores; tras corregir tests obsoletos (falta `price_per_class`, `payment_method` ahora obligatorio, limpieza de cohortes con FK de chat) 68 OK en la 2.ª ronda. Una 3.ª ronda parcial dejó 26 OK / 25 fallos.
Los fallos que quedan **no son regresiones de producto confirmadas**, sino tests desactualizados frente a reglas nuevas:
- La regla D7 ya exige un mínimo de clases completadas (por defecto 3) antes de cambiar de paquete: ~14 tests de `test_package_change`, `test_d7`, `test_difficult_bugs` y `test_lifetime` esperan poder cambiar con 0 clases (hay que fijar `PlatformConfig` en el test o completar clases).
- Varios endpoints de pago exigen `payment_method` (tests de cohorte y `test_d7_zero_minimum...`).
- `test_cohort_close_and_cancel`: «No hay alumnos con pago confirmado» (el flujo del test no aprueba el pago antes de cerrar).
- `test_d14_close_cohort...`: la sesión generada queda fuera de la disponibilidad declarada (03:00 UTC); depende de la hora de ejecución.
- Fallos que sí coinciden con bugs reales: `test_withdrawals_pending_real_path` (AUD-12, 404).
- `test_direct_chat_requires_real_link...`: el chat directo se crea sin vínculo real; revisar si es regla o bug.
Los fallos de la 3.ª ronda dejan residuos en la BD compartida: limpiar con la fixture o a mano antes de repetir.
