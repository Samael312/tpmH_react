# Consumo de recursos y facturas: acciones ordenadas de MAYOR a MENOR coste

Análisis **estático** del código (commit `848e6f3`, 2026-11-16). No se midió en producción: los órdenes de magnitud son
estimaciones razonadas, no métricas. Para validarlas hace falta el panel de Neon (compute-hours, conexiones), Railway
(CPU/RAM/egress), OpenAI (uso), Cloudinary (créditos) y Google Cloud (cuotas Calendar). Marcado: 💰 factura directa · ⏱ CPU/latencia · 🧠 RAM · 🔌 conexiones BD.

Servicios que facturan: **Neon** (compute-hours + almacenamiento + transferencia), **Railway** (CPU/RAM/red de backend y frontend),
**OpenAI** (Chipi + TTS), **Cloudinary** (almacenamiento, transformación, ancho de banda), **Resend** (emails/mes), **Google** (cuotas de Calendar API).

## Ranking

### 1. 💰🔌 Neon nunca se suspende (jobs del scheduler cada 5/10/30 min)
Neon serverless factura por tiempo de compute y se auto-suspende tras unos minutos de inactividad. Estos jobs consultan la BD aunque nadie use la plataforma:

| Job | Intervalo | Consultas mínimas por disparo |
|---|---|---|
| `generate_upcoming_meet_links` | 5 min | 1+ (clases confirmadas próximas) |
| `finalize_expired_classes` | 10 min | escaneo de clases `confirmed`/pendientes pasadas |
| `sync_all_teacher_calendars` | 30 min | 1 + N por profesor con Calendar |
| `send_class_reminders` | 1 h | 1+ |

Con el de 5 min, la BD se despierta ~288 veces/día: **compute 24/7 aunque haya 0 usuarios**. Es probablemente la mayor partida fija de la factura de Neon.
Mitigación: subir el intervalo (Meet cada 15–30 min; finalizar cada 30–60 min), o hacer los jobs «lazy» (solo cuando hay clases en ventana, comprobable con una consulta barata o con caché en memoria), o mover a cron externo solo en horas útiles.
`scheduler.py` líneas 322–327.

**Resuelto en la Fase 9.** Los jobs de Meet, finalizar clases, recordatorios y sincronización de Calendar dejaron de ser de intervalo fijo: cada uno calcula cuándo le toca (hora de la clase, de su fin, etc.) y se programa con un `DateTrigger`; sin clases próximas duermen hasta 24 h. Los jobs diarios se juntan a las 03:00 UTC. Neon ya puede suspenderse cuando no hay actividad ni clases cerca. Ver `ARCHITECTURE.md` (Scheduler) y `tests/audit/test_due_jobs.py`.

### 2. ⏱🧠 Los jobs `async def` ejecutan código **bloqueante** en el event loop
`AsyncIOScheduler` corre las corrutinas en el mismo loop que atiende la API. Dentro hay SQLAlchemy síncrono, llamadas HTTP síncronas a Google y `resend` síncrono, sin `await`/`run_in_executor`.
Mientras `sync_all_teacher_calendars` recorre **todos** los profesores con Calendar (secuencial, `run_calendar_sync_for_all_teachers`), **toda la API se congela** para los endpoints `async` (chat, Chipi) y los síncronos pueden quedarse sin hilo. Crece linealmente con nº de profesores: con 50 profesores × varias llamadas Google ≈ minutos de bloqueo cada 30 min.
`send_class_reminders` hace lo mismo con un email síncrono por clase. Esto incrementa latencia, timeouts del healthcheck de Railway y la necesidad de más CPU/instancias.
Mitigación: `def` normales (APScheduler los lanza en un pool de hilos) o `await asyncio.to_thread(...)`; limitar profesores por pasada y paralelizar con tope.

**Resuelto en la Fase 5:** los jobs son `def` y corren en el pool de hilos.

