# app/core/chat.py
#
# Lógica de negocio del chat interno (N1). No incluye el transporte WS en
# sí (eso vive en core/chat_ws.py) para poder testear esta parte sin
# necesidad de abrir sockets.

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional
from fastapi import HTTPException, status
from sqlalchemy.orm import Session, joinedload, selectinload
from sqlalchemy import and_, exists, func, or_, select, update
from sqlalchemy.exc import IntegrityError

from app.models.chat import ChatConversation, ChatConversationType, ChatMessage, ChatReadState
from app.models.user import User, UserRole
from app.models.teacher import TeacherProfile, TeacherStatus
from app.models.student import StudentProfile
from app.models.group_cohort import GroupCohort
from app.models.package import Enrollment, EnrollmentStatus
from app.core.cache import cache_invalidate, cached
from app.core.platform_config import get_or_create_platform_config
from app.core.timezone import utc_now


# ─── Config / gate ───────────────────────────────────────────────────────
#
# Cada petición del chat (listar, no leídos, enviar, abrir el socket) comprobaba si el chat está activo leyendo
# PlatformConfig en la BD. Esos dos valores cambian casi nunca, así que se guardan 30 s en memoria del proceso y
# se invalidan al guardar los ajustes (admin.py::update_platform_config). Una sola instancia: ver core/cache.py.

CHAT_SETTINGS_CACHE_KEY = "chat:settings"
CHAT_SETTINGS_TTL_SECONDS = 30
ACTIVE_COHORT_STATUSES = (
    EnrollmentStatus.active, EnrollmentStatus.pending_renewal, EnrollmentStatus.pending_package_change,
)


@dataclass(frozen=True)
class ChatSettings:
    chat_enabled: bool
    chat_reactivation_hours: int


def get_chat_settings(db: Session) -> ChatSettings:
    def load() -> ChatSettings:
        config = get_or_create_platform_config(db)
        return ChatSettings(bool(config.chat_enabled), int(config.chat_reactivation_hours or 0))
    return cached(CHAT_SETTINGS_CACHE_KEY, CHAT_SETTINGS_TTL_SECONDS, load)


def invalidate_chat_settings() -> None:
    cache_invalidate(CHAT_SETTINGS_CACHE_KEY)


def assert_chat_enabled(db: Session) -> ChatSettings:
    """
    Bloquea a nivel backend el chat cuando el superadmin/teacher_admin lo
    desactivó desde /admin/settings — no basta con ocultarlo en el UI,
    porque alguien podría pegar la URL o abrir el WS directo.
    """
    settings = get_chat_settings(db)
    if not settings.chat_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="El chat interno está deshabilitado por el momento.",
        )
    return settings


def assert_chat_enabled_ws(db: Session) -> Optional[ChatSettings]:
    """Misma validación que assert_chat_enabled pero sin levantar HTTPException
    (dentro de un WebSocket ya aceptado no tiene sentido — el caller cierra
    el socket con un código explícito). Devuelve None si está deshabilitado."""
    settings = get_chat_settings(db)
    return settings if settings.chat_enabled else None


# ─── Autorización ────────────────────────────────────────────────────────

def _teacher_has_student(teacher: TeacherProfile, student_id: int) -> bool:
    """
    Fuente de verdad del vínculo directo profesor-alumno en AMBOS modos
    (single y multi-tenant): TeacherProfile.students (JSONB), poblada por
    core/teacher_students.py::link_student_to_teacher.
    StudentTeacherLink NO sirve para esto — queda vacía en single-tenant
    (ver su docstring y payments.py::_ensure_teacher_linked).
    """
    return student_id in (teacher.students or [])


def _cohort_participant_ids(db: Session, cohort_id: int) -> set[int]:
    """IDs de StudentProfile con Enrollment (activo o pendiente) en la cohorte."""
    rows = db.query(Enrollment.student_id).filter(
        Enrollment.cohort_id == cohort_id,
        Enrollment.status.in_(ACTIVE_COHORT_STATUSES),
    ).all()
    return {r[0] for r in rows}


