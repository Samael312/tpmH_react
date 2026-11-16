# API_REFERENCE (generado)

Generado por `backend/doc/generate_docs.py`. Prefijo global: `/api/v1`.
Auth = dependencia FastAPI de rol detectada. `—` = sin autenticación (pública).

Total de rutas: **211**


## Autenticación

| Método | Ruta | Auth | Límite | Función (archivo:línea) | Qué hace |
|---|---|---|---|---|---|
| POST | `/auth/forgot-password` | — | 5/hour | `forgot_password` (app/api/v1/endpoints/auth.py:247) | Inicia el flujo de recuperación de contraseña. Siempre devuelve 200 aunque el email no exista para no revelar qué emails están registrados. |
| POST | `/auth/forgot-username` | — | 5/hour | `forgot_username` (app/api/v1/endpoints/auth.py:332) | Envía el nombre de usuario asociado a un email. Igual que forgot-password: siempre devuelve el mismo mensaje, exista o no el email, para no revelar qué correos están registrados. |
| POST | `/auth/google` | — | 20/minute | `google_login` (app/api/v1/endpoints/auth.py:135) | Paso 1 del flujo Google (GSI). Verifica el id_token contra Google. - Si el email ya tiene cuenta -> login normal, devuelve token. - Si no existe -> NO crea la cuenta. Devuelve needs_registration=True   junto con los datos de Google para que el frontend pida   username + rol antes de crear la cuenta. |
| POST | `/auth/google/register` | — | 10/hour | `google_register` (app/api/v1/endpoints/auth.py:192) |  |
| POST | `/auth/login` | — | 10/minute | `login` (app/api/v1/endpoints/auth.py:87) |  |
| POST | `/auth/register` | — | 5/hour | `register` (app/api/v1/endpoints/auth.py:36) |  |
| POST | `/auth/reset-password` | — | 10/hour | `reset_password` (app/api/v1/endpoints/auth.py:291) | Establece la nueva contraseña usando el token del email. |

## Usuarios

| Método | Ruta | Auth | Límite | Función (archivo:línea) | Qué hace |
|---|---|---|---|---|---|
| DELETE | `/users/me` | get_current_user |  | `delete_account` (app/api/v1/endpoints/users.py:209) | Elimina la cuenta del usuario. |
| GET | `/users/me` | get_current_user |  | `get_me` (app/api/v1/endpoints/users.py:113) | Devuelve los datos del usuario autenticado |
| PATCH | `/users/me` | get_current_user |  | `update_profile` (app/api/v1/endpoints/users.py:119) | Actualiza datos básicos del perfil. Solo actualiza los campos que se envían (PATCH parcial). |
| GET | `/users/me/avatar` | get_current_user |  | `get_avatar` (app/api/v1/endpoints/users.py:270) | Obtiene la URL del avatar/foto del usuario autenticado. |
| PATCH | `/users/me/avatar` | get_current_user |  | `upload_avatar_patch` (app/api/v1/endpoints/users.py:303) | Actualiza la foto de perfil (PATCH /me/avatar). |
| POST | `/users/me/avatar` | get_current_user |  | `upload_avatar_post` (app/api/v1/endpoints/users.py:293) | Sube o reemplaza la foto de perfil (POST /me/avatar). |
| POST | `/users/me/change-password` | get_current_user | 10/hour | `change_password` (app/api/v1/endpoints/users.py:182) | Cambia la contraseña verificando la actual |
| GET | `/users/me/photo` | get_current_user |  | `get_photo` (app/api/v1/endpoints/users.py:287) | Alias para obtener la foto de perfil (GET /me/photo). |
| PATCH | `/users/me/photo` | get_current_user |  | `upload_photo_patch` (app/api/v1/endpoints/users.py:323) | Alias de compatibilidad para actualizar foto (PATCH /me/photo). |
| POST | `/users/me/photo` | get_current_user |  | `upload_photo_post` (app/api/v1/endpoints/users.py:313) | Alias de compatibilidad para subir foto (POST /me/photo). |
| GET | `/users/me/preferences` | get_current_student, get_current_user |  | `get_schedule_preferences` (app/api/v1/endpoints/users.py:458) | Devuelve las preferencias de horario del estudiante en UTC para que el frontend las adapte |
| POST | `/users/me/preferences` | get_current_student, get_current_user |  | `set_schedule_preferences` (app/api/v1/endpoints/users.py:404) | El estudiante configura sus horas preferidas. Reemplaza todas las preferencias anteriores. |
| PUT | `/users/me/preferences` | get_current_student, get_current_user |  | `update_schedule_preferences` (app/api/v1/endpoints/users.py:476) | Actualiza (reemplaza) las preferencias de horario del estudiante vía PUT. |
| GET | `/users/me/student-profile` | get_current_user |  | `get_student_profile` (app/api/v1/endpoints/users.py:335) | Devuelve los datos del perfil de estudiante del usuario autenticado |
| PATCH | `/users/me/student-profile` | get_current_user |  | `update_student_profile` (app/api/v1/endpoints/users.py:356) | Actualiza datos del perfil de estudiante (timezone, goal, etc.). Si cambia la zona horaria, se recalculan las preferencias de horario (StudentSchedulePreference) para preservar la hora LOCAL configurada por el estudiante — solo se recalcula el UTC equivalente. Ver core/schedule_recalc.py. |
| GET | `/users/me/teachers` | get_current_student, get_current_user |  | `get_my_teachers` (app/api/v1/endpoints/users.py:528) | Profesores vinculados al estudiante, cada uno con su relación independiente (stage de reserva propio, enrollment activo si existe). En single-tenant siempre devuelve solo al featured teacher, para que el frontend use la misma forma de respuesta en ambos modos. |
| DELETE | `/users/me/teachers/{teacher_username}` | get_current_student, get_current_user |  | `unlink_teacher` (app/api/v1/endpoints/users.py:642) | Termina la relación con un profesor (solo multi-tenant). Bloqueado si hay un enrollment activo o cualquier solicitud pendiente (renovación o cambio de paquete) con ese profesor. |
| POST | `/users/me/teachers/{teacher_username}` | get_current_student, get_current_user |  | `link_teacher` (app/api/v1/endpoints/users.py:601) | Vincula al estudiante con un profesor adicional (solo multi-tenant). Idempotente — si el vínculo ya existe, no falla. |

## Profesores

