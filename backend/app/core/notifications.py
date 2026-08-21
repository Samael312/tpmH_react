from sqlalchemy.orm import Session
from typing import Optional
from app.models.notification import Notification


def create_notification(
    db: Session,
    type: str,
    title: str,
    message: Optional[str] = None,
    related_teacher_id: Optional[int] = None,
    recipient_role: str = "staff",
) -> Notification:
    """
    Crea una notificación persistente para el panel de staff.
    No hace commit — el caller decide cuándo confirmar la transacción
    (normalmente junto con el resto de cambios de la operación).
    """
    notification = Notification(
        recipient_role=recipient_role,
        type=type,
        title=title,
        message=message,
        related_teacher_id=related_teacher_id,
    )
    db.add(notification)
    return notification


def get_unread_count(db: Session, recipient_role: str = "staff") -> int:
    return db.query(Notification).filter(
        Notification.recipient_role == recipient_role,
        Notification.is_read == False,
    ).count()