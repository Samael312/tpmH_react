# Operación y despliegue (runbook)

Proveedor actual: **Railway** (backend + frontend) y **Neon** (PostgreSQL). Esta guía describe lo que el código y los Dockerfiles implican; los pasos de los paneles (Railway, Neon, Google, Resend) hay que confirmarlos en sus interfaces, que cambian.

## 1. Piezas

| Pieza | Cómo corre | Salud |
|---|---|---|
| Backend | `backend/Dockerfile` (python:3.11-slim), `uvicorn app.main:app --host 0.0.0.0 --port 8000` | `GET /health` → `{"status":"ok","environment":...}` |
| Frontend | `frontend/Dockerfile` (node 20, build standalone), `node server.js` | `GET /` |
| BD | Neon serverless PostgreSQL | panel de Neon |
| Scheduler | dentro del proceso del backend | logs (`Recordatorios: …`, `[calendar_sync] …`) |

Despliegue declarado en `railway.toml` (dos servicios, `healthcheckTimeout = 30`).

## 2. Variables en Railway

- **Backend**: las de `backend/doc/ENVIRONMENT.md`. Mínimo: `DATABASE_URL`, `SECRET_KEY`, `OPENAI_API_KEY`, `ENVIRONMENT=production`, `FRONTEND_URL`, `BACKEND_URL`, más Resend/Cloudinary/Google según uso.
- **Frontend**: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_FEATURED_TEACHER_USERNAME` deben estar **también declaradas como `ARG`/`ENV` en `frontend/Dockerfile`** (ya lo están): se incrustan en el build; cambiarlas exige **redesplegar con rebuild**.
- No se usa el archivo `.env` en Railway.

## 3. Despliegue

1. Rama limpia: `python -m pytest tests/audit -q`, `npx tsc --noEmit`, `npm run lint`, `npm run build`.
2. **Migraciones primero si el cambio las incluye** (ver §4); el esquema nuevo debe ser compatible con el código viejo mientras dura el despliegue.
3. Push a la rama que Railway observa (confirma cuál en el panel) → se construyen los dos servicios.
4. Verifica `GET /health` y `GET /`, y haz un login real.
5. Revisa `/admin/logs` (tabla `error_logs`) y los logs de Railway durante ~10 min.

Rollback: redeploy del despliegue anterior en Railway. Si hubo migración, solo es seguro si era aditiva (columnas nuevas nullable); si no, hay que escribir una migración inversa (`alembic downgrade -1`) **y probarla en una rama**.

## 4. Migraciones

Desde la Fase 9 `railway.toml` declara `preDeployCommand = "alembic upgrade head"` en el servicio del backend: Railway aplica las migraciones **antes** de arrancar la versión nueva y, si fallan, el despliegue no sale. **Sin verificar:** el `railway.toml` del repo usa una estructura multi-servicio que Railway puede no interpretar; confirma en el panel (servicio backend → Settings → Deploy → *Pre-deploy command*) que figura `alembic upgrade head` y, si no, escríbelo ahí. Comprueba también que `DATABASE_URL` admite DDL (en Neon, mejor la conexión directa que la *pooled*). Regla: las migraciones deben ser **retrocompatibles** (añadir, no borrar ni renombrar) porque durante el relevo todavía corre el código viejo. Para hacerlo a mano:
```bash
cd backend
# .env con la DATABASE_URL del entorno destino (¡comprueba a cuál apunta!)
alembic current        # debe mostrar la revisión actual
alembic heads          # debe haber UN solo head (hoy b1d5e6f7a8c9)
alembic upgrade head
```
- Verifica el destino antes: `alembic current` y el host de `DATABASE_URL`. `load_dotenv(override=True)` hace que el `.env` pise tu entorno.
- Si el *pre-deploy* automático no se usa, ejecuta el comando a mano antes de cada despliegue que incluya migraciones.
- Estado verificado el 2026-11-16: la BD de Neon estaba en `c9d0e1f2a3b4`. **Desde entonces el repo tiene 7 migraciones más** (`d1e2f3a4b5c6` NEG-02, `a7b8c9d0e1f2` SEC-04, `b8c9d0e1f2a3` SEC-05, `e7a1b2c3d4f5` Fase 7: control de correos, `f8b3c4d5e6a7` Fase 8: idiomas que habla el usuario (también crea el catálogo `spoken_languages`) `a9c4d5e6f7a8` Fase 9: tamaño de los materiales y aviso de chat pendiente y `b1d5e6f7a8c9` Fase 11: 26 índices de rendimiento, solo añaden índices). Según el equipo, Neon está aplicada hasta `f8b3c4d5e6a7`: faltan `a9c4d5e6f7a8` y `b1d5e6f7a8c9`: hay que ejecutar `alembic upgrade head` en cada entorno antes de desplegar el código nuevo (sin ellas fallan el login con refresh y la verificación de email).

## 5. Copias de seguridad y recuperación

- La BD es lo único con estado valioso (los archivos están en Cloudinary; el resto se reconstruye).
- **Neon**: usa sus *branches* y recuperación a un punto en el tiempo (la ventana de retención depende del plan; compruébala en el panel). Antes de una migración arriesgada, crea una **rama** de la base.
- Copia lógica manual: `pg_dump "$DATABASE_URL" -Fc -f tpm_$(date +%F).dump` (guarda el archivo fuera del repo, contiene datos personales).
- Prueba de restauración trimestral en una rama aparte.
- Cloudinary: sin copia propia; los materiales de profesores solo viven allí.

## 6. Monitorización

| Qué | Dónde |
|---|---|
| Errores de backend y frontend | `/admin/logs` (tabla `error_logs`, se refresca cada 30 s). Hoy crece sin límite y acepta reportes anónimos (SEC-06) |
| Logs de proceso, jobs y despliegues | panel de Railway |
| Consultas, conexiones, compute | panel de Neon (ver `backend/doc/RESOURCE_COSTS.md`) |
| Uso y gasto de IA | panel de OpenAI (Chipi/TTS) |
| Emails | panel de Resend |
| Créditos de almacenamiento y ancho de banda | panel de Cloudinary |
| Disponibilidad externa | monitor HTTP gratuito (p. ej. UptimeRobot) sobre `/health` |

Alertas recomendadas: gasto OpenAI, compute-hours de Neon, 5xx en Railway, `needs_reauth` de Calendar.

## 7. Incidentes frecuentes

| Síntoma | Diagnóstico | Acción |
|---|---|---|
| Todo da 500 tras desplegar | migración no aplicada o columna inexistente | `alembic current` vs repo; aplicar `upgrade head` |
| 429 para todos los usuarios | rate-limit ve la IP del proxy (SEC-01) | ya incluido en `railway.toml` y `Dockerfile` (SEC-01); si persiste, revisa que el despliegue use ese comando |
| El backend no arranca | falta `OPENAI_API_KEY` o `DATABASE_URL`/`SECRET_KEY` | revisar variables del servicio |
| Emails no llegan | `RESEND_API_KEY` ausente/errónea o dominio de `EMAIL_FROM` sin verificar; los fallos se capturan y solo quedan en logs | revisar logs («Error enviando email…») |
| Sin recordatorios ni Meet | proceso reiniciado antes del primer disparo (intervalos de 1 h/24 h/7 d) o servicio dormido | comprobar logs de jobs; no escalar a >1 worker |
| API lenta cada 30 min | sync de Calendar bloquea el event loop (RESOURCE_COSTS #2) | reducir profesores por pasada / pasar jobs a hilos |
| Google Calendar de un profesor no sincroniza | token `needs_reauth` | el profesor reconecta desde su panel; revisar `GOOGLE_*` |
| Login con Google falla | `redirect_uri_mismatch` o `CLIENT_ID` distinto entre front y back | alinear en Google Cloud Console |
| Retiros pendientes no aparecen | bug AUD-12 | corregir decorador; mientras, consultar la tabla `withdrawals` |
| Un profesor no puede agendar/cobrar | `status` ≠ `approved` | aprobar en `/admin/teachers` |
| «Sin créditos» tras renovar | AUD-03 | ajustar `unlocked_credits`/`status` con God Mode (con motivo) |
| Neon con muchas conexiones/latencia | el engine usa pool (`DB_POOL_SIZE`=5, `DB_MAX_OVERFLOW`=5, `DB_POOL_RECYCLE`=240) | con el endpoint *pooled* de Neon bajar `DB_POOL_SIZE`; vigilar el total de conexiones (engine principal + `chat_engine`) |

## 8. Rotación de claves

| Secreto | Efecto de rotarlo | Pasos |
|---|---|---|
| `SECRET_KEY` | **cierra todas las sesiones** | generar (`python -c "import secrets;print(secrets.token_urlsafe(48))"`), actualizar en Railway, redeploy del backend |
| Contraseña de Neon | caída hasta actualizar `DATABASE_URL` | rotar en Neon, actualizar variable, redeploy |
| `OPENAI_API_KEY` | Chipi/TTS fallan hasta actualizar | crear nueva, actualizar, revocar la vieja |
| `RESEND_API_KEY` | emails fallan hasta actualizar | idem |
| `CLOUDINARY_API_SECRET` | subidas fallan hasta actualizar | idem |
| `GOOGLE_CLIENT_SECRET` | Calendar falla hasta actualizar | idem (el login GSI usa solo el `CLIENT_ID`) |
Tras compartir un `.env` (chat, captura, repositorio) considera comprometidas **todas** y rótalas. Verifica que no está en git: `git log --all --full-history -- "*.env"` (vacío = bien).

## 9. Dominio, HTTPS y CORS

- Backend y frontend en dominios propios con HTTPS; `FRONTEND_URL`/`BACKEND_URL` coherentes (los usan CORS y los emails). CORS solo admite `FRONTEND_URL` y `http://localhost:3000`.
- `lib/csp.ts` (aplicado por `proxy.ts`) fija el CSP con nonce: el dominio del backend debe estar en `connect-src` (sale de `NEXT_PUBLIC_API_URL`, que se lee al construir); la cookie de sesión es `secure`, así que el frontend debe servirse por HTTPS.
- Google Cloud: orígenes y URIs de redirección de ambos dominios; `GOOGLE_REDIRECT_URI` en `https://`.
- Resend: verificar el dominio de `EMAIL_FROM` (SPF/DKIM).