| Método | Ruta | Auth | Límite | Función (archivo:línea) | Qué hace |
|---|---|---|---|---|---|
| GET | `/teachers/` | — |  | `list_approved_teachers` (app/api/v1/endpoints/teachers.py:43) | Lista profesores aprobados. Filtrable por materia e idioma. Endpoint público. Excluye cuentas fijas de la suite de tests (is_test_account=True) — no deben aparecer en el marketplace real. |
| POST | `/teachers/me/appeal` | get_current_teacher, get_current_user |  | `submit_appeal` (app/api/v1/endpoints/teachers.py:417) | El profesor apela un rechazo. Máximo 2 apelaciones por ciclo de rechazo. Al agotar las 2, debe subir un nuevo video (POST /teachers/me/video) para reiniciar el ciclo — no se pueden presentar más apelaciones. |
| GET | `/teachers/me/appeals` | get_current_teacher, get_current_user |  | `get_my_appeals` (app/api/v1/endpoints/teachers.py:475) |  |
| PATCH | `/teachers/me/feedback-seen` | get_current_teacher, get_current_user |  | `mark_rejection_feedback_seen` (app/api/v1/endpoints/teachers.py:403) | El profesor marcó como visto el banner de retroalimentación de rechazo. |
| GET | `/teachers/me/profile` | get_current_teacher, get_current_user |  | `get_my_teacher_profile` (app/api/v1/endpoints/teachers.py:106) | Devuelve el perfil completo del profesor autenticado |
| PATCH | `/teachers/me/profile` | get_current_teacher, get_current_user |  | `update_my_teacher_profile` (app/api/v1/endpoints/teachers.py:121) | Actualiza el perfil del profesor autenticado. Si cambia la zona horaria, se recalcula la disponibilidad semanal y las excepciones puntuales para que la hora LOCAL configurada por el profesor se preserve (ej. "06:00-08:00" en Sydney sigue siendo "06:00-08:00" al pasar a Bogotá) — lo único que cambia  |
| GET | `/teachers/me/students` | get_current_teacher, get_current_user |  | `get_my_students` (app/api/v1/endpoints/teachers.py:171) | Lista los estudiantes vinculados al profesor autenticado (teacher_profiles.students). La usan los modales de asignar material/tareas para buscar solo entre sus propios estudiantes. |
| GET | `/teachers/me/students-full` | get_current_teacher, get_current_user |  | `get_my_students_full` (app/api/v1/endpoints/teachers.py:206) | Devuelve la info completa de los estudiantes vinculados al profesor: datos de contacto, progreso de paquetes (enrollments) y materiales asignados. Pensado para la página de gestión de Estudiantes. |
| DELETE | `/teachers/me/video` | get_current_teacher, get_current_user |  | `delete_teacher_video` (app/api/v1/endpoints/teachers.py:374) | Elimina el video de presentación del profesor. |
| POST | `/teachers/me/video` | get_current_teacher, get_current_user |  | `upload_teacher_video` (app/api/v1/endpoints/teachers.py:298) | Sube (o reemplaza) el video de presentación del profesor. Es un requisito obligatorio para que el superadmin pueda aprobar el perfil. |
| GET | `/teachers/{username}` | — |  | `get_teacher_profile` (app/api/v1/endpoints/teachers.py:81) | Perfil público de un profesor específico. Endpoint público — no requiere autenticación. |

## Disponibilidad

| Método | Ruta | Auth | Límite | Función (archivo:línea) | Qué hace |
|---|---|---|---|---|---|
| GET | `/availability/featured-teacher/slots` | get_current_user |  | `get_featured_teacher_slots` (app/api/v1/endpoints/availability.py:533) | Slots disponibles de la profesora featured. |
| GET | `/availability/featured-teacher/username` | — |  | `get_featured_teacher_username` (app/api/v1/endpoints/availability.py:516) | Solo el username del profesor featured — para pantallas de booking en modo single-tenant que necesitan resolverlo UNA vez y reusarlo en endpoints que requieren el username como path param (slots, paquetes, etc.), en vez de tener que enseñarle esa lógica a cada uno. |
| GET | `/availability/me/exceptions` | get_current_teacher, get_current_user |  | `get_my_exceptions` (app/api/v1/endpoints/availability.py:113) | Devuelve todas las excepciones del profesor ordenadas por fecha |
| POST | `/availability/me/exceptions` | get_current_teacher, get_current_user |  | `add_exception` (app/api/v1/endpoints/availability.py:132) | Añade una o varias excepciones puntuales (día completo u horas específicas), opcionalmente sobre un rango de fechas (ej. vacaciones). El profesor envía fecha(s) + hora LOCAL + su zona horaria; el backend convierte a UTC usando la fecha real de cada día (sin ambigüedad de DST). |
| DELETE | `/availability/me/exceptions/{exception_id}` | get_current_teacher, get_current_user |  | `delete_exception` (app/api/v1/endpoints/availability.py:238) | Elimina una excepción específica del profesor. Verifica que la excepción exista y pertenezca al profesor autenticado. |
| GET | `/availability/me/weekly` | get_current_teacher, get_current_user |  | `get_my_weekly_availability` (app/api/v1/endpoints/availability.py:39) | Devuelve la disponibilidad semanal del profesor en UTC |
| PUT | `/availability/me/weekly` | get_current_teacher, get_current_user |  | `set_my_weekly_availability` (app/api/v1/endpoints/availability.py:56) | Actualiza (reemplaza) la disponibilidad semanal del profesor vía PUT. |
| GET | `/availability/{teacher_username}/slots` | get_current_user |  | `get_teacher_available_slots` (app/api/v1/endpoints/availability.py:273) | Devuelve los slots disponibles de un profesor para una fecha. Devuelve UTC. El frontend convierte a zona local del usuario. |

## Clases

| Método | Ruta | Auth | Límite | Función (archivo:línea) | Qué hace |
|---|---|---|---|---|---|
| DELETE | `/classes/admin/{class_id}` | get_current_staff, get_current_user |  | `cancel_class_admin` (app/api/v1/endpoints/classes.py:880) | El staff/admin cancela una clase. El crédito SIEMPRE se reembolsa, igual que en la cancelación del profesor. |
| PATCH | `/classes/admin/{class_id}/reschedule` | get_current_staff, get_current_user |  | `reschedule_class_admin` (app/api/v1/endpoints/classes.py:833) |  |
| GET | `/classes/my-classes` | get_current_student, get_current_user |  | `get_my_classes_student` (app/api/v1/endpoints/classes.py:280) |  |
| GET | `/classes/teacher/classes` | get_current_teacher_or_teacher_admin, get_current_user |  | `get_my_classes_teacher` (app/api/v1/endpoints/classes.py:565) |  |
| DELETE | `/classes/teacher/{class_id}` | get_current_teacher_or_teacher_admin, get_current_user |  | `cancel_class_teacher` (app/api/v1/endpoints/classes.py:724) | El profesor cancela una clase. El crédito SIEMPRE se le reembolsa al estudiante, sin importar la antelación — la penalización de 12h es exclusivamente para cancelaciones hechas por el propio estudiante. |
| PATCH | `/classes/teacher/{class_id}/reschedule` | get_current_teacher_or_teacher_admin, get_current_user |  | `reschedule_class_teacher` (app/api/v1/endpoints/classes.py:780) |  |
| POST | `/classes/trial` | get_current_staff, get_current_user |  | `book_trial_class` (app/api/v1/endpoints/classes.py:482) |  |
| DELETE | `/classes/{class_id}` | get_current_student, get_current_user |  | `cancel_class_student` (app/api/v1/endpoints/classes.py:386) |  |
| DELETE | `/classes/{class_id}/leave` | get_current_student, get_current_user |  | `leave_group_class` (app/api/v1/endpoints/classes.py:330) | El estudiante cancela SU participación en una sesión grupal puntual (Class con class_type='group'). No cancela la clase para los demás inscritos — solo libera su propio cupo (vía ClassParticipant), igual que hace release_cohort_seat al migrar de grupal a individual. |
| PATCH | `/classes/{class_id}/meet-link` | get_current_teacher_or_teacher_admin, get_current_user |  | `update_meet_link` (app/api/v1/endpoints/classes.py:693) | El profesor carga/edita manualmente el link de la videollamada. Campo 100% opcional: no bloquea ninguna otra acción sobre la clase. Solo se permite mientras la clase está 'confirmed' (mismo estado en el que ClassResponse se lo muestra al estudiante). |
| PATCH | `/classes/{class_id}/reschedule` | get_current_student, get_current_user |  | `reschedule_class_student` (app/api/v1/endpoints/classes.py:418) |  |
| PATCH | `/classes/{class_id}/status` | get_current_teacher_or_teacher_admin, get_current_user |  | `update_class_status` (app/api/v1/endpoints/classes.py:625) |  |

## Materiales

