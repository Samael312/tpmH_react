# app/api/v1/endpoints/chat.py
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, WebSocket, WebSocketDisconnect, status
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.auth.jwt import decode_access_token
from app.core import chat as chat_core
from app.core.chat_ws import chat_manager
from app.core.email import send_new_chat_message_teacher_email
from app.core.rate_limit import limiter
from app.core.config import settings
from app.db.base import SessionLocal, get_db
from app.models.chat import ChatConversation, ChatConversationType
from app.models.group_cohort import GroupCohort
from app.models.user import User, UserRole
from app.schemas.chat import (
    ChatConversationResponse,
    ChatMessageResponse,
    SendMessageRequest,
    UnreadCountResponse,
)

router = APIRouter()


# ─── Serialización ───────────────────────────────────────────────────────

def _serialize_conversation(db: Session, convo: ChatConversation, current_user: User) -> ChatConversationResponse:
    from app.models.chat import ChatReadState, ChatMessage

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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    chat_core.assert_chat_enabled(db)
    convo = db.query(ChatConversation).filter(ChatConversation.id == conversation_id).first()
    if not convo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversación no encontrada")
    chat_core.assert_participant(db, current_user, convo)
    messages = chat_core.get_messages(db, convo, before_id=before_id)
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


@router.post("/conversations/{conversation_id}/messages", response_model=ChatMessageResponse)
@limiter.limit("30/minute")
async def post_message(
    request: Request,
    conversation_id: int,
    data: SendMessageRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Envío por REST (fallback si el WS no está conectado). El WS también
    puede recibir mensajes directamente — ver `chat_websocket` más abajo —
    ambos caminos pasan por la misma `chat_core.send_message`.
    """
    config = chat_core.assert_chat_enabled(db)
    convo = db.query(ChatConversation).filter(ChatConversation.id == conversation_id).first()
    if not convo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversación no encontrada")
    chat_core.assert_participant(db, current_user, convo)

    message, should_notify = chat_core.send_message(db, config, convo, current_user, data.content)
    await _broadcast_and_notify(db, convo, message, should_notify)
    return _serialize_message(message)


# ─── WebSocket ───────────────────────────────────────────────────────────
#
# El navegador no permite mandar headers custom (Authorization) al abrir
# un WebSocket, y frontend/backend son servicios distintos (no hay cookie
# same-site que viaje sola) — por eso el token va como query param sobre
# wss:// (va cifrado por TLS igual que cualquier header).

@router.websocket("/ws/{conversation_id}")
async def chat_websocket(websocket: WebSocket, conversation_id: int, token: str = Query(...)):
    payload = decode_access_token(token)
    if not payload:
        await websocket.close(code=4401)
        return

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == int(payload["sub"])).first()
        if not user or not user.is_active:
            await websocket.close(code=4401)
            return

        config = chat_core.assert_chat_enabled_ws(db)
        if config is None:
            await websocket.close(code=4403)
            return

        convo = db.query(ChatConversation).filter(ChatConversation.id == conversation_id).first()
        if not convo:
            await websocket.close(code=4404)
            return
        try:
            chat_core.assert_participant(db, user, convo)
        except HTTPException:
            await websocket.close(code=4403)
            return

        await chat_manager.connect(conversation_id, user.id, websocket)
        try:
            while True:
                raw = await websocket.receive_json()
                content = (raw or {}).get("content", "")
                # Re-chequeamos el toggle en cada mensaje (no solo al conectar)
                # por si el admin lo apaga mientras el socket sigue abierto.
                config = chat_core.assert_chat_enabled_ws(db)
                if config is None:
                    await websocket.send_json({"type": "error", "detail": "Chat deshabilitado"})
                    continue
                try:
                    message, should_notify = chat_core.send_message(db, config, convo, user, content)
                except HTTPException as e:
                    await websocket.send_json({"type": "error", "detail": e.detail})
                    continue
                await _broadcast_and_notify(db, convo, message, should_notify)
        except WebSocketDisconnect:
            pass
        finally:
            chat_manager.disconnect(conversation_id, user.id, websocket)
    finally:
        db.close()


async def _broadcast_and_notify(db: Session, convo: ChatConversation, message, should_notify: bool) -> None:
    payload = {
        "type": "message",
        "id": message.id,
        "conversation_id": message.conversation_id,
        "sender_id": message.sender_id,
        "sender_username": message.sender.username,
        "content": message.content,
        "created_at": message.created_at.isoformat(),
    }
    await chat_manager.broadcast(convo.id, payload)

    if should_notify and convo.teacher and convo.teacher.user:
        teacher_user = convo.teacher.user
        student_name = message.sender.name if convo.conversation_type == ChatConversationType.direct else message.sender.name
        try:
            send_new_chat_message_teacher_email(
                to_email=teacher_user.email,
                teacher_name=teacher_user.name,
                student_name=student_name,
                message_preview=message.content[:140],
                conversation_url=f"{settings.FRONTEND_URL}/teacher/chat?conversation={convo.id}",
            )
        except Exception:
            # Nunca romper el envío del mensaje por un fallo de email.
            pass
