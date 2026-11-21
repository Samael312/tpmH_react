# Manual de uso por rol

Describe lo que cada rol puede hacer según el código (pantallas en `frontend/doc/generated/ROUTES.md`, reglas en `backend/doc/BUSINESS_RULES.md`). **No se ha comprobado en un navegador** (la extensión de Chrome no conectó durante la auditoría): si una pantalla difiere, prevalece lo que veas y conviene corregir este documento. Los avisos ⚠ marcan fallos conocidos que afectan al usuario.

Cuentas de práctica (solo con `python -m tests.audit.run_server`): `admin`, `profe`, `alumno`, contraseña `Password123`.

---

## Alumno

### Empezar
1. **Registro** en `/register` (nombre, apellido, usuario, email, contraseña de 8–128 caracteres) o con **Google**. Rol «alumno».
2. **Onboarding** (`/dashboard/onboarding`): completa tus datos y preferencias; la zona horaria determina todas las horas que verás.
3. Olvidaste la contraseña o el usuario: `/forgot-password` (recibes un email, el enlace es de un solo uso y caduca).

### Reservar tu primera clase con un profesor
1. `/dashboard/teachers` → elige un profesor y abre su perfil (vídeo, idiomas, paquetes, reseñas).
2. `/dashboard/schedule` → selecciona profesor y un horario libre. Tu primera clase con **cada** profesor es una **clase de prueba** (25 min por defecto, no consume paquete).
3. Recibes un email de confirmación; el profesor, otro de aviso. Unos 30 min antes se genera el enlace de **Google Meet** (aparece en la tarjeta de la clase) y 24 h antes llega un recordatorio.

### Comprar un paquete
1. Tras completar la prueba, la pantalla te pide elegir **paquete** (N clases, o ilimitado con créditos prepagados; algunos permiten **pagar en cuotas**).
2. Elige método de pago (transferencia, PayPal, Binance o pago móvil, según lo que esté habilitado) y **paga fuera de la plataforma** con los datos que se muestran.
3. Pulsa **notificar pago** e indica la referencia. Queda «pendiente de revisión».
4. El profesor o el administrador lo **aprueba** (recibes el recibo por email) o lo **rechaza** con un motivo (verás el motivo y podrás reintentar).
5. Con el pago aprobado tienes créditos para agendar. En cuotas, cada cuota aprobada desbloquea parte de los créditos.

### Agendar, cancelar y reagendar
- **Agendar**: `/dashboard/schedule`; cada clase ocupa un crédito al reservar. No puedes reservar con menos de 1 h de antelación ni solapar tus clases.
- **Cancelar**: hasta **12 h antes** se devuelve el crédito; con menos de 12 h no se permite. Si cancela el profesor, siempre se devuelve.
- **Reagendar**: también con 12 h de antelación y hasta 2 veces por clase (la ventana muestra cuántos te quedan; al agotarlos, pide al profesor que la mueva o cancela con 12 h);  puedes elegir el mismo horario sin efecto. Una clase cancelada no se reabre (se agenda otra). Al cancelar, la ventana te muestra cuántas horas faltan y si recuperas el crédito.
- **Historial y próximas**: `/dashboard/classes`.

### Renovar o cambiar de paquete
- Cuando se agotan los créditos aparece la opción de **renovar** (mismo flujo de pago). ⚠ Hoy, renovar un paquete agotado puede dejarte sin créditos aunque el pago esté aprobado (AUD-03): contacta con soporte.
- **Cambio de paquete**: subir a uno mayor paga solo la diferencia; bajar o pedir reembolso exige indicar un medio de contacto/cobro.

### Otras secciones
Tareas (`/dashboard/homework`: entrega y nota con feedback), materiales (`/dashboard/materials`), chat con tu profesor (`/dashboard/chat`), reseñas a profesores tras clases completadas, soporte (`/dashboard/support`), perfil (`/dashboard/profile`: datos, zona horaria, contraseña, foto) y el asistente **Chipi** (botón flotante) para dudas sobre la plataforma.

### Borrar la cuenta
En el perfil, escribiendo tu usuario. ⚠ El aviso habla de borrado total, pero el sistema **anonimiza** y conserva pagos y clases por contabilidad.