def get_direct_conversation_or_404(
    db: Session, current_user: User, other_username: str,
) -> ChatConversation:
    """
    Resuelve (creando si hace falta) la conversación 1:1 entre el usuario
    actual y `other_username`.

    - Estudiante → profesor: permitido si ya están vinculados, o si el
      profesor está aprobado/visible en la plataforma (aunque todavía no
      lo haya elegido — ver comentario más abajo).
    - Profesor → estudiante: solo si ya están vinculados (sin cambios).
    """
    if current_user.role == UserRole.student:
        student_profile: StudentProfile = current_user.student_profile
        teacher_profile = db.query(TeacherProfile).filter(
            TeacherProfile.user_username == other_username
        ).first()
        if not teacher_profile:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Profesor no encontrado")
        # Antes exigía que ya estuvieran vinculados (_teacher_has_student).
        # Se relaja a propósito: un estudiante tiene que poder escribirle a
        # un profesor ANTES de elegirlo (típicamente desde su perfil
        # público, para resolver dudas antes de decidir) — no solo
        # después. Si ya están vinculados, siempre puede. Si no, igual
        # puede mientras el profesor esté aprobado/visible en la
        # plataforma — uno que no lo esté no es alcanzable ni siquiera
        # adivinando el username.
        if (
            not _teacher_has_student(teacher_profile, student_profile.id)
            and teacher_profile.status != TeacherStatus.approved
        ):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Profesor no encontrado")
        return _get_or_create_direct(db, student_profile.id, teacher_profile.id)

    if current_user.role in (UserRole.teacher, UserRole.teacher_admin):
        teacher_profile: TeacherProfile = current_user.teacher_profile
        if not teacher_profile:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "No tienes perfil de profesor")
        student_user = db.query(User).filter(User.username == other_username).first()
        if not student_user or not student_user.student_profile:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Alumno no encontrado")
        student_profile = student_user.student_profile
        if not _teacher_has_student(teacher_profile, student_profile.id):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Ese alumno no está asignado a ti.",
            )
        return _get_or_create_direct(db, student_profile.id, teacher_profile.id)

    raise HTTPException(status.HTTP_403_FORBIDDEN, "Rol sin acceso al chat interno")


def ensure_direct_conversation(db: Session, student_id: int, teacher_id: int, commit: bool = True) -> ChatConversation:
    """
    Wrapper público de `_get_or_create_direct` para llamarse desde fuera de
    este módulo (ver core/teacher_students.py::link_student_to_teacher) sin
    tocar un nombre "privado". Idempotente: no crea duplicados si ya existe.
    """
    return _get_or_create_direct(db, student_id, teacher_id, commit=commit)


def _get_or_create_direct(db: Session, student_id: int, teacher_id: int, commit: bool = True) -> ChatConversation:
    convo = db.query(ChatConversation).filter(
        ChatConversation.conversation_type == ChatConversationType.direct,
        ChatConversation.student_id == student_id,
        ChatConversation.teacher_id == teacher_id,
    ).first()
    if convo:
        return convo
    convo = ChatConversation(
        conversation_type=ChatConversationType.direct,
        student_id=student_id,
        teacher_id=teacher_id,
    )
    db.add(convo)
    if commit:
        db.commit()
        db.refresh(convo)
    else:
        db.flush()  # transacción del llamador (backfill atómico): no se confirma aquí
    return convo