## 10. Tareas periódicas

| Frecuencia | Tarea |
|---|---|
| Diaria | revisar `/admin/logs` y gasto de OpenAI |
| Semanal | pagos y retiros pendientes; profesores en `pending` |
| Mensual | tamaño de BD y de `error_logs` (purgar), crédito de Cloudinary/Resend, dependencias (`pip-audit`, `npm audit`) |
| Trimestral | prueba de restauración, rotación de claves, revisar `KNOWN_ISSUES.md` |

## 11. Checklist previo a producción real (estado actual)

- [ ] Corregir AUD-12 (retiros pendientes) y AUD-03 (renovación): bloquean ingresos y cobros.
- [x] `--proxy-headers` en uvicorn (SEC-01, ya en `railway.toml`/`Dockerfile`) · [ ] `ENVIRONMENT=production`.
- [ ] Ejecutar `alembic upgrade head` (nueva migración `a7b8c9d0e1f2`: verificación de email).
- [ ] Pool de conexiones/endpoint pooled de Neon; subir intervalos del scheduler.
- [ ] Límites y login para Chipi/TTS (coste); tope en `/logs/frontend`.
- [ ] Separar funciones de `teacher_admin` (comisión propia, retiros propios).
- [ ] Verificación de email y `email_verified` de Google.
- [ ] Migraciones automatizadas en el despliegue.
- [ ] Rotar las claves usadas durante la auditoría.
- [ ] Prueba E2E en navegador y prueba de carga básica.

