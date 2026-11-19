# CORE_FUNCTIONS (generado)

Funciones y clases de nivel módulo en `app/core`, `app/auth` y `app/db`.
Las que empiezan por `_` son privadas del módulo.


## app/core/cache.py

- `cache_get(key: str)` — L20
- `cache_set(key: str, value: Any, ttl_seconds: float)` — L32
- `cache_invalidate(key: str)` — L37
- `cache_invalidate_prefix(prefix: str)` — L42
- `cached(key: str, ttl_seconds: float, loader: Callable[[], Any])` — L48: Devuelve el valor cacheado si sigue vigente; si no, lo recalcula con `loader`, lo guarda y lo devuelve.

## app/core/calendar_sync.py

- `_get_teacher_calendar_service(teacher_id: int, db: Session)` — L19: Devuelve (service, calendar_id) para el profesor, o (None, None) si no tiene Calendar conectado/activo o el token necesita reconexión. Nunca lanza — el flujo de reserva de clases debe seguir funcionando aunque Calendar esté desconectado o roto.
- `_teacher_attendee_emails(class_: Class)` — L42: El profesor queda como invitado explícito del evento (sin correo de invitación, ver sendUpdates="none" en core/google_calendar.py) para que Google Meet lo reconozca siempre como participante autorizado y pueda entrar a la videollamada sin pedir permiso — incluso si abre el link desde una cuenta/sesi
- `sync_class_created(class_: Class, db: Session)` — L55
- `sync_class_updated(class_: Class, google_event_id: str, db: Session)` — L77
- `generate_meet_link_for_class(class_: Class, db: Session)` — L95: Genera automáticamente un link de Google Meet real para la clase, usando el Google Calendar del profesor. Se usa desde el job programado que corre ~30 minutos antes del inicio de cada clase (ver core/scheduler.py::generate_upcoming_meet_links).
- `sync_class_cancelled(teacher_id: int, google_event_id: str, db: Session)` — L145

## app/core/chat.py