| Método | Ruta | Auth | Límite | Función (archivo:línea) | Qué hace |
|---|---|---|---|---|---|
| POST | `/materials/` | get_current_teacher, get_current_user |  | `create_material` (app/api/v1/endpoints/materials.py:28) | El profesor crea un material. Puede ser un archivo subido o solo metadatos (para sets de vocabulario que se crean por separado). |
| GET | `/materials/my-materials` | get_current_teacher, get_current_user |  | `get_my_materials_teacher` (app/api/v1/endpoints/materials.py:251) | Devuelve todos los materiales del profesor |
| GET | `/materials/student/my-materials` | get_current_student, get_current_user |  | `get_my_materials_student` (app/api/v1/endpoints/materials.py:297) | Devuelve los materiales asignados al estudiante |
| PATCH | `/materials/student/{assignment_id}/progress` | get_current_student, get_current_user |  | `update_material_progress` (app/api/v1/endpoints/materials.py:312) | El estudiante actualiza su progreso en un material |
| DELETE | `/materials/{material_id}` | get_current_teacher, get_current_user |  | `delete_material` (app/api/v1/endpoints/materials.py:263) | Elimina un material. Borra el archivo de Cloudinary y desactiva el material en BD. |
| PATCH | `/materials/{material_id}` | get_current_teacher, get_current_user |  | `update_material` (app/api/v1/endpoints/materials.py:89) | Edita los datos de un material existente: título, descripción, categoría y/o nivel. No reemplaza el archivo ni las palabras de vocabulario — eso se maneja desde sus propios endpoints. |
| POST | `/materials/{material_id}/assign` | get_current_approved_teacher, get_current_user |  | `assign_material` (app/api/v1/endpoints/materials.py:158) | Asigna un material a uno o varios de TUS estudiantes (StudentProfile.id) y/o a todos los integrantes de una de tus cohortes grupales (cohort_id). |
| GET | `/materials/{material_id}/stream` | get_current_user |  | `stream_material_file` (app/api/v1/endpoints/materials.py:348) | Redirige directamente al archivo en Cloudinary de forma segura |
| POST | `/materials/{material_id}/vocabulary` | get_current_teacher, get_current_user |  | `set_vocabulary_words` (app/api/v1/endpoints/materials.py:122) | Establece las palabras de un set de vocabulario. Las palabras se capitalizan automáticamente. |

## Tareas

| Método | Ruta | Auth | Límite | Función (archivo:línea) | Qué hace |
|---|---|---|---|---|---|
| POST | `/homework/` | get_current_approved_teacher, get_current_user |  | `create_homework` (app/api/v1/endpoints/homework.py:52) | El profesor crea una tarea y la asigna a estudiantes (solo los suyos) y/o a todos los integrantes de una de sus cohortes grupales (cohort_id). |
| GET | `/homework/my-homework` | get_current_teacher, get_current_user |  | `get_my_homework_teacher` (app/api/v1/endpoints/homework.py:139) | Devuelve todas las tareas creadas por el profesor |
| GET | `/homework/student/my-homework` | get_current_student, get_current_user |  | `get_my_homework_student` (app/api/v1/endpoints/homework.py:260) | Devuelve todas las tareas del estudiante. Incluye tareas pendientes e historial. |
| POST | `/homework/student/{assignment_id}/submit` | get_current_student, get_current_user |  | `submit_homework` (app/api/v1/endpoints/homework.py:279) | El estudiante entrega una tarea |
| DELETE | `/homework/{homework_id}` | get_current_teacher, get_current_user |  | `delete_homework` (app/api/v1/endpoints/homework.py:113) | Elimina una tarea. Se desactiva en lugar de borrarse de la BD para conservar el historial de entregas ya calificadas. |
| PATCH | `/homework/{homework_id}` | get_current_teacher, get_current_user |  | `update_homework` (app/api/v1/endpoints/homework.py:25) | El profesor edita el enunciado, descripción o fecha límite de una tarea ya creada. |
| GET | `/homework/{homework_id}/submissions` | get_current_teacher, get_current_user |  | `get_homework_submissions` (app/api/v1/endpoints/homework.py:154) | El profesor ve todas las entregas de una tarea |
| PATCH | `/homework/{homework_id}/submissions/{assignment_id}/grade` | get_current_teacher, get_current_user |  | `grade_homework` (app/api/v1/endpoints/homework.py:204) | El profesor califica una entrega |

## Superadmin

| Método | Ruta | Auth | Límite | Función (archivo:línea) | Qué hace |
|---|---|---|---|---|---|
| GET | `/admin/appeals` | get_current_staff, get_current_user |  | `list_appeals` (app/api/v1/endpoints/admin.py:463) | Bandeja global de apelaciones — usada en Visión Global y en la pestaña Rechazados de Profesores. Por defecto muestra todas; filtrable por status. |
| PATCH | `/admin/appeals/{appeal_id}/resolve` | get_current_staff, get_current_user |  | `resolve_appeal` (app/api/v1/endpoints/admin.py:504) | Resuelve una apelación pendiente. - approve: el profesor vuelve a "approved" (perfil público). - reject: incrementa el conteo de apelaciones agotadas. Al llegar a 2,   el perfil permanece "rejected" pero se marca appeal_exhausted=True,   lo que habilita en el dashboard del profesor la opción de subi |
| GET | `/admin/notifications` | get_current_staff, get_current_user |  | `list_notifications` (app/api/v1/endpoints/admin.py:676) |  |
| POST | `/admin/notifications/mark-all-read` | get_current_staff, get_current_user |  | `mark_all_notifications_read` (app/api/v1/endpoints/admin.py:711) |  |
| GET | `/admin/notifications/unread-count` | get_current_staff, get_current_user |  | `unread_notification_count` (app/api/v1/endpoints/admin.py:689) |  |
| PATCH | `/admin/notifications/{notification_id}/read` | get_current_staff, get_current_user |  | `mark_notification_read` (app/api/v1/endpoints/admin.py:697) |  |
| GET | `/admin/platform-config` | — |  | `get_platform_config` (app/api/v1/endpoints/admin.py:983) | Configuración pública de la plataforma. Endpoint público — el frontend lo consulta al cargar. |
| PATCH | `/admin/platform-config` | get_current_staff, get_current_user |  | `update_platform_config` (app/api/v1/endpoints/admin.py:993) | El superadmin (o teacher_admin, como staff) configura el modo de la plataforma |
| GET | `/admin/stats` | get_current_staff, get_current_user |  | `get_platform_stats` (app/api/v1/endpoints/admin.py:99) | KPIs globales de la plataforma. Todas las métricas en una sola llamada para el dashboard. |
| POST | `/admin/students/{user_id}/ban` | get_current_staff, get_current_user |  | `ban_student` (app/api/v1/endpoints/admin.py:832) | Banea a un estudiante: lo desactiva, cancela sus enrollments activos y sus clases futuras/pendientes, y deja registrado el motivo. El email queda "quemado" por el unique constraint existente en users.email, así que no puede volver a registrarse con el mismo correo. |
| GET | `/admin/students/{user_id}/detail` | get_current_staff, get_current_user |  | `get_student_detail` (app/api/v1/endpoints/admin.py:905) | Detalle completo de un estudiante para el desplegable en /admin/students: enrollments (paquetes) y materiales asignados, con nombre del profesor y del recurso. Usado bajo demanda al expandir la card. |
| POST | `/admin/students/{user_id}/unban` | get_current_staff, get_current_user |  | `unban_student` (app/api/v1/endpoints/admin.py:882) | Revierte el baneo. No reactiva enrollments/clases canceladas automáticamente. |
| GET | `/admin/support-tickets` | get_current_staff, get_current_user |  | `list_support_tickets` (app/api/v1/endpoints/admin.py:569) | Bandeja global de tickets de soporte, filtrable por estado y categoría. |
| PATCH | `/admin/support-tickets/{ticket_id}/resolve` | get_current_staff, get_current_user |  | `resolve_support_ticket` (app/api/v1/endpoints/admin.py:614) | Responde y cierra un ticket pendiente. Notifica al usuario por email y reactiva el aviso in-app (user_notified_seen=False) en su bandeja. |
| GET | `/admin/teachers` | get_current_staff, get_current_user |  | `list_all_teachers` (app/api/v1/endpoints/admin.py:204) | Lista todos los profesores con sus métricas. Filtrable por estado: pending, approved, rejected, suspended. |
| GET | `/admin/teachers/{teacher_id}` | get_current_staff, get_current_user |  | `get_teacher_detail` (app/api/v1/endpoints/admin.py:277) | Detalle de un profesor para el modal de revisión: incluye video, motivo de rechazo y estado de apelaciones. Usado por /admin/teachers al abrir el modal de detalle. |
| GET | `/admin/teachers/{teacher_id}/appeals` | get_current_staff, get_current_user |  | `get_teacher_appeals` (app/api/v1/endpoints/admin.py:327) | Historial de apelaciones de un profesor, para el modal de detalle. |
| PATCH | `/admin/teachers/{teacher_id}/commission` | get_current_staff, get_current_user |  | `update_teacher_commission` (app/api/v1/endpoints/admin.py:420) | Actualiza la comisión de un profesor específico. Permite personalizar la comisión por profesor. |
| PATCH | `/admin/teachers/{teacher_id}/status` | get_current_staff, get_current_user |  | `update_teacher_status` (app/api/v1/endpoints/admin.py:342) | Aprueba, rechaza o suspende un profesor. Es el flujo principal de onboarding de nuevos profesores. |
| GET | `/admin/users` | get_current_staff, get_current_user |  | `list_all_users` (app/api/v1/endpoints/admin.py:726) | Lista todos los usuarios con filtros y paginación. Por defecto NO incluye baneados en /admin/students — ese listado usa is_banned=False explícitamente desde el frontend; este endpoint general deja el filtro abierto para la vista separada de baneados. |
| PATCH | `/admin/users/{user_id}` | get_current_user |  | `admin_update_user` (app/api/v1/endpoints/admin.py:1107) |  |
| PATCH | `/admin/users/{user_id}/status` | get_current_staff, get_current_user |  | `update_user_status` (app/api/v1/endpoints/admin.py:785) | Activa o desactiva un usuario (distinto de banear). No se puede desactivar a sí mismo ni a otro superadmin. |

