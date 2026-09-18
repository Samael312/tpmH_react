# app/api/v1/endpoints/chat.py
import asyncio
import json
import logging
from dataclasses import dataclass
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, WebSocket, WebSocketDisconnect, status
from sqlalchemy import func
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.auth.dependencies import get_current_user, get_current_staff
from app.auth.jwt import decode_access_token
from app.core import chat as chat_core
from app.core.chat_ws import chat_manager
from app.core.email import send_new_chat_message_teacher_email
from app.core.god_mode_audit import log_god_mode_action
from app.core.rate_limit import limiter
from app.core.config import settings
from app.db.base import ChatSessionLocal, get_db
from app.models.chat import ChatConversation, ChatConversationType, ChatMessage
from app.models.group_cohort import GroupCohort
from app.models.teacher import TeacherProfile
from app.models.student import StudentProfile
from app.models.user import User, UserRole
from app.schemas.chat import (
    ChatConversationAdminResponse,
    ChatConversationResponse,
    ChatMessageResponse,
    SendMessageRequest,
    UnreadCountResponse,
)

router = APIRouter()
logger = logging.getLogger(__name__)


# ─── Serialización ───────────────────────────────────────────────────────

def _serialize_conversation(db: Session, convo: ChatConversation, current_user: User) -> ChatConversationResponse:
    from app.models.chat import ChatReadState

    state = db.query(ChatReadState).filter(
        ChatReadState.conversation_id == convo.id,
        ChatReadState.user_id == current_user.id,
    ).first()
    unread_q = db.query(ChatMessage).filter(
        ChatMessage.conversation_id == convo.id,
        ChatMessage.sender_id != current_user.id,
    )
    if state and state.last_read_at:
        unread_q = unread_q.filter(ChatMessage.created_at > state.last_read_at)
    unread_count = unread_q.count()

    if convo.conversation_type == ChatConversationType.direct:
        if current_user.role == UserRole.student:
            other_user = convo.teacher.user if convo.teacher else None
        else:
            other_user = convo.student.user if convo.student else None
        title = f"{other_user.name} {other_user.surname}".strip() if other_user else "Usuario"
        return ChatConversationResponse(
            id=convo.id,
            conversation_type="direct",
            title=title,
            subtitle=None,
            avatar=other_user.avatar if other_user else None,
            other_username=other_user.username if other_user else None,
            cohort_id=None,
            last_message_preview=convo.last_message_preview,
            last_message_at=convo.last_message_at,
            unread_count=unread_count,
        )

    cohort = convo.cohort
    cohort_label = cohort.package.name if cohort and cohort.package else "Grupo"
    return ChatConversationResponse(
        id=convo.id,
        conversation_type="group",
        title=cohort_label,
        subtitle="Chat grupal",
        avatar=None,
        other_username=None,
        cohort_id=convo.cohort_id,
        last_message_preview=convo.last_message_preview,
        last_message_at=convo.last_message_at,
        unread_count=unread_count,
    )


def _serialize_message(msg) -> ChatMessageResponse:
    return ChatMessageResponse(
        id=msg.id,
        conversation_id=msg.conversation_id,
        sender_id=msg.sender_id,
        sender_username=msg.sender.username,
        content=msg.content,
        created_at=msg.created_at,
        delivered_at=msg.delivered_at,
        client_id=msg.client_id,
    )