- `class ChatSettings()` — L41
- `get_chat_settings(db: Session)` — L46
- `invalidate_chat_settings()` — L53
- `assert_chat_enabled(db: Session)` — L57: Bloquea a nivel backend el chat cuando el superadmin/teacher_admin lo desactivó desde /admin/settings — no basta con ocultarlo en el UI, porque alguien podría pegar la URL o abrir el WS directo.
- `assert_chat_enabled_ws(db: Session)` — L72: Misma validación que assert_chat_enabled pero sin levantar HTTPException (dentro de un WebSocket ya aceptado no tiene sentido — el caller cierra el socket con un código explícito). Devuelve None si está deshabilitado.
- `_teacher_has_student(teacher: TeacherProfile, student_id: int)` — L82: Fuente de verdad del vínculo directo profesor-alumno en AMBOS modos (single y multi-tenant): TeacherProfile.students (JSONB), poblada por core/teacher_students.py::link_student_to_teacher. StudentTeacherLink NO sirve para esto — queda vacía en single-tenant (ver su docstring y payments.py::_ensure_t
- `_cohort_participant_ids(db: Session, cohort_id: int)` — L93: IDs de StudentProfile con Enrollment (activo o pendiente) en la cohorte.
- `get_direct_conversation_or_404(db: Session, current_user: User, other_username: str)` — L102: Resuelve (creando si hace falta) la conversación 1:1 entre el usuario actual y `other_username`.
- `ensure_direct_conversation(db: Session, student_id: int, teacher_id: int)` — L154: Wrapper público de `_get_or_create_direct` para llamarse desde fuera de este módulo (ver core/teacher_students.py::link_student_to_teacher) sin tocar un nombre "privado". Idempotente: no crea duplicados si ya existe.
- `_get_or_create_direct(db: Session, student_id: int, teacher_id: int)` — L163
- `get_group_conversation_or_404(db: Session, current_user: User, cohort_id: int)` — L182
- `assert_participant(db: Session, current_user: User, convo: ChatConversation)` — L217: Re-valida pertenencia contra una conversación ya existente (para el WS y para /messages).
- `conversation_participant_user_ids(db: Session, convo: ChatConversation)` — L240: User.id de todos los participantes — para el broadcast por WS. Una sola consulta por conversación.
- `_conversation_filter(current_user: User)` — L259: Condición SQL «conversaciones en las que participa este usuario», o None si su rol no tiene chat.
- `conversation_ids_subquery(current_user: User)` — L300
- `with_display_relations(query)` — L305: Carga en bloque lo que muestra la lista (nombre y avatar del otro, paquete del grupo): sin esto, cada conversación hacía 2-3 consultas perezosas.
- `conversations_page_for_user(db: Session, current_user: User, offset: int, limit: int)` — L315: (total, página) paginando en SQL. Antes se cargaban TODAS las conversaciones y se cortaba en Python.
- `list_conversations_for_user(db: Session, current_user: User)` — L331
- `get_messages(db: Session, convo: ChatConversation, before_id: Optional[int]=None, after_id: Optional[int]=None, limit: int=50)` — L338: - Sin `before_id` ni `after_id`: los últimos `limit` (historial inicial). - `before_id`: página hacia atrás (scroll-up / "cargar más antiguos"). - `after_id`: SOLO los mensajes nuevos desde el último que el cliente   ya tiene cacheado (ver frontend/store/chatStore.ts) — evita   volver a traer los 50
- `mark_read(db: Session, convo: ChatConversation, user: User)` — L364
- `_unread_query(db: Session, user_id: int, conversation_ids)` — L389: Mensajes ajenos posteriores a la última lectura del usuario (o todos si nunca abrió la conversación). `conversation_ids` puede ser una lista o una subconsulta.
- `unread_counts(db: Session, user_id: int, conversation_ids: list[int])` — L405: {conversation_id: no leídos} en UNA consulta (antes: 2 por conversación).
- `get_unread_count_for_user(db: Session, current_user: User)` — L412: Suma de mensajes no leídos en todas las conversaciones del usuario: una consulta.
- `find_message_by_client_id(db: Session, conversation_id: int, sender_id: int, client_id: Optional[str])` — L422
- `send_message(db: Session, config: ChatSettings, convo: ChatConversation, sender: User, content: str, client_id: Optional[str]=None)` — L434: Persiste el mensaje y determina si corresponde disparar el email de aviso al profesor (solo cuando el remitente es un estudiante y la conversación estaba inactiva por más de chat_reactivation_hours, o es el primer mensaje de la conversación).
- `mark_delivered_by_id(db: Session, message_id: int)` — L503: UPDATE atómico de una sola query: devuelve el instante si ESTA llamada fue la que marcó el mensaje como entregado, None si ya lo estaba.
- `catch_up_deliveries(db: Session, user: User)` — L516: Al conectarse (o reconectarse) el socket global de `user`, cualquier mensaje QUE LE HAYAN MANDADO A ÉL en cualquiera de sus conversaciones y que siguiera sin `delivered_at` (porque no estaba online cuando se envió) pasa a estar entregado en este instante.
- `purge_old_messages(db: Session, retention_days: int)` — L555: Borra mensajes más viejos que `retention_days`. 0 = sin límite (no borra nada).

## app/core/chat_digest.py

- `next_due(db: Session)` — L28: Cuando hay que enviar el siguiente resumen (None si no hay avisos pendientes).
- `_unread_from_others(db: Session, convo: ChatConversation, teacher_user_id: int)` — L34: Mensajes de otros que el profesor aun no leyo y el ultimo de ellos.
- `send_pending_digests(db: Session, now: Optional[datetime]=None)` — L45: Envia un correo por profesor con sus conversaciones pendientes vencidas. Devuelve cuantos correos pidio enviar.

## app/core/chat_ws.py

- `class ChatConnectionManager()` — L44

## app/core/class_logic.py

- `is_within_teacher_availability(teacher_id: int, start_utc: datetime, end_utc: datetime, db: Session)` — L27: Verifica que [start_utc, end_utc) caiga dentro de un bloque de disponibilidad declarado por el profesor (horario semanal recurrente + excepciones puntuales de disponibilidad extra), y que no choque con una excepción de bloqueo puntual (vacaciones, feriado, etc).
- `validate_payment_method(payment_method: str, db: Session)` — L109: Correcciones Extra (informe D1-D14): el método de pago que indica el estudiante al notificar un pago tiene que ser uno de los métodos que el admin tiene efectivamente habilitados en ese momento (no alcanza con que sea una de las 4 claves conocidas -- si el admin apagó "bank_transfer", ya no es un mé
- `get_price_per_class(package)` — L139: Correcciones Extra (informe D1-D14): precio de una clase suelta dentro de `package`. Usa el campo `price_per_class` guardado a mano por el profesor si existe; si es un paquete creado antes de que ese campo existiera (queda NULL), cae al cálculo derivado de siempre (price/classes_count) para no rompe
- `get_business_rules(db: Session)` — L155: Lee las reglas de negocio configuradas por el superadmin desde PlatformConfig. Si no hay fila aún, cae a los defaults de arriba.
- `validate_class_duration(duration_minutes: int, db: Session)` — L207: Valida una duración de clase REGULAR contra el subconjunto configurado por el superadmin. No aplica a trial (ver get_trial_duration_minutes, que no es una elección del usuario sino un valor fijo de config).
- `validate_package_duration(duration_minutes: int, db: Session)` — L218: Valida la duración de clase de un PAQUETE contra el subconjunto configurado por el superadmin (allowed_package_durations) — catálogo independiente de allowed_class_durations, aunque hoy comparten el mismo pool fijo (CLASS_DURATION_OPTIONS).
- `get_buffer_minutes_for_type(class_type, db: Session)` — L230: Minutos de margen que se descuentan del final real de una clase de este tipo, según la config vigente. `class_type` puede ser un ClassType o su valor string ("trial" | "regular" | "group").
- `lock_booking_rows(db: Session, teacher_id: int, student_id: int | None=None)` — L247: Serializa las reservas concurrentes tomando un lock de fila (SELECT ... FOR UPDATE) sobre el alumno y luego el profesor (siempre en ese orden, para evitar deadlocks). Sin esto, dos requests simultaneos leen la agenda/creditos antes de que el otro haga commit y ambos pasan los chequeos (doble reserva
- `lock_class_row(db: Session, class_id: int)` — L263: Recarga la clase con lock de fila para que dos cancelaciones simultaneas no devuelvan el credito dos veces.
- `can_book_slot(start_time_utc: datetime, teacher_id: int, student_id: int, end_time_utc: datetime, db: Session, exclude_class_id: int=None, enforce_min_not)` — L268
- `can_join_group_class(class_: Class, db: Session)` — L415: Chequeo de cupo para una sesión grupal ya creada (Class con class_type == "group"): ¿hay lugar para un alumno más? Complementa a can_book_slot, que ya valida antelación mínima y que ni el alumno ni el profesor tengan otro compromiso en ese horario.
- `can_cancel_class(class_: Class, requesting_user_id: int, db: Session)` — L441
- `can_reschedule_class(class_: Class, role: str, db: Session)` — L463
- `resolve_status_after_reschedule(class_: Class)` — L503: Determina el status que debe quedar una clase tras reagendarla.
- `update_enrollment_counter(enrollment_id: int, delta: int, db: Session)` — L527: Actualiza el contador de clases usadas en un enrollment. delta=1 cuando se completa una clase delta=-1 cuando se cancela una clase completada
- `get_student_booking_stage(student_id: int, teacher_id: int, db: Session, *, heal: bool=True)` — L556: Determina la etapa de reserva del estudiante CON UN PROFESOR ESPECÍFICO. Cada relación estudiante-profesor es independiente: completar la prueba con un profesor no exime de la prueba con otro.
- `release_stale_unpaid_enrollments(db: Session, older_than_hours: int=STALE_UNPAID_ENROLLMENT_HOURS)` — L695: Cancela los enrollments individuales activos que nunca se pagaron ni tienen un pago en revision y tienen mas de `older_than_hours` horas. Es lo que antes hacia, en un GET, `get_student_booking_stage`. Los de cohorte (grupales) no se tocan.
- `notify_teachers_auto_no_show(db: Session, classes: list[Class])` — L731: Fase 13 (A9): avisa a cada profesor (campana «Avisos», sin correo) de las clases que pasaron solas a `no_show` por no marcarlas en 72 h. UNA notificacion por profesor y pasada del job, aunque sean varias clases (si el job estuvo caido no se le inunda). No hace commit: va en la misma transaccion que 
- `finalize_past_classes(db: Session)` — L771: Marca como 'finalized' las clases confirmadas cuyo horario ya terminó, y como 'no_show' las que nunca se confirmaron/pagaron y ya pasó su hora. Actualiza también el contador de clases usadas del paquete, ya que estos estados cuentan contra el cupo del estudiante.
- `class_counts_towards_package(class_status: str, start_time_utc: datetime, reference_time: datetime | None=None, apply_late_cancel_penalty: bool=True, min_cancel_hours: i)` — L839: Determina si una clase en este estado debe contarse contra el paquete del estudiante (classes_used).
- `sync_student_lifetime_class_counter(class_: 'Class', old_status: str, new_status: str, db: Session)` — L882: Mantiene StudentProfile.total_completed_classes al día cada vez que el status de una Class entra o sale de LIFETIME_COUNTING_STATUSES.
- `count_completed_classes_with_teacher(db: Session, teacher_id: int, student_id: int)` — L930: Cuántas clases completó un alumno con un profesor puntual (individuales + grupales, status 'completed'). A diferencia del contador de por vida de StudentProfile, este número es específico del par profesor-alumno y no incluye 'no_show' — usa el mismo criterio que la elegibilidad para dejar una reseña
- `cancel_class_and_refund(class_: 'Class', db: Session, apply_late_cancel_penalty: bool)` — L957: Marca la clase como cancelada y devuelve el crédito al estudiante si corresponde. Centraliza la lógica que antes estaba duplicada en los 3 endpoints de cancelación (estudiante, profesor, admin).

## app/core/config.py

- `class Settings()` — L7

## app/core/email.py

- `_detail_row(label: str, value: str)` — L31
- `_detail_table(rows: list[str])` — L39
- `_cta_button(text: str, url: str)` — L46
- `_badge(text: str, color: str)` — L59
- `_base_template(preheader: str, badge_html: str, heading: str, body_html: str)` — L68
- `_get_email_executor()` — L125
- `shutdown_email_queue(wait: bool=True)` — L133: Al apagar el servidor: deja salir los correos que estaban en cola (main.py::lifespan).
- `_send(to_email: str, subject: str, html: str, category: str='essential')` — L142: Pone el correo en cola y vuelve al instante (Fase 14, E1): la peticion ya no espera a Resend. Devuelve True si quedo en cola; si sale, se omite o falla se anota igual en email_log desde el hilo de envio. Ningun llamador usa el valor devuelto. Con EMAIL_ASYNC=false se envia en linea y devuelve el res
- `_send_now(to_email: str, subject: str, html: str, category: str='essential')` — L158: Unico punto de salida de correos. Antes de enviar consulta el control de la Fase 7 (core/email_settings.py): categoria apagada, limite diario o modo ahorro -> se omite y se anota. Si el control o el contador fallan, el correo SALE igual (nunca se pierde un correo por un fallo de conteo).
- `send_password_reset_email(to_email: str, user_name: str, reset_token: str)` — L208
- `send_verification_email(to_email: str, user_name: str, verify_token: str)` — L220
- `send_username_recovery_email(to_email: str, user_name: str, username: str)` — L232
- `send_welcome_email(to_email: str, user_name: str, role: str)` — L246
- `_duration_and_buffer_rows(duration_minutes: int, buffer_minutes: int=0)` — L269
- `send_class_booking_confirmation(to_email: str, student_name: str, teacher_name: str, subject: str, class_start_local: str, duration_minutes: int, is_trial: bool=False, buff)` — L280
- `send_class_rescheduled_student_email(to_email: str, student_name: str, teacher_name: str, old_start_local: str, new_start_local: str, changed_by: str)` — L301
- `send_class_reminder_email(to_email: str, student_name: str, teacher_name: str, subject: str, class_start_local: str, hours_before: int=24)` — L318
- `send_cohort_ended_email(to_email: str, student_name: str, package_name: str, reason: str, credit_returned: bool | None=None)` — L337: Para cuando una cohorte grupal termina y el alumno queda libre de elegir un nuevo paquete — a diferencia de una clase cancelada (que tiene una fecha/hora puntual), acá lo que se cancela es la cohorte completa, así que esta plantilla NO reutiliza el campo "Fecha y hora" de send_class_cancelled_email 
- `send_class_cancelled_email(to_email: str, student_name: str, class_start_local: str, cancelled_by: str, reason: str | None=None, credit_returned: bool | None=None)` — L367
- `send_class_no_show_email(to_email: str, student_name: str, class_start_local: str)` — L388
- `send_homework_graded_email(to_email: str, student_name: str, homework_title: str, score: float, feedback: str | None)` — L399
- `send_material_assigned_email(to_email: str, student_name: str, teacher_name: str, material_title: str, category: str)` — L415
- `send_payment_receipt_email(to_email: str, student_name: str, concept: str, amount: float, payment_method: str, transaction_reference: str | None=None)` — L430
- `send_payment_failed_email(to_email: str, student_name: str, concept: str, amount: float, rejection_reason: str)` — L449
- `send_teacher_status_update_email(to_email: str, teacher_name: str, new_status: str, reason: str | None=None)` — L469
- `send_support_ticket_response_email(to_email: str, user_name: str, subject: str, admin_response: str, portal_path: str)` — L490
- `send_new_booking_teacher_email(to_email: str, teacher_name: str, student_first_name: str, student_last_name: str, student_nationality: str | None, student_phone: str | Non)` — L503
- `send_class_rescheduled_teacher_email(to_email: str, teacher_name: str, student_name: str, old_start_local: str, new_start_local: str, changed_by: str)` — L526
- `send_class_reminder_teacher_email(to_email: str, teacher_name: str, student_name: str, subject: str, class_start_local: str, hours_before: int=24)` — L543
- `send_class_reminders_teacher_digest_email(to_email: str, teacher_name: str, items: list[tuple[str, str, str]], hours_before: int=24)` — L561: Un solo correo con TODAS las clases que el profesor tiene en la ventana de recordatorio, en vez de uno por clase. `items`: (alumno, materia, fecha y hora local).
- `send_chat_digest_teacher_email(to_email: str, teacher_name: str, items: list[tuple[str, int, str]], conversation_url: str)` — L579: Un solo correo con los mensajes nuevos de varias conversaciones, en vez de uno por alumno. `items`: (alumno, mensajes sin leer, vista previa del ultimo).
- `send_class_cancelled_teacher_email(to_email: str, teacher_name: str, student_name: str, class_start_local: str, cancelled_by: str, reason: str | None=None)` — L598
- `send_homework_submitted_email(to_email: str, teacher_name: str, student_name: str, homework_title: str, submitted_at_local: str)` — L616
- `send_new_review_received_email(to_email: str, teacher_name: str, student_name: str, rating: float, comment: str | None)` — L631
- `send_withdrawal_requested_teacher_email(to_email: str, teacher_name: str, amount: float, destination_method: str)` — L645
- `send_withdrawal_processed_email(to_email: str, teacher_name: str, status: str, amount: float, reference: str | None=None, rejection_reason: str | None=None)` — L661
- `send_admin_new_support_ticket_email(to_email: str, user_name: str, user_role_label: str, category_label: str, subject: str, message: str)` — L685
- `send_admin_new_teacher_pending_email(to_email: str, teacher_name: str, teacher_email: str, subjects_or_languages: list[str])` — L701
- `send_admin_payment_pending_email(to_email: str, student_name: str, amount: float, concept: str, payment_method: str, transaction_reference: str | None=None)` — L717
- `send_admin_withdrawal_requested_email(to_email: str, teacher_name: str, amount: float, destination_details: str)` — L738
- `send_package_expiring_email(to_email: str, student_name: str, package_name: str, classes_remaining: int)` — L753
- `send_new_chat_message_teacher_email(to_email: str, teacher_name: str, student_name: str, message_preview: str, conversation_url: str)` — L770
- `send_class_confirmed_email(to_email: str, student_name: str, teacher_name: str, subject: str, class_start_local: str, duration_minutes: int, buffer_minutes: int=0)` — L784
- `send_class_confirmed_teacher_email(to_email: str, teacher_name: str, student_name: str, subject: str, class_start_local: str, duration_minutes: int)` — L801

## app/core/email_settings.py

- `today()` — L89
- `_config(db: Session)` — L93
- `get_limit(cfg: PlatformConfig | None)` — L97
- `get_saver_percent(cfg: PlatformConfig | None)` — L102
- `is_category_enabled(cfg: PlatformConfig | None, category: str)` — L107
- `usage_today(db: Session)` — L114: {categoria: {sent, skipped, failed}} de hoy (UTC).
- `sent_today(db: Session)` — L128
- `saver_active(cfg: PlatformConfig | None, sent: int)` — L132: El modo ahorro esta pausando categorias ahora mismo.
- `decide(db: Session, category: str)` — L139: (enviar?, motivo si se omite). Las esenciales siempre salen.
- `record(db: Session, category: str, outcome: str, reason: str | None=None)` — L155

## app/core/error_log.py

- `is_reportable_business_error(path: str, status_code: int)` — L47
- `get_user_from_request(db: Session, request: Request)` — L53: Intenta identificar al usuario logueado a partir del header Authorization, sin lanzar nunca una excepción (se usa dentro de exception handlers, donde las Depends normales no corren).
- `log_error(source: str, level: str, message: str, detail: Optional[str]=None, screen: Optional[str]=None, method: Optional[str]=None, status_code: Opti)` — L72: Guarda un ErrorLog. Si no se pasa `db`, abre y cierra una sesión propia (necesario desde los exception handlers globales, donde no hay una sesión de request disponible vía Depends).

## app/core/god_mode_audit.py

- `log_god_mode_action(db: Session, actor: User, action: str, entity_type: str, entity_id: int, reason: str, before: Optional[dict[str, Any]]=None, after: Optional)` — L8: Registra una acción del Modo Dios. No hace commit — el caller debe incluir este `db.add` en la misma transacción que el resto de los cambios de la operación, para que el log y la mutación real vivan o mueran juntos (si algo falla y se hace rollback, no queda un log huérfano de una acción que en real

## app/core/google_calendar.py

- `get_oauth_flow()` — L57: Crea el flujo OAuth2 para conectar Google Calendar
- `get_auth_url(state: Optional[str]=None)` — L74: Genera la URL de autorización de Google. Limpia los parámetros de PKCE para evitar desajustes de 'code_verifier'.
- `exchange_code_for_tokens(code: str, code_verifier: Optional[str]=None)` — L100: Intercambia el código de autorización por tokens.
- `revoke_token(token: str)` — L115: Revoca el token de acceso en los servidores de Google
- `get_calendar_service_for_token(token: GoogleCalendarToken, db: Session)` — L132
- `_with_retries(fn, *args, **kwargs)` — L173
- `get_busy_ranges(service, calendar_id: str, time_min: datetime, time_max: datetime)` — L194
- `get_teacher_busy_ranges(teacher_id: int, time_min: datetime, time_max: datetime, db: Session)` — L232
- `list_calendar_events(service, calendar_id: str, time_min: datetime, time_max: datetime)` — L258: Trae los eventos "reales" (con título, no solo el rango busy/free) del calendario del profesor en la ventana dada. `singleEvents=True` expande eventos recurrentes en instancias individuales, cada una con su propio id — necesario para poder dedupear/actualizar por Class.google_event_id igual que hace
- `_is_own_event(event: dict)` — L302: True si el evento lo creó esta plataforma (ver create_calendar_event / create_calendar_event_with_meet, que siempre marcan extendedProperties). Estos nunca deben re-importarse como clase externa.
- `_match_external_source(event: dict)` — L313: Si el título del evento contiene alguna de las keywords configuradas en EXTERNAL_IMPORT_SOURCES, devuelve el nombre de la fuente (ej. "preply"). None si no matchea ninguna o si el evento no tiene un horario puntual (dateTime) — los eventos de todo el día (solo "date") no se importan porque Class exi
- `import_external_classes_for_teacher(teacher_id: int, service, calendar_id: str, db: Session, time_min: datetime, time_max: datetime)` — L335: Lee los eventos reales del Google Calendar del profesor (no solo freebusy) y refleja como Class(class_type="external") los que correspondan a una plataforma externa reconocida (ver EXTERNAL_IMPORT_SOURCES, hoy solo Preply, detectado por palabra en el título). Son de solo lectura desde la perspectiva
- `_build_attendees(attendee_emails: Optional[List[str]])` — L455: Arma la lista de `attendees` para el body del evento. Se usa para que el profesor quede explícitamente como invitado del evento (además de ser el dueño del calendario), de forma que Google Meet lo reconozca como participante autorizado y no le pida "Pedir unirme" al entrar. Siempre se combina con se
- `create_calendar_event(service, calendar_id: str, title: str, start_utc: datetime, end_utc: datetime, description: str='', meet_link: Optional[str]=None, attendee_)` — L469
- `_extract_meet_link(event: dict)` — L506: Saca el link de Google Meet de un evento con conferenceData.
- `create_calendar_event_with_meet(service, calendar_id: str, title: str, start_utc: datetime, end_utc: datetime, description: str='', attendee_emails: Optional[List[str]]=Non)` — L517: Crea un evento en Google Calendar generando de una vez un link de Google Meet real (conferenceData). Devuelve (event_id, meet_link); cualquiera de los dos puede venir None si falló ese paso puntual.
- `add_meet_conference_to_event(service, calendar_id: str, event_id: str, attendee_emails: Optional[List[str]]=None)` — L561: Agrega un link de Google Meet real a un evento ya existente (conferenceData). Devuelve el link generado, o None si el evento ya no existe (fue borrado externamente) o si la generación falla — en ambos casos el llamador debe manejarlo sin romper el flujo.
- `update_calendar_event(service, calendar_id: str, event_id: str, start_utc: Optional[datetime]=None, end_utc: Optional[datetime]=None, meet_link: Optional[str]=Non)` — L617
- `delete_calendar_event(service, calendar_id: str, event_id: str)` — L676
- `sync_calendar_logic(teacher_id: int, db: Session)` — L694
- `run_calendar_sync_for_all_teachers(db: Session)` — L844

## app/core/group_cohort_logic.py

- `get_cohort_active_count(cohort_id: int, db: Session)` — L12: Enrollments activos (no cancelados) inscritos en esta cohorte.
- `get_cohort_student_ids(cohort_id: int, teacher_id: int, db: Session)` — L20: StudentProfile.id de todos los integrantes activos (no cancelados) de una cohorte, validando que le pertenezca al profesor que la consulta. Usado para asignar materiales/tareas a un grupo entero de una sola vez (ver endpoints /materials/{id}/assign y POST /homework/). Devuelve [] si la cohorte no ex
- `get_enrollment_group_occupied_slots(enrollment: Enrollment, db: Session)` — L42: Equivalente a _get_enrollment_occupied_slots (payments.py) pero para enrollments grupales: las clases grupales no llevan Class.enrollment_id (una misma Class es compartida por varios alumnos), así que se cuenta vía ClassParticipant.
- `release_cohort_seat(enrollment: Enrollment, db: Session)` — L61: Libera el cupo de un alumno que migra de grupal a individual (o cuyo enrollment grupal se cancela). No hace commit — el caller decide cuándo.
- `close_cohort(cohort: GroupCohort, start_date, db: Session)` — L92: El profesor cierra la cohorte manualmente con los integrantes actuales, sin importar si llegó al mínimo definido.
- `release_and_cancel_all_cohort_enrollments(cohort_id: int, db: Session)` — L100: Libera el cupo y CANCELA cada enrollment activo de una cohorte — lógica compartida entre cancel_cohort (el profesor la aborta porque no se llenó) y complete_cohort (el paquete/las sesiones ya cumplieron su ciclo pero el grupo quedó por debajo del mínimo). En ambos casos el alumno debe quedar libre d
- `cancel_future_cohort_sessions(cohort_id: int, db: Session)` — L120: Cancela las sesiones (Class) FUTURAS que ya estaban agendadas para una cohorte que se acaba de cancelar o completar bajo el mínimo.
- `cancel_cohort(cohort: GroupCohort, db: Session)` — L147: Cancela una cohorte que no se llenó (o que el profesor decide abortar antes de que arrancara). Libera el cupo de TODOS sus enrollments activos y además CANCELA cada enrollment por completo (antes solo se liberaba el cupo y el enrollment quedaba "activo" pero sin cohorte — un estado inconsistente: el

## app/core/http_cache.py

- `set_public_cache(response: Response)` — L27

## app/core/notifications.py

- `create_notification(db: Session, type: str, title: str, message: Optional[str]=None, related_teacher_id: Optional[int]=None, related_support_ticket_id: Optional)` — L6: Crea una notificación persistente para el panel de staff. No hace commit — el caller decide cuándo confirmar la transacción (normalmente junto con el resto de cambios de la operación).
- `get_unread_count(db: Session, recipient_role: str='staff')` — L34
- `get_user_unread_count(db: Session, user_id: int)` — L41: Avisos sin leer dirigidos a un usuario concreto (Fase 13, A9).

## app/core/pagination.py

- `class Pagination()` — L12
- `paginate(query, page: Pagination, response: Response)` — L22: Aplica offset/limit a una consulta ya ordenada y anota el total en `X-Total-Count`.

## app/core/phone.py

- `normalize_phone(raw: str | None)` — L4: Normaliza un número de teléfono al formato canónico "+<código> <número>", ej. "+34 642185633".

## app/core/platform_config.py

- `get_landing_content(config: PlatformConfig)` — L71: Defaults + lo que el admin haya sobreescrito en config.landing_content. Nunca falta ninguna clave (aunque el admin solo haya guardado un subconjunto, o la fila sea vieja y landing_content sea None).
- `get_platform_config(db: Session)` — L86: La fila única de PlatformConfig, leída UNA vez por sesión (= por petición) (Fase 14, E9).
- `get_or_create_platform_config(db: Session)` — L105: Devuelve la fila (única) de configuración de plataforma, creándola con valores default si todavía no existe.
- `serialize_platform_config(db: Session, config: PlatformConfig)` — L118: Convierte PlatformConfig al dict público que ya consumía el frontend desde /admin/platform-config. Extraído para poder reutilizarlo también en el endpoint agregado de landing.
- `resolve_featured_teacher(db: Session, config: Optional[PlatformConfig]=None)` — L152: La profesora destacada: la guardada en PlatformConfig o, si no hay, FEATURED_TEACHER_USERNAME del entorno.
- `ensure_featured_teacher_in_single_tenant(db: Session, teacher_id: int)` — L171: En single-tenant solo se agenda, compra o inscribe con la destacada (400 si es otro profesor).

## app/core/rate_limit.py

- `user_or_ip_key(request)` — L27: Clave de rate-limit: el usuario autenticado (claim `sub` del JWT) o, si es anonimo / el token no es valido, la IP. Asi un usuario no comparte cupo con otros detras de la misma IP (NAT, proxy) y un anonimo no puede agotar el cupo de los demas. Un token invalido o vencido cae a la IP (no se puede fals

## app/core/request_timing.py

- `slow_request_ms()` — L26
- `class RequestTimingMiddleware()` — L33: Middleware ASGI puro (sin BaseHTTPMiddleware: no retiene ni vuelve a trocear el cuerpo).

## app/core/retention.py

- `purge_error_logs(db: Session, days: int=ERROR_LOG_RETENTION_DAYS)` — L21: Borra los registros de error mas viejos que `days` dias. Devuelve cuantos borro.
- `purge_email_log(db: Session, days: int=EMAIL_LOG_RETENTION_DAYS)` — L31: Borra las filas de `email_log` mas viejas que `days` dias (el contador diario solo usa las de hoy).
- `purge_user_notifications(db: Session, days: int=USER_NOTIFICATION_RETENTION_DAYS)` — L41: Borra los avisos dirigidos a un usuario (Fase 13, A9) ya LEIDOS y mas viejos que `days` dias. Los de staff no se tocan.

## app/core/schedule_recalc.py

- `_recalc_weekly_rows(rows, old_tz: str, new_tz: str)` — L40: Recalcula filas con day_of_week + start_time_utc/end_time_utc ("HH:MM"), preservando la hora local y recalculando el UTC para la nueva zona horaria. Devuelve un resumen de los cambios para notificar al usuario.
- `_recalc_exception_rows(rows, old_tz: str, new_tz: str)` — L88: Recalcula excepciones puntuales (fecha real + hora), preservando la fecha y hora de reloj local exactas al reinterpretarlas en la nueva zona horaria.
- `recalculate_teacher_schedule_timezone(teacher_id: int, old_tz: str, new_tz: str, db: Session)` — L126: Recalcula disponibilidad semanal + excepciones del profesor tras un cambio de zona horaria. NO hace commit.
- `recalculate_student_preferences_timezone(student_id: int, old_tz: str, new_tz: str, db: Session)` — L149: Recalcula las preferencias de horario del estudiante tras un cambio de zona horaria. NO hace commit.

## app/core/scheduler.py

- `class JobFailed()` — L27: Un job por vencimiento no pudo con alguno de sus elementos. `_run_due_job` la cuenta como fallo (reintento con espera creciente y tope de intentos, ver `compute_run_at`).
- `finalize_expired_classes()` — L32: Job que se ejecuta cada 10 minutos. Marca como 'finalized' las clases confirmadas cuyo horario ya pasó.
- `send_class_reminders()` — L48: Job que se ejecuta cada hora. Busca clases confirmadas que empiezan en ~24h y envía el recordatorio si aún no se envió.
- `send_chat_digests()` — L200: Job por vencimiento: un correo por profesor con sus conversaciones de chat pendientes (core/chat_digest.py).
- `generate_upcoming_meet_links()` — L216: Job que se ejecuta cada 5 minutos. Genera automáticamente el link de videollamada (Google Meet, vía el Calendar del profesor) para las clases confirmadas que empiezan dentro de la ventana configurada por el superadmin (meet_link_autogen_minutes en PlatformConfig, default 30 min) y todavía NO tienen 
- `sync_all_teacher_calendars()` — L285: Job que se ejecuta cada 30 minutos, en segundo plano, sin depender de que algún profesor tenga el panel abierto.
- `notify_low_credit_packages()` — L308: Job semanal. Revisa enrollments activos con pocas clases restantes (finitos o ilimitados con crédito prepagado) y avisa al estudiante si no se le avisó ya dentro de la ventana configurada por el superadmin (low_credit_renotify_days en PlatformConfig).
- `purge_old_chat_messages()` — L363: Job diario. Borra mensajes de chat interno más viejos que PlatformConfig.chat_retention_days (0 = sin límite, no borra nada).
- `release_stale_enrollments()` — L383: Job diario. Cancela los enrollments sin pagar de mas de 24 h (antes lo hacia un GET).
- `purge_old_logs()` — L398: Job diario. Purga `error_logs` y `email_log` por antiguedad (core/retention.py).
- `class DueJob()` — L444
- `_due_finalize(job: DueJob, db: Session, now: datetime)` — L453: Primera clase que hay que cerrar: confirmed/pending_trial al terminar, finalized a las 72 h de terminar.
- `_due_meet_links(job: DueJob, db: Session, now: datetime)` — L469: Hora en que la proxima clase sin link entra en la ventana de autogeneracion. Solo cuentan los profesores con Google Calendar conectado: sin el, no se puede generar el link y el job reintentaba cada 5 min (despertando Neon) durante toda la ventana previa a cada clase.
- `_due_chat_digest(job: DueJob, db: Session, now: datetime)` — L491
- `_due_reminders(job: DueJob, db: Session, now: datetime)` — L496: Recordatorio 24 h antes: se envia en la ventana [23 h, 25 h] antes del inicio.
- `_due_calendar_sync(job: DueJob, db: Session, now: datetime)` — L508: Sin profesores con Calendar conectado no hay nada que sincronizar. Con clase en curso o en las proximas 3 h: cada 30 min. Si no: cada 6 h, y siempre antes de que la proxima clase entre en esa ventana.
- `retry_delay(job: DueJob)` — L547: Espera antes de reintentar tras `job.failures` fallos seguidos: min_gap x 2^(fallos-1), con tope MAX_BACKOFF.
- `compute_run_at(job: DueJob, due: Optional[datetime], now: datetime)` — L552: Cuando programar la proxima ejecucion: `due` acotado a [ahora+1s, ahora+MAX_SLEEP] y respetando `min_gap`.
- `reschedule_job(job: DueJob)` — L565: Recalcula (con una consulta corta) cuando le toca al job y lo programa. Nunca lanza.
- `report_job_failure(job: DueJob, exc: Exception)` — L584: Deja el fallo en la pantalla de Logs del admin (ErrorLog) con el numero de intento. Nunca lanza.
- `_run_due_job(job_id: str)` — L601
- `reschedule_all_due_jobs()` — L614
- `request_reschedule(delay_seconds: int=3)` — L619: Pide recalcular los vencimientos (con un pequeño retraso: varias escrituras seguidas cuentan una vez).
- `_watched_models()` — L635
- `_after_flush(session, flush_context)` — L641
- `_after_commit(session)` — L646
- `_after_soft_rollback(session, previous_transaction)` — L651
- `install_session_hooks()` — L655
- `start_scheduler()` — L666
- `stop_scheduler()` — L680: Para el scheduler al apagar la aplicación

## app/core/slots_cache.py

- `slots_key(teacher_id: int, date: str, duration: int, occupancy: int)` — L45
- `cached_slot_grid(teacher_id: int, date: str, duration: int, occupancy: int, loader: Callable[[], Any])` — L49
- `invalidate_teacher_slots(teacher_id: int)` — L58
- `invalidate_all_slots()` — L62
- `_pending(session: Session)` — L66
- `_teacher_ids(obj: Any)` — L70: teacher_id actual y, si cambió (sustitución de profesor), también el anterior. Si no está cargado (no se lanza SQL dentro del flush), se invalida todo.
- `_collect_after_flush(session: Session, _flush_context)` — L79
- `_collect_bulk(orm_execute_state)` — L87
- `_invalidate_after_commit(session: Session)` — L96

## app/core/spoken_languages.py

- `class SpokenLanguagesError()` — L36: Entrada invalida; el mensaje es apto para mostrar al usuario (HTTP 422).
- `_key(text: str)` — L40: Clave de comparacion: sin tildes, sin mayusculas, sin espacios sobrantes.
- `get_catalog(db: Session)` — L46
- `read_spoken_languages(raw)` — L52: Lee lo guardado (formato nuevo o textos sueltos de la Fase 8) como [{language, level|None}]. Nunca lanza.
- `language_names(raw)` — L64
- `speaks(raw, language: str)` — L68: True si la lista incluye ese idioma (sin distinguir mayusculas ni tildes).
- `normalize_spoken_languages(raw, catalog: list[str])` — L74: Valida y normaliza. Devuelve [{language, level}] con la ortografia del catalogo; lanza SpokenLanguagesError si no es valida. Cada elemento debe ser {"language": ..., "level": ...} con un nivel de LEVELS.

## app/core/storage.py

- `_slugify(text: str)` — L68
- `_matches_declared_type(file_bytes: bytes, content_type: str)` — L89
- `_resource_type_for(content_type: str)` — L136: Determina el resource_type correcto de Cloudinary según el content_type. Crítico para video: si se sube con resource_type="auto" (o "raw"), Cloudinary puede aplicarle el límite de tamaño de imagen/raw del plan (mucho más bajo) en vez del límite específico para video.
- `upload_file(file_bytes: bytes, filename: str, content_type: str, folder: str='materials', display_name: str | None=None)` — L152
- `_validate_upload(head: bytes, size: int, content_type: str)` — L166: Valida tamano y firma (magic bytes) sin necesitar el archivo completo.
- `upload_file_stream(fileobj, filename: str, content_type: str, folder: str='materials', display_name: str | None=None)` — L187: Igual que upload_file, pero recibe un objeto tipo archivo (p. ej. `UploadFile.file`, que Starlette ya guarda en disco si pasa de 1 MB) en vez de bytes: el archivo nunca se carga entero en RAM. Valida tamano y firma ANTES de enviar nada, y los videos se suben por trozos (`upload_large`).
- `_send_to_cloudinary(data, filename: str, content_type: str, folder: str, display_name: str | None)` — L218: `data` puede ser bytes o un objeto tipo archivo.
- `delete_file(public_id: str, resource_type: str='image')` — L254

## app/core/teacher_students.py

- `link_student_to_teacher(db: Session, student_profile: StudentProfile, new_teacher: TeacherProfile, old_teacher_username: str | None=None)` — L6: Mantiene sincronizado teacher_profiles.students (lista de StudentProfile.id) cada vez que un estudiante queda vinculado a un profesor, y crea (si no existe todavía) la conversación de chat directa entre ambos — así no hace falta que ninguno de los dos entre a apretar "Chat" para que la conversación 

## app/core/timezone.py

- `to_utc(dt_naive_str: str, tz_str: str)` — L14: Convierte un datetime local a UTC.
- `from_utc(dt_utc: datetime, tz_str: str)` — L38: Convierte un datetime UTC a zona horaria local. Usado principalmente para logs y emails, el frontend hace su propia conversión.
- `utc_now()` — L61: Devuelve el momento actual en UTC. Usar siempre en lugar de datetime.utcnow()
- `build_weekly_range_utc(date_str: str, start_hhmm_utc: str, end_hhmm_utc: str)` — L68: Construye el rango datetime UTC para una disponibilidad semanal aplicada a una fecha concreta.
- `get_next_weekday_date(day_of_week: int, tz_str: str, reference: datetime | None=None)` — L109: Devuelve la fecha (YYYY-MM-DD) de la próxima ocurrencia de day_of_week (0=Lunes...6=Domingo) a partir de "hoy" en la zona horaria indicada. Se usa como fecha de referencia para las conversiones de horarios recurrentes, así el offset UTC/DST calculado al guardar coincide siempre con el que usa el fro
- `convert_local_time_to_utc(time_str: str, tz_str: str, day_of_week: int)` — L124: Convierte una hora local "HH:MM" a su equivalente UTC "HH:MM", y además devuelve el día de la semana (ISO, 0=Lunes...6=Domingo) que ese horario ocupa REALMENTE en UTC.
- `convert_local_time_to_utc_string(time_str: str, tz_str: str, day_of_week: int)` — L160: Igual que convert_local_time_to_utc, pero solo devuelve la hora, para el código que ya maneja el día de la semana por su cuenta (ej. excepciones puntuales, que tienen una fecha real de calendario en vez de un day_of_week recurrente, así que no sufren el problema del corrimiento de día).
- `convert_utc_time_to_local_string(utc_time_str: str, tz_str: str, day_of_week: int)` — L178: Inversa de convert_local_time_to_utc_string. Dado un "HH:MM" UTC recurrente asociado a un day_of_week, devuelve el "HH:MM" que esa misma hora representa en la zona horaria indicada. Se usa para recuperar la hora LOCAL que un usuario configuró antes de recalcular su horario tras un cambio de zona hor
- `get_available_slots_utc(availability_ranges: List[Tuple[datetime, datetime]], busy_ranges: List[Tuple[datetime, datetime]], duration_minutes: int, step_minutes: int)` — L208: Calcula los slots libres dado un conjunto de rangos disponibles y rangos ocupados. Todo en UTC.
- `get_all_slots_utc(availability_ranges: List[Tuple[datetime, datetime]], busy_ranges: List[Tuple[datetime, datetime]], duration_minutes: int, step_minutes: int)` — L259: Igual que get_available_slots_utc pero NO descarta los slots ocupados: devuelve todos los slots dentro de los rangos de disponibilidad, marcando cada uno con su estado de ocupación (is_busy).
- `is_slot_in_past(slot_utc: datetime)` — L307: Verifica si un slot ya ocurrió de verdad (su hora de inicio ya quedó atrás). NO tiene en cuenta el margen mínimo de antelación para reservar — eso es un concepto distinto, ver `is_slot_too_soon`.
- `is_slot_too_soon(slot_utc: datetime, buffer_minutes: int=60)` — L316: Verifica si un slot, aunque todavía NO haya pasado, está demasiado próximo para poder reservarlo según el margen mínimo de antelación (buffer_minutes, configurable por el superadmin vía min_booking_hours).
- `validate_timezone(tz_str: str)` — L331: Verifica que una zona horaria es válida
- `format_local_datetime(dt_utc: datetime, tz_str: Optional[str]=None)` — L339: Formatea un datetime UTC en la hora LOCAL del destinatario, para usar en emails. Si tz_str es None o inválido, cae a UTC sin romper el envío.

## app/core/tts_service.py

- `_get_cache_key(word: str, voice: str, speed: float)` — L27: Genera una clave única para cada combinación de palabra + voz + velocidad. Usamos hash para tener claves cortas y consistentes.
- `async generate_word_audio(word: str, voice: str=DEFAULT_VOICE, speed: float=DEFAULT_SPEED)` — L36: Genera audio de alta calidad para una palabra usando OpenAI TTS. Cachea el resultado en Cloudinary para no regenerar.
- `async generate_batch_audio(words: list[str], voice: str=DEFAULT_VOICE, speed: float=DEFAULT_SPEED)` — L100: Genera audio para múltiples palabras de forma eficiente. Solo genera las que no están en caché.

## app/core/upload_quota.py

- `quota_bytes()` — L21
- `get_upload_size(fileobj)` — L25: Tamano en bytes de un objeto tipo archivo sin cargarlo en memoria (deja el puntero al inicio).
- `used_bytes(db: Session, teacher_id: int)` — L33
- `usage(db: Session, teacher_id: int)` — L39
- `ensure_quota(db: Session, teacher_id: int, new_size: int)` — L46: 413 si subir `new_size` bytes superaria la cuota del profesor.

## app/core/chipi/context.py

- `_get_package_landscape(db: Session)` — L17: Resumen EN VIVO (sin precios) de los paquetes activos que existen hoy en la plataforma, para que Chipi nunca hable de planes/precios inventados o hardcodeados. Deliberadamente sin montos — solo variedad (materias/idiomas, si hay grupales, si hay pago en cuotas) para que Chipi anime a registrarse y t
- `get_platform_context_for_chipi(db: Session)` — L44: Datos de configuración global de la plataforma (modo single/multi-tenant, nombre, profesor destacado) + resumen en vivo de los paquetes activos. Se agrega SIEMPRE al prompt, sin importar el rol, porque cambia cómo Chipi debe explicar la home y los planes.
- `_open_support_tickets_count(user_id: int, db: Session)` — L68
- `get_student_data_for_chipi(user: User, db: Session)` — L75: Recopila datos relevantes del estudiante para el contexto de Chipi. Solo datos que Chipi realmente necesita — no sobrecargar el prompt.
- `get_teacher_data_for_chipi(user: User, db: Session, is_admin: bool=False)` — L126: Recopila datos relevantes del profesor para el contexto de Chipi. Se usa tanto para role="teacher" como para role="teacher_admin" (mismo tipo de datos — un teacher_admin es, ante todo, un profesor). `is_admin` solo agrega la bandera para que el prompt sepa que además tiene permisos de staff (Modo Di
- `get_staff_data_for_chipi(user: User, db: Session)` — L198: Datos ligeros para superadmin (vista global de la plataforma, no de un profesor en particular). Se mantiene deliberadamente liviano — el staff ya conoce el panel de administración, Chipi solo da un resumen rápido.

## app/core/chipi/prompts.py

- `get_platform_context(platform_data: Optional[dict])` — L66: Contexto de configuración de la plataforma (single vs multi-tenant). Se agrega siempre, independientemente del rol, porque cambia completamente cómo se debe hablar de "elegir profesor" o "los planes".
- `get_student_context(user_data: dict)` — L136: Contexto específico del estudiante autenticado. user_data viene de la BD en tiempo real.
- `get_teacher_context(user_data: dict)` — L174: Contexto del profesor autenticado. También se usa para teacher_admin (con una nota adicional sobre sus permisos de staff — ver `is_admin`).
- `get_staff_context(user_data: Optional[dict])` — L228: Contexto ligero para superadmin (vista global de la plataforma).
- `get_public_context()` — L257: Contexto para usuarios no autenticados
- `get_navigation_map(role: Optional[str], platform_data: Optional[dict]=None)` — L282
- `get_screen_context(screen: str)` — L803: Devuelve el contexto de la pantalla actual
- `build_system_prompt(role: Optional[str], screen: str, user_data: Optional[dict]=None, platform_data: Optional[dict]=None)` — L808: Construye el prompt del sistema completo combinando: 1. Prompt base 2. Contexto de plataforma (single/multi-tenant) — siempre 3. Contexto del rol del usuario 4. Contexto de la pantalla actual

## app/core/chipi/service.py

- `async get_chipi_response(message: str, system_prompt: str, history: List[dict])` — L22: Obtiene respuesta de Chipi sin streaming. Más simple — para cuando no necesitas streaming.
- `async stream_chipi_response(message: str, system_prompt: str, history: List[dict])` — L53: Obtiene respuesta de Chipi con streaming. El texto aparece letra a letra en el frontend. Mejor experiencia de usuario.

## app/auth/dependencies.py

- `get_current_user(request: Request, credentials: Optional[HTTPAuthorizationCredentials]=Depends(optional_security), db: Session=Depends(get_db))` — L16: Dependencia base — verifica que el usuario está logueado. Se usa en cualquier endpoint que requiera autenticación. SEC-05: el token puede venir en la cabecera Authorization (clientes API, periodo de transicion) o en la cookie HttpOnly `tpm_access`.
- `get_current_user_optional(request: Request, credentials: Optional[HTTPAuthorizationCredentials]=Depends(optional_security), db: Session=Depends(get_db))` — L57: Igual que get_current_user pero devuelve None en vez de lanzar 401 cuando no hay token o es inválido. Se usa en endpoints que aceptan reportes tanto de usuarios logueados como anónimos (ej. reporte de errores de frontend, que puede ocurrir antes de loguearse).
- `get_current_teacher(current_user: User=Depends(get_current_user))` — L80: Permite acceso a profesores y a teacher_admin (actúan como profesores)
- `get_current_student(current_user: User=Depends(get_current_user))` — L89: Solo permite acceso a estudiantes
- `get_current_staff(current_user: User=Depends(get_current_user))` — L98: Permite acceso a superadmin Y teacher_admin. Para endpoints que ambos pueden usar.
- `get_current_teacher_or_teacher_admin(current_user: User=Depends(get_current_user))` — L116: Permite acceso a teacher Y teacher_admin. Para endpoints de gestión de clases propias.
- `get_current_approved_teacher(current_user: User=Depends(get_current_user))` — L133: Solo permite acceso a profesores con status='approved'. Se usa donde el profesor asigna material o tareas.
- `get_current_staff_or_teacher(current_user: User=Depends(get_current_user))` — L154: Permite acceso a superadmin, teacher_admin y teacher. Se usa para aprobar renovaciones de paquete: el staff o el propio profesor del estudiante pueden confirmar el pago y activarla.
- `require_verified_email(user)` — L172: SEC-04 (politica suave): retiros y pagos exigen email verificado. Las cuentas previas quedaron verificadas en la migracion.

## app/auth/google.py

- `async verify_google_token(id_token: str)` — L4: Verifica el token de Google y devuelve los datos del usuario. Lanza una excepción si el token es inválido.

## app/auth/jwt.py

- `create_access_token(user_id: int, role: str)` — L7: Genera un token JWT con el id y rol del usuario. Expira según ACCESS_TOKEN_EXPIRE_MINUTES del .env
- `create_oauth_state(teacher_id: int, purpose: str='gcal')` — L27: `state` firmado y de vida corta para el flujo OAuth (SEC-06): ata la autorizacion al profesor que la inicio y evita que un atacante inyecte su propio `code` en la sesion de otro. Usa `tid` y `typ` (no `sub`/`role`) para que NUNCA se pueda usar como token de acceso.
- `decode_oauth_state(state: str, purpose: str='gcal')` — L43: Devuelve el teacher_id del `state`, o None si es invalido, vencido o de otro tipo.
- `decode_access_token(token: str)` — L54: Verifica y decodifica un token. Retorna None si el token es inválido o expiró.

## app/auth/passwords.py

- `hash_password(password: str)` — L3: Convierte la contraseña en un hash seguro
- `verify_password(plain_password: str, hashed_password: str)` — L9: Compara la contraseña introducida con el hash guardado
- `burn_password_check(plain_password: str)` — L20: Gasta el mismo tiempo que verify_password; el resultado se descarta.

## app/auth/session.py

- `hash_token(raw: str)` — L33
- `_aware(dt: Optional[datetime])` — L37
- `_secure()` — L43
- `_set_cookie(response: Response, name: str, value: str, max_age: int, path: str='/')` — L49
- `_delete_cookie(response: Response, name: str, path: str='/')` — L56
- `allowed_origins()` — L63: Origenes del frontend que pueden hacer peticiones con cookies (mismo criterio que CORS).
- `set_auth_cookies(response: Response, user: User, db: Session, family_id: Optional[str]=None)` — L68: Crea access + refresh, guarda el hash del refresh y fija las cookies. Devuelve el access token.
- `clear_auth_cookies(response: Response)` — L86
- `_revoke_family(db: Session, family_id: str)` — L92
- `revoke_all_sessions(db: Session, user_id: int)` — L98: Cierra TODAS las sesiones del usuario (cambio/restablecimiento de contrasena, borrado de cuenta).
- `rotate_refresh_token(db: Session, raw: Optional[str])` — L105: Valida el refresh y lo rota. Devuelve (usuario, family_id) o None si no es valido. - Desconocido o vencido -> None. - Ya revocado: dentro de la ventana de gracia se acepta (carrera entre pestanas); fuera de ella se asume   reutilizacion/robo y se revoca TODA la familia.
- `revoke_refresh_family(db: Session, raw: Optional[str])` — L139: Logout: revoca la familia del refresh presentado (si es valido o conocido).
- `token_from_request(request: Request)` — L149: Token de acceso de la peticion: cabecera Authorization (clientes API / transicion) o cookie.

## app/db/base.py

- `class Base()` — L49
- `get_db()` — L53
