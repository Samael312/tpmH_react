# Sondas de la auditoría de zonas horarias

Tests SQLite (harness de `tests/audit`, sin `.env` ni PostgreSQL) que **documentan bugs actuales**:
cada `test_bug_*` que pasa confirma un fallo descrito en `docs/TIMEZONE_AUDIT.md`; los `test_ok_*` son controles.

- `test_teacher_tz_change.py` — cambio de zona del profesor, validación de franjas y excepciones.
- `test_dst_and_booking.py` — horario de verano, medianoche UTC y validación de reservas.
- `test_calendar_emails_jobs.py` — Google Calendar/Preply (simulado), correos y jobs.

Correr: `cd backend && venv\Scripts\python.exe -m pytest tests/tz_probes -q`

`setup_qa.py` y `live_probe.py` son scripts de prueba en vivo **solo para Neon dev** (crean cuentas `qa_tz_*`);
no son tests de pytest.

Al arreglar un bug, su sonda empezará a fallar: invertir el assert y moverla a `tests/audit/`.