def get_group_conversation_or_404(
    db: Session, current_user: User, cohort_id: int,
) -> ChatConversation:
    cohort = db.query(GroupCohort).filter(GroupCohort.id == cohort_id).first()
    if not cohort:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Grupo no encontrado")

    if current_user.role == UserRole.student:
        student_profile: StudentProfile = current_user.student_profile
        if student_profile.id not in _cohort_participant_ids(db, cohort_id):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "No pertenecés a este grupo")
    elif current_user.role in (UserRole.teacher, UserRole.teacher_admin):
        teacher_profile: TeacherProfile = current_user.teacher_profile
        if not teacher_profile or cohort.teacher_id != teacher_profile.id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Este grupo no es tuyo")
    else:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Rol sin acceso al chat interno")

    convo = db.query(ChatConversation).filter(
        ChatConversation.conversation_type == ChatConversationType.group,
        ChatConversation.cohort_id == cohort_id,
    ).first()
    if convo:
        return convo
    convo = ChatConversation(
        conversation_type=ChatConversationType.group,
        cohort_id=cohort_id,
        teacher_id=cohort.teacher_id,
    )
    db.add(convo)
    db.commit()
    db.refresh(convo)
    return convo


def assert_participant(db: Session, current_user: User, convo: ChatConversation) -> None:
    """Re-valida pertenencia contra una conversación ya existente (para el WS y para /messages)."""
    if convo.conversation_type == ChatConversationType.direct:
        if current_user.role == UserRole.student:
            if current_user.student_profile.id != convo.student_id:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "No participás de esta conversación")
        elif current_user.role in (UserRole.teacher, UserRole.teacher_admin):
            if not current_user.teacher_profile or current_user.teacher_profile.id != convo.teacher_id:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "No participás de esta conversación")
        else:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Rol sin acceso al chat interno")
    else:  # group
        if current_user.role == UserRole.student:
            ids = _cohort_participant_ids(db, convo.cohort_id)
            if current_user.student_profile.id not in ids:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "No participás de esta conversación")
        elif current_user.role in (UserRole.teacher, UserRole.teacher_admin):
            if not current_user.teacher_profile or current_user.teacher_profile.id != convo.teacher_id:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "No participás de esta conversación")
        else:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Rol sin acceso al chat interno")


def conversation_participant_user_ids(db: Session, convo: ChatConversation) -> set[int]:
    """User.id de los participantes ACTIVOS — para el broadcast por WS (C5: una cuenta desactivada no recibe nada).
    Una sola consulta por conversación."""
    teacher_user = (
        select(TeacherProfile.user_id)
        .join(User, User.id == TeacherProfile.user_id)
        .where(TeacherProfile.id == convo.teacher_id, User.is_active.is_(True))
    )
    if convo.conversation_type == ChatConversationType.direct:
        rows = db.execute(
            teacher_user.union_all(
                select(StudentProfile.user_id)
                .join(User, User.id == StudentProfile.user_id)
                .where(StudentProfile.id == convo.student_id, User.is_active.is_(True))
            )
        ).all()
    else:
        students = (
            select(StudentProfile.user_id)
            .join(User, User.id == StudentProfile.user_id)
            .join(Enrollment, Enrollment.student_id == StudentProfile.id)
            .where(
                Enrollment.cohort_id == convo.cohort_id,
                Enrollment.status.in_(ACTIVE_COHORT_STATUSES),
                User.is_active.is_(True),
            )
        )
        rows = db.execute(teacher_user.union_all(students)).all()
    return {r[0] for r in rows if r[0]}


# ─── Listado / historial / lectura ──────────────────────────────────────

def _conversation_filter(current_user: User):
    """Condición SQL «conversaciones en las que participa este usuario», o None si su rol no tiene chat.

    Es una sola expresión (con subconsulta para las cohortes del alumno) para que listar, contar no leídos y el
    catch-up del socket se resuelvan en una consulta cada uno, sin traer antes la lista de conversaciones.
    """
    if current_user.role == UserRole.student:
        student_profile: StudentProfile = current_user.student_profile
        if not student_profile:
            return None
        cohorts = select(Enrollment.cohort_id).where(
            Enrollment.student_id == student_profile.id,
            Enrollment.cohort_id.isnot(None),
            Enrollment.status.in_(ACTIVE_COHORT_STATUSES),
        )
        return or_(
            and_(
                ChatConversation.conversation_type == ChatConversationType.direct,
                ChatConversation.student_id == student_profile.id,
            ),
            and_(
                ChatConversation.conversation_type == ChatConversationType.group,
                ChatConversation.cohort_id.in_(cohorts),
            ),
        )
    if current_user.role in (UserRole.teacher, UserRole.teacher_admin):
        teacher_profile: TeacherProfile = current_user.teacher_profile
        if not teacher_profile:
            return None
        return ChatConversation.teacher_id == teacher_profile.id
    return None


