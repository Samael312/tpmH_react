# app/core/chat.py
#
# Lógica de negocio del chat interno (N1). No incluye el transporte WS en
# sí (eso vive en core/chat_ws.py) para poder testear esta parte sin
# necesidad de abrir sockets.

from collections import defaultdict
from datetime import timedelta
from typing import Optional
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.models.chat import ChatConversation, ChatConversationType, ChatMessage, ChatReadState
from app.models.user import User, UserRole
from app.models.teacher import TeacherProfile, TeacherStatus
from app.models.student import StudentProfile
from app.models.group_cohort import GroupCohort
from app.models.package import Enrollment, EnrollmentStatus
from app.models.payment_config import PlatformConfig
from app.core.platform_config import get_or_create_platform_config
from app.core.timezone import utc_now


# ─── Config / gate ───────────────────────────────────────────────────────

def assert_chat_enabled(db: Session) -> PlatformConfig:
    """
    Bloquea a nivel backend el chat cuando el superadmin/teacher_admin lo
    desactivó desde /admin/settings — no basta con ocultarlo en el UI,
    porque alguien podría pegar la URL o abrir el WS directo.
    """
    config = get_or_create_platform_config(db)
    if not config.chat_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="El chat interno está deshabilitado por el momento.",
        )
    return config


def assert_chat_enabled_ws(db: Session) -> Optional[PlatformConfig]:
    """Misma validación que assert_chat_enabled pero sin levantar HTTPException
    (dentro de un WebSocket ya aceptado no tiene sentido — el caller cierra
    el socket con un código explícito). Devuelve None si está deshabilitado."""
    config = get_or_create_platform_config(db)
    return config if config.chat_enabled else None


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
        Enrollment.status.in_([EnrollmentStatus.active, EnrollmentStatus.pending_renewal, EnrollmentStatus.pending_package_change]),
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
            raise HTTPException(status.HTTP_403_FORBIDDEN, "No tenés perfil de profesor")
        student_user = db.query(User).filter(User.username == other_username).first()
        if not student_user or not student_user.student_profile:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Alumno no encontrado")
        student_profile = student_user.student_profile
        if not _teacher_has_student(teacher_profile, student_profile.id):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Ese alumno no está asignado a vos.",
            )
        return _get_or_create_direct(db, student_profile.id, teacher_profile.id)

    raise HTTPException(status.HTTP_403_FORBIDDEN, "Rol sin acceso al chat interno")


def ensure_direct_conversation(db: Session, student_id: int, teacher_id: int) -> ChatConversation:
    """
    Wrapper público de `_get_or_create_direct` para llamarse desde fuera de
    este módulo (ver core/teacher_students.py::link_student_to_teacher) sin
    tocar un nombre "privado". Idempotente: no crea duplicados si ya existe.
    """
    return _get_or_create_direct(db, student_id, teacher_id)


def _get_or_create_direct(db: Session, student_id: int, teacher_id: int) -> ChatConversation:
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
    db.commit()
    db.refresh(convo)
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
    """User.id de todos los participantes — para el broadcast por WS."""
    if convo.conversation_type == ChatConversationType.direct:
        ids = set()
        if convo.teacher and convo.teacher.user_id:
            ids.add(convo.teacher.user_id)
        if convo.student and convo.student.user_id:
            ids.add(convo.student.user_id)
        return ids
    student_ids = _cohort_participant_ids(db, convo.cohort_id)
    user_ids = {
        r[0] for r in db.query(StudentProfile.user_id).filter(
            StudentProfile.id.in_(student_ids)
        ).all()
    }
    if convo.teacher and convo.teacher.user_id:
        user_ids.add(convo.teacher.user_id)
    return user_ids


# ─── Listado / historial / lectura ──────────────────────────────────────

def list_conversations_for_user(db: Session, current_user: User) -> list[ChatConversation]:
    if current_user.role == UserRole.student:
        student_profile: StudentProfile = current_user.student_profile
        direct = db.query(ChatConversation).filter(
            ChatConversation.conversation_type == ChatConversationType.direct,
            ChatConversation.student_id == student_profile.id,
        )
        cohort_ids = list(_student_cohort_ids(db, student_profile.id))
        group = db.query(ChatConversation).filter(
            ChatConversation.conversation_type == ChatConversationType.group,
            ChatConversation.cohort_id.in_(cohort_ids) if cohort_ids else False,
        )
        convos = direct.all() + (group.all() if cohort_ids else [])
    elif current_user.role in (UserRole.teacher, UserRole.teacher_admin):
        teacher_profile: TeacherProfile = current_user.teacher_profile
        if not teacher_profile:
            return []
        convos = db.query(ChatConversation).filter(
            ChatConversation.teacher_id == teacher_profile.id,
        ).all()
    else:
        return []

    convos.sort(key=lambda c: c.last_message_at or c.created_at, reverse=True)
    return convos