## Reseñas

| Método | Ruta | Auth | Límite | Función (archivo:línea) | Qué hace |
|---|---|---|---|---|---|
| DELETE | `/reviews/{review_id}` | get_current_student, get_current_user |  | `delete_review` (app/api/v1/endpoints/reviews.py:251) | El estudiante elimina su propia reseña |
| GET | `/reviews/{teacher_username}` | — |  | `get_teacher_reviews` (app/api/v1/endpoints/reviews.py:145) | Devuelve todas las reseñas de un profesor. Endpoint público — no requiere autenticación. |
| POST | `/reviews/{teacher_username}` | get_current_student, get_current_user |  | `create_review` (app/api/v1/endpoints/reviews.py:37) | El estudiante deja una reseña sobre un profesor. Requisito: haber tenido al menos una clase completada con él. Solo se puede dejar una reseña por profesor. |
| GET | `/reviews/{teacher_username}/summary` | — |  | `get_teacher_rating_summary` (app/api/v1/endpoints/reviews.py:201) | Resumen de ratings del profesor. Usado para mostrar las estrellas en el perfil público. |

## Chatbot

| Método | Ruta | Auth | Límite | Función (archivo:línea) | Qué hace |
|---|---|---|---|---|---|
| POST | `/chipi/chat` | get_current_user_optional |  | `chat_with_chipi` (app/api/v1/endpoints/chipi.py:26) | Endpoint principal del chatbot Chipi. Soporta streaming y respuesta completa. |

## Text-to-Speech

| Método | Ruta | Auth | Límite | Función (archivo:línea) | Qué hace |
|---|---|---|---|---|---|
| POST | `/tts/batch` | get_current_user |  | `get_batch_audio` (app/api/v1/endpoints/tts.py:52) | Genera audio para múltiples palabras de una vez. Ideal para precargar un set de vocabulario completo. |
| POST | `/tts/vocabulary/{material_id}` | get_current_user |  | `get_vocabulary_audio` (app/api/v1/endpoints/tts.py:104) | Genera audio para todas las palabras de un material de tipo vocabulario. |
| POST | `/tts/word` | get_current_user |  | `get_word_audio` (app/api/v1/endpoints/tts.py:21) | Genera o recupera el audio de alta calidad para una palabra. Cualquier usuario autenticado puede usarlo. |

## Paquetes

| Método | Ruta | Auth | Límite | Función (archivo:línea) | Qué hace |
|---|---|---|---|---|---|
| POST | `/packages/` | get_current_teacher_or_teacher_admin, get_current_user |  | `create_package` (app/api/v1/endpoints/packages.py:73) | El profesor crea un paquete de clases |
| GET | `/packages/enrollment/{enrollment_id}` | get_current_student, get_current_user |  | `get_enrollment_package` (app/api/v1/endpoints/packages.py:593) | Obtiene los detalles del paquete asignado a un enrollment. |
| GET | `/packages/my-enrollments` | get_current_student, get_current_user |  | `get_my_enrollments` (app/api/v1/endpoints/packages.py:312) | Enrollments del estudiante. Incluye activos, completados y en renovación, junto con el nombre del profesor para mostrarlo en el dashboard. |
| GET | `/packages/my-packages` | get_current_teacher_or_teacher_admin, get_current_user |  | `get_my_packages` (app/api/v1/endpoints/packages.py:107) | Paquetes del profesor |
| POST | `/packages/request-package-change` | get_current_student, get_current_user |  | `request_package_change` (app/api/v1/endpoints/packages.py:467) | El estudiante solicita cambiar de paquete manteniendo la relación activa. |
| POST | `/packages/request-renewal` | get_current_student, get_current_user |  | `request_renewal` (app/api/v1/endpoints/packages.py:397) | El estudiante solicita renovar su paquete (mismo u otro del mismo profesor). El enrollment pasa a 'pending_renewal' y se guarda cuál paquete pidió. |
| GET | `/packages/teacher/enrollments` | get_current_teacher_or_teacher_admin, get_current_user |  | `get_teacher_enrollments_overview` (app/api/v1/endpoints/packages.py:198) | Lista todos los enrollments (activos, agotados y pendientes de renovación) de los estudiantes del profesor, con el desglose de cumplimiento: completadas, no-show y canceladas tarde. |
| GET | `/packages/teacher/{teacher_username}` | — |  | `get_teacher_packages` (app/api/v1/endpoints/packages.py:275) | Paquetes disponibles de un profesor. Filtrable por materia. Endpoint público. |
| POST | `/packages/{enrollment_id}/cancel-package-change` | get_current_student, get_current_user |  | `cancel_package_change` (app/api/v1/endpoints/packages.py:565) | El estudiante cancela su solicitud de cambio de paquete. |
| DELETE | `/packages/{package_id}` | get_current_teacher_or_teacher_admin, get_current_user |  | `deactivate_package` (app/api/v1/endpoints/packages.py:172) | Desactivar un paquete — no se borra para conservar enrollments |
| PATCH | `/packages/{package_id}` | get_current_teacher_or_teacher_admin, get_current_user |  | `update_package` (app/api/v1/endpoints/packages.py:119) | Actualizar un paquete |

## Google Calendar