### 3. 💰⏱🔌 `NullPool` en el engine principal: una conexión TCP+TLS nueva a Neon por sesión/commit
`app/db/base.py`: `engine = create_engine(..., poolclass=NullPool)`. Cada petición abre al menos una conexión física; tras cada `commit()` la conexión se cierra y la siguiente consulta abre otra (el propio comentario del `chat_engine` documenta «3-4 reconexiones por envío de mensaje»).
Costes: +30–150 ms de latencia por consulta fría, CPU de handshake TLS en Neon, presión sobre el límite de conexiones y de compute. Solo el chat tiene pool propio (`pool_size=5`, `max_overflow=5`). Cada endpoint que hace varios `commit()` (reservar, validar pago, cancelar) multiplica el coste.
Mitigación: usar el endpoint *pooled* de Neon (PgBouncer) y un pool normal (`pool_size` 5–10, `pool_pre_ping`, `pool_recycle`), o `QueuePool` también en el engine principal.
**Resuelto:** `app/db/base.py` ya usa un pool normal (`pool_size`/`max_overflow` por entorno, `pool_pre_ping`, `pool_recycle=240`); el chat mantiene su propio pool. Lo de arriba describe el estado anterior.

### 4. ⏱🔌 `finalize_past_classes(db)` en CADA lectura de agenda
`GET /classes/my-classes` (`classes.py:286`) y `GET /classes/teacher/classes` llaman a `finalize_past_classes`, que escanea y **escribe** (UPDATE + commit) además del job de 10 min. Cada alumno/profesor que abre la agenda dispara un barrido global (no filtrado por usuario) → N usuarios = N barridos de toda la tabla `classes` con escritura. Son las pantallas más visitadas. Además es redundante con el job.
Mitigación: quitar la llamada de los GET (basta el job) o acotar por usuario y hacerlo como máximo cada X minutos (caché en memoria).

### 5. 💰 Chipi (OpenAI `gpt-4o-mini`) anónimo y con entrada sin tope
`POST /chipi/chat` (`chipi.py`) permite usuarios sin sesión; `max_tokens=500` limita la **salida**, pero `message` y `history` no tienen tope de longitud ni de nº de elementos → la **entrada** puede ser enorme (tokens de entrada facturados) y el prompt del sistema se reconstruye en cada llamada con consultas a BD (`core/chipi/context.py`: paquetes activos, datos de alumno/profesor). Solo hay el límite global de 200/min/IP (y con SEC-01 ese límite ni distingue usuarios).
Peor caso: script anónimo con historiales largos 200 req/min → factura OpenAI + 2–6 consultas a Neon por mensaje. Es el vector de **abuso económico** más barato para un atacante.
Mitigación: exigir login para el chat completo, límite por usuario/día, `max_length` en mensaje, `history ≤ N` con `role ∈ {user, assistant}`, caché del contexto de plataforma (`core/cache.py` existe).

### 6. 💰 TTS (OpenAI) + Cloudinary
`POST /tts/*` genera audio por palabra (hasta ~50 palabras por petición) y lo cachea en Cloudinary; la caché evita repetir, pero palabras distintas = una llamada OpenAI TTS + una subida a Cloudinary cada una, sin cuota por usuario (solo exige login). Un usuario puede generar miles de palabras únicas → coste OpenAI + almacenamiento permanente en Cloudinary sin purga.
Mitigación: cuota diaria por usuario, catálogo/lista blanca de palabras de materiales, política de limpieza.

### 7. 💰🧠 Subidas de archivos y vídeo
> **Corregido en la Fase 5:** las subidas ya no se leen enteras en RAM. Los endpoints son `def` (hilo, no bloquean el event loop) y pasan `UploadFile.file` a `upload_file_stream` (`app/core/storage.py`), que valida tamaño y firma antes de enviar y sube los vídeos por trozos con `upload_large`. Sigue sin haber cuota por profesor ni subida directa desde el navegador. El texto de abajo describe el estado anterior.

Documentos hasta 10 MB y **vídeos hasta 100 MB** (`MAX_VIDEO_UPLOAD_MB`), leídos **completos en RAM** (`file_bytes`, `len(file_bytes) > max_size`) antes de subir a Cloudinary: cada subida simultánea de 100 MB ocupa ~100 MB (más copias durante validación de magic bytes) del contenedor de Railway; unas pocas en paralelo pueden provocar OOM. Cloudinary factura almacenamiento y ancho de banda; `/materials/{id}/stream` redirige a la URL pública, por lo que cada reproducción consume ancho de banda de Cloudinary (no de Railway: bien).
Mitigación: subida directa del navegador a Cloudinary (firma desde el backend) o streaming con tope, límite de subidas por usuario, cuota de almacenamiento por profesor.