def _student_cohort_ids(db: Session, student_id: int) -> set[int]:
    rows = db.query(Enrollment.cohort_id).filter(
        Enrollment.student_id == student_id,
        Enrollment.cohort_id.isnot(None),
        Enrollment.status.in_([EnrollmentStatus.active, EnrollmentStatus.pending_renewal, EnrollmentStatus.pending_package_change]),
    ).all()
    return {r[0] for r in rows}


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
    q = db.query(ChatMessage).filter(ChatMessage.conversation_id == convo.id)
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
    db.commit()


def get_unread_count_for_user(db: Session, current_user: User) -> int:
    """Suma de mensajes no leídos en todas las conversaciones del usuario."""
    convos = list_conversations_for_user(db, current_user)
    if not convos:
        return 0
    total = 0
    for convo in convos:
        state = db.query(ChatReadState).filter(
            ChatReadState.conversation_id == convo.id,
            ChatReadState.user_id == current_user.id,
        ).first()
        q = db.query(ChatMessage).filter(
            ChatMessage.conversation_id == convo.id,
            ChatMessage.sender_id != current_user.id,
        )
        if state and state.last_read_at:
            q = q.filter(ChatMessage.created_at > state.last_read_at)
        total += q.count()
    return total


# ─── Envío de mensajes + reactivación de email ──────────────────────────

def send_message(
    db: Session, config: PlatformConfig, convo: ChatConversation, sender: User, content: str,
) -> tuple[ChatMessage, bool]:
    """
    Persiste el mensaje y determina si corresponde disparar el email de
    aviso al profesor (solo cuando el remitente es un estudiante y la
    conversación estaba inactiva por más de chat_reactivation_hours, o es
    el primer mensaje de la conversación).
    Devuelve (mensaje, should_notify_teacher_by_email).
    """
    content = content.strip()
    if not content:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El mensaje no puede estar vacío")
    if len(content) > 4000:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Mensaje demasiado largo")

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

    message = ChatMessage(conversation_id=convo.id, sender_id=sender.id, content=content)
    db.add(message)

    convo.last_message_at = now
    convo.last_message_preview = content[:140]
    if should_notify:
        convo.teacher_last_notified_at = now

    db.commit()
    db.refresh(message)
    return message, should_notify


# ─── Entrega (checkmarks) ────────────────────────────────────────────────
#
# N3: la conexión WS ahora es global por usuario (ver core/chat_ws.py), no
# por conversación — así que "entregado" pasa a significar "el usuario
# destinatario tiene AL MENOS UN socket global abierto", esté mirando esa
# conversación o cualquier otra pantalla de la app.

def mark_delivered_now(db: Session, message: ChatMessage) -> bool:
    """Marca el mensaje como entregado AHORA si todavía no lo estaba.
    Devuelve True si lo acaba de marcar (o sea, hay que avisarle al emisor
    con el evento 'delivered' — ver endpoints/chat.py)."""
    if message.delivered_at is not None:
        return False
    message.delivered_at = utc_now()
    db.commit()
    return True


def catch_up_deliveries(db: Session, user: User) -> dict[int, list[int]]:
    """Al conectarse (o reconectarse) el socket global de `user`, cualquier
    mensaje QUE LE HAYAN MANDADO A ÉL en cualquiera de sus conversaciones y
    que siguiera sin `delivered_at` (porque no estaba online cuando se
    envió) pasa a estar entregado en este instante.

    Devuelve {sender_user_id: [message_id, ...]} para que el caller le
    avise el segundo checkmark a cada emisor que siga conectado."""
    convos = list_conversations_for_user(db, user)
    convo_ids = [c.id for c in convos]
    if not convo_ids:
        return {}
    pending = db.query(ChatMessage).filter(
        ChatMessage.conversation_id.in_(convo_ids),
        ChatMessage.sender_id != user.id,
        ChatMessage.delivered_at.is_(None),
    ).all()
    if not pending:
        return {}
    now = utc_now()
    by_sender: dict[int, list[int]] = defaultdict(list)
    for message in pending:
        message.delivered_at = now
        by_sender[message.sender_id].append(message.id)
    db.commit()
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
    db.commit()
    return result