## Sesión por cookies (SEC-05)
- Variables nuevas del backend: `COOKIE_DOMAIN=.tuprofemaria.com` (producción), `COOKIE_SAMESITE=lax`, `REFRESH_TOKEN_EXPIRE_DAYS=30`. `COOKIE_SECURE` es automático en `ENVIRONMENT=production`.
- Ejecutar `alembic upgrade head` (migración `b8c9d0e1f2a3`: tabla `refresh_tokens`).
- Orden de despliegue: backend primero (acepta cookie y Bearer), luego frontend. Cuando todos usen el frontend nuevo, bajar `ACCESS_TOKEN_EXPIRE_MINUTES` a 30.
- Frontend y API deben ser del mismo sitio (`tuprofemaria.com` y `api.tuprofemaria.com`); con dominios `*.up.railway.app` distintos las cookies no se comparten con el proxy de Next.

## 7. Scheduler y Neon (Fase 9)

- Los jobs de clases (Meet, finalizar, recordatorios, resumen de chat, sincronización de Calendar) se programan para la hora en que hay algo que hacer; sin actividad la base de Neon puede suspenderse. Los diarios se ejecutan juntos a las 03:00 UTC (`purge_old_chat_messages`, `purge_old_logs`, `release_stale_enrollments`) y el aviso de pocos créditos los lunes 14:00 UTC.
- Los jobs viven en memoria del proceso: tras un reinicio o despliegue se recalculan solos a los 5 s. Con **más de un worker** se duplicarían (mantén uno).
- Si un job no se ejecuta a su hora, revisa los logs de Railway (`logger` de `app.core.scheduler`): un error al calcular el vencimiento lo reintenta a los 10 min y no se pierde.
- Ajustes: `CHAT_DIGEST_DELAY_MINUTES`, `MATERIALS_QUOTA_MB`, `ERROR_LOG_RETENTION_DAYS`, `EMAIL_LOG_RETENTION_DAYS` (ver `backend/doc/ENVIRONMENT.md`).