### 8. ⏱🔌 N+1 por carga perezosa (0 usos de `joinedload`/`selectinload`)
No hay *eager loading* en todo `app/`; los serializadores recorren relaciones (`class_.teacher`, `.student`, `.enrollment`, `.package`, `user`…) y cada acceso lanza una consulta. Combinado con el punto 3 (cada consulta puede abrir una conexión) una lista de 50 clases puede costar 100–250 consultas. Afecta a: `my-classes`, listados de admin (`admin.py`, `god_mode.py`, `payments.py` con 16 `.all()`), conversaciones de chat (`_serialize_conversation` por conversación), `send_class_reminders` (consulta `User` por clase).
Mitigación: `selectinload`/`joinedload` en las consultas de listado; serializar con una sola consulta agregada.

**Resuelto en la Fase 5** para 9 listados (vigilados por `tests/audit/test_perf_queries.py`).

### 9. ⏱🔌 Listados sin paginación
Solo ~23 usos de `limit/offset` frente a decenas de `.all()`: usuarios, estudiantes, pagos, logs, clases, conversaciones, materiales se devuelven enteros. Crece con los datos (memoria del contenedor, JSON grande, egress de Neon y de Railway, tiempo de render del navegador). `error_logs` además crece sin límite por `POST /logs/frontend` anónimo (SEC-06) y sin política de purga.
Mitigación: paginación obligatoria con tope (`limit ≤ 100`), índices por filtro, purga de `error_logs`.

**Resuelto en parte (Fases 5 y 9):** `limit`/`offset` + `X-Total-Count` (200 por defecto, 500 máximo) en los listados principales y job diario de purga (`error_logs` 30 d, `email_log` 60 d). Queda `god_mode` y los listados de admin.

### 10. 💰⏱ Sincronización con Google Calendar
Cada 30 min y por cada profesor conectado: lectura de busy/eventos (`list_calendar_events`, `get_busy_ranges`), push de clases propias y creación de Meet; reintentos (`_with_retries`). Cuota Google Calendar (peticiones/min/proyecto) y CPU (ver punto 2). Además `GET /availability/slots` puede consultar el busy de Google en cada petición de slots (sin caché persistente: `core/cache.py` es en memoria y por proceso).
Mitigación: sync por *webhooks* (push notifications) o solo para profesores con actividad/clases próximas; cachear busy 2–5 min.

**Mitigado en la Fase 9:** la sincronización ya no corre cada 30 min siempre: solo con clase en curso o en las próximas 3 h; si no, cada 6 h; y nada si ningún profesor tiene Calendar.

### 11. 🔌🧠 WebSocket de chat global
Una conexión persistente por usuario conectado (alumnos y profesores con la app abierta), con *ping* cada ~25 s (`chatStore.ts`) → mantiene sockets y memoria en Railway proporcional a usuarios concurrentes; cada mensaje: 3–4 operaciones en BD (persistir, entrega, no leídos) con el `chat_engine` (hasta 10 conexiones a Neon) y, si el destinatario está desconectado, un email por mensaje (`send_new_chat_message_teacher_email`, sin agrupar). Sin límite de mensajes por segundo por conexión → un cliente puede saturar BD y facturar emails.
Mitigación: límite por conexión, agrupar notificaciones por email (máx. 1 cada X min), tope de longitud de mensaje.
**Fase 13 (chat eficiente):** el límite por conexión ya existe (20 envíos cada 10 s, 20 000 caracteres por frame). Consultas por petición, medidas con 12 conversaciones (`tests/audit/test_f13_chat_queries.py`, que además comprueba que no crecen con las filas): lista 9 (antes ≈ 4 por conversación: estado de lectura, recuento y dos cargas perezosas), no leídos 3 (antes 2 por conversación), historial 4 (el remitente va en la misma consulta), lista del admin 7 (el recuento de mensajes es una consulta agrupada). La lista pagina en SQL en vez de cargar todas las conversaciones; abrir el socket hace una sola lectura del usuario y el catch-up de entregas son 2 consultas fijas; los participantes de un mensaje salen en 1 consulta; `chat_enabled` y las horas de reactivación se cachean 30 s (se invalidan al guardar los ajustes). Frontend: con el socket conectado el polling de lista y no leídos baja a una comprobación cada 5 min; la reconexión usa retroceso con componente aleatorio, renueva la sesión si el cierre es 4401 y espera 5 min si es 4403; `POST /read` simultáneos del mismo hilo se agrupan en uno.