---

## Profesor

### Alta y aprobación
1. Regístrate como **profesor** (nace en estado `pending`).
2. Completa el **onboarding** (`/teacher/onboarding`): perfil, título, idiomas/asignaturas, **vídeo de presentación**, zona horaria y disponibilidad.
3. Un administrador te **aprueba** (email de resultado). Hasta entonces no recibes reservas. Si te suspenden, tus alumnos con paquete quedan «congelados».
4. **Cambiar tu vídeo** (`/teacher/profile`): si ya estás aprobado, el vídeo nuevo queda «en revisión» y el actual sigue visible hasta que el staff lo apruebe. Si lo rechaza, recibes aviso con el motivo y conservas el anterior; puedes **apelar una vez** desde el mismo bloque de vídeo o subir otro.

### Disponibilidad
`/teacher/availability`: horario semanal por día y **excepciones** (vacaciones/bloqueos). El horario semanal es en **tu hora local** y se mantiene así todo el año: «18:00-20:00» sigue siendo 18:00-20:00 aunque cambie la hora de verano, y si cambias tu zona horaria en el perfil conserva esas mismas horas locales (no se «recalcula»). Una franja que cruza la medianoche (p. ej. 22:00-01:00) termina al día siguiente; la hora que no existe el día del cambio de primavera se salta. Los alumnos solo ven horas libres que no choquen con tus clases (con margen de 5–10 min). ⚠ El servidor no obliga a respetar tu disponibilidad si alguien salta la interfaz (AUD-01).
Opcional: **conectar Google Calendar** (`/teacher/profile` o panel de calendario): se sincronizan tus clases y se importan eventos externos (p. ej. otras plataformas) como bloqueos.

### Paquetes y precios
`/teacher/packages`: crea paquetes finitos (nº de clases, precio total, **precio por clase** obligatorio y coherente: `precio por clase × nº = precio`), ilimitados (créditos prepagados), y cuotas opcionales. Puedes activar/desactivar.

### Clases del día a día
`/teacher/dashboard` y la agenda: próximas clases con enlace de Meet.
- **Confirmar** pruebas pendientes.
- Tras la clase, márcala **completada** o **no_show** (hasta 72 h después del fin). Las clases «finalizadas» sin marcar quedan en limbo y el alumno no puede reseñar; la tarjeta te avisa de cuánto tiempo queda antes de que pasen solas a «No asistió». Si una pasa sola, te llega un aviso en **Avisos** (menú lateral) con el detalle; desde la clase puedes pedir la corrección a soporte.
- **Cancelar** una clase: siempre devuelve el crédito al alumno y le avisa. No se puede cancelar una clase ya dada o pasada: márcala completada o no asistida (hasta 72 h después). Si una prueba termina sin que la confirmes, recibes un aviso y tienes 72 h para marcarla; pasado ese plazo pasa a «No asistió».
- **Reagendar** acordando con el alumno.

### Pagos y dinero
- `/teacher/payments`: aprueba o rechaza (con motivo) los pagos de **tus** alumnos.
- `/teacher/wallet`: saldo disponible, total ganado y retirado. Tu parte es el pago menos la **comisión** (15 % por defecto, la fija la plataforma por profesor).
- **Solicitar retiro**: indica el método de cobro; solo un retiro pendiente a la vez, nunca más que tu saldo (la interfaz pide mínimo $10). El administrador lo paga fuera de la plataforma y lo marca completado (con referencia) o lo rechaza con motivo (te devuelve el saldo); ambos datos los ves en el historial de retiros. Para dar un paquete gratis a un alumno (beca o pago recibido fuera) usa «Pedir paquete gratis» en Mis Paquetes: el staff la aprueba o rechaza y te avisa.

### Grupos, tareas y materiales
- **Cohortes** (`/teacher/cohorts`): crea grupos con mínimo/máximo de alumnos, cierra con los inscritos actuales o cancela (se liberan cupos y se cancelan las sesiones futuras).
- **Tareas** (`/teacher/homework`) y **materiales** (`/teacher/materials`: documentos hasta 10 MB y vídeos hasta 100 MB; ⚠ PowerPoint desde navegador puede fallar).
- **Alumnos** (`/teacher/students`), **chat** y **soporte**.

