# Prueba de carga (`backend/tests/load/`, Fase 14 · E5)

Simula alumnos y visitantes contra el backend real y una base de datos Neon de
**desarrollo**. Sirve para medir en vez de estimar: latencia por endpoint,
peticiones por segundo, errores bajo carga y, sobre todo, **consultas SQL por
petición**, que no dependen de desde dónde se lance la prueba.

> **Escribe en la base de datos del `backend/.env`** (usuarios `lt_`, reservas,
> pagos aprobados, mensajes de chat). `app/db/base.py` hace
> `load_dotenv(override=True)`, así que manda la URL del `.env`, no la del
> entorno. Todos los scripts se niegan a arrancar si `LOADTEST_DB_HOST` no
> coincide con el host de esa URL: compruébalo antes en Neon (rama `dev`, no la
> principal).

## Qué hace

| Archivo | Para qué |
|---|---|
| `common.py` | Guard de la BD (`LOADTEST_DB_HOST`), anulación del envío de correos, constantes (`lt_`, contraseña). |
| `seed.py` | Crea (idempotente) `lt_admin`, N profesores aprobados con 24 h de disponibilidad y un paquete de 200 clases, y M alumnos. A cada alumno sin paquete le pasa por el flujo real (prueba → confirmada → completada → compra del paquete → aprobación) con la app en proceso. Usa el primer método de pago habilitado en esa BD, sin cambiar la configuración. Escribe `.seed.json`. |
| `run_server.py` | Arranca el backend igual que en Railway (1 worker, `--proxy-headers`) pero sin correos y con `profiling.py`. |
| `profiling.py` | Cuenta consultas SQL y ms de BD por ruta → `results/queries.csv` (cada 10 s). Solo en este servidor. |
| `locustfile.py` | `Student` (peso 4): login una vez y luego dashboard, huecos, chat y reservar + cancelar. `Visitor` (peso 1): landing y perfiles públicos. |
| `cleanup.py` | Borra las clases canceladas y los mensajes de chat de los usuarios `lt_`. Los usuarios se quedan para la siguiente corrida. Para borrarlo todo, resetea la rama de Neon. |

Cada usuario simulado manda su propio `X-Forwarded-For`, como un usuario real
detrás del proxy de Railway. Si no, todos compartirían el límite general por
IP (200/min) y el de login (10/min) y la prueba mediría los 429.

Las reservas que chocan (400/409) cuentan como correctas en la fila
`book (choque)`: es el servidor rechazando bien. Cada reserva se cancela al
momento (más de 3 días vista, sin penalización) para no agotar el paquete.

## Cómo correrla

Desde `backend/`, con el venv del proyecto (en Git Bash; en PowerShell usa
`$env:LOADTEST_DB_HOST = "..."`):

```bash
pip install -r tests/load/requirements.txt
export LOADTEST_DB_HOST=<host de DATABASE_URL en .env>   # p. ej. ep-xxx-pooler.c-3.us-west-2.aws.neon.tech

python -m tests.load.seed 30 3              # alumnos, profesores (la 1.ª vez tarda: ~25 s por alumno desde Europa)
python -m tests.load.run_server 8001        # en otra terminal; Ctrl+C al terminar

locust -f tests/load/locustfile.py --host http://127.0.0.1:8001 \
    --headless -u 20 -r 2 -t 3m --csv tests/load/results/run
# o sin --headless para la interfaz web en http://localhost:8089

python -m tests.load.cleanup
```

Resultados en `tests/load/results/` (ignorado por git): `run_stats.csv`
(latencias y percentiles por endpoint), `run_failures.csv` y `queries.csv`.
`queries.csv` acumula desde que arrancó el servidor: reinícialo entre corridas
que quieras comparar.

Variables útiles del servidor (no están en `.env`, así que el entorno sí
manda): `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` (5 / 5), `SLOW_REQUEST_MS`.

## Resultados del 2026-11-19

Portátil en España → Neon `us-west-2` (endpoint *pooled*), 10 alumnos y 2
profesores sembrados, 3 min por corrida, 0 errores en todas.

**Consultas por petición** (1 usuario; cada consulta cuesta ~220 ms de red desde aquí):

| Endpoint | Consultas | Comentario |
|---|---|---|
| `POST /payments/book` | 29 | la más cara; ~7 s desde Europa |
| `GET /users/me/teachers` | 11 | |
| `GET /payments/booking-status` | 11 | |
| `DELETE /classes/{id}` (cancelar) | 11 | |
| `GET /availability/{username}/slots` | 10 | sin acierto de caché (fecha al azar); con acierto (E3), solo las de auth y reglas |
| `GET /chat/conversations` | 9 | |
| `POST /chat/.../messages` | 9 | |
| `GET /packages/my-enrollments` | 8 | |
| dashboard completo del alumno (8 peticiones) | ~43 | |

Tras E9 (mismo día, medido en `tests/audit`): reservar 29 → 25, `/users/me/teachers` 11 → 8, `/payments/booking-status` 11 → 10 (la configuración de plataforma se lee una vez por petición y la etapa de reserva hace 2 consultas en vez de 3-6).
| `GET /users/me` | 1 | |

**Saturación por el pool de conexiones** (mediana en ms):

| Endpoint | 1 usuario | 20 usuarios, pool 10 (por defecto) | 20 usuarios, pool 30 |
|---|---|---|---|
| `GET /users/me` | 630 | 1700 | 620 |
| `GET /classes/my-classes` | 1200 | 2600 | 1300 |
| `GET .../slots` | 2400 | 3600 | 2500 |
| `POST /payments/book` | 7000 | 8500 | 7100 |
| **Todas** | 1700 | 2900 (4,9 req/s) | 1300 (7,2 req/s) |

Conclusión: con 20 usuarios el límite no es la CPU ni el worker único: es el
pool de 10 conexiones (`DB_POOL_SIZE=5` + `DB_MAX_OVERFLOW=5`), porque cada
petición retiene su conexión mientras hace sus consultas y cada consulta tarda
lo que tarda la red hasta Neon. Con 30 conexiones la latencia vuelve a la de un
solo usuario. Cuánto importa en producción depende de la distancia entre
Railway y Neon, que desde aquí no se ve: con ambos en la misma región cada
consulta cuesta milisegundos, no 220 ms. Hay que repetir la prueba desde un
servicio en la región de Railway y mirar `Server-Timing` en producción.

## Límites

- La latencia absoluta mide la red de quien lanza la prueba; compara corridas
  hechas desde el mismo sitio, o mira `queries.csv`.
- No usa WebSocket: el chat va por la ruta REST de reserva (`POST .../messages`).
- No cubre profesores ni admin bajo carga, ni Chipi (cuesta OpenAI).
- La CDN (B4) no existe todavía, así que el `Cache-Control` de E4 solo lo
  aprovecharía un navegador; Locust no cachea.