**Resuelto en la Fase 9 (correos):** el aviso al profesor ya no sale por mensaje sino agrupado: un correo por profesor con todas sus conversaciones pendientes, 10 min después del primer aviso (`core/chat_digest.py`). Falta un límite de mensajes por segundo por conexión.

### 12. ⏱ Polling del frontend
`useChat` consulta conversaciones y no leídos cada 30 s (solo con la pestaña visible, bien), `useAdminData`/`useSupport` cada 30 s, `useErrorLogs` cada 30 s. Con 100 usuarios simultáneos ≈ 200–400 peticiones/min constantes → cada una abre conexión a Neon (punto 3) y mantiene la BD despierta en horario de uso.
Mitigación: el WS ya notifica eventos; subir a 60–120 s o eliminar el polling donde el WS cubra el evento; `staleTime` mayor.
**Fase 13:** en el chat ya está hecho (ver punto 11): con el WebSocket conectado, lista y no leídos pasan de 30 s y 45 s a 5 min. Quedan `useAdminData`/`useSupport`/`useErrorLogs` cada 30 s.

### 13. 💰 Emails (Resend) síncronos y numerosos
~40 plantillas; cada reserva envía 2 emails (alumno + profesor), cancelaciones/reagendados 2, recordatorios (1/clase), recibos, tareas, mensajes de chat. Resend factura por volumen mensual. En el camino de la petición el envío es **síncrono** (`resend.Emails.send` bloquea el hilo hasta la respuesta, +200–800 ms por email) y sin cola ni reintento.
Mitigación: `BackgroundTasks`/cola, agrupar, preferencias de notificación.

### 14. ⏱ Disponibilidad, slots y recálculo de zona horaria
`GET /availability/slots` calcula en cada petición rangos × clases ocupadas × excepciones × (opcional) Google busy; coste CPU moderado, crece con ventana y nº de clases del profesor. El cambio de zona horaria recalcula toda la disponibilidad y preferencias (puntual, barato). Sin caché por profesor/día.

### 15. 💰 Almacenamiento en BD (crecimiento sostenido)
`error_logs` (anónimo sin tope), `chat_messages` (retención 90 días por defecto; si el admin pone 0 = infinito), `god_mode_audit`, `notifications`, clases históricas. Neon factura almacenamiento y la copia de seguridad (*history*) de cambios. Los jobs de purga de 24 h pueden no ejecutarse si hay despliegues frecuentes (IntervalTrigger no persistente).

### 16. 🔌 Otros costes menores
- Rate limiter en memoria (`slowapi`): sin Redis no escala, pero tampoco cuesta; el riesgo es el de SEC-01.
- Landing 3D (`three.js`) y vídeos: coste en el cliente y egress de Railway (frontend) por bundle; `next build` standalone ya optimiza.
- `GET /public/landing` tiene caché (`LANDING_CACHE_TTL_SECONDS`) en memoria: correcto.
- Reservas/pagos: pocas escrituras y consultas, pero con NullPool cada `commit()` reabre conexión (ver punto 3).

## Resumen de impacto económico (estimado, de mayor a menor)

| Posición | Partida de la factura | Quién la dispara |
|---|---|---|
| 1 | Neon compute 24/7 | scheduler (sin usuarios) |
| 2 | Railway CPU/latencia + timeouts | jobs bloqueantes en el event loop |
| 3 | Neon compute + latencia + conexiones | `NullPool` en todas las peticiones |
| 4 | Neon + CPU | cada apertura de agenda (barrido global) |
| 5 | OpenAI | cualquiera, incluso anónimo |
| 6 | OpenAI TTS + Cloudinary | cualquier usuario logueado |
| 7 | Railway RAM (OOM) + Cloudinary | subidas de profesores |
| 8–9 | Neon/Railway egress y CPU | listados grandes y N+1 |
| 10 | Cuota Google / CPU | sync cada 30 min |
| 11–13 | Railway RAM + Resend | chat y notificaciones |
| 14–16 | menores | — |