---

## Administrador (`superadmin`; `teacher_admin` = profesor con panel)

> Un `teacher_admin` ve el panel pero **no puede** cambiar el modo de plataforma ni el profesor destacado, los correos, moderar chats, reagendar o borrar clases ajenas, ni crear pagos en Modo Dios; tampoco procesa su propio retiro ni valida sus propios pagos. Eso lo hace el `superadmin`. **Sí puede** editar los datos de pago (Configuración > Pagos), banear/desbanear alumnos, cambiar el estado de profesores y editar usuarios (el cambio de rol es del `superadmin`).

### Rutina semanal
1. **Profesores** (`/admin/teachers`): aprobar/rechazar solicitudes, suspender, fijar la **comisión** (0–1) de cada profesor. Si un profesor aprobado subió un vídeo nuevo verás «Video nuevo pendiente» en su detalle: **Aprobar** (sustituye al anterior) o **Rechazar** con motivo. Si el profesor apela un vídeo rechazado, la apelación aparece en su detalle (resuélvela: aprobar promueve el vídeo, rechazar lo descarta). Un `teacher_admin` no puede revisar su propio vídeo ni resolver apelaciones sobre su perfil.
2. **Pagos** (`/admin/payments`): revisar pagos pendientes y aprobarlos/rechazarlos (con confirmación); los reembolsos se gestionan aquí. La pestaña **Paquetes gratis** lista las solicitudes de los profesores: apruébalas o recházalas con motivo. ⚠ Un reembolso no descuenta la billetera del profesor (AUD-14).
3. **Retiros**: procesar solicitudes (completar con referencia o rechazar con motivo). ⚠ El listado de retiros pendientes da 404 hoy (AUD-12): consulta la tabla `withdrawals` hasta corregirlo.
4. **Soporte** (`/admin/support`): responder tickets (el usuario recibe email).
5. **Logs** (`/admin/logs`): errores de backend y frontend.

### Configuración (`/admin/settings`)
Reglas de negocio (antelación mínima, ventanas de cancelación y reagendado, duraciones permitidas, márgenes entre clases, umbral de «pocos créditos», retención del chat), métodos de pago y sus datos, contenido del landing, activar/desactivar el chat, modo un solo profesor.

### Usuarios y emergencias
- `/admin/users`, `/admin/students`, `/admin/students/banned`: ver, activar/desactivar y **banear** (un baneado no puede iniciar sesión ni usar tokens existentes).
- **God Mode** (`/admin/god-mode`): editar directamente clases, pagos, inscripciones, créditos… exige **motivo** y deja auditoría; `teacher_admin` solo puede tocar sus propios datos. Úsalo para corregir casos como la renovación fallida o créditos mal calculados.
- `/admin/chat`: lectura de conversaciones para moderación (solo `superadmin`).
- `/admin/flow-tester`: solo desarrollo (lanza pruebas; bloqueado con `ENVIRONMENT=production`).

---

## Errores y situaciones típicas (para soporte)

| Lo que cuenta el usuario | Causa habitual | Qué hacer |
|---|---|---|
| «No puedo cancelar» | faltan menos de 12 h | pedir al profesor que cancele (siempre devuelve crédito) |
| «Pagué y no puedo agendar» | pago aún en revisión o renovación afectada por AUD-03 | aprobar el pago; si ya está aprobado, ajustar créditos con God Mode |
| «No me llega el email» | spam, o servicio de email no configurado | revisar Resend y logs |
| «No veo horarios» | el profesor no tiene disponibilidad o no está aprobado | revisar disponibilidad/estado |
| «Me da error al entrar con Google» | cuenta creada con contraseña y sin Google (o `redirect_uri_mismatch`) | entrar con usuario y contraseña; revisar Google Cloud |
| «Mi clase no aparece como completada» | el profesor no la marcó (estado `finalized`) | pedir al profesor que la marque |
| «Me cierra la sesión» | el token caducó (7 días) o dio 401 | iniciar sesión de nuevo |