| Método | Ruta | Auth | Límite | Función (archivo:línea) | Qué hace |
|---|---|---|---|---|---|
| GET | `/calendar/auth-url` | get_current_teacher, get_current_user |  | `get_google_auth_url` (app/api/v1/endpoints/calendar.py:42) |  |
| POST | `/calendar/callback` | get_current_teacher, get_current_user |  | `calendar_callback` (app/api/v1/endpoints/calendar.py:47) |  |
| POST | `/calendar/disconnect` | get_current_teacher, get_current_user |  | `disconnect_calendar` (app/api/v1/endpoints/calendar.py:142) |  |
| GET | `/calendar/status` | get_current_teacher, get_current_user |  | `calendar_status` (app/api/v1/endpoints/calendar.py:18) |  |
| POST | `/calendar/sync` | get_current_teacher, get_current_user |  | `manual_sync` (app/api/v1/endpoints/calendar.py:117) | Fuerza una sincronización manual inmediata para este profesor. |
| POST | `/calendar/toggle` | get_current_teacher, get_current_user |  | `toggle_sync` (app/api/v1/endpoints/calendar.py:95) |  |

## AI Tools

| Método | Ruta | Auth | Límite | Función (archivo:línea) | Qué hace |
|---|---|---|---|---|---|
| POST | `/ai-tools/analyze-test-failure` | get_current_staff, get_current_user |  | `analyze_test_failure` (app/api/v1/endpoints/ai_debug.py:33) | Analiza un test fallido del flow-tester usando Gemini. La API key vive solo en el backend — nunca se expone al frontend. |

## Pagos

| Método | Ruta | Auth | Límite | Función (archivo:línea) | Qué hace |
|---|---|---|---|---|---|
| POST | `/payments/admin/withdrawals/{withdrawal_id}/process` | get_current_staff, get_current_user |  | `process_withdrawal_v2` (app/api/v1/endpoints/payments.py:1306) |  |
| POST | `/payments/book` | get_current_student, get_current_user |  | `book_class` (app/api/v1/endpoints/payments.py:398) |  |
| GET | `/payments/booking-status` | get_current_student, get_current_user |  | `get_booking_status` (app/api/v1/endpoints/payments.py:1352) |  |
| GET | `/payments/config` | — |  | `get_payment_config` (app/api/v1/endpoints/payments.py:336) |  |
| PATCH | `/payments/config` | get_current_staff, get_current_user |  | `update_payment_config` (app/api/v1/endpoints/payments.py:368) |  |
| GET | `/payments/history` | get_current_staff_or_teacher, get_current_user |  | `get_payments_history` (app/api/v1/endpoints/payments.py:780) | Historial de pagos ya resueltos (aprobados o rechazados). Teacher solo ve los suyos; staff ve todos. |
| POST | `/payments/manual-grant` | get_current_staff_or_teacher, get_current_user |  | `manual_grant_payment` (app/api/v1/endpoints/payments.py:1130) |  |
| GET | `/payments/my-income` | get_current_teacher_or_teacher_admin, get_current_user |  | `get_my_income` (app/api/v1/endpoints/payments.py:1202) |  |
| GET | `/payments/my-payments` | get_current_student, get_current_user |  | `get_my_payments_student` (app/api/v1/endpoints/payments.py:1192) |  |
| GET | `/payments/my-wallet` | get_current_teacher_or_teacher_admin, get_current_user |  | `get_my_wallet` (app/api/v1/endpoints/payments.py:1221) |  |
| GET | `/payments/my-withdrawals` | get_current_teacher_or_teacher_admin, get_current_user |  | `get_my_withdrawals` (app/api/v1/endpoints/payments.py:1247) |  |
| POST | `/payments/notify-payment` | get_current_student, get_current_user |  | `notify_payment` (app/api/v1/endpoints/payments.py:1450) |  |
| GET | `/payments/pending-review` | get_current_staff_or_teacher, get_current_user |  | `get_payments_pending_review` (app/api/v1/endpoints/payments.py:731) |  |
| POST | `/payments/request-refund-cohort-cancelled` | get_current_student, get_current_user |  | `request_refund_cohort_cancelled` (app/api/v1/endpoints/payments.py:2039) | Reembolso por una cohorte grupal que el profesor canceló (F3 del roadmap de verificación). A diferencia del reembolso por profesor suspendido, acá siempre es el 100% de lo pagado: el grupo nunca llegó a arrancar (o se abortó), no hay "clases ya tomadas" que descontar. Mientras este reembolso esté pe |
| POST | `/payments/request-refund-teacher-suspended` | get_current_student, get_current_user |  | `request_refund_teacher_suspended` (app/api/v1/endpoints/payments.py:1917) | Reembolso disparado por la suspensión/rechazo del profesor del estudiante (no por un downgrade de paquete). Reutiliza el mismo mecanismo que el "reembolso completo" de cambio de paquete (Payment payment_type="refund" sin ningún paquete nuevo solicitado): al aprobarse, /payments/validate/{id} cancela |
| POST | `/payments/request-withdrawal` | get_current_teacher_or_teacher_admin, get_current_user |  | `request_withdrawal_v2` (app/api/v1/endpoints/payments.py:1257) |  |
| PATCH | `/payments/{payment_id}/validate` | get_current_staff_or_teacher, get_current_user |  | `validate_payment` (app/api/v1/endpoints/payments.py:836) |  |

## Clases grupales