## Orden recomendado de arreglos (mayor ahorro con menor esfuerzo)
1. Pool de conexiones + endpoint *pooled* de Neon (punto 3) — cambio de 5 líneas en `db/base.py`.
2. Subir intervalos del scheduler y hacerlos «lazy» (1); convertir jobs a `def`/hilos (2).
3. Quitar `finalize_past_classes` de los GET (4).
4. Topes y login para Chipi/TTS (5, 6) — corta el vector de abuso de coste.
5. Eager loading y paginación en listados (8, 9).
6. Subidas directas a Cloudinary (7), email asíncrono y agrupado (11, 13).

## Cómo medirlo de verdad (pendiente)
Neon: *Monitoring* (compute time, active connections, queries). Railway: métricas de CPU/RAM por servicio. OpenAI: *Usage* por clave. Cloudinary: panel de créditos. Local: `EXPLAIN ANALYZE` y `sqlalchemy` con `echo=True` contando consultas por endpoint (`my-classes`, `admin/users`) o un test que cuente sentencias con `event.listens_for(engine, "before_cursor_execute")`.

---

# Alternativas gratuitas a Railway

Investigado el 2026-11-16 con búsqueda web. **Las fuentes son blogs de terceros con cifras que se contradicen y los planes gratuitos cambian cada pocos meses: comprueba la página oficial de precios antes de migrar.**

