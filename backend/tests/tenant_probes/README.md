# Sondas de la auditoría de modos (single/multi-tenant)

Tests SQLite (harness de `tests/audit`, sin `.env` ni PostgreSQL) que **documentan bugs actuales**:
cada assert que pasa confirma el comportamiento defectuoso descrito en `docs/TENANT_MODES_AUDIT.md`.

- `test_single_probes.py` — modo single (F*, S*).
- `test_multi_probes.py` — modo multi y `teacher_admin` (M*, A*).
- `test_tenant_transition.py` — cambio de modo y de destacado (T*).

Correr: `cd backend && venv\Scripts\python.exe -m pytest tests/tenant_probes -q`

No están dentro de `tests/audit` a propósito: al arreglar un bug, su sonda empezará a fallar.
Entonces hay que invertir el assert y moverla a `tests/audit/` como test de regresión.
