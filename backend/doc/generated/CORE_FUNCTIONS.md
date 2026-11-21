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

- `_get_teacher_calendar_service(teacher_id: int, db: Session)` — L20: Devuelve (service, calendar_id) para el profesor, o (None, None) si no tiene Calendar conectado/activo o el token necesita reconexión. Nunca lanza — el flujo de reserva de clases debe seguir funcionando aunque Calendar esté desconectado o roto.
- `_teacher_attendee_emails(class_: Class)` — L43: El profesor queda como invitado explícito del evento (sin correo de invitación, ver sendUpdates="none" en core/google_calendar.py) para que Google Meet lo reconozca siempre como participante autorizado y pueda entrar a la videollamada sin pedir permiso — incluso si abre el link desde una cuenta/sesi
- `sync_class_created(class_: Class, db: Session)` — L56
- `sync_class_updated(class_: Class, google_event_id: str, db: Session)` — L78
- `generate_meet_link_for_class(class_: Class, db: Session)` — L96: Genera automáticamente un link de Google Meet real para la clase, usando el Google Calendar del profesor. Se usa desde el job programado que corre ~30 minutos antes del inicio de cada clase (ver core/scheduler.py::generate_upcoming_meet_links).
- `sync_class_cancelled(teacher_id: int, google_event_id: str, db: Session)` — L146

## app/core/chat.py

