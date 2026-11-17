# app/api/v1/endpoints/support.py

from datetime import timedelta
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Response, status
from app.core.pagination import Pagination, paginate
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_teacher_or_teacher_admin, get_current_user
from app.core.class_logic import CLASS_STATUS_WINDOW_HOURS
from app.core.timezone import utc_now
from app.models.class_ import Class, ClassType
from app.core.email import send_admin_new_support_ticket_email
from app.core.notifications import create_notification
from app.db.base import get_db
from app.models.support_ticket import SupportCategory, SupportTicket, SupportTicketStatus
from app.models.user import User, UserRole
from app.schemas.support import (
    CreateClassCorrectionRequest,
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

    role_label = "Profesor" if current_user.role in (UserRole.teacher, UserRole.teacher_admin) else "Estudiante"
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


@router.post("/class-corrections", response_model=SupportTicketResponse, status_code=status.HTTP_201_CREATED)
def create_class_correction_ticket(
    data: CreateClassCorrectionRequest,
    current_user: User = Depends(get_current_teacher_or_teacher_admin),
    db: Session = Depends(get_db),
):
    """
    NEG-02: el profesor (o teacher_admin) pide cambiar una clase suya que quedo en
    `no_show` una vez cerrada la ventana de 72 h. Lo resuelve el superadmin:
    - `completed`: no cambia el credito (no_show y completed ya lo consumen).
    - `cancelled`: se devuelve el credito.
    """
    teacher = current_user.teacher_profile
    if not teacher:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Perfil de profesor no encontrado")
    class_ = db.query(Class).filter(Class.id == data.class_id, Class.teacher_id == teacher.id).first()
    if not class_:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Clase no encontrada")
    if class_.class_type == ClassType.external:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Las clases externas no se pueden corregir")
    if class_.status != "no_show":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Solo se puede pedir correccion de una clase en estado no_show")
    if utc_now() - class_.end_time_utc <= timedelta(hours=CLASS_STATUS_WINDOW_HOURS):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Aun estas dentro de las {CLASS_STATUS_WINDOW_HOURS} h: cambia el estado directamente desde la clase.",
        )
    if db.query(SupportTicket).filter(
        SupportTicket.class_id == class_.id,
        SupportTicket.category == SupportCategory.class_correction,
        SupportTicket.status == SupportTicketStatus.pending,
    ).first():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ya hay una solicitud de correccion pendiente para esta clase")

    label = "completada" if data.requested_status == "completed" else "cancelada"
    ticket = SupportTicket(
        user_id=current_user.id,
        category=SupportCategory.class_correction,
        subject=f"Correccion de clase #{class_.id}: pasar a {label}",
        message=data.reason,
        class_id=class_.id,
        requested_status=data.requested_status,
    )
    db.add(ticket)
    db.flush()
    create_notification(
        db,
        type="support_ticket",
        title="Solicitud de correccion de clase",
        message=f"{current_user.name} {current_user.surname}: clase #{class_.id} -> {label}",
        related_support_ticket_id=ticket.id,
    )
    db.commit()
    db.refresh(ticket)

    for admin in db.query(User).filter(User.role == UserRole.superadmin, User.is_active == True).all():  # noqa: E712
        send_admin_new_support_ticket_email(
            to_email=admin.email,
            user_name=f"{current_user.name} {current_user.surname}",
            user_role_label="Profesor",
            category_label="Correccion de clase",
            subject=ticket.subject,
            message=ticket.message,
        )
    return ticket


@router.get("/tickets/me", response_model=List[SupportTicketResponse])
def get_my_support_tickets(
    response: Response,
    page: Pagination = Depends(),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Bandeja 'Mi soporte' del usuario — sus propios tickets, más recientes primero."""
    _require_student_or_teacher(current_user)

    query = (
        db.query(SupportTicket)
        .filter(SupportTicket.user_id == current_user.id)
        .order_by(SupportTicket.created_at.desc(), SupportTicket.id.desc())
    )
    return paginate(query, page, response).all()


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
