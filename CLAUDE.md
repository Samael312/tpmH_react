# TPM (tuprofemaria) — guía para Claude

Antes de auditar o explorar a ciegas, lee la documentación ya hecha (describe el comportamiento actual, verificado):

- Guías transversales: `docs/README.md` (desarrollo, dominio con diagramas, manual por rol, operación/despliegue).
- Backend: `backend/doc/README.md` (índice) · `BUSINESS_RULES.md` · `FLOWS.md` · `KNOWN_ISSUES.md` · `TESTING.md` · `RESOURCE_COSTS.md` (qué consume más facturas) · `ENVIRONMENT.md` (**los .env usan URLs localhost pero la BD Neon real y claves reales: no ejecutes `tests/flow` sin una rama de desarrollo**) · `generated/API_REFERENCE.md` (211 rutas).
- Frontend: `frontend/doc/README.md` · `ARCHITECTURE.md` · `PAGES_AND_UX.md` · `KNOWN_ISSUES.md`.
- Informe de auditoría completo: `ANALISIS.md`.
- Tras cambiar código, regenera lo automático: `cd backend && python doc/generate_docs.py`; actualiza a mano `KNOWN_ISSUES.md` y `BUSINESS_RULES.md` si cambia una regla o se corrige un bug.
- Tests sin `.env` ni PostgreSQL: `cd backend && python -m pytest tests/audit -q`. Servidor local con datos semilla: `python -m tests.audit.run_server`.
- Chipi (asistente IA): su conocimiento son fichas `.md` en `backend/app/core/chipi/knowledge/` (`screens/` por pantalla, `topics/` por tema). Al cambiar una regla de negocio o una pantalla, actualiza su ficha y ejecuta `cd backend && venv/Scripts/python.exe -m pytest tests/audit/test_chipi_knowledge.py -q`.
- Frontend: lee `frontend/AGENTS.md` (Next 16 con cambios incompatibles) antes de escribir código Next.
