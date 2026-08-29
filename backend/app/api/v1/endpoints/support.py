# app/api/v1/endpoints/support.py

from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.core.email import send_admin_new_support_ticket_email
from app.core.notifications import create_notification
from app.db.base import get_db
from app.models.support_ticket import SupportCategory, SupportTicket, SupportTicketStatus
from app.models.user import User, UserRole
from app.schemas.support import (
    CreateSupportTicketRequest,
    SupportTicketResponse,
    UnreadSupportCountResponse,
)

router = APIRouter()

_CATEGORY_LABELS = {
    "bug": "Bug",
    "error": "Error",
    "question": "Duda",
    "other": "Otro",
}


def _require_student_or_teacher(current_user: User) -> None:
    if current_user.role not in (UserRole.student, UserRole.teacher):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Solo estudiantes y profesores pueden enviar tickets de soporte",
        )


@router.post("/tickets", response_model=SupportTicketResponse, status_code=status.HTTP_201_CREATED)
def create_support_ticket(
    data: CreateSupportTicketRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    El student o teacher reporta un bug, un error, o una duda que Chipi no
    pudo resolver. Genera un ticket pendiente y una notificación en la
    bandeja de staff (superadmin + teacher_admin), igual que ocurre con las
    apelaciones de profesores.
    """
    _require_student_or_teacher(current_user)

    ticket = SupportTicket(
        user_id=current_user.id,
        category=SupportCategory(data.category),
        subject=data.subject,
        message=data.message,
        screen_context=data.screen_context,
    )
    db.add(ticket)
    db.flush()  # asigna ticket.id antes de crear la notificación

    role_label = "Profesor" if current_user.role == UserRole.teacher else "Estudiante"
    create_notification(
        db,
        type="support_ticket",
        title=f"Nuevo ticket de soporte ({role_label})",
        message=f"{current_user.name} {current_user.surname}: {data.subject}",
        related_support_ticket_id=ticket.id,
    )

    db.commit()
    db.refresh(ticket)

    staff_emails = [
        u.email for u in db.query(User).filter(
            User.role.in_([UserRole.superadmin, UserRole.teacher_admin]),
            User.is_active == True,  # noqa: E712
        ).all()
    ]
    for staff_email in staff_emails:
        send_admin_new_support_ticket_email(
            to_email=staff_email,
            user_name=f"{current_user.name} {current_user.surname}",
            user_role_label=role_label,
            category_label=_CATEGORY_LABELS.get(data.category, data.category),
            subject=data.subject,
            message=data.message,
        )

    return ticket


@router.get("/tickets/me", response_model=List[SupportTicketResponse])
def get_my_support_tickets(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Bandeja 'Mi soporte' del usuario — sus propios tickets, más recientes primero."""
    _require_student_or_teacher(current_user)

    return (
        db.query(SupportTicket)
        .filter(SupportTicket.user_id == current_user.id)
        .order_by(SupportTicket.created_at.desc())
        .all()
    )


@router.get("/tickets/me/unread-count", response_model=UnreadSupportCountResponse)
def get_my_unread_support_count(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Cantidad de tickets respondidos que el usuario aún no ha revisado —
    alimenta el badge en el sidebar (equivalente al contador de staff).
    """
    _require_student_or_teacher(current_user)

    count = (
        db.query(SupportTicket)
        .filter(
            SupportTicket.user_id == current_user.id,
            SupportTicket.status == SupportTicketStatus.answered,
            SupportTicket.user_notified_seen == False,  # noqa: E712
        )
        .count()
    )
    return {"unread_count": count}


@router.patch("/tickets/{ticket_id}/seen", response_model=SupportTicketResponse)
def mark_support_ticket_seen(
    ticket_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Marca como vista la respuesta del staff (quita el badge de no leído)."""
    _require_student_or_teacher(current_user)

    ticket = db.query(SupportTicket).filter(
        SupportTicket.id == ticket_id,
        SupportTicket.user_id == current_user.id,
    ).first()
    if not ticket:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ticket no encontrado")

    if not ticket.user_notified_seen:
        ticket.user_notified_seen = True
        db.commit()
        db.refresh(ticket)

    return ticket