# Más reciente primero; las que aún no tienen mensajes, por fecha de creación. El id desempata (orden estable
# entre páginas).
CONVERSATION_ORDER = (
    func.coalesce(ChatConversation.last_message_at, ChatConversation.created_at).desc(),
    ChatConversation.id.desc(),
)


def conversation_ids_subquery(current_user: User):
    cond = _conversation_filter(current_user)
    return None if cond is None else select(ChatConversation.id).where(cond)


def with_display_relations(query):
    """Carga en bloque lo que muestra la lista (nombre y avatar del otro, paquete del grupo): sin esto, cada
    conversación hacía 2-3 consultas perezosas."""
    return query.options(
        selectinload(ChatConversation.teacher).selectinload(TeacherProfile.user),
        selectinload(ChatConversation.student).selectinload(StudentProfile.user),
        selectinload(ChatConversation.cohort).selectinload(GroupCohort.package),
    )


def conversations_page_for_user(
    db: Session, current_user: User, offset: int, limit: int,
) -> tuple[int, list[ChatConversation]]:
    """(total, página) paginando en SQL. Antes se cargaban TODAS las conversaciones y se cortaba en Python."""
    cond = _conversation_filter(current_user)
    if cond is None:
        return 0, []
    total = db.query(func.count(ChatConversation.id)).filter(cond).scalar() or 0
    if not total:
        return 0, []
    rows = with_display_relations(
        db.query(ChatConversation).filter(cond).order_by(*CONVERSATION_ORDER)
    ).offset(offset).limit(limit).all()
    return total, rows


def list_conversations_for_user(db: Session, current_user: User) -> list[ChatConversation]:
    cond = _conversation_filter(current_user)
    if cond is None:
        return []
    return db.query(ChatConversation).filter(cond).order_by(*CONVERSATION_ORDER).all()


def get_messages(
    db: Session,
    convo: ChatConversation,
    before_id: Optional[int] = None,
    after_id: Optional[int] = None,
    limit: int = 50,
) -> list[ChatMessage]:
    """
    - Sin `before_id` ni `after_id`: los últimos `limit` (historial inicial).
    - `before_id`: página hacia atrás (scroll-up / "cargar más antiguos").
    - `after_id`: SOLO los mensajes nuevos desde el último que el cliente
      ya tiene cacheado (ver frontend/store/chatStore.ts) — evita
      volver a traer los 50 de siempre cada vez que se reabre un hilo ya
      visto en esta sesión. No lleva límite propio: en la práctica son
      pocos (lo que se mandó mientras no estabas mirando ese hilo).
    """
    # joinedload: el serializador usa `sender.username`; sin esto eran hasta 50 consultas extra por página.
    q = db.query(ChatMessage).options(joinedload(ChatMessage.sender)).filter(ChatMessage.conversation_id == convo.id)
    if after_id:
        q = q.filter(ChatMessage.id > after_id)
        return q.order_by(ChatMessage.id.asc()).all()
    if before_id:
        q = q.filter(ChatMessage.id < before_id)
    return q.order_by(ChatMessage.id.desc()).limit(limit).all()[::-1]