- `class ChatSettings()` — L41
- `get_chat_settings(db: Session)` — L46
- `invalidate_chat_settings()` — L53
- `assert_chat_enabled(db: Session)` — L57: Bloquea a nivel backend el chat cuando el superadmin/teacher_admin lo desactivó desde /admin/settings — no basta con ocultarlo en el UI, porque alguien podría pegar la URL o abrir el WS directo.
- `assert_chat_enabled_ws(db: Session)` — L72: Misma validación que assert_chat_enabled pero sin levantar HTTPException (dentro de un WebSocket ya aceptado no tiene sentido — el caller cierra el socket con un código explícito). Devuelve None si está deshabilitado.
- `_teacher_has_student(teacher: TeacherProfile, student_id: int)` — L82: Fuente de verdad del vínculo directo profesor-alumno en AMBOS modos (single y multi-tenant): TeacherProfile.students (JSONB), poblada por core/teacher_students.py::link_student_to_teacher. StudentTeacherLink NO sirve para esto — queda vacía en single-tenant (ver su docstring y payments.py::_ensure_t
- `_cohort_participant_ids(db: Session, cohort_id: int)` — L93: IDs de StudentProfile con Enrollment (activo o pendiente) en la cohorte.
- `get_direct_conversation_or_404(db: Session, current_user: User, other_username: str)` — L102: Resuelve (creando si hace falta) la conversación 1:1 entre el usuario actual y `other_username`.
- `ensure_direct_conversation(db: Session, student_id: int, teacher_id: int, commit: bool=True)` — L154: Wrapper público de `_get_or_create_direct` para llamarse desde fuera de este módulo (ver core/teacher_students.py::link_student_to_teacher) sin tocar un nombre "privado". Idempotente: no crea duplicados si ya existe.
- `_get_or_create_direct(db: Session, student_id: int, teacher_id: int, commit: bool=True)` — L163
- `get_group_conversation_or_404(db: Session, current_user: User, cohort_id: int)` — L185
- `assert_participant(db: Session, current_user: User, convo: ChatConversation)` — L220: Re-valida pertenencia contra una conversación ya existente (para el WS y para /messages).
- `conversation_participant_user_ids(db: Session, convo: ChatConversation)` — L243: User.id de los participantes ACTIVOS — para el broadcast por WS (C5: una cuenta desactivada no recibe nada). Una sola consulta por conversación.
- `_conversation_filter(current_user: User)` — L276: Condición SQL «conversaciones en las que participa este usuario», o None si su rol no tiene chat.
- `conversation_ids_subquery(current_user: User)` — L317
- `with_display_relations(query)` — L322: Carga en bloque lo que muestra la lista (nombre y avatar del otro, paquete del grupo): sin esto, cada conversación hacía 2-3 consultas perezosas.
- `conversations_page_for_user(db: Session, current_user: User, offset: int, limit: int)` — L332: (total, página) paginando en SQL. Antes se cargaban TODAS las conversaciones y se cortaba en Python.
- `list_conversations_for_user(db: Session, current_user: User)` — L348
- `get_messages(db: Session, convo: ChatConversation, before_id: Optional[int]=None, after_id: Optional[int]=None, limit: int=50)` — L355: - Sin `before_id` ni `after_id`: los últimos `limit` (historial inicial). - `before_id`: página hacia atrás (scroll-up / "cargar más antiguos"). - `after_id`: SOLO los mensajes nuevos desde el último que el cliente   ya tiene cacheado (ver frontend/store/chatStore.ts) — evita   volver a traer los 50
- `mark_read(db: Session, convo: ChatConversation, user: User)` — L381
- `_unread_query(db: Session, user_id: int, conversation_ids)` — L406: Mensajes ajenos posteriores a la última lectura del usuario (o todos si nunca abrió la conversación). `conversation_ids` puede ser una lista o una subconsulta.
- `unread_counts(db: Session, user_id: int, conversation_ids: list[int])` — L422: {conversation_id: no leídos} en UNA consulta (antes: 2 por conversación).
- `get_unread_count_for_user(db: Session, current_user: User)` — L429: Suma de mensajes no leídos en todas las conversaciones del usuario: una consulta.
- `find_message_by_client_id(db: Session, conversation_id: int, sender_id: int, client_id: Optional[str])` — L439
- `send_message(db: Session, config: ChatSettings, convo: ChatConversation, sender: User, content: str, client_id: Optional[str]=None)` — L451: Persiste el mensaje y determina si corresponde disparar el email de aviso al profesor (solo cuando el remitente es un estudiante y la conversación estaba inactiva por más de chat_reactivation_hours, o es el primer mensaje de la conversación).
- `mark_delivered_by_id(db: Session, message_id: int)` — L520: UPDATE atómico de una sola query: devuelve el instante si ESTA llamada fue la que marcó el mensaje como entregado, None si ya lo estaba.
- `catch_up_deliveries(db: Session, user: User)` — L533: Al conectarse (o reconectarse) el socket global de `user`, cualquier mensaje QUE LE HAYAN MANDADO A ÉL en cualquiera de sus conversaciones y que siguiera sin `delivered_at` (porque no estaba online cuando se envió) pasa a estar entregado en este instante.
- `purge_old_messages(db: Session, retention_days: int)` — L572: Borra mensajes más viejos que `retention_days`. 0 = sin límite (no borra nada).

## app/core/chat_digest.py

- `next_due(db: Session)` — L28: Cuando hay que enviar el siguiente resumen (None si no hay avisos pendientes).
- `_unread_from_others(db: Session, convo: ChatConversation, teacher_user_id: int)` — L34: Mensajes de otros que el profesor aun no leyo y el ultimo de ellos.
- `send_pending_digests(db: Session, now: Optional[datetime]=None)` — L45: Envia un correo por profesor con sus conversaciones pendientes vencidas. Devuelve cuantos correos pidio enviar.

## app/core/chat_ws.py

- `class ChatConnectionManager()` — L44

## app/core/class_logic.py

- `is_within_teacher_availability(teacher_id: int, start_utc: datetime, end_utc: datetime, db: Session)` — L27: Verifica que [start_utc, end_utc) caiga dentro de un bloque de disponibilidad declarado por el profesor (horario semanal recurrente + excepciones puntuales de disponibilidad extra), y que no choque con una excepción de bloqueo puntual (vacaciones, feriado, etc).
- `validate_payment_method(payment_method: str, db: Session)` — L83: Correcciones Extra (informe D1-D14): el método de pago que indica el estudiante al notificar un pago tiene que ser uno de los métodos que el admin tiene efectivamente habilitados en ese momento (no alcanza con que sea una de las 4 claves conocidas -- si el admin apagó "bank_transfer", ya no es un mé
- `get_price_per_class(package)` — L113: Correcciones Extra (informe D1-D14): precio de una clase suelta dentro de `package`. Usa el campo `price_per_class` guardado a mano por el profesor si existe; si es un paquete creado antes de que ese campo existiera (queda NULL), cae al cálculo derivado de siempre (price/classes_count) para no rompe
- `get_business_rules(db: Session)` — L129: Lee las reglas de negocio configuradas por el superadmin desde PlatformConfig. Si no hay fila aún, cae a los defaults de arriba.
- `validate_class_duration(duration_minutes: int, db: Session)` — L181: Valida una duración de clase REGULAR contra el subconjunto configurado por el superadmin. No aplica a trial (ver get_trial_duration_minutes, que no es una elección del usuario sino un valor fijo de config).
- `validate_package_duration(duration_minutes: int, db: Session)` — L192: Valida la duración de clase de un PAQUETE contra el subconjunto configurado por el superadmin (allowed_package_durations) — catálogo independiente de allowed_class_durations, aunque hoy comparten el mismo pool fijo (CLASS_DURATION_OPTIONS).
- `get_buffer_minutes_for_type(class_type, db: Session)` — L204: Minutos de margen que se descuentan del final real de una clase de este tipo, según la config vigente. `class_type` puede ser un ClassType o su valor string ("trial" | "regular" | "group").
- `lock_booking_rows(db: Session, teacher_id: int, student_id: int | None=None)` — L221: Serializa las reservas concurrentes tomando un lock de fila (SELECT ... FOR UPDATE) sobre el alumno y luego el profesor (siempre en ese orden, para evitar deadlocks). Sin esto, dos requests simultaneos leen la agenda/creditos antes de que el otro haga commit y ambos pasan los chequeos (doble reserva
- `lock_class_row(db: Session, class_id: int)` — L237: Recarga la clase con lock de fila para que dos cancelaciones simultaneas no devuelvan el credito dos veces.
- `_google_busy_conflict(teacher_id: int, start_time_utc: datetime, end_time_utc: datetime, exclude_class_id: int | None, db: Session)` — L242: True si freebusy de Google marca ocupado algun instante de [start, end). Falla ABIERTO: si Google no responde (caida, token invalido, cuota) se registra y se deja reservar, para no bloquear reservas por una caida de un tercero. Si se esta reagendando una clase, el evento de Google de su horario ANTE
- `can_book_slot(start_time_utc: datetime, teacher_id: int, student_id: int, end_time_utc: datetime, db: Session, exclude_class_id: int=None, enforce_min_not)` — L294
- `can_join_group_class(class_: Class, db: Session)` — L413: Chequeo de cupo para una sesión grupal ya creada (Class con class_type == "group"): ¿hay lugar para un alumno más? Complementa a can_book_slot, que ya valida antelación mínima y que ni el alumno ni el profesor tengan otro compromiso en ese horario.
- `can_cancel_class(class_: Class, requesting_user_id: int, db: Session)` — L439
- `can_reschedule_class(class_: Class, role: str, db: Session)` — L461
- `resolve_status_after_reschedule(class_: Class)` — L501: Determina el status que debe quedar una clase tras reagendarla.
- `validate_class_status_transition(class_: Class, new_status: str, now: datetime | None=None)` — L551: (ok, mensaje). Misma transicion = no-op permitido. No toca la BD.
- `apply_reschedule_status(class_: Class, db: Session)` — L579: Fase 22 (TE-02): fija el estado tras reagendar y mantiene los contadores. Reagendar un `no_show` (cortesia) a 'confirmed' devuelve el credito que ya se habia contado (antes se contaba dos veces al completarla). No hace commit.
- `class_in_current_cycle(class_: 'Class | None', enrollment: Enrollment)` — L599: Fase 22 (E1): ¿la clase pertenece al ciclo actual del enrollment? Renovar/cambiar de paquete pone classes_used=0 pero las clases del ciclo anterior siguen ligadas al enrollment: al completarse NO deben sumar al contador nuevo (antes lo llenaban y el enrollment pasaba a 'completed' con creditos dispo
- `update_enrollment_counter(enrollment_id: int, delta: int, db: Session, class_: 'Class | None'=None)` — L619: Actualiza el contador de clases usadas en un enrollment. delta=1 cuando se completa una clase delta=-1 cuando se cancela una clase completada `class_` (Fase 22, E1): si es de un ciclo anterior (renovacion/cambio de paquete) no toca el contador.
- `_cohort_cancelled_refund_pending(student_id: int, teacher_id: int, db: Session)` — L651: F3 / Fase 22 (E5): ¿el alumno tiene un enrollment pagado de una cohorte cancelada por el profesor y aun sin reembolso pedido/aprobado? (Cancelar la cohorte conserva `cohort_id` en el enrollment para poder encontrarlo.)
- `get_student_booking_stage(student_id: int, teacher_id: int, db: Session, *, heal: bool=True)` — L679: Determina la etapa de reserva del estudiante CON UN PROFESOR ESPECÍFICO. Cada relación estudiante-profesor es independiente: completar la prueba con un profesor no exime de la prueba con otro.
- `release_stale_unpaid_enrollments(db: Session, older_than_hours: int=STALE_UNPAID_ENROLLMENT_HOURS)` — L802: Cancela los enrollments individuales activos que nunca se pagaron ni tienen un pago en revision y tienen mas de `older_than_hours` horas. Es lo que antes hacia, en un GET, `get_student_booking_stage`. Los de cohorte (grupales) no se tocan.
- `notify_teachers_auto_no_show(db: Session, classes: list[Class])` — L838: Fase 13 (A9): avisa a cada profesor (campana «Avisos», sin correo) de las clases que pasaron solas a `no_show` por no marcarlas en 72 h. UNA notificacion por profesor y pasada del job, aunque sean varias clases (si el job estuvo caido no se le inunda). No hace commit: va en la misma transaccion que 
- `notify_teachers_unconfirmed_trials(db: Session, classes: list[Class])` — L881: Fase 22 (E6): avisa (una vez por clase: solo se llama al pasar de pending_trial a finalized) a cada profesor de sus pruebas que terminaron sin confirmar/marcar. No hace commit.
- `finalize_past_classes(db: Session)` — L916: Marca como 'finalized' las clases confirmadas cuyo horario ya terminó, y como 'no_show' las que nunca se confirmaron/pagaron y ya pasó su hora. Actualiza también el contador de clases usadas del paquete, ya que estos estados cuentan contra el cupo del estudiante.
- `class_counts_towards_package(class_status: str, start_time_utc: datetime, reference_time: datetime | None=None, apply_late_cancel_penalty: bool=True, min_cancel_hours: i)` — L986: Determina si una clase en este estado debe contarse contra el paquete del estudiante (classes_used).
- `sync_student_lifetime_class_counter(class_: 'Class', old_status: str, new_status: str, db: Session)` — L1029: Mantiene StudentProfile.total_completed_classes al día cada vez que el status de una Class entra o sale de LIFETIME_COUNTING_STATUSES.
- `count_completed_classes_with_teacher(db: Session, teacher_id: int, student_id: int)` — L1077: Cuántas clases completó un alumno con un profesor puntual (individuales + grupales, status 'completed'). A diferencia del contador de por vida de StudentProfile, este número es específico del par profesor-alumno y no incluye 'no_show' — usa el mismo criterio que la elegibilidad para dejar una reseña
- `cancel_class_and_refund(class_: 'Class', db: Session, apply_late_cancel_penalty: bool)` — L1104: Marca la clase como cancelada y devuelve el crédito al estudiante si corresponde. Centraliza la lógica que antes estaba duplicada en los 3 endpoints de cancelación (estudiante, profesor, admin).

## app/core/config.py

- `class Settings()` — L7

## app/core/email.py

- `_detail_row(label: str, value: str)` — L33
- `_detail_table(rows: list[str])` — L41
- `_cta_button(text: str, url: str)` — L48
- `_badge(text: str, color: str)` — L61
- `_base_template(preheader: str, badge_html: str, heading: str, body_html: str)` — L70
- `_get_email_executor()` — L127
- `shutdown_email_queue(wait: bool=True)` — L135: Al apagar el servidor: deja salir los correos que estaban en cola (main.py::lifespan).
- `_plain_subject(subject: str)` — L144: El asunto es texto plano: se deshace el escape HTML de los datos del usuario y se quitan saltos de línea (inyección de cabeceras).
- `_send(to_email: str, subject: str, html: str, category: str='essential')` — L149: Pone el correo en cola y vuelve al instante (Fase 14, E1): la peticion ya no espera a Resend. Devuelve True si quedo en cola; si sale, se omite o falla se anota igual en email_log desde el hilo de envio. Ningun llamador usa el valor devuelto. Con EMAIL_ASYNC=false se envia en linea y devuelve el res
- `_send_now(to_email: str, subject: str, html: str, category: str='essential')` — L166: Unico punto de salida de correos. Antes de enviar consulta el control de la Fase 7 (core/email_settings.py): categoria apagada, limite diario o modo ahorro -> se omite y se anota. Si el control o el contador fallan, el correo SALE igual (nunca se pierde un correo por un fallo de conteo).
- `send_password_reset_email(to_email: str, user_name: str, reset_token: str)` — L216
- `send_verification_email(to_email: str, user_name: str, verify_token: str)` — L228
- `send_username_recovery_email(to_email: str, user_name: str, username: str)` — L240
- `send_welcome_email(to_email: str, user_name: str, role: str)` — L254
- `_duration_and_buffer_rows(duration_minutes: int, buffer_minutes: int=0)` — L277
- `send_class_booking_confirmation(to_email: str, student_name: str, teacher_name: str, subject: str, class_start_local: str, duration_minutes: int, is_trial: bool=False, buff)` — L288
- `send_class_rescheduled_student_email(to_email: str, student_name: str, teacher_name: str, old_start_local: str, new_start_local: str, changed_by: str)` — L309
- `send_class_reminder_email(to_email: str, student_name: str, teacher_name: str, subject: str, class_start_local: str, hours_before: int=24)` — L326
- `send_cohort_ended_email(to_email: str, student_name: str, package_name: str, reason: str, credit_returned: bool | None=None)` — L345: Para cuando una cohorte grupal termina y el alumno queda libre de elegir un nuevo paquete — a diferencia de una clase cancelada (que tiene una fecha/hora puntual), acá lo que se cancela es la cohorte completa, así que esta plantilla NO reutiliza el campo "Fecha y hora" de send_class_cancelled_email 
- `send_class_cancelled_email(to_email: str, student_name: str, class_start_local: str, cancelled_by: str, reason: str | None=None, credit_returned: bool | None=None)` — L375
- `send_class_no_show_email(to_email: str, student_name: str, class_start_local: str)` — L396
- `send_homework_graded_email(to_email: str, student_name: str, homework_title: str, score: float, feedback: str | None)` — L407
- `send_material_assigned_email(to_email: str, student_name: str, teacher_name: str, material_title: str, category: str)` — L423
- `send_payment_receipt_email(to_email: str, student_name: str, concept: str, amount: float, payment_method: str, transaction_reference: str | None=None)` — L438
- `send_payment_failed_email(to_email: str, student_name: str, concept: str, amount: float, rejection_reason: str)` — L457
- `send_teacher_status_update_email(to_email: str, teacher_name: str, new_status: str, reason: str | None=None)` — L477
- `send_teacher_video_review_email(to_email: str, teacher_name: str, approved: bool, reason: str | None=None)` — L501
- `send_support_ticket_response_email(to_email: str, user_name: str, subject: str, admin_response: str, portal_path: str)` — L519
- `send_new_booking_teacher_email(to_email: str, teacher_name: str, student_first_name: str, student_last_name: str, student_nationality: str | None, student_phone: str | Non)` — L532
- `send_class_rescheduled_teacher_email(to_email: str, teacher_name: str, student_name: str, old_start_local: str, new_start_local: str, changed_by: str)` — L555
- `send_class_reminder_teacher_email(to_email: str, teacher_name: str, student_name: str, subject: str, class_start_local: str, hours_before: int=24)` — L572
- `send_class_reminders_teacher_digest_email(to_email: str, teacher_name: str, items: list[tuple[str, str, str]], hours_before: int=24)` — L590: Un solo correo con TODAS las clases que el profesor tiene en la ventana de recordatorio, en vez de uno por clase. `items`: (alumno, materia, fecha y hora local).
- `send_chat_digest_teacher_email(to_email: str, teacher_name: str, items: list[tuple[str, int, str]], conversation_url: str)` — L608: Un solo correo con los mensajes nuevos de varias conversaciones, en vez de uno por alumno. `items`: (alumno, mensajes sin leer, vista previa del ultimo).
- `send_class_cancelled_teacher_email(to_email: str, teacher_name: str, student_name: str, class_start_local: str, cancelled_by: str, reason: str | None=None)` — L627
- `send_homework_submitted_email(to_email: str, teacher_name: str, student_name: str, homework_title: str, submitted_at_local: str)` — L645
- `send_new_review_received_email(to_email: str, teacher_name: str, student_name: str, rating: float, comment: str | None)` — L660
- `send_calendar_reauth_teacher_email(to_email: str, teacher_name: str)` — L674
- `send_withdrawal_requested_teacher_email(to_email: str, teacher_name: str, amount: float, destination_method: str)` — L685
- `send_withdrawal_processed_email(to_email: str, teacher_name: str, status: str, amount: float, reference: str | None=None, rejection_reason: str | None=None)` — L701
- `send_admin_new_support_ticket_email(to_email: str, user_name: str, user_role_label: str, category_label: str, subject: str, message: str)` — L725
- `send_admin_new_teacher_pending_email(to_email: str, teacher_name: str, teacher_email: str, subjects_or_languages: list[str])` — L741
- `send_admin_payment_pending_email(to_email: str, student_name: str, amount: float, concept: str, payment_method: str, transaction_reference: str | None=None)` — L757
- `send_admin_withdrawal_requested_email(to_email: str, teacher_name: str, amount: float, destination_details: str)` — L778
- `send_package_expiring_email(to_email: str, student_name: str, package_name: str, classes_remaining: int)` — L793
- `send_new_chat_message_teacher_email(to_email: str, teacher_name: str, student_name: str, message_preview: str, conversation_url: str)` — L810
- `send_class_confirmed_email(to_email: str, student_name: str, teacher_name: str, subject: str, class_start_local: str, duration_minutes: int, buffer_minutes: int=0)` — L824
- `send_class_confirmed_teacher_email(to_email: str, teacher_name: str, student_name: str, subject: str, class_start_local: str, duration_minutes: int)` — L841
- `_escape_value(v)` — L867
- `_escaped_args(fn)` — L875

## app/core/email_settings.py

- `today()` — L91
- `_config(db: Session)` — L95
- `get_limit(cfg: PlatformConfig | None)` — L99
- `get_saver_percent(cfg: PlatformConfig | None)` — L104
- `is_category_enabled(cfg: PlatformConfig | None, category: str)` — L109
- `usage_today(db: Session)` — L116: {categoria: {sent, skipped, failed}} de hoy (UTC).
- `sent_today(db: Session)` — L130
- `saver_active(cfg: PlatformConfig | None, sent: int)` — L134: El modo ahorro esta pausando categorias ahora mismo.
- `decide(db: Session, category: str)` — L141: (enviar?, motivo si se omite). Las esenciales siempre salen.
- `record(db: Session, category: str, outcome: str, reason: str | None=None)` — L157

## app/core/error_log.py

- `is_reportable_business_error(path: str, status_code: int)` — L47
- `get_user_from_request(db: Session, request: Request)` — L53: Intenta identificar al usuario logueado a partir del header Authorization, sin lanzar nunca una excepción (se usa dentro de exception handlers, donde las Depends normales no corren).
- `log_error(source: str, level: str, message: str, detail: Optional[str]=None, screen: Optional[str]=None, method: Optional[str]=None, status_code: Opti)` — L72: Guarda un ErrorLog. Si no se pasa `db`, abre y cierra una sesión propia (necesario desde los exception handlers globales, donde no hay una sesión de request disponible vía Depends).

## app/core/god_mode_audit.py

- `log_god_mode_action(db: Session, actor: User, action: str, entity_type: str, entity_id: int, reason: str, before: Optional[dict[str, Any]]=None, after: Optional)` — L8: Registra una acción del Modo Dios. No hace commit — el caller debe incluir este `db.add` en la misma transacción que el resto de los cambios de la operación, para que el log y la mutación real vivan o mueran juntos (si algo falla y se hace rollback, no queda un log huérfano de una acción que en real

## app/core/google_calendar.py

- `get_oauth_flow()` — L58: Crea el flujo OAuth2 para conectar Google Calendar
- `get_auth_url(state: Optional[str]=None)` — L75: Genera la URL de autorización de Google. Limpia los parámetros de PKCE para evitar desajustes de 'code_verifier'.
- `exchange_code_for_tokens(code: str, code_verifier: Optional[str]=None)` — L101: Intercambia el código de autorización por tokens.
- `_identity_from_id_token(id_token: Optional[str])` — L120: (sub, email) del id_token que Google devuelve en el canje del codigo (scope openid/email). Llega directo del endpoint de tokens de Google por TLS, por eso no se re-verifica la firma.
- `calendar_id_for(token: GoogleCalendarToken)` — L137: Calendario a usar: siempre el principal de la cuenta conectada. Las filas antiguas guardaban el email de la plataforma en calendar_id (puede no ser la cuenta de Google conectada): se tratan como "primary".
- `revoke_token(token: str)` — L146: Revoca el token de acceso en los servidores de Google
- `get_calendar_service_for_token(token: GoogleCalendarToken, db: Session)` — L163
- `reset_platform_sync_state(teacher_id: int, db: Session, clear_event_ids: bool)` — L212: Prepara las clases PROPIAS (no external) de un profesor para re-publicarse en un calendario de Google distinto/desconocido. NUNCA cancela clases ni borra nada en Google. - Siempre limpia google_sync_hash: la proxima sync consulta el evento (update); si no existe en ese   calendario (404) lo crea de 
- `notify_calendar_reauth(token: GoogleCalendarToken, db: Session)` — L232: Avisa al profesor (campana + correo) de que debe reconectar Google Calendar. Nunca lanza.
- `run_calendar_sync_background(teacher_id: int)` — L257: Sync de un profesor con su PROPIA sesion de BD (para BackgroundTasks: la de la peticion ya se cerro).
- `http_error_kind(e: HttpError)` — L272: Clasifica un HttpError de Google: "quota" (429 o 403 por limite/cuota: reintentable mas tarde), "permission" (403/401 real: el profesor no tiene permiso sobre ese evento/calendario), "gone" (404/410) u "other".
- `_with_retries(fn, *args, **kwargs)` — L301
- `class FreebusyError()` — L322: freebusy fallo (HttpError, error dentro del calendario o token invalido). Solo se lanza con strict=True.
- `get_busy_ranges(service, calendar_id: str, time_min: datetime, time_max: datetime, strict: bool=False)` — L326: Rangos ocupados del calendario. Por defecto falla ABIERTO (devuelve [] si Google falla, para no romper reservas); con strict=True lanza FreebusyError para que el llamador sepa que el resultado NO es fiable (p. ej. para no cachearlo).
- `get_teacher_busy_ranges(teacher_id: int, time_min: datetime, time_max: datetime, db: Session, strict: bool=False)` — L378
- `list_calendar_events(service, calendar_id: str, time_min: datetime, time_max: datetime)` — L407: Trae los eventos "reales" (con título, no solo el rango busy/free) del calendario del profesor en la ventana dada. `singleEvents=True` expande eventos recurrentes en instancias individuales, cada una con su propio id — necesario para poder dedupear/actualizar por Class.google_event_id igual que hace
- `_is_own_event(event: dict)` — L451: True si el evento lo creó esta plataforma (ver create_calendar_event / create_calendar_event_with_meet, que siempre marcan extendedProperties). Estos nunca deben re-importarse como clase externa.
- `_match_external_source(event: dict)` — L462: Si el título del evento contiene alguna de las keywords configuradas en EXTERNAL_IMPORT_SOURCES, devuelve el nombre de la fuente (ej. "preply"). None si no matchea ninguna o si el evento no tiene un horario puntual (dateTime) — los eventos de todo el día (solo "date") no se importan porque Class exi
- `import_external_classes_for_teacher(teacher_id: int, service, calendar_id: str, db: Session, time_min: datetime, time_max: datetime)` — L484: Lee los eventos reales del Google Calendar del profesor (no solo freebusy) y refleja como Class(class_type="external") los que correspondan a una plataforma externa reconocida (ver EXTERNAL_IMPORT_SOURCES, hoy solo Preply, detectado por palabra en el título). Son de solo lectura desde la perspectiva
- `_build_attendees(attendee_emails: Optional[List[str]])` — L628: Arma la lista de `attendees` para el body del evento. Se usa para que el profesor quede explícitamente como invitado del evento (además de ser el dueño del calendario), de forma que Google Meet lo reconozca como participante autorizado y no le pida "Pedir unirme" al entrar. Siempre se combina con se
- `_teacher_attendees(class_: Class)` — L642: El profesor como invitado explicito (igual que los hooks de calendar_sync._teacher_attendee_emails).
- `_event_fingerprint(title: str, description: str, class_: Class, attendees: List[str])` — L648: Huella corta de lo que la sync empuja a Google para esta clase.
- `create_calendar_event(service, calendar_id: str, title: str, start_utc: datetime, end_utc: datetime, description: str='', meet_link: Optional[str]=None, attendee_)` — L658
- `_extract_meet_link(event: dict)` — L695: Saca el link de Google Meet de un evento con conferenceData.
- `create_calendar_event_with_meet(service, calendar_id: str, title: str, start_utc: datetime, end_utc: datetime, description: str='', attendee_emails: Optional[List[str]]=Non)` — L706: Crea un evento en Google Calendar generando de una vez un link de Google Meet real (conferenceData). Devuelve (event_id, meet_link); cualquiera de los dos puede venir None si falló ese paso puntual.
- `add_meet_conference_to_event(service, calendar_id: str, event_id: str, attendee_emails: Optional[List[str]]=None)` — L750: Agrega un link de Google Meet real a un evento ya existente (conferenceData). Devuelve el link generado, o None si el evento ya no existe (fue borrado externamente) o si la generación falla — en ambos casos el llamador debe manejarlo sin romper el flujo.
- `update_calendar_event(service, calendar_id: str, event_id: str, start_utc: Optional[datetime]=None, end_utc: Optional[datetime]=None, meet_link: Optional[str]=Non)` — L806
- `delete_calendar_event(service, calendar_id: str, event_id: str)` — L868
- `sync_calendar_logic(teacher_id: int, db: Session)` — L886
- `_teachers_needing_sync(db: Session, tokens: List[GoogleCalendarToken], now: datetime)` — L1049: Solo los profesores con una clase propia (no Preply) en curso o en la ventana activa, o cuya ultima sync es antigua (ciclo ocioso: importar Preply / refrescar). El resto se salta: cero llamadas a Google.
- `run_calendar_sync_for_all_teachers(db: Session)` — L1073

## app/core/grant_emails.py

- `send_admin_manual_grant_requested_email(to_email: str, teacher_name: str, student_name: str, package_name: str, reason: str)` — L16
- `send_manual_grant_resolved_email(to_email: str, teacher_name: str, student_name: str, approved: bool, rejection_reason: str | None=None)` — L33

## app/core/group_cohort_logic.py

- `get_cohort_active_count(cohort_id: int, db: Session)` — L12: Enrollments activos (no cancelados) inscritos en esta cohorte.
- `get_cohort_student_ids(cohort_id: int, teacher_id: int, db: Session)` — L20: StudentProfile.id de todos los integrantes activos (no cancelados) de una cohorte, validando que le pertenezca al profesor que la consulta. Usado para asignar materiales/tareas a un grupo entero de una sola vez (ver endpoints /materials/{id}/assign y POST /homework/). Devuelve [] si la cohorte no ex
- `get_enrollment_group_occupied_slots(enrollment: Enrollment, db: Session)` — L42: Equivalente a _get_enrollment_occupied_slots (payments.py) pero para enrollments grupales: las clases grupales no llevan Class.enrollment_id (una misma Class es compartida por varios alumnos), así que se cuenta vía ClassParticipant.
- `release_cohort_seat(enrollment: Enrollment, db: Session, keep_cohort_id: bool=False)` — L61: Libera el cupo de un alumno que migra de grupal a individual (o cuyo enrollment grupal se cancela). No hace commit — el caller decide cuándo.
- `close_cohort(cohort: GroupCohort, start_date, db: Session)` — L97: El profesor cierra la cohorte manualmente con los integrantes actuales, sin importar si llegó al mínimo definido.
- `release_and_cancel_all_cohort_enrollments(cohort_id: int, db: Session)` — L105: Libera el cupo y CANCELA cada enrollment activo de una cohorte — lógica compartida entre cancel_cohort (el profesor la aborta porque no se llenó) y complete_cohort (el paquete/las sesiones ya cumplieron su ciclo pero el grupo quedó por debajo del mínimo). En ambos casos el alumno debe quedar libre d
- `cancel_future_cohort_sessions(cohort_id: int, db: Session)` — L125: Cancela las sesiones (Class) FUTURAS que ya estaban agendadas para una cohorte que se acaba de cancelar o completar bajo el mínimo.
- `cancel_cohort(cohort: GroupCohort, db: Session)` — L152: Cancela una cohorte que no se llenó (o que el profesor decide abortar antes de que arrancara). Libera el cupo de TODOS sus enrollments activos y además CANCELA cada enrollment por completo (antes solo se liberaba el cupo y el enrollment quedaba "activo" pero sin cohorte — un estado inconsistente: el

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

- `_recalc_weekly_rows(rows, old_tz: str, new_tz: str)` — L37: Recalcula filas (preferencias del estudiante) con day_of_week + start_time_utc/end_time_utc ("HH:MM"), preservando la hora local y recalculando el UTC para la nueva zona horaria. Devuelve un resumen de los cambios para notificar al usuario.
- `_recalc_exception_rows(rows, old_tz: str, new_tz: str)` — L85: Recalcula excepciones puntuales (fecha real + hora), preservando la fecha y hora de reloj local exactas al reinterpretarlas en la nueva zona horaria.
- `recalculate_teacher_schedule_timezone(teacher_id: int, old_tz: str, new_tz: str, db: Session)` — L123: Tras un cambio de zona del profesor. Fase 26: el horario SEMANAL ya esta en hora local y no se toca (`weekly_changes` siempre vacio, se mantiene la clave por compatibilidad). Solo se reinterpretan las excepciones puntuales (fecha real + hora de reloj local). NO hace commit.
- `apply_teacher_timezone_change(profile, new_tz: str, db: Session)` — L142: Pone `new_tz` en el perfil del profesor, reinterpreta sus excepciones y marca su cache de huecos para descartarla al commit (el horario semanal en hora local cambia de UTC sin tocar TeacherAvailability, asi que la invalidacion automatica por entidades no lo veria). NO hace commit.
- `recalculate_student_preferences_timezone(student_id: int, old_tz: str, new_tz: str, db: Session)` — L154: Recalcula las preferencias de horario del estudiante tras un cambio de zona horaria. NO hace commit.

## app/core/scheduler.py

- `class JobFailed()` — L27: Un job por vencimiento no pudo con alguno de sus elementos. `_run_due_job` la cuenta como fallo (reintento con espera creciente y tope de intentos, ver `compute_run_at`).
- `finalize_expired_classes()` — L32: Job que se ejecuta cada 10 minutos. Marca como 'finalized' las clases confirmadas cuyo horario ya pasó.
- `_reminder_hours(class_: Class, now: datetime)` — L57: Horas que se dicen en el correo: 24 en la ventana clasica 23-25 h; si no, las reales (minimo 1).
- `send_class_reminders()` — L65: Job por vencimiento. Recuerda (una sola vez, via reminder_sent_at) las clases no canceladas ni externas que empiezan en las proximas 25 h y a mas de 30 min.
- `send_chat_digests()` — L218: Job por vencimiento: un correo por profesor con sus conversaciones de chat pendientes (core/chat_digest.py).
- `generate_upcoming_meet_links()` — L234: Job que se ejecuta cada 5 minutos. Genera automáticamente el link de videollamada (Google Meet, vía el Calendar del profesor) para las clases confirmadas que empiezan dentro de la ventana configurada por el superadmin (meet_link_autogen_minutes en PlatformConfig, default 30 min) y todavía NO tienen 
- `sync_all_teacher_calendars()` — L303: Job que se ejecuta cada 30 minutos, en segundo plano, sin depender de que algún profesor tenga el panel abierto.
- `notify_low_credit_packages()` — L326: Job semanal. Revisa enrollments activos con pocas clases restantes (finitos o ilimitados con crédito prepagado) y avisa al estudiante si no se le avisó ya dentro de la ventana configurada por el superadmin (low_credit_renotify_days en PlatformConfig).
- `purge_old_chat_messages()` — L381: Job diario. Borra mensajes de chat interno más viejos que PlatformConfig.chat_retention_days (0 = sin límite, no borra nada).
- `release_stale_enrollments()` — L401: Job diario. Cancela los enrollments sin pagar de mas de 24 h (antes lo hacia un GET).
- `purge_old_logs()` — L416: Job diario. Purga `error_logs` y `email_log` por antiguedad (core/retention.py).
- `class DueJob()` — L462
- `_due_finalize(job: DueJob, db: Session, now: datetime)` — L471: Primera clase que hay que cerrar: confirmed/pending_trial al terminar, finalized a las 72 h de terminar.
- `_due_meet_links(job: DueJob, db: Session, now: datetime)` — L487: Hora en que la proxima clase sin link entra en la ventana de autogeneracion. Solo cuentan los profesores con Google Calendar conectado: sin el, no se puede generar el link y el job reintentaba cada 5 min (despertando Neon) durante toda la ventana previa a cada clase.
- `_due_chat_digest(job: DueJob, db: Session, now: datetime)` — L509
- `_due_reminders(job: DueJob, db: Session, now: datetime)` — L514: Recordatorio unico (Fase 27): vence 25 h antes del inicio. Si ya falta menos de 25 h (reserva tardia) vence ya (`now`), salvo que falten <= 30 min (no se avisa; se ignora). Ver send_class_reminders.
- `_due_calendar_sync(job: DueJob, db: Session, now: datetime)` — L530: Sin profesores con Calendar conectado no hay nada que sincronizar. Con clase en curso o en las proximas 3 h: cada 30 min. Si no: cada 6 h, y siempre antes de que la proxima clase entre en esa ventana.
- `retry_delay(job: DueJob)` — L571: Espera antes de reintentar tras `job.failures` fallos seguidos: min_gap x 2^(fallos-1), con tope MAX_BACKOFF.
- `compute_run_at(job: DueJob, due: Optional[datetime], now: datetime)` — L576: Cuando programar la proxima ejecucion: `due` acotado a [ahora+1s, ahora+MAX_SLEEP] y respetando `min_gap`.
- `reschedule_job(job: DueJob)` — L589: Recalcula (con una consulta corta) cuando le toca al job y lo programa. Nunca lanza.
- `report_job_failure(job: DueJob, exc: Exception)` — L608: Deja el fallo en la pantalla de Logs del admin (ErrorLog) con el numero de intento. Nunca lanza.
- `_run_due_job(job_id: str)` — L625
- `reschedule_all_due_jobs()` — L638
- `request_reschedule(delay_seconds: int=3)` — L643: Pide recalcular los vencimientos (con un pequeño retraso: varias escrituras seguidas cuentan una vez).
- `_watched_models()` — L659
- `_after_flush(session, flush_context)` — L665
- `_after_commit(session)` — L670
- `_after_soft_rollback(session, previous_transaction)` — L675
- `install_session_hooks()` — L679
- `start_scheduler()` — L690
- `stop_scheduler()` — L704: Para el scheduler al apagar la aplicación

## app/core/slot_availability.py

- `window_for_local_dates(start_date: str, tz_name: Optional[str], days: int=1)` — L42: [00:00 local de start_date, 00:00 local de start_date + days) como instantes UTC. Sin zona (o "UTC") es el dia UTC clasico. Lanza ValueError si fecha o zona no son validas.
- `resolve_zone(tz_name: Optional[str])` — L54: ZoneInfo de la zona del profesor; nula o invalida -> UTC (ver docstring del modulo).
- `local_wall_to_utc(naive: datetime, tz: ZoneInfo)` — L64: Hora de reloj local (naive) -> instante UTC. Ambigua: primera ocurrencia (fold=0). Inexistente (salto de primavera): el instante del salto, es decir la primera hora que si existe.
- `local_range_to_utc(day: date, start_hhmm: str, end_hhmm: str, tz: ZoneInfo)` — L79: Franja semanal de la fecha LOCAL `day` -> (inicio, fin) UTC. fin <= inicio cruza la medianoche local. None si el texto no es HH:MM valido o si la franja queda vacia tras saltar horas inexistentes.
- `weekly_ranges_for_window(rows: Iterable[TeacherAvailability], tz_name: Optional[str], w0: datetime, w1: datetime)` — L98: Rangos UTC concretos de las filas semanales (hora local en la zona `tz_name`) que solapan con [w0, w1). Incluye la cola de la fila del dia local anterior que cruza la medianoche local.
- `class TeacherWindow()` — L120: Todo lo que condiciona la agenda del profesor en una ventana.
- `load_busy_classes(db: Session, teacher_id: int, w0: datetime, w1: datetime, exclude_class_id: Optional[int]=None)` — L132: Clases que ocupan la agenda en algun punto de [w0, w1): (inicio, fin + margen propio, id). Por SOLAPE (no por inicio dentro del dia UTC). BUG-04: cancelled/expired no ocupan; pending_trial y sesiones grupales si.
- `load_teacher_window(db: Session, teacher_id: int, w0: datetime, w1: datetime, pad: timedelta=timedelta(0), exclude_class_id: Optional[int]=None, include_classes)` — L154: 3 consultas (semanal, excepciones, clases). Los rangos se buscan por solape con [w0, w1); bloqueos y clases por solape con [w0, w1 + pad) (un hueco que empieza antes de w1 ocupa hasta +pad). BUG-04: clases "cancelled"/"expired" no ocupan. Las grupales y pending_trial SI ocupan.
- `slot_free(tw: TeacherWindow, start: datetime, occupied_end: datetime)` — L194: [start, occupied_end) cabe en UN rango declarado, sin bloqueo ni clase encima. (Google se comprueba aparte: es una llamada externa.) Devuelve (ok, motivo).
- `is_slot_free(db: Session, teacher_id: int, start_utc: datetime, occupied_end_utc: datetime, exclude_class_id: Optional[int]=None)` — L208: Version "una sola franja" para la validacion de reservas (misma logica que la rejilla).
- `compute_slot_grid(tw: TeacherWindow, occupancy_minutes: int, google_busy: Optional[List[Range]]=None, step_minutes: int=SLOT_STEP_MINUTES)` — L220: Inicios de hueco dentro de [w0, w1) -> (inicio, ocupado). La rejilla va de 30 en 30 desde el inicio de cada rango; el bloque entero (clase + margen) debe caber en el rango. Un inicio puede pertenecer a un rango que empieza antes de w0 o termina despues de w1.
- `preference_intervals_for_window(prefs, w0: datetime, w1: datetime)` — L247: Preferencias del alumno (`day_of_week` UTC + HH:MM UTC, fin <= inicio cruza medianoche) como intervalos UTC concretos que solapan con [w0, w1). Evita comparar cadenas "23:30" <= t < "01:00".

## app/core/slots_cache.py

- `slots_key(teacher_id: int, date: str, duration: int, occupancy: int)` — L45
- `class Uncacheable()` — L49: El loader devuelve esto (con la rejilla dentro) cuando el resultado es degradado y NO debe cachearse, p. ej. cuando freebusy de Google fallo: se sirve a esta peticion pero la siguiente vuelve a calcular.
- `cached_slot_grid(teacher_id: int, date: str, duration: int, occupancy: int, loader: Callable[[], Any])` — L57
- `invalidate_teacher_slots(teacher_id: int)` — L75
- `invalidate_all_slots()` — L79
- `_pending(session: Session)` — L83
- `mark_teacher_slots_dirty(session: Session, teacher_id: int)` — L87: Descarta la cache del profesor al hacer commit de esta sesion aunque no cambie ninguna entidad rastreada (p. ej. cambia su zona horaria: el horario semanal en hora local mueve el UTC).
- `_teacher_ids(obj: Any)` — L93: teacher_id actual y, si cambió (sustitución de profesor), también el anterior. Si no está cargado (no se lanza SQL dentro del flush), se invalida todo.
- `_collect_after_flush(session: Session, _flush_context)` — L102
- `_collect_bulk(orm_execute_state)` — L110
- `_invalidate_after_commit(session: Session)` — L119

## app/core/spoken_languages.py

- `class SpokenLanguagesError()` — L36: Entrada invalida; el mensaje es apto para mostrar al usuario (HTTP 422).
- `_key(text: str)` — L40: Clave de comparacion: sin tildes, sin mayusculas, sin espacios sobrantes.
- `get_catalog(db: Session)` — L46
- `read_spoken_languages(raw)` — L52: Lee lo guardado (formato nuevo o textos sueltos de la Fase 8) como [{language, level|None}]. Nunca lanza.
- `language_names(raw)` — L64
- `speaks(raw, language: str)` — L68: True si la lista incluye ese idioma (sin distinguir mayusculas ni tildes).
- `normalize_spoken_languages(raw, catalog: list[str])` — L74: Valida y normaliza. Devuelve [{language, level}] con la ortografia del catalogo; lanza SpokenLanguagesError si no es valida. Cada elemento debe ser {"language": ..., "level": ...} con un nivel de LEVELS.

## app/core/storage.py

- `_slugify(text: str)` — L88
- `_matches_declared_type(file_bytes: bytes, content_type: str)` — L109
- `_resource_type_for(content_type: str)` — L156: Determina el resource_type correcto de Cloudinary según el content_type. Crítico para video: si se sube con resource_type="auto" (o "raw"), Cloudinary puede aplicarle el límite de tamaño de imagen/raw del plan (mucho más bajo) en vez del límite específico para video.
- `upload_file(file_bytes: bytes, filename: str, content_type: str, folder: str='materials', display_name: str | None=None)` — L172
- `_validate_upload(head: bytes, size: int, content_type: str, max_bytes: int | None=None)` — L186: Valida tamano y firma (magic bytes) sin necesitar el archivo completo.
- `upload_file_stream(fileobj, filename: str, content_type: str, folder: str='materials', display_name: str | None=None, allowed_types: set | frozenset | None=Non)` — L209: Igual que upload_file, pero recibe un objeto tipo archivo (p. ej. `UploadFile.file`, que Starlette ya guarda en disco si pasa de 1 MB) en vez de bytes: el archivo nunca se carga entero en RAM. Valida tamano y firma ANTES de enviar nada, y los videos se suben por trozos (`upload_large`).
- `_send_to_cloudinary(data, filename: str, content_type: str, folder: str, display_name: str | None)` — L242: `data` puede ser bytes o un objeto tipo archivo.
- `delete_file(public_id: str, resource_type: str='image')` — L278

## app/core/student_overlap.py

- `student_has_overlap(db: Session, student_id: int, start: datetime, end: datetime, exclude_class_id: int | None=None)` — L21: True si el alumno ya tiene otra clase (individual con cualquier profesor, o sesión grupal en la que participa) que se solapa con [start, end). Sin margen de preparación del profesor.

## app/core/teacher_students.py

- `ensure_student_teacher_link(db: Session, student_id: int, teacher_id: int)` — L8: Crea el StudentTeacherLink si no existe. Devuelve True si lo creó.
- `link_student_to_teacher(db: Session, student_profile: StudentProfile, new_teacher: TeacherProfile, old_teacher_username: str | None=None, commit: bool=True)` — L42: Mantiene sincronizado teacher_profiles.students (lista de StudentProfile.id) cada vez que un estudiante queda vinculado a un profesor, y crea (si no existe todavía) la conversación de chat directa entre ambos — así no hace falta que ninguno de los dos entre a apretar "Chat" para que la conversación 
- `backfill_student_teacher_links(db: Session, commit: bool=True)` — L97: Reconstruye, de forma ATÓMICA e idempotente, los vínculos alumno-profesor a partir del historial.

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

- `_get_cache_key(word: str, voice: str, speed: float)` — L28: Genera una clave única para cada combinación de palabra + voz + velocidad. Usamos hash para tener claves cortas y consistentes.
- `count_cached(words: list[str], voice: str=DEFAULT_VOICE, speed: float=DEFAULT_SPEED)` — L37: Cuantas de estas palabras ya tienen audio en cache (consultar ANTES de generar, para informar cached).
- `async generate_word_audio(word: str, voice: str=DEFAULT_VOICE, speed: float=DEFAULT_SPEED)` — L42: Genera audio de alta calidad para una palabra usando OpenAI TTS. Cachea el resultado en Cloudinary para no regenerar.
- `async generate_batch_audio(words: list[str], voice: str=DEFAULT_VOICE, speed: float=DEFAULT_SPEED)` — L108: Genera audio para múltiples palabras de forma eficiente. Solo genera las que no están en caché.

## app/core/upload_quota.py

- `quota_bytes()` — L21
- `get_upload_size(fileobj)` — L25: Tamano en bytes de un objeto tipo archivo sin cargarlo en memoria (deja el puntero al inicio).
- `used_bytes(db: Session, teacher_id: int)` — L33
- `usage(db: Session, teacher_id: int)` — L39
- `ensure_quota(db: Session, teacher_id: int, new_size: int)` — L46: 413 si subir `new_size` bytes superaria la cuota del profesor.

## app/core/wallet.py

- `_ensure_wallet_row(db: Session, teacher_id: int)` — L16
- `wallet_apply(db: Session, teacher_id: int, *, balance: float=0.0, earned: float=0.0, withdrawn: float=0.0, allow_negative: bool=False)` — L27: Suma (o resta, con signo negativo) a la billetera de forma atomica. No hace commit.

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
- `require_superadmin(current_user: User=Depends(get_current_user))` — L98: Solo superadmin (para dinero, modo de plataforma y acciones sobre otros profesores).
- `get_current_staff(current_user: User=Depends(get_current_user))` — L108: Permite acceso a superadmin Y teacher_admin. Para endpoints que ambos pueden usar.
- `get_current_teacher_or_teacher_admin(current_user: User=Depends(get_current_user))` — L126: Permite acceso a teacher Y teacher_admin. Para endpoints de gestión de clases propias.
- `get_current_approved_teacher(current_user: User=Depends(get_current_user))` — L143: Solo permite acceso a profesores con status='approved'. Se usa donde el profesor asigna material o tareas.
- `get_current_staff_or_teacher(current_user: User=Depends(get_current_user))` — L164: Permite acceso a superadmin, teacher_admin y teacher. Se usa para aprobar renovaciones de paquete: el staff o el propio profesor del estudiante pueden confirmar el pago y activarla.
- `require_verified_email(user)` — L182: SEC-04 (politica suave): retiros y pagos exigen email verificado. Las cuentas previas quedaron verificadas en la migracion.

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
- `_hard_revoked_at()` — L92: Instante de una revocación DEFINITIVA: se fecha fuera de la ventana de gracia de rotación, para que el token revocado no se acepte durante REFRESH_REUSE_GRACE_SECONDS como si fuera una carrera entre pestañas (Fase 21).
- `_revoke_family(db: Session, family_id: str)` — L98
- `revoke_all_sessions(db: Session, user_id: int)` — L104: Cierra TODAS las sesiones del usuario (cambio/restablecimiento de contrasena, borrado de cuenta).
- `rotate_refresh_token(db: Session, raw: Optional[str])` — L115: Valida el refresh y lo rota. Devuelve (usuario, family_id) o None si no es valido. - Desconocido o vencido -> None. - Ya revocado: dentro de la ventana de gracia se acepta (carrera entre pestanas); fuera de ella se asume   reutilizacion/robo y se revoca TODA la familia.
- `revoke_refresh_family(db: Session, raw: Optional[str])` — L149: Logout: revoca la familia del refresh presentado (si es valido o conocido).
- `token_from_request(request: Request)` — L159: Token de acceso de la peticion: cabecera Authorization (clientes API / transicion) o cookie.

## app/db/base.py

- `class Base()` — L49
- `get_db()` — L53