## 8. CDN y compresión en Railway (Fase 11)

- **Backend:** `GZipMiddleware` (nivel 5, respuestas de 1000 bytes o más; `API_GZIP_MIN_BYTES`). No comprime el streaming de Chipi.
- **CDN de Railway (sin coste extra según su documentación, https://docs.railway.com/networking/cdn):** está **apagado por defecto** y se activa por servicio: servicio del **frontend** → Settings → Edge → *Enable CDN Caching* (o `railway cdn enable --service <nombre>`). No cambia DNS ni SSL. Solo cachea `GET`/`HEAD` sin `Authorization` ni `Set-Cookie`, así que sirve para los estáticos del frontend (`/_next/static`, `public/`) y no para la API. Según esa documentación, el borde comprime con Brotli/gzip lo que el origen envía sin comprimir (respuestas de 256 bytes o más) y nunca retiene `text/event-stream`. **Sin verificar en producción:** hay que activarlo y comprobar con `curl -I -H "Accept-Encoding: br" <url>`.
- `public/` (modelo 3D, assets) lleva `Cache-Control` de 7 días (`next.config.ts`); `_next/static` ya es `immutable` por defecto de Next.
- Tras activar el CDN, si se cambia un archivo de `public/` con el mismo nombre, puede tardar hasta 7 días en verse; cambia el nombre del archivo al sustituirlo.

## 9. Rendimiento en producción (Fase 11)

- **Peticiones lentas:** el backend añade `Server-Timing: app;dur=<ms>` a cada respuesta y escribe `Peticion lenta: <método> <ruta> <ms> (<estado>)` en el log cuando pasa de `SLOW_REQUEST_MS` (1500). Búscalo en los logs de Railway para saber qué endpoints optimizar. No consulta ni escribe en la base de datos.
- **Imágenes:** las de Cloudinary se sirven con `f_auto,q_auto` desde el propio Cloudinary (`frontend/lib/imageLoader.ts`); el servidor de Railway ya no recodifica imágenes. Los créditos de transformación de Cloudinary son compartidos con almacenamiento y ancho de banda: revisa su panel tras el lanzamiento.
- **Índices:** tras aplicar `b1d5e6f7a8c9`, comprueba en Neon con `EXPLAIN ANALYZE` que las consultas de agenda (clases por profesor y fecha) usan `ix_classes_teacher_start`.