def _serialize_conversation_admin(db: Session, convo: ChatConversation) -> ChatConversationAdminResponse:
    teacher_user = convo.teacher.user if convo.teacher else None
    message_count = db.query(func.count(ChatMessage.id)).filter(
        ChatMessage.conversation_id == convo.id
    ).scalar() or 0

    if convo.conversation_type == ChatConversationType.direct:
        student_user = convo.student.user if convo.student else None
        student_label = f"{student_user.name} {student_user.surname}".strip() if student_user else "Alumno"
        teacher_label = f"{teacher_user.name} {teacher_user.surname}".strip() if teacher_user else "Profesor"
        return ChatConversationAdminResponse(
            id=convo.id,
            conversation_type="direct",
            title=f"{student_label} ↔ {teacher_label}",
            subtitle="Conversación directa",
            teacher_username=teacher_user.username if teacher_user else None,
            teacher_name=teacher_label,
            student_username=student_user.username if student_user else None,
            student_name=student_label,
            cohort_id=None,
            last_message_preview=convo.last_message_preview,
            last_message_at=convo.last_message_at,
            message_count=message_count,
        )

    cohort = convo.cohort
    cohort_label = cohort.package.name if cohort and cohort.package else "Grupo"
    teacher_label = f"{teacher_user.name} {teacher_user.surname}".strip() if teacher_user else "Profesor"
    return ChatConversationAdminResponse(
        id=convo.id,
        conversation_type="group",
        title=cohort_label,
        subtitle=f"Grupo de {teacher_label}",
        teacher_username=teacher_user.username if teacher_user else None,
        teacher_name=teacher_label,
        student_username=None,
        student_name=None,
        cohort_id=convo.cohort_id,
        last_message_preview=convo.last_message_preview,
        last_message_at=convo.last_message_at,
        message_count=message_count,
    )


# ─── REST ────────────────────────────────────────────────────────────────

