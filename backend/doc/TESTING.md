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

## Estado de `tests/flow` (ejecutado contra la rama dev de Neon, noviembre 2026)
Tras las Fases 1-3 los 109 tests quedaron al día con las reglas nuevas (el último run completo tuvo 4 fallos por residuos de `d7`, ya corregidos; esos módulos pasan 13/13). Cambios hechos solo en los tests:
- `payment_method` y `payment_info` en los cambios de paquete; precios con `price_per_class` exacto; fixture autouse que fija el mínimo D7 en 0 (omite los módulos `d7`).
- Enrollments insertados por ORM llevan un `Payment` aprobado (AUD-14: un reembolso exige un pago aprobado real).
- Cohortes: el pago se aprueba antes de cerrar; fixture `open_teacher_availability` (24 h, restaura lo que había) porque cerrar una cohorte valida la disponibilidad (AUD-01).
- SEC-05: el `TestClient` conserva las cookies de sesión: fixture autouse que las limpia antes de cada test (si no, «sin token» queda autenticado).
- Chat: la regla vigente deja a un alumno abrir chat con un profesor aprobado sin vínculo; el profesor solo con alumnos vinculados (el test se reescribió).
- Limpiezas: borrar `class_participants`/`classes` de cohortes y los `Payment` de un enrollment **antes** de borrarlo (la FK falla en silencio con `rollback` y deja un enrollment activo que rompe tests posteriores).
Los tests dejan residuos en la BD compartida si fallan a medias: comprobar `enrollments`, `packages` y `error_logs` (`message like 'Flow-test%'`) de los usuarios `flowtest_*` antes de repetir.
