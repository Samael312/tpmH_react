# Flow-tests (`backend/tests/flow/`)

Suite de pruebas de integración semi-real para probar rápidamente todo el
backend, pensada para reemplazar al flow-tester manual (el HTML standalone
y la página `/admin/flow-tester`). Corre contra un backend + base de datos
**reales** (locales, no mocks), a través de la propia app FastAPI en
proceso (sin levantar un servidor aparte).

## Por qué el flow-tester manual no funcionaba

No era (solo) un problema de roles, aunque ese era el síntoma más visible:

- `get_current_teacher` acepta `teacher` **o** `teacher_admin`, nunca
  `superadmin`. El tester viejo usaba el token del admin logueado como
  fallback para los tests de profesor — si esa cuenta era `superadmin`
  puro, todo lo de profesor fallaba con 403.
- `get_current_approved_teacher` (asignar material/tareas) exige además
  `status == approved`, y un profesor recién registrado nace `pending` y
  necesita `video_url` para poder aprobarse.
- Bugs de método/ruta que no tenían nada que ver con roles:
  - `PUT /availability/me/weekly`, no `POST` (405).
  - `POST /materials/` es multipart (`Form`), no JSON (422), y `category`
    va en minúscula (`"vocabulary"`, no `"Vocabulary"`).
  - `/api/v1/admin/withdrawals/pending` no existe — la ruta real es
    `/api/v1/payments/admin/withdrawals/pending` (el router de pagos está
    montado bajo `/payments`).
  - `/api/v1/admin/classes` no existe — no hay listado global de clases
    para admin en este backend.
- Asignar material/tarea a un estudiante que el profesor no tiene
  vinculado (`TeacherProfile.students`) se salta en silencio
  (`skipped_not_mine`) sin dar error — el test viejo "pasaba" (200) sin
  haber asignado nada en realidad.

Cada uno de estos bugs quedó documentado como comentario en el test que lo
cubre.

## Filosofía

- **4 usuarios fijos** (superadmin, teacher_admin, teacher, student): se
  crean una única vez (ver `seed.py`) y se **reutilizan siempre**. Nunca se
  borran entre corridas. El profesor fijo nace ya `approved` y con
  `video_url`, así que ningún test de profesor se topa con el bloqueo de
  aprobación.
- **Todo lo demás es volátil**: cualquier POST/PATCH que un test haga
  (clases, materiales, tareas, enrollments, tickets de soporte,
  excepciones de disponibilidad, paquetes...) se registra en el fixture
  `volatile` y se borra automáticamente al terminar el test — pase o
  falle.
- Cuando el propio endpoint `DELETE` es un soft-delete (`is_active =
  False`, por ejemplo `materials` y `homework`, a propósito para conservar
  historial), la suite hace un hard-delete por debajo además de ejercer el
  endpoint real, para que la BD quede realmente limpia.
- Verificado con 3+ corridas consecutivas contra una base de datos local
  real: **cero filas residuales** en cualquier tabla relevante después de
  cada corrida (auditado a mano, ver más abajo cómo repetirlo).

### Lo único que persiste entre corridas (y por qué está bien)

- Los 4 usuarios fijos y sus perfiles (por diseño).
- `god_mode_audit_logs`: nunca se borran — es un log de auditoría real, no
  basura.
- `platform_config`: fila singleton que el propio backend autocrea la
  primera vez que se llama `GET /admin/platform-config` (pasaría igual en
  cualquier entorno real, no es un efecto de la suite).

## Cómo correrla

```bash
cd backend
pip install -r requirements.txt   # ya incluye pytest y pytest-order
```

Necesitas un `.env` en `backend/` apuntando a un backend **local o de
desarrollo** (nunca producción):