def mark_read(db: Session, convo: ChatConversation, user: User) -> None:
    state = db.query(ChatReadState).filter(
        ChatReadState.conversation_id == convo.id,
        ChatReadState.user_id == user.id,
    ).first()
    now = utc_now()
    if state:
        state.last_read_at = now
    else:
        db.add(ChatReadState(conversation_id=convo.id, user_id=user.id, last_read_at=now))
    try:
        db.commit()
    except IntegrityError:
        # Dos peticiones /read simultaneas (primera apertura del hilo) intentan crear la fila a la vez: la unica
        # (conversation_id, user_id) deja ganar a una y la otra solo actualiza la fecha.
        db.rollback()
        state = db.query(ChatReadState).filter(
            ChatReadState.conversation_id == convo.id,
            ChatReadState.user_id == user.id,
        ).first()
        if state:
            state.last_read_at = now
            db.commit()


def _unread_query(db: Session, user_id: int, conversation_ids):
    """Mensajes ajenos posteriores a la última lectura del usuario (o todos si nunca abrió la conversación).
    `conversation_ids` puede ser una lista o una subconsulta."""
    state = ChatReadState
    return (
        db.query(ChatMessage.conversation_id, func.count(ChatMessage.id))
        .outerjoin(state, and_(state.conversation_id == ChatMessage.conversation_id, state.user_id == user_id))
        .filter(
            ChatMessage.conversation_id.in_(conversation_ids),
            ChatMessage.sender_id != user_id,
            or_(state.last_read_at.is_(None), ChatMessage.created_at > state.last_read_at),
        )
        .group_by(ChatMessage.conversation_id)
    )


def unread_counts(db: Session, user_id: int, conversation_ids: list[int]) -> dict[int, int]:
    """{conversation_id: no leídos} en UNA consulta (antes: 2 por conversación)."""
    if not conversation_ids:
        return {}
    return {cid: n for cid, n in _unread_query(db, user_id, conversation_ids).all()}


def get_unread_count_for_user(db: Session, current_user: User) -> int:
    """Suma de mensajes no leídos en todas las conversaciones del usuario: una consulta."""
    ids = conversation_ids_subquery(current_user)
    if ids is None:
        return 0
    return sum(n for _cid, n in _unread_query(db, current_user.id, ids).all())


# ─── Envío de mensajes + reactivación de email ──────────────────────────

def find_message_by_client_id(
    db: Session, conversation_id: int, sender_id: int, client_id: Optional[str],
) -> Optional[ChatMessage]:
    if not client_id:
        return None
    return db.query(ChatMessage).filter(
        ChatMessage.conversation_id == conversation_id,
        ChatMessage.sender_id == sender_id,
        ChatMessage.client_id == client_id,
    ).first()


def send_message(
    db: Session, config: ChatSettings, convo: ChatConversation, sender: User, content: str,
    client_id: Optional[str] = None,
) -> tuple[ChatMessage, bool, bool]:
    """
    Persiste el mensaje y determina si corresponde disparar el email de
    aviso al profesor (solo cuando el remitente es un estudiante y la
    conversación estaba inactiva por más de chat_reactivation_hours, o es
    el primer mensaje de la conversación).

    Idempotente por `client_id`: si ese mensaje ya existe (reintento por
    REST tras un WS lento) devuelve el existente sin duplicarlo.
    Devuelve (mensaje, should_notify_teacher_by_email, is_duplicate).
    """
    content = content.strip()
    if not content:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El mensaje no puede estar vacío")
    if len(content) > 4000:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Mensaje demasiado largo")

    existing = find_message_by_client_id(db, convo.id, sender.id, client_id)
    if existing:
        return existing, False, True

    now = utc_now()
    should_notify = False
    if sender.role == UserRole.student:
        window = timedelta(hours=config.chat_reactivation_hours or 0)
        if (
            convo.teacher_last_notified_at is None
            or (config.chat_reactivation_hours or 0) == 0
            or now - convo.teacher_last_notified_at > window
        ):
            should_notify = True

    message = ChatMessage(conversation_id=convo.id, sender_id=sender.id, content=content, client_id=client_id)
    db.add(message)

    convo.last_message_at = now
    convo.last_message_preview = content[:140]
    if should_notify:
        convo.teacher_last_notified_at = now
        # El correo ya no sale al instante: queda pendiente y un job lo agrupa (core/chat_digest.py).
        if convo.teacher_notify_pending_at is None:
            convo.teacher_notify_pending_at = now

    try:
        db.commit()
    except IntegrityError:
        # Carrera con otro envío del mismo client_id (WS + REST casi a la vez).
        db.rollback()
        existing = find_message_by_client_id(db, convo.id, sender.id, client_id)
        if existing:
            return existing, False, True
        raise
    db.refresh(message)
    if should_notify:
        from app.core.scheduler import request_reschedule
        request_reschedule()   # el job del resumen duerme hasta que haya algo pendiente: despertarlo
    return message, should_notify, False


