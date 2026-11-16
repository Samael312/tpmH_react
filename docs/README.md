# Documentación general del proyecto TPM

Índice maestro. Audiencia principal: **desarrolladores y asistentes de IA**. Estado documentado: commit `848e6f3`, 2026-11-16 (nada corregido tras la auditoría).

## Por dónde empezar

| Quiero… | Lee |
|---|---|
| Entender qué es el proyecto y arrancarlo | [`../README.md`](../README.md) |
| Incorporarme al código y saber cómo añadir cosas | [`DEVELOPER_GUIDE.md`](DEVELOPER_GUIDE.md) |
| Entender el dominio, los estados y el flujo del dinero (con diagramas) | [`DOMAIN_AND_DIAGRAMS.md`](DOMAIN_AND_DIAGRAMS.md) |
| Saber qué hace cada rol en la aplicación, paso a paso | [`USER_MANUAL.md`](USER_MANUAL.md) |
| Desplegar, migrar, vigilar, resolver incidencias, rotar claves | [`OPERATIONS.md`](OPERATIONS.md) |

## Mapa completo de la documentación

```
README.md                          visión general + puesta en marcha
CLAUDE.md                          arranque rápido para asistentes de IA
ANALISIS.md                        informe de auditoría (seguridad, lógica, UX)
docs/                              ← estás aquí (guías transversales)
  DEVELOPER_GUIDE.md · DOMAIN_AND_DIAGRAMS.md · USER_MANUAL.md · OPERATIONS.md
backend/doc/                       referencia técnica del backend
  ARCHITECTURE · BUSINESS_RULES · FLOWS · KNOWN_ISSUES · TESTING · ENVIRONMENT · RESOURCE_COSTS
  generated/  API_REFERENCE (211 rutas) · MODELS · CORE_FUNCTIONS · SCHEMAS   (regenerables)
frontend/doc/                      referencia técnica del frontend
  ARCHITECTURE · PAGES_AND_UX · KNOWN_ISSUES · TESTING
  generated/  ROUTES · COMPONENTS · API_CALLS                                  (regenerables)
```

## Reglas para mantener la documentación

1. **Lo generado no se edita a mano**: `cd backend && python doc/generate_docs.py` lo reescribe (no necesita `.env` ni BD).
2. Al **corregir un bug** de `KNOWN_ISSUES.md`: quita el `xfail` de su test, marca el bug como cerrado en ambos `KNOWN_ISSUES.md`, `ANALISIS.md` y la tabla del `README.md` raíz.
3. Al **cambiar una regla de negocio**: actualiza `backend/doc/BUSINESS_RULES.md`, el diagrama afectado en `DOMAIN_AND_DIAGRAMS.md` y, si cambia lo que ve el usuario, `USER_MANUAL.md`.
4. Al **añadir variable de entorno**: `backend/.env.example` o `frontend/.env.example`, `backend/doc/ENVIRONMENT.md` y, si es `NEXT_PUBLIC_*`, el `ARG`/`ENV` del `frontend/Dockerfile`.
5. Cita siempre `archivo:línea` y comprueba que sigue siendo cierto antes de fiarte de una cifra de líneas: cambian.
6. Idioma: español; comentarios y mensajes de la API en español.
