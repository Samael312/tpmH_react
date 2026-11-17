"""
Aviso por email de mensajes de chat, AGRUPADO (Fase 9).

Antes: un correo al profesor por cada conversacion que se reactivaba (con 20 alumnos, hasta 20 correos de la
cuota diaria de Resend). Ahora el mensaje que antes disparaba el correo solo marca la conversacion como
pendiente (`teacher_notify_pending_at`); pasados CHAT_DIGEST_DELAY_MINUTES (10 por defecto) un job envia UN correo
por profesor con todas sus conversaciones pendientes. Si el profesor ya leyo los mensajes en ese rato, no se envia.
La ventana de reactivacion (PlatformConfig.chat_reactivation_hours) sigue decidiendo QUE mensajes avisan.
"""
import logging
import os
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.email import send_chat_digest_teacher_email, send_new_chat_message_teacher_email
from app.core.timezone import utc_now
from app.models.chat import ChatConversation, ChatMessage, ChatReadState

logger = logging.getLogger(__name__)

CHAT_DIGEST_DELAY = timedelta(minutes=max(int(os.getenv("CHAT_DIGEST_DELAY_MINUTES", "10")), 0))


def next_due(db: Session) -> Optional[datetime]:
    """Cuando hay que enviar el siguiente resumen (None si no hay avisos pendientes)."""
    first = db.query(func.min(ChatConversation.teacher_notify_pending_at)).scalar()
    return None if first is None else first + CHAT_DIGEST_DELAY


def _unread_from_others(db: Session, convo: ChatConversation, teacher_user_id: int) -> tuple[int, Optional[ChatMessage]]:
    """Mensajes de otros que el profesor aun no leyo y el ultimo de ellos."""
    state = db.query(ChatReadState).filter(
        ChatReadState.conversation_id == convo.id, ChatReadState.user_id == teacher_user_id,
    ).first()
    q = db.query(ChatMessage).filter(ChatMessage.conversation_id == convo.id, ChatMessage.sender_id != teacher_user_id)
    if state and state.last_read_at:
        q = q.filter(ChatMessage.created_at > state.last_read_at)
    return q.count(), q.order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc()).first()


def send_pending_digests(db: Session, now: Optional[datetime] = None) -> int:
    """Envia un correo por profesor con sus conversaciones pendientes vencidas. Devuelve cuantos correos pidio enviar."""
    now = now or utc_now()
    due = db.query(ChatConversation).filter(
        ChatConversation.teacher_notify_pending_at.isnot(None),
        ChatConversation.teacher_notify_pending_at <= now - CHAT_DIGEST_DELAY,
    ).all()
    by_teacher: dict[int, list[ChatConversation]] = {}
    for convo in due:
        by_teacher.setdefault(convo.teacher_id, []).append(convo)

    sent = 0
    for _tid, convos in by_teacher.items():
        teacher = convos[0].teacher
        teacher_user = teacher.user if teacher else None
        items: list[tuple[str, int, str, int]] = []   # (alumno, no leidos, vista previa, id de conversacion)
        if teacher_user and teacher_user.is_active:
            for convo in convos:
                unread, last = _unread_from_others(db, convo, teacher_user.id)
                if unread and last is not None:
                    name = last.sender.name if last.sender else "Un alumno"
                    items.append((name, unread, last.content[:140], convo.id))
        for convo in convos:           # se descartan tambien las ya leidas: nada que avisar
            convo.teacher_notify_pending_at = None
        db.commit()
        if not items or not teacher_user:
            continue
        try:
            if len(items) == 1:
                name, _n, preview, cid = items[0]
                send_new_chat_message_teacher_email(
                    to_email=teacher_user.email, teacher_name=teacher_user.name, student_name=name,
                    message_preview=preview, conversation_url=f"{settings.FRONTEND_URL}/teacher/chat?conversation={cid}",
                )
            else:
                send_chat_digest_teacher_email(
                    to_email=teacher_user.email, teacher_name=teacher_user.name,
                    items=[(n, c, p) for n, c, p, _cid in items],
                    conversation_url=f"{settings.FRONTEND_URL}/teacher/chat",
                )
            sent += 1
        except Exception:
            logger.exception("No se pudo enviar el resumen de chat")
    return sent