# ─── Entrega (checkmarks) ────────────────────────────────────────────────
#
# N3: la conexión WS ahora es global por usuario (ver core/chat_ws.py), no
# por conversación — así que "entregado" pasa a significar "el usuario
# destinatario tiene AL MENOS UN socket global abierto", esté mirando esa
# conversación o cualquier otra pantalla de la app.

def mark_delivered_by_id(db: Session, message_id: int) -> Optional[datetime]:
    """UPDATE atómico de una sola query: devuelve el instante si ESTA llamada
    fue la que marcó el mensaje como entregado, None si ya lo estaba."""
    now = utc_now()
    result = db.execute(
        update(ChatMessage)
        .where(ChatMessage.id == message_id, ChatMessage.delivered_at.is_(None))
        .values(delivered_at=now)
    )
    db.commit()
    return now if result.rowcount else None


def catch_up_deliveries(db: Session, user: User) -> dict[int, list[int]]:
    """Al conectarse (o reconectarse) el socket global de `user`, cualquier
    mensaje QUE LE HAYAN MANDADO A ÉL en cualquiera de sus conversaciones y
    que siguiera sin `delivered_at` (porque no estaba online cuando se
    envió) pasa a estar entregado en este instante.

    Una lectura de (id, remitente) y un UPDATE por lotes: antes se cargaban todas las conversaciones y cada
    mensaje pendiente como objeto completo.

    Devuelve {sender_user_id: [message_id, ...]} para que el caller le
    avise el segundo checkmark a cada emisor que siga conectado."""
    ids = conversation_ids_subquery(user)
    if ids is None:
        return {}
    pending = db.query(ChatMessage.id, ChatMessage.sender_id).filter(
        ChatMessage.conversation_id.in_(ids),
        ChatMessage.sender_id != user.id,
        ChatMessage.delivered_at.is_(None),
    ).all()
    if not pending:
        return {}
    now = utc_now()
    message_ids = [message_id for message_id, _ in pending]
    for start in range(0, len(message_ids), 500):
        db.execute(
            update(ChatMessage)
            .where(ChatMessage.id.in_(message_ids[start:start + 500]), ChatMessage.delivered_at.is_(None))
            .values(delivered_at=now)
            .execution_options(synchronize_session=False)
        )
    db.commit()
    by_sender: dict[int, list[int]] = defaultdict(list)
    for message_id, sender_id in pending:
        by_sender[sender_id].append(message_id)
    return dict(by_sender)


# ─── Retención ───────────────────────────────────────────────────────────

def purge_old_messages(db: Session, retention_days: int) -> int:
    """Borra mensajes más viejos que `retention_days`. 0 = sin límite (no borra nada)."""
    if not retention_days or retention_days <= 0:
        return 0
    cutoff = utc_now() - timedelta(days=retention_days)
    result = db.query(ChatMessage).filter(ChatMessage.created_at < cutoff).delete(
        synchronize_session=False
    )
    # C6: la vista previa de la lista de conversaciones no puede seguir mostrando el texto de mensajes ya
    # purgados: se borra en las conversaciones que se quedaron sin mensajes.
    has_messages = exists().where(ChatMessage.conversation_id == ChatConversation.id)
    db.query(ChatConversation).filter(
        ChatConversation.last_message_preview.isnot(None), ~has_messages
    ).update({"last_message_preview": None}, synchronize_session=False)
    db.commit()
    return result