## Punto de partida: qué es Railway hoy
Según su documentación hay un plan Free ($0), Hobby ($5/mes con $5 de uso incluido), Pro ($20/mes) y Enterprise; los cuentas nuevas reciben un *trial* de $5 de crédito una sola vez. Las fuentes discrepan sobre si existe un plan gratuito permanente (algunas hablan de $1/mes de crédito tras el *trial*). Conclusión práctica: **Railway no es gratis de forma fiable**; pagas por CPU/RAM/red usados, por eso los puntos 2, 3, 4 y 7 del ranking suben la factura.
Fuentes: [documentación de Railway](https://docs.railway.com/pricing/plans.md), [Costbench: Free plan](https://costbench.com/software/developer-tools/railway/free-plan/), [Activepieces: Railway pricing 2026](https://www.activepieces.com/blog/railway-pricing-2026-plans-usage-rates-and-costs.md).

## Qué necesita esta app (condiciona la elección)
- **Un proceso siempre encendido**: el scheduler (recordatorios, Meet, finalizar clases, sync Calendar) y el **WebSocket del chat** viven en el proceso web. Un servicio que se duerme por inactividad **no ejecuta los jobs ni mantiene el chat** y el primer usuario espera un arranque en frío (~1 min).
- **Un solo worker** (jobs y rate-limit en memoria).
- Frontend Next.js 16 (standalone), backend FastAPI con Dockerfile, BD **PostgreSQL en Neon** (ya es externa; no depende de Railway).
- RAM: desde la Fase 5 las subidas van por streaming (punto 7), así que 256–512 MB ya no son un problema por esto.

## Opciones por componente

### Frontend (Next.js)
| Opción | Gratis | Pegas |
|---|---|---|
| **Vercel Hobby** | ~100 GB/mes de ancho de banda | Solo uso personal/no comercial (según las fuentes); una plataforma que cobra clases es comercial → probablemente exige plan de pago |
| **Cloudflare Pages / Workers** | generoso, sin sleep | Next.js completo requiere adaptador (`@opennextjs/cloudflare`); revisar compatibilidad con Next 16 y con `proxy.ts` |
| **Render** (web service gratuito) | 750 h/mes | se duerme a los 15 min |
Recomendación: Cloudflare Pages/Workers si se acepta el adaptador; si no, el frontend puede seguir en Railway (consume poco) mientras se mueve el backend.

### Backend (FastAPI + scheduler + WS)
| Opción | Gratis | Encaja con la app |
|---|---|---|
| **Oracle Cloud Always Free (VM)** | VM(s) ARM/AMD siempre encendidas; las fuentes citan 4 OCPU/24 GB y otras una reducción a 2 OCPU/12 GB desde 2026-06-15 | **Mejor encaje técnico**: proceso siempre vivo, scheduler y WS sin problemas, RAM de sobra. Contras: pides capacidad («out of host capacity» frecuente), administras tú el servidor (Docker, HTTPS con Caddy/Traefik, actualizaciones), exige tarjeta |
| **Google Cloud Run** | cuota gratuita mensual (≈180 000 vCPU-s, 360 000 GiB-s, 2 M peticiones según una fuente), con tarjeta | Escala a cero → el scheduler y el WS **no son fiables**; habría que sacar los jobs a Cloud Scheduler y activar CPU siempre asignada (deja de ser gratis) |
| **Render (free web service)** | 750 h/mes; una fuente indica que el ancho de banda gratuito bajó a 5 GB en abril de 2026 | Se duerme a los 15 min inactivo: **rompe jobs y chat**; sirve solo para demo/staging. Truco habitual: ping externo cada 10 min (UptimeRobot) para evitar el sueño, con los 750 h/mes cubriendo un solo servicio |
| **Koyeb** | según una fuente, el plan sin tarjeta se eliminó en febrero de 2026 y exige tarjeta; duerme tras 1 h | No recomendado |
| **Fly.io** | la mayoría de fuentes: sin plan gratuito para cuentas nuevas desde 2024 | No recomendado (verificar) |
Fuentes: [Render: plataformas con free tier real 2026](https://render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026), [Hatchable: estado del hosting gratuito 2026](https://hatchable.com/articles/state-of-free-web-hosting-in-2026), [SnapDeploy: State of Free Hosting 2026](https://snapdeploy.dev/state-of-free-hosting), [FlyWP: Docker hosting gratuito 2026](https://flywp.com/blog/9769/), [Techplained: hosting gratuito 2026](https://www.techplained.com/best-free-hosting).

### Base de datos
Neon ya es externo; su plan gratuito suspende el compute por inactividad (por eso el punto 1 del ranking importa: con los jobs actuales **nunca se suspende** y consume las horas de compute). Si se reducen los jobs, el plan gratuito de Neon es más viable. Alternativa: Supabase (PostgreSQL gratuito; pausa proyectos inactivos). Comprobar cuotas actuales en sus páginas oficiales.

### Servicios de terceros con capa gratuita (no son Railway, pero también facturan)
Resend (envío de emails con tope mensual gratuito), Cloudinary (créditos gratuitos mensuales), OpenAI (sin capa gratuita estable: de pago por uso), Google Calendar API (gratuita con cuotas). Verifica los límites vigentes.

## Recomendación para esta app
1. **Sin gastar nada, producción ligera**: VM Oracle Always Free con Docker Compose (backend + frontend, o frontend en Cloudflare Pages) + Neon gratuito. Cabe el proceso único con scheduler y WS. Riesgo: capacidad/cambios de política de Oracle y mantenimiento propio.
2. **Demo/staging gratis**: Render gratuito (se duerme; aceptar arranques en frío y que los jobs no corran) + Vercel/Cloudflare + Neon gratuito.
3. **Producción de verdad con coste mínimo**: quedarse en Railway Hobby ($5/mes con $5 de uso incluido) y aplicar el orden de arreglos de arriba (pool de conexiones, intervalos del scheduler, quitar `finalize_past_classes` de los GET, topes en Chipi/TTS): es lo que más baja la factura sin migrar.

## Cambios en el código necesarios para migrar (y para ahorrar en cualquier proveedor)
- Quitar el *scheduler* del proceso web si el proveedor escala a cero: ejecutar los jobs con un cron externo (GitHub Actions programado, cron-job.org o Cloud Scheduler) llamando a endpoints protegidos con un secreto.
- Mantener **un único worker** o mover el *rate-limit* y el scheduler a algo compartido.
- `uvicorn ... --proxy-headers --forwarded-allow-ips='*'` detrás de cualquier proxy (SEC-01), y revisar `FRONTEND_URL`/CORS y `NEXT_PUBLIC_API_URL` para los nuevos dominios.
- Cookies `secure: true` y CSP (`connect-src`) deben incluir el nuevo dominio del backend.
- Reducir el tamaño máximo de subida (o subir directo a Cloudinary) si la RAM del plan gratuito es de 256–512 MB.