```env
DATABASE_URL=postgresql+psycopg2://usuario:password@localhost:5432/tu_bd_local
SECRET_KEY=cualquier-secreto-para-firmar-jwt-en-local
ALGORITHM=HS256
ENVIRONMENT=development
# Necesarios solo para que la app arranque sin fallar en el import:
OPENAI_API_KEY=sk-dummy
GEMINI_API_KEY=dummy
RESEND_API_KEY=dummy   # los envíos de email se mockean en los tests igual
```

Corre las migraciones una vez contra esa base:

```bash
python -m alembic upgrade head
```

La suite está **deshabilitada por defecto** (aunque hagas `pytest` sin más
argumentos no se ejecuta ni un test de `tests/flow/`) — hay que habilitarla
explícitamente:

```bash
pytest tests/flow --run-flow-tests -v
# o, en CI:
RUN_FLOW_TESTS=1 pytest tests/flow -v
```

Además, la suite **se niega a correr** si detecta `ENVIRONMENT=production`
o `"prod"` en `DATABASE_URL` (salvo que fuerces
`FLOW_TESTS_ALLOW_PROD=1`, bajo tu propio riesgo — no lo hagas).

### Marcadores

- `integration`: todos los tests de esta suite.
- `destructive`: además de crear, fuerza estados vía god-mode (hoy solo
  `test_purchase_flow.py`). Para excluirlos: `pytest tests/flow -m "integration and not destructive" --run-flow-tests`.

### Sobreescribir credenciales de los usuarios fijos

Por variable de entorno, por si en tu entorno ya existen cuentas con esos
correos:

```env
FLOW_TEST_PASSWORD=...
FLOW_TEST_SUPERADMIN_EMAIL=...
FLOW_TEST_TEACHER_ADMIN_EMAIL=...
FLOW_TEST_TEACHER_EMAIL=...
FLOW_TEST_STUDENT_EMAIL=...
```

### Convención de docstrings (Técnico / UX)

Todo test nuevo debería llevar un docstring con este formato exacto, para
que `/flow-tests/manifest` lo pueda partir automáticamente en los dos
campos que muestra la UI:

```python
def test_algo(...):
    """
    Técnico: qué hace el test a nivel API/BD, qué endpoint(s) golpea y qué
    verifica exactamente.
    UX: qué significa esto para la experiencia real de un usuario —
    qué pantalla o flujo se rompería si este test fallara.
    """
```

Si un test no sigue el formato, el manifiesto igual funciona (cae de
vuelta al docstring completo como "technical_description" y
"ux_description" en `null`), pero no se benefician del desplegable dividido.

## Qué cubre hoy

| Archivo | Qué prueba |
|---|---|
| `test_auth.py` | Registro público (student/teacher), rechazo de roles privilegiados, login, `/users/me`, forgot-password |
| `test_availability.py` | Disponibilidad semanal del profesor (roles correctos), slots públicos, excepciones puntuales |
| `test_materials_homework.py` | Crear/asignar material y vocabulario, crear/asignar/borrar tareas, vínculo profesor-estudiante |
| `test_purchase_flow.py` | El flujo completo: prueba gratuita → completarla (god-mode) → crear paquete → notificar pago → aprobar pago → clase regular con crédito |
| `test_admin_staff.py` | Regresión directa del bug original: staff (`superadmin`/`teacher_admin`) vs. no-staff en endpoints de admin |
| `test_support.py` | Crear ticket, listar, resolver (superadmin y teacher_admin) |

## Diagnóstico de "0 tests" en la UI sin ningún error visible

Si `/admin/flow-tester` muestra "TODO VERDE" con **0 tests** y termina casi
instantáneo (unos pocos cientos de ms), casi seguro es esto: el Python que
corre el servidor (`sys.executable` dentro de `flow_tests.py`) **no tiene
pytest instalado** — típicamente porque se actualizó el código pero no se
volvió a correr `pip install -r backend/requirements.txt` en el entorno
donde vive el proceso del backend (venv, contenedor, etc.). `python -m
pytest` en ese caso imprime `No module named pytest` y sale con código 1
— el mismo código que usa pytest para "corrieron tests y alguno falló", así
que versiones de esta suite anteriores al fix de abajo se lo tragaban en
silencio.