| Método | Ruta | Auth | Límite | Función (archivo:línea) | Qué hace |
|---|---|---|---|---|---|
| POST | `/cohorts/` | get_current_teacher_or_teacher_admin, get_current_user |  | `create_cohort` (app/api/v1/endpoints/cohorts.py:212) |  |
| GET | `/cohorts/available` | — |  | `get_available_cohorts` (app/api/v1/endpoints/cohorts.py:1042) | Cohortes con cupo para un paquete grupal específico. D12: antes solo se listaban las 'filling' -- ahora también se listan 'confirmed'/ 'in_progress' con cupo libre, para permitir inscripción tardía (con precio prorrateado, ver _to_cohort_response / _late_join_pricing). |
| GET | `/cohorts/migration-quote` | get_current_student, get_current_user |  | `get_migration_quote` (app/api/v1/endpoints/cohorts.py:1205) |  |
| GET | `/cohorts/sessions/{class_id}/participants` | get_current_teacher_or_teacher_admin, get_current_user |  | `get_session_participants` (app/api/v1/endpoints/cohorts.py:967) | Lista los integrantes de UNA sesión grupal puntual con su asistencia individual — antes no existía forma de ver esto desglosado por alumno, el único estado disponible era el de la Class compartida (todo o nada). |
| PATCH | `/cohorts/sessions/{class_id}/participants/{student_id}/attendance` | get_current_teacher_or_teacher_admin, get_current_user |  | `mark_participant_attendance` (app/api/v1/endpoints/cohorts.py:1000) | El profesor marca la asistencia de UN alumno en una sesión grupal — a diferencia del estado general de la Class (que aplica a todos por igual), esto permite reflejar que, por ejemplo, 4 de 6 asistieron. Solo admite "confirmed" (asistió) o "no_show" (no asistió); para sacar a un alumno de la sesión e |
| GET | `/cohorts/teacher` | get_current_teacher_or_teacher_admin, get_current_user |  | `get_my_cohorts` (app/api/v1/endpoints/cohorts.py:298) |  |
| PATCH | `/cohorts/{cohort_id}` | get_current_teacher_or_teacher_admin, get_current_user |  | `edit_cohort` (app/api/v1/endpoints/cohorts.py:242) | D12: el profesor edita min_students/max_students de una cohorte propia. Antes esto solo existía vía Modo Dios (GodModeCohortEditRequest, exclusivo de staff) -- el profesor no tenía forma de corregir el cupo que definió al crear la cohorte (ej. subir el máximo porque llegaron más interesados de los p |
| GET | `/cohorts/{cohort_id}/attendance-summary` | get_current_teacher_or_teacher_admin, get_current_user |  | `get_cohort_attendance_summary` (app/api/v1/endpoints/cohorts.py:878) | Historial de asistencia agregado por alumno a lo largo de todas las sesiones ya realizadas de la cohorte — antes solo se podía ver la asistencia sesión por sesión (get_session_participants), sin un resumen acumulado que le muestre al profesor patrones (ej. un alumno que falta seguido). |
| POST | `/cohorts/{cohort_id}/cancel` | get_current_teacher_or_teacher_admin, get_current_user |  | `cancel_cohort_endpoint` (app/api/v1/endpoints/cohorts.py:546) | Cancela una cohorte que no se llenó (o que el profesor decide abortar). Cancela el enrollment de cada alumno inscrito (ver cancel_cohort) para que quede libre de elegir un paquete nuevo, y le notifica por email. |
| POST | `/cohorts/{cohort_id}/close` | get_current_teacher_or_teacher_admin, get_current_user |  | `close_cohort_endpoint` (app/api/v1/endpoints/cohorts.py:397) | El profesor cierra la cohorte con los integrantes actuales, sin importar si llegó al mínimo definido al crearla. Solo se bloquea si la cohorte quedó vacía (en ese caso corresponde cancelarla, no cerrarla) o si ya no está en estado "filling". |
| POST | `/cohorts/{cohort_id}/complete` | get_current_teacher_or_teacher_admin, get_current_user |  | `complete_cohort_endpoint` (app/api/v1/endpoints/cohorts.py:593) | El profesor marca una cohorte como finalizada — el paquete/las sesiones ya cumplieron su ciclo (antes no existía ningún estado de "terminó normalmente", solo "cancelada" antes de arrancar). Si al finalizar el grupo quedó por debajo del mínimo declarado, se cancela el enrollment de cada alumno restan |
| POST | `/cohorts/{cohort_id}/enroll` | get_current_student, get_current_user |  | `enroll_in_cohort` (app/api/v1/endpoints/cohorts.py:1066) | El estudiante se inscribe en una cohorte abierta. Crea el Enrollment (unpaid, igual que la compra inicial de un paquete individual) y un Payment pendiente de revisión — mismo circuito manual que cualquier otro pago de la plataforma. |
| POST | `/cohorts/{cohort_id}/leave` | get_current_student, get_current_user |  | `leave_cohort` (app/api/v1/endpoints/cohorts.py:1160) | El estudiante abandona una cohorte grupal POR COMPLETO (no solo una sesión puntual, ver DELETE /classes/{id}/leave para eso): cancela su Enrollment y libera su cupo en todas las sesiones futuras vía release_cohort_seat. Al quedar sin enrollment activo con este profesor, get_student_booking_stage lo  |
| GET | `/cohorts/{cohort_id}/members` | get_current_teacher_or_teacher_admin, get_current_user |  | `get_cohort_members` (app/api/v1/endpoints/cohorts.py:309) | Integrantes actuales de la cohorte (Enrollments activos, no cancelados), sin importar su status ('filling', 'confirmed', etc). A diferencia de /sessions/{class_id}/participants, esto funciona incluso ANTES de que exista ninguna sesión agendada — es lo que permite mostrar en vivo, mientras el grupo s |
| GET | `/cohorts/{cohort_id}/recurring-candidates` | get_current_teacher_or_teacher_admin, get_current_user |  | `get_recurring_candidates` (app/api/v1/endpoints/cohorts.py:352) | D14: para paquetes grupales con group_schedule_mode="fixed", devuelve las próximas `count` fechas UTC que coinciden con el patrón semanal configurado en el paquete, marcando cuáles ya están libres en la agenda del profesor. El modal de cierre de cohorte usa esto para que el profesor elija a partir d |
| POST | `/cohorts/{cohort_id}/reopen` | get_current_teacher_or_teacher_admin, get_current_user |  | `reopen_cohort_endpoint` (app/api/v1/endpoints/cohorts.py:514) | Corrección QA: revierte un cierre manual (close_cohort_endpoint) si todavía no arrancó ninguna sesión — por ejemplo si el profesor cerró por error o decide seguir aceptando inscripciones. Vuelve la cohorte a "filling" y limpia la fecha de inicio/cierre para que un cierre posterior tenga que fijarlas |
| GET | `/cohorts/{cohort_id}/sessions` | get_current_user |  | `get_cohort_sessions` (app/api/v1/endpoints/cohorts.py:935) | Visible tanto para el profesor como para los alumnos de la cohorte. |
| POST | `/cohorts/{cohort_id}/sessions` | get_current_teacher_or_teacher_admin, get_current_user |  | `create_group_session` (app/api/v1/endpoints/cohorts.py:845) | Agenda una sesión concreta de una cohorte ya confirmada. Se crea UNA sola fila de Class (compartida) y se inscribe automáticamente a todos los alumnos actualmente activos de la cohorte vía ClassParticipant — el cupo/capacidad ya se definió al crear la cohorte, no por sesión. |

## Soporte

| Método | Ruta | Auth | Límite | Función (archivo:línea) | Qué hace |
|---|---|---|---|---|---|
| POST | `/support/tickets` | get_current_user |  | `create_support_ticket` (app/api/v1/endpoints/support.py:38) | El student o teacher reporta un bug, un error, o una duda que Chipi no pudo resolver. Genera un ticket pendiente y una notificación en la bandeja de staff (superadmin + teacher_admin), igual que ocurre con las apelaciones de profesores. |
| GET | `/support/tickets/me` | get_current_user |  | `get_my_support_tickets` (app/api/v1/endpoints/support.py:93) | Bandeja 'Mi soporte' del usuario — sus propios tickets, más recientes primero. |
| GET | `/support/tickets/me/unread-count` | get_current_user |  | `get_my_unread_support_count` (app/api/v1/endpoints/support.py:109) | Cantidad de tickets respondidos que el usuario aún no ha revisado — alimenta el badge en el sidebar (equivalente al contador de staff). |
| PATCH | `/support/tickets/{ticket_id}/seen` | get_current_user |  | `mark_support_ticket_seen` (app/api/v1/endpoints/support.py:132) | Marca como vista la respuesta del staff (quita el badge de no leído). |

## Catálogos del Sistema

| Método | Ruta | Auth | Límite | Función (archivo:línea) | Qué hace |
|---|---|---|---|---|---|
| GET | `/system-catalogs/` | — |  | `get_all_catalogs` (app/api/v1/endpoints/system_catalogs.py:30) | Devuelve todos los catálogos como { key: value }. Público — lo consume cualquier pantalla (onboarding, perfil, etc.) sin requerir sesión de admin. |
| GET | `/system-catalogs/admin` | get_current_staff, get_current_user |  | `list_catalogs_admin` (app/api/v1/endpoints/system_catalogs.py:41) | Vista completa (con label y updated_at) para la pantalla de configuración. |
| GET | `/system-catalogs/business-rules` | — |  | `get_business_rules` (app/api/v1/endpoints/system_catalogs.py:50) | Público — el frontend lo necesita para validar duraciones/plazos sin sesión de admin. |
| PATCH | `/system-catalogs/business-rules` | get_current_staff, get_current_user |  | `update_business_rules` (app/api/v1/endpoints/system_catalogs.py:93) |  |
| PATCH | `/system-catalogs/{key}` | get_current_staff, get_current_user |  | `update_catalog` (app/api/v1/endpoints/system_catalogs.py:119) |  |

## Modo Dios

| Método | Ruta | Auth | Límite | Función (archivo:línea) | Qué hace |
|---|---|---|---|---|---|
| GET | `/god-mode/audit-log` | get_current_staff, get_current_user |  | `list_god_mode_audit_log` (app/api/v1/endpoints/god_mode.py:311) |  |
| GET | `/god-mode/audit-log/{entity_type}/{entity_id}` | get_current_staff, get_current_user |  | `get_entity_god_mode_history` (app/api/v1/endpoints/god_mode.py:366) | Historial de Modo Dios de una entidad puntual — ej: todos los cambios manuales hechos sobre el Enrollment #42, o la Clase #103. Útil para mostrar un panel "historial" directamente en la ficha del alumno, la clase o la cohorte, sin tener que filtrar el log general. |
| POST | `/god-mode/classes` | get_current_staff, get_current_user |  | `god_mode_create_class` (app/api/v1/endpoints/god_mode.py:768) | Crea una clase individual (regular o trial) para cualquier par profesor-alumno, sin pasar por los flujos normales de reserva ni por la disponibilidad declarada del profesor. |
| DELETE | `/god-mode/classes/{class_id}` | get_current_staff, get_current_user |  | `god_mode_hard_delete_class` (app/api/v1/endpoints/god_mode.py:1028) | Elimina una clase POR COMPLETO (a diferencia de cancelar, que solo cambia el status). Pensado para clases creadas por error que nunca debieron existir — no un reemplazo de la cancelación normal. |
| PATCH | `/god-mode/classes/{class_id}/force-status` | get_current_staff, get_current_user |  | `god_mode_force_class_status` (app/api/v1/endpoints/god_mode.py:957) | Fuerza el estado de cualquier clase a cualquier valor, sin la ventana de 72h que aplica al profesor normal (ver update_class_status en classes.py) y sin importar de qué profesor sea. Ajusta el contador de créditos del enrollment igual que el flujo normal, para no dejar el paquete del alumno desincro |
| PATCH | `/god-mode/classes/{class_id}/reschedule` | get_current_staff, get_current_user |  | `god_mode_reschedule_class` (app/api/v1/endpoints/god_mode.py:891) | Reagenda cualquier clase sin las restricciones normales (antelación mínima, disponibilidad). Por defecto sigue validando que no choque con otra clase (can_book_slot); usa skip_conflict_check=true para saltarte incluso eso. |
| PATCH | `/god-mode/cohorts/{cohort_id}` | get_current_staff, get_current_user |  | `god_mode_edit_cohort` (app/api/v1/endpoints/god_mode.py:649) | Edita min_students/max_students/start_date de una cohorte ya creada. |
| POST | `/god-mode/cohorts/{cohort_id}/reopen` | get_current_staff, get_current_user |  | `god_mode_reopen_cohort` (app/api/v1/endpoints/god_mode.py:707) | Reabre una cohorte cancelada o completada, devolviéndola a 'filling' (vuelve a aceptar inscripciones) o 'confirmed' (fecha ya fija, solo esperando que arranquen las sesiones). |
| PATCH | `/god-mode/enrollments/{enrollment_id}/adjust` | get_current_staff, get_current_user |  | `god_mode_adjust_enrollment` (app/api/v1/endpoints/god_mode.py:408) | Ajusta directamente los contadores/estado de un enrollment, sin pasar por el flujo normal de pagos, renovación o cambio de paquete. Solo se tocan los campos que vengan en el body (el resto queda intacto). |
| POST | `/god-mode/enrollments/{enrollment_id}/change-package` | get_current_staff, get_current_user |  | `god_mode_change_package` (app/api/v1/endpoints/god_mode.py:476) | Cambia el paquete de un enrollment de forma instantánea, saltándose 'request-package-change' y cualquier validación de pago pendiente. |
| POST | `/god-mode/enrollments/{enrollment_id}/move-cohort` | get_current_staff, get_current_user |  | `god_mode_move_cohort` (app/api/v1/endpoints/god_mode.py:563) | Mueve el enrollment de un alumno a otra cohorte del mismo profesor, o lo convierte a individual si new_cohort_id es None. |
| GET | `/god-mode/lookup/class-durations` | get_current_staff, get_current_user |  | `god_mode_lookup_class_durations` (app/api/v1/endpoints/god_mode.py:1716) | Duraciones de clase permitidas, configuradas por el superadmin en /admin/settings (PlatformConfig.allowed_class_durations). El panel de Modo Dios las usa para el selector de duración en vez de un input numérico libre, que podía terminar en una clase de una duración que la plataforma ni siquiera ofre |
| GET | `/god-mode/lookup/students/{student_id}/enrollments` | get_current_staff, get_current_user |  | `god_mode_lookup_student_enrollments` (app/api/v1/endpoints/god_mode.py:1676) |  |
| GET | `/god-mode/lookup/teachers` | get_current_staff, get_current_user |  | `god_mode_lookup_teachers` (app/api/v1/endpoints/god_mode.py:1579) | superadmin: todos los profesores aprobados. teacher_admin: solo él mismo (coherente con el scope del resto del Modo Dios: un teacher_admin únicamente crea/gestiona sobre sí mismo como profesor). |
| GET | `/god-mode/lookup/teachers/{teacher_id}/cohorts` | get_current_staff, get_current_user |  | `god_mode_lookup_teacher_cohorts` (app/api/v1/endpoints/god_mode.py:1771) | Cohortes de un profesor — para los selectores de "mover a cohorte", "editar cupos" y "reabrir cohorte" del Modo Dios, en vez de escribir el ID de la cohorte a mano. |
| GET | `/god-mode/lookup/teachers/{teacher_id}/packages` | get_current_staff, get_current_user |  | `god_mode_lookup_teacher_packages` (app/api/v1/endpoints/god_mode.py:1636) | Paquetes individuales (no grupales) activos de un profesor — para el selector de "cambiar de paquete" del Modo Dios, en vez de escribir el ID del paquete a mano y arriesgarse a asignar uno de otro profesor o uno grupal (que no aplica por esa vía). |
| GET | `/god-mode/lookup/teachers/{teacher_id}/reviews` | get_current_staff, get_current_user |  | `god_mode_lookup_teacher_reviews` (app/api/v1/endpoints/god_mode.py:1895) | Reseñas de un profesor — para los selectores de editar/eliminar. |
| GET | `/god-mode/lookup/teachers/{teacher_id}/students` | get_current_staff, get_current_user |  | `god_mode_lookup_teacher_students` (app/api/v1/endpoints/god_mode.py:1606) |  |
| GET | `/god-mode/lookup/teachers/{teacher_id}/students/reviewable` | get_current_staff, get_current_user |  | `god_mode_lookup_reviewable_students` (app/api/v1/endpoints/god_mode.py:1838) | Candidatos para 'Añadir reseña legacy': a diferencia del selector de alumnos normal (solo vínculo vigente), acá se incluye a cualquier alumno que haya tenido alguna clase con este profesor —individual o grupal— aunque el vínculo (StudentTeacherLink) ya se haya borrado por no estar más activo. Es jus |
| GET | `/god-mode/lookup/teachers/{teacher_id}/students/{student_id}/classes` | get_current_staff, get_current_user |  | `god_mode_lookup_pair_classes` (app/api/v1/endpoints/god_mode.py:1735) | Clases existentes entre un profesor y un alumno puntuales — para elegir cuál reagendar / forzar estado / eliminar sin escribir el ID de la clase a mano. Ordenadas de más próxima a más lejana. |
| GET | `/god-mode/lookup/teachers/{teacher_id}/students/{student_id}/payments` | get_current_staff, get_current_user |  | `god_mode_lookup_pair_payments` (app/api/v1/endpoints/god_mode.py:1802) | Pagos registrados entre un profesor y un alumno puntuales — para el selector de "editar pago" del Modo Dios. |
| POST | `/god-mode/payments` | get_current_staff, get_current_user |  | `god_mode_create_payment` (app/api/v1/endpoints/god_mode.py:1093) | Registra un pago que se hizo por fuera del sistema (transferencia, efectivo, WhatsApp) y nunca quedó cargado. Solo crea el registro del Payment — no activa ni modifica ningún enrollment automáticamente. |
| PATCH | `/god-mode/payments/{payment_id}` | get_current_staff, get_current_user |  | `god_mode_edit_payment` (app/api/v1/endpoints/god_mode.py:1180) | Edita un Payment ya registrado: monto y/o status. Ajusta el saldo de la billetera del profesor cuando corresponde, para que nunca quede desincronizada de lo que el Payment dice haber acreditado: |
| POST | `/god-mode/reviews` | get_current_staff, get_current_user |  | `god_mode_create_review` (app/api/v1/endpoints/god_mode.py:1300) | Carga manual de una reseña que un alumno ya dejó en la plataforma anterior, para no perderla al migrar. Pensado sobre todo para alumnos que ya no están activos en este sistema. |
| DELETE | `/god-mode/reviews/{review_id}` | get_current_staff, get_current_user |  | `god_mode_delete_review` (app/api/v1/endpoints/god_mode.py:1437) | Elimina una reseña por completo (legacy o no). |
| PATCH | `/god-mode/reviews/{review_id}` | get_current_staff, get_current_user |  | `god_mode_edit_review` (app/api/v1/endpoints/god_mode.py:1378) | Corrige rating, comentario, nombre mostrado o fecha de una reseña ya cargada (legacy o no). No permite reasignar a qué alumno pertenece — si el vínculo quedó mal, elimínala y vuelve a cargarla. |
| POST | `/god-mode/students/{student_id}/transfer-teacher` | get_current_staff, get_current_user |  | `god_mode_transfer_student` (app/api/v1/endpoints/god_mode.py:1474) | Transfiere a un alumno de un profesor a otro: crea/asegura el vínculo (StudentTeacherLink) con el profesor destino, reasigna sus enrollments individuales activos y sus clases futuras al nuevo profesor. |

## Flow Tests (dev)

| Método | Ruta | Auth | Límite | Función (archivo:línea) | Qué hace |
|---|---|---|---|---|---|
| GET | `/flow-tests/manifest` | get_current_staff, get_current_user |  | `get_flow_tests_manifest` (app/api/v1/endpoints/flow_tests.py:345) | Enumera todos los tests de backend/tests/flow SIN ejecutarlos (usa `pytest --collect-only`, no toca la BD, tarda milisegundos), con su descripción técnica/UX (extraída del docstring de cada test) y si son destructivos. Pensado para que la UI arme la lista de tests y una barra de progreso precisa ANT |
| POST | `/flow-tests/run` | get_current_staff, get_current_user |  | `start_flow_tests_run` (app/api/v1/endpoints/flow_tests.py:394) | Lanza backend/tests/flow en background y devuelve de inmediato un run_id para hacer polling con GET /flow-tests/{run_id}. Si `node_ids` viene con contenido, corre exactamente esos tests (individual o bloque/módulo); si no, corre la suite completa respetando `include_destructive`. |
| GET | `/flow-tests/{run_id}` | get_current_staff, get_current_user |  | `get_flow_tests_run` (app/api/v1/endpoints/flow_tests.py:422) | Progreso/resultado de una corrida — hacer polling mientras status=='running'. |

## Landing pública

| Método | Ruta | Auth | Límite | Función (archivo:línea) | Qué hace |
|---|---|---|---|---|---|
| GET | `/public/landing` | — |  | `get_landing_data` (app/api/v1/endpoints/public.py:74) | Toda la data que necesita la landing page en una sola respuesta: configuración de plataforma, profesores, reseñas y paquetes. |

## Logs

| Método | Ruta | Auth | Límite | Función (archivo:línea) | Qué hace |
|---|---|---|---|---|---|
| GET | `/logs` | get_current_staff, get_current_user |  | `list_error_logs` (app/api/v1/endpoints/logs.py:48) | Listado paginado para la pantalla de Logs en /admin (superadmin y teacher_admin). |
| POST | `/logs/frontend` | get_current_user_optional |  | `report_frontend_error` (app/api/v1/endpoints/logs.py:22) | El frontend reporta acá los crashes de React no controlados y los fallos de llamadas a la API (4xx/5xx). No requiere estar logueado (puede ocurrir en /login o antes de cargar la sesión), pero si hay un usuario identificado por el token, queda asociado al log. |
| GET | `/logs/stats` | get_current_staff, get_current_user |  | `get_error_log_stats` (app/api/v1/endpoints/logs.py:118) | Contadores rápidos para las StatCards de la pantalla de Logs. |
| GET | `/logs/users` | get_current_staff, get_current_user |  | `list_error_log_users` (app/api/v1/endpoints/logs.py:96) | Usuarios que tienen al menos un error registrado, con su nombre y apellido vigentes (se busca en `users`, no en el snapshot guardado en el log, para que si el usuario cambió su nombre el filtro siempre muestre el actual). Alimenta el <select> del filtro por usuario en la pantalla de Logs. |

## Chat interno

| Método | Ruta | Auth | Límite | Función (archivo:línea) | Qué hace |
|---|---|---|---|---|---|
| GET | `/chat/admin/conversations` | get_current_staff, get_current_user |  | `admin_list_conversations` (app/api/v1/endpoints/chat.py:499) |  |
| GET | `/chat/admin/conversations/{conversation_id}` | get_current_staff, get_current_user |  | `admin_get_conversation` (app/api/v1/endpoints/chat.py:526) |  |
| GET | `/chat/admin/conversations/{conversation_id}/messages` | get_current_staff, get_current_user |  | `admin_get_conversation_messages` (app/api/v1/endpoints/chat.py:538) |  |
| GET | `/chat/conversations` | get_current_user |  | `list_conversations` (app/api/v1/endpoints/chat.py:150) |  |
| GET | `/chat/conversations/direct/{other_username}` | get_current_user |  | `open_direct_conversation` (app/api/v1/endpoints/chat.py:169) |  |
| GET | `/chat/conversations/group/{cohort_id}` | get_current_user |  | `open_group_conversation` (app/api/v1/endpoints/chat.py:180) |  |
| GET | `/chat/conversations/unread-count` | get_current_user |  | `unread_count` (app/api/v1/endpoints/chat.py:160) |  |
| GET | `/chat/conversations/{conversation_id}/messages` | get_current_user |  | `get_messages` (app/api/v1/endpoints/chat.py:191) |  |
| POST | `/chat/conversations/{conversation_id}/messages` | get_current_user | 30/minute | `post_message` (app/api/v1/endpoints/chat.py:345) | Envío por REST: fallback si el WS global no está conectado o no devolvió el eco a tiempo (ver store/chatStore.ts). Comparte todo el camino con el WS (`_send_and_fanout`) y es idempotente por `client_id`, así que reintentar un mensaje que en realidad sí se guardó no lo duplica. |
| POST | `/chat/conversations/{conversation_id}/read` | get_current_user |  | `mark_conversation_read` (app/api/v1/endpoints/chat.py:212) |  |

## -

| Método | Ruta | Auth | Límite | Función (archivo:línea) | Qué hace |
|---|---|---|---|---|---|
| WS | `/chat/ws` | — |  | `chat_websocket` (app/api/v1/endpoints/chat.py:420) |  |