@router.get("/conversations", response_model=list[ChatConversationResponse])
def list_conversations(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    chat_core.assert_chat_enabled(db)
    convos = chat_core.list_conversations_for_user(db, current_user)
    return [_serialize_conversation(db, c, current_user) for c in convos]


@router.get("/conversations/unread-count", response_model=UnreadCountResponse)
def unread_count(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    chat_core.assert_chat_enabled(db)
    return UnreadCountResponse(unread_count=chat_core.get_unread_count_for_user(db, current_user))


@router.get("/conversations/direct/{other_username}", response_model=ChatConversationResponse)
def open_direct_conversation(
    other_username: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    chat_core.assert_chat_enabled(db)
    convo = chat_core.get_direct_conversation_or_404(db, current_user, other_username)
    return _serialize_conversation(db, convo, current_user)


@router.get("/conversations/group/{cohort_id}", response_model=ChatConversationResponse)
def open_group_conversation(
    cohort_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    chat_core.assert_chat_enabled(db)
    convo = chat_core.get_group_conversation_or_404(db, current_user, cohort_id)
    return _serialize_conversation(db, convo, current_user)


@router.get("/conversations/{conversation_id}/messages", response_model=list[ChatMessageResponse])
def get_messages(
    conversation_id: int,
    before_id: Optional[int] = Query(None),
    # N4: permite al frontend cachear el historial localmente (ver
    # store/chatStore.ts) y, en reaperturas del mismo hilo, pedir
    # SOLO lo nuevo desde el último id que ya tiene en vez de repetir el
    # fetch completo de los últimos 50 — ver core/chat.py::get_messages.
    after_id: Optional[int] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    chat_core.assert_chat_enabled(db)
    convo = db.query(ChatConversation).filter(ChatConversation.id == conversation_id).first()
    if not convo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversación no encontrada")
    chat_core.assert_participant(db, current_user, convo)
    messages = chat_core.get_messages(db, convo, before_id=before_id, after_id=after_id)
    return [_serialize_message(m) for m in messages]


@router.post("/conversations/{conversation_id}/read")
def mark_conversation_read(
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    chat_core.assert_chat_enabled(db)
    convo = db.query(ChatConversation).filter(ChatConversation.id == conversation_id).first()
    if not convo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversación no encontrada")
    chat_core.assert_participant(db, current_user, convo)
    chat_core.mark_read(db, convo, current_user)
    return {"message": "ok"}


# ─── Envío de mensajes (camino compartido REST + WS) ────────────────────
#
# Todo el trabajo de base de datos (síncrono) corre en el threadpool con su
# propia sesión de vida corta (ChatSessionLocal, ver db/base.py): antes se
# hacía directo dentro de handlers `async`, bloqueando el event loop —
# cada mensaje de cualquier usuario esperaba las queries (y el SMTP) del
# anterior. El orden de salida es: persistir → eco al emisor (lo que quita
# el reloj) → resto de participantes → "entregado" → email en segundo plano.

@dataclass
class _Persisted:
    payload: dict
    message_id: int
    conversation_id: int
    sender_id: int
    participant_ids: set[int]
    duplicate: bool
    email_args: Optional[dict]


_background_tasks: set[asyncio.Task] = set()


def _persist_message(user_id: int, conversation_id: int, content: str, client_id: Optional[str]) -> _Persisted:
    db = ChatSessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user or not user.is_active:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuario no válido")
        config = chat_core.assert_chat_enabled(db)
        convo = db.query(ChatConversation).filter(ChatConversation.id == conversation_id).first()
        if not convo:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversación no encontrada")
        chat_core.assert_participant(db, user, convo)

        message, should_notify, duplicate = chat_core.send_message(
            db, config, convo, user, content, client_id=client_id,
        )
        payload = {
            "type": "message",
            "id": message.id,
            "conversation_id": message.conversation_id,
            "sender_id": message.sender_id,
            "sender_username": user.username,
            "content": message.content,
            "created_at": message.created_at.isoformat(),
            "delivered_at": message.delivered_at.isoformat() if message.delivered_at else None,
            # Solo lo usa el emisor para reconciliar su mensaje "sending";
            # los demás participantes lo ignoran.
            "client_id": message.client_id,
        }
        if duplicate:
            return _Persisted(payload, message.id, convo.id, user.id, set(), True, None)

        email_args = None
        if should_notify and convo.teacher and convo.teacher.user:
            teacher_user = convo.teacher.user
            email_args = dict(
                to_email=teacher_user.email,
                teacher_name=teacher_user.name,
                student_name=user.name,
                message_preview=message.content[:140],
                conversation_url=f"{settings.FRONTEND_URL}/teacher/chat?conversation={convo.id}",
            )
        return _Persisted(
            payload, message.id, convo.id, user.id,
            chat_core.conversation_participant_user_ids(db, convo), False, email_args,
        )
    finally:
        db.close()


def _mark_delivered(message_id: int):
    db = ChatSessionLocal()
    try:
        return chat_core.mark_delivered_by_id(db, message_id)
    finally:
        db.close()


def _send_notification_email(args: dict) -> None:
    try:
        send_new_chat_message_teacher_email(**args)
    except Exception:
        # Nunca romper el envío del mensaje por un fallo de email.
        logger.exception("No se pudo enviar el email de nuevo mensaje de chat")


async def _send_and_fanout(user_id: int, conversation_id: int, content: str, client_id: Optional[str]) -> dict:
    sent = await run_in_threadpool(_persist_message, user_id, conversation_id, content, client_id)
    payload = sent.payload

    # Eco al emisor primero: es lo que le quita el reloj de "enviando".
    await chat_manager.send_to_user(sent.sender_id, payload)
    if sent.duplicate:
        return payload

    online_others = await chat_manager.broadcast_to_users(sent.participant_ids - {sent.sender_id}, payload)

    # 2do checkmark: al menos un destinatario (que no sea el emisor) estaba
    # online cuando salió el mensaje.
    if online_others:
        delivered_at = await run_in_threadpool(_mark_delivered, sent.message_id)
        if delivered_at:
            await chat_manager.send_to_user(sent.sender_id, {
                "type": "delivered",
                "id": sent.message_id,
                "conversation_id": sent.conversation_id,
                "delivered_at": delivered_at.isoformat(),
            })

    if sent.email_args:
        task = asyncio.create_task(run_in_threadpool(_send_notification_email, sent.email_args))
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)
    return payload


@router.post("/conversations/{conversation_id}/messages", response_model=ChatMessageResponse)
@limiter.limit("30/minute")
async def post_message(
    request: Request,
    conversation_id: int,
    data: SendMessageRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Envío por REST: fallback si el WS global no está conectado o no
    devolvió el eco a tiempo (ver store/chatStore.ts). Comparte todo el
    camino con el WS (`_send_and_fanout`) y es idempotente por `client_id`,
    así que reintentar un mensaje que en realidad sí se guardó no lo duplica.
    """
    payload = await _send_and_fanout(current_user.id, conversation_id, data.content, data.client_id)
    return ChatMessageResponse.model_validate({
        k: payload[k] for k in (
            "id", "conversation_id", "sender_id", "sender_username",
            "content", "created_at", "delivered_at", "client_id",
        )
    })


# ─── WebSocket ───────────────────────────────────────────────────────────
#
# N3: UNA sola conexión GLOBAL por usuario (no una por conversación) — se
# abre apenas hay sesión (ver store/chatStore.ts, montado en los
# layouts de student/teacher/admin) y se mantiene viva mientras navegás
# por CUALQUIER pantalla de la app, no solo /dashboard/chat.
#
# El navegador no permite mandar headers custom (Authorization) al abrir
# un WebSocket, y frontend/backend son servicios distintos (no hay cookie
# same-site que viaje sola) — por eso el token va como query param sobre
# wss:// (va cifrado por TLS igual que cualquier header).
#
# Protocolo (frames JSON):
#   Cliente → servidor:
#     {"type": "send", "conversation_id": int, "content": str, "client_id": str}
#     {"type": "ping"}   — heartbeat del cliente cada ~25 s; sin "pong" a
#                          tiempo el cliente descarta el socket y reconecta
#                          (detecta conexiones zombie tras un proxy/sleep).
#   Servidor → cliente:
#     {"type": "message", ...}     — mensaje nuevo (todos los participantes,
#                                     incluido el emisor).
#     {"type": "delivered", "id", "conversation_id", "delivered_at"}
#                                   — SOLO al emisor (2do checkmark).
#     {"type": "pong"}
#     {"type": "error", "detail": str, "client_id": str | None}


def _ws_validate(user_id: int) -> Optional[int]:
    """None si el usuario puede abrir el socket; si no, el close code."""
    db = ChatSessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user or not user.is_active:
            return 4401
        if chat_core.assert_chat_enabled_ws(db) is None:
            return 4403
        if user.role not in (UserRole.student, UserRole.teacher, UserRole.teacher_admin):
            return 4403
        return None
    finally:
        db.close()


def _ws_catch_up(user_id: int) -> dict[int, list[int]]:
    db = ChatSessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        return chat_core.catch_up_deliveries(db, user) if user else {}
    finally:
        db.close()


@router.websocket("/ws")
async def chat_websocket(websocket: WebSocket, token: str = Query(...)):
    payload = decode_access_token(token)
    if not payload:
        await websocket.close(code=4401)
        return
    user_id = int(payload["sub"])

    close_code = await run_in_threadpool(_ws_validate, user_id)
    if close_code:
        await websocket.close(code=close_code)
        return

    await chat_manager.connect(user_id, websocket)
    try:
        # Catch-up: los mensajes que le mandaron mientras estaba offline
        # pasan a "entregado" ahora — se lo avisamos a cada emisor online.
        by_sender = await run_in_threadpool(_ws_catch_up, user_id)
        for sender_id, message_ids in by_sender.items():
            for message_id in message_ids:
                await chat_manager.send_to_user(sender_id, {"type": "delivered", "id": message_id})

        while True:
            try:
                raw = json.loads(await websocket.receive_text())
            except json.JSONDecodeError:
                continue
            if not isinstance(raw, dict):
                continue

            msg_type = raw.get("type", "send")
            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue
            if msg_type != "send":
                continue

            client_id = raw.get("client_id")
            client_id = str(client_id)[:64] if client_id else None
            conversation_id = raw.get("conversation_id")
            if not conversation_id:
                await websocket.send_json({"type": "error", "detail": "Falta conversation_id", "client_id": client_id})
                continue
            try:
                await _send_and_fanout(user_id, int(conversation_id), str(raw.get("content") or ""), client_id)
            except HTTPException as e:
                await websocket.send_json({"type": "error", "detail": e.detail, "client_id": client_id})
            except Exception:
                logger.exception("Error enviando mensaje de chat por WS")
                await websocket.send_json({"type": "error", "detail": "No se pudo enviar el mensaje", "client_id": client_id})
    except WebSocketDisconnect:
        pass
    finally:
        chat_manager.disconnect(user_id, websocket)


# ─── N5: Auditoría (superadmin / teacher_admin) ──────────────────────────
#
# Panel de solo lectura para que staff pueda revisar conversaciones ajenas
# (moderación, soporte a un reclamo, investigar un reporte) sin depender
# de pedirle capturas a nadie. Dos niveles de exposición a propósito:
#
#   - LISTAR conversaciones (metadata: quiénes hablan, cuándo fue el
#     último mensaje, cuántos mensajes hay) no requiere motivo ni queda
#     auditado — no hay contenido privado de por medio, es lo mismo que
#     ya se ve en /admin/students o /admin/teachers.
#   - VER LOS MENSAJES de una conversación puntual SÍ requiere `reason`
#     (mismo criterio que el resto del Modo Dios — ver
#     core/god_mode_audit.py) y queda registrado en GodModeAuditLog con
#     entity_type="chat_conversation". Se reutiliza esa misma tabla (en
#     vez de crear una nueva) para que /god-mode/audit-log y
#     /god-mode/audit-log/{entity_type}/{entity_id}, que YA existen y son
#     genéricos por entity_type, sirvan también acá sin tocarlos — el
#     frontend simplemente les pasa entity_type="chat_conversation".
#
# El log se graba ANTES de devolver los mensajes (y aunque la respuesta
# termine vacía por paginación): lo que se registra es "se pidió ver
# esto", no "había contenido que ver".

@router.get("/admin/conversations", response_model=list[ChatConversationAdminResponse])
def admin_list_conversations(
    teacher_username: Optional[str] = Query(None),
    student_username: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    query = db.query(ChatConversation)
    if teacher_username:
        query = query.join(TeacherProfile, ChatConversation.teacher_id == TeacherProfile.id).join(
            User, TeacherProfile.user_id == User.id
        ).filter(User.username.ilike(f"%{teacher_username}%"))
    if student_username:
        # Solo aplica a conversaciones directas (las grupales no tienen
        # student_id) — el join simplemente no matchea nada de "group".
        query = query.join(StudentProfile, ChatConversation.student_id == StudentProfile.id).join(
            User, StudentProfile.user_id == User.id
        ).filter(User.username.ilike(f"%{student_username}%"))

    convos = query.order_by(
        ChatConversation.last_message_at.is_(None), ChatConversation.last_message_at.desc(),
    ).offset(skip).limit(limit).all()
    return [_serialize_conversation_admin(db, c) for c in convos]


@router.get("/admin/conversations/{conversation_id}", response_model=ChatConversationAdminResponse)
def admin_get_conversation(
    conversation_id: int,
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    convo = db.query(ChatConversation).filter(ChatConversation.id == conversation_id).first()
    if not convo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversación no encontrada")
    return _serialize_conversation_admin(db, convo)


@router.get("/admin/conversations/{conversation_id}/messages", response_model=list[ChatMessageResponse])
def admin_get_conversation_messages(
    conversation_id: int,
    reason: str = Query(..., min_length=3, max_length=500, description="Motivo de la revisión — obligatorio, queda auditado."),
    before_id: Optional[int] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    convo = db.query(ChatConversation).filter(ChatConversation.id == conversation_id).first()
    if not convo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversación no encontrada")

    log_god_mode_action(
        db, current_user,
        action="chat.view_conversation",
        entity_type="chat_conversation",
        entity_id=conversation_id,
        reason=reason,
    )
    db.commit()

    messages = chat_core.get_messages(db, convo, before_id=before_id, limit=limit)
    return [_serialize_message(m) for m in messages]