**Ya está corregido**: ahora, si el `--report-log` terminó con 0 tests
reales (sin importar el código de salida), la UI siempre muestra la salida
completa del proceso en el panel rojo "Salida de error del proceso" —
incluyendo ese mensaje exacto, para que quede obvio qué instalar y dónde.

## Limitaciones conocidas / próximos pasos

- **Modo single-tenant**: `POST /payments/book` ignora `teacher_username`
  si `PlatformConfig.is_single_tenant` es `True` (o no hay fila de config
  todavía) y usa el "profesor destacado"
  (`PlatformConfig.featured_teacher_id` o `FEATURED_TEACHER_USERNAME`). Si
  en tu entorno el destacado no es el profesor fijo de esta suite,
  `test_purchase_flow.py` se **salta** (no falla) con un mensaje explicando
  por qué. Para que corra de verdad, o pon
  `FEATURED_TEACHER_USERNAME=flowtest_teacher` en tu `.env` local, o
  configura `PlatformConfig.is_single_tenant=False`.
- No cubre todavía: cohortes/clases grupales, calendario de Google
  (requiere credenciales OAuth reales), TTS/Chipi (llaman a APIs externas
  reales), reviews, ni renovación/cambio de paquete. El framework
  (`conftest.py`: `volatile`, `fixed_users`, tokens por rol) está pensado
  para que añadir estos casos sea sencillo — seguir el patrón de
  `test_materials_homework.py` o `test_purchase_flow.py` según la
  complejidad del flujo.
- `/admin/flow-tester` (Next.js) dispara esta suite de verdad, con
  feedback visual en vivo. Capacidades actuales:
  - **Enumeración previa**: al cargar la página, `GET /flow-tests/manifest`
    corre `pytest --collect-only` (sin tocar la BD, milisegundos) y trae la
    lista exacta de tests — así la barra de progreso durante una corrida es
    precisa (`completados/total conocido de antemano`), no una animación
    genérica.
  - **Descripción técnica + UX por test**: cada test tiene un docstring con
    el formato `Técnico: ... UX: ...`; el backend lo parte en dos campos
    (`technical_description` / `ux_description`) y la UI los muestra en un
    desplegable por fila (ícono de info), disponible siempre, no solo
    cuando falla.
  - **Ejecución granular**: se puede correr un test individual (▶ en la
    fila), un módulo/bloque completo (▶ en el header del módulo, o
    checkbox "seleccionar todo" del módulo), una selección arbitraria de
    tests marcados con checkbox ("Ejecutar seleccionados"), o la suite
    completa ("Ejecutar todo"). Una selección explícita de tests corre
    exactamente esos, **incluso si alguno es destructivo** — el toggle de
    "incluir destructivos" solo se aplica automáticamente cuando se corre
    todo o un módulo/bloque sin selección manual de esos tests puntuales;
    los checkboxes de tests destructivos están deshabilitados mientras el
    toggle esté apagado.
  - Progreso en vivo vía polling (`GET /flow-tests/{run_id}`), que lee un
    `--report-log` de pytest escrito test a test.
  - Acceso: cualquier staff (`superadmin` o `teacher_admin`). El backend se
    niega a correr si `ENVIRONMENT=production`.
  `frontend/public/flow-tester.html` se eliminó por estar duplicado y
  obsoleto frente a esta suite.
- **Cuentas de prueba ocultas de la UI real**: `users.is_test_account=True`
  para los 4 usuarios fijos — el profesor fijo, aunque esté `approved`, no
  aparece en `GET /teachers/` (el marketplace público), pero sigue siendo
  accesible por username directo (perfil, slots, reservas), que es lo que
  el resto de la suite necesita. Solo se filtró la superficie pública
  explícitamente señalada; los listados de staff en `/admin` siguen
  mostrando estas cuentas (útil para depurar).
