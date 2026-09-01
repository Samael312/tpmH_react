"""
Suite: Tickets de soporte.

No hay DELETE de tickets por API (por diseño: son historial). Se limpian
directo por BD, junto con la Notification que se genera para el staff.
"""
import pytest

from app.models.support_ticket import SupportTicket
from app.models.notification import Notification
from tests.flow.conftest import auth_headers

pytestmark = pytest.mark.integration


def _register_ticket_cleanup(volatile, ticket_id: int):
    # OJO con el orden: Notification.related_support_ticket_id apunta al
    # ticket, así que hay que borrar la notificación ANTES que el ticket
    # (si no, el DELETE del ticket viola la FK y falla en silencio dentro
    # del teardown). volatile ejecuta en orden LIFO (inverso al registro),
    # así que registramos el ticket PRIMERO para que se borre AL FINAL.
    volatile.db(SupportTicket, ticket_id, label=f"ticket de soporte #{ticket_id}")
    volatile.db_query(Notification, related_support_ticket_id=ticket_id, label=f"notificación del ticket #{ticket_id}")


def test_student_creates_ticket_and_staff_resolves_it(
    client, student_token, superadmin_token, volatile,
):
    """
    Técnico: flujo completo de un ticket — el estudiante lo crea (201,
    status "pending"), aparece en su propio listado y en el listado de
    staff filtrado por pendientes, y el superadmin lo resuelve (status
    pasa a "answered").
    UX: es "Ayuda y soporte" de punta a punta — un estudiante con una
    duda escribe al equipo, y ese equipo puede verla y responderla desde
    el panel de administración.
    """
    r_create = client.post("/api/v1/support/tickets", json={
        "category": "question", "subject": "Flow-test ticket",
        "message": "Ticket creado por la suite automática de flow-tests.",
    }, headers=auth_headers(student_token))
    assert r_create.status_code == 201, r_create.text
    ticket = r_create.json()
    ticket_id = ticket["id"]
    assert ticket["status"] == "pending"
    _register_ticket_cleanup(volatile, ticket_id)

    r_mine = client.get("/api/v1/support/tickets/me", headers=auth_headers(student_token))
    assert r_mine.status_code == 200
    assert any(t["id"] == ticket_id for t in r_mine.json())

    r_staff_list = client.get(
        "/api/v1/admin/support-tickets?status_filter=pending", headers=auth_headers(superadmin_token),
    )
    assert r_staff_list.status_code == 200
    assert any(t["id"] == ticket_id for t in r_staff_list.json())

    r_resolve = client.patch(
        f"/api/v1/admin/support-tickets/{ticket_id}/resolve",
        json={"admin_response": "Resuelto automáticamente por flow-tests."},
        headers=auth_headers(superadmin_token),
    )
    assert r_resolve.status_code == 200, r_resolve.text
    assert r_resolve.json()["status"] == "answered"


def test_teacher_admin_can_also_resolve_tickets(client, student_token, teacher_admin_token, volatile):
    """
    Técnico: el mismo flujo de resolución de tickets, pero con token de
    teacher_admin en vez de superadmin — confirma que get_current_staff
    también cubre este endpoint para ambos roles de staff.
    UX: cualquier miembro del equipo de soporte (no solo el dueño de la
    plataforma) debe poder cerrar tickets de estudiantes.
    """
    r_create = client.post("/api/v1/support/tickets", json={
        "category": "bug", "subject": "Flow-test ticket 2",
        "message": "Segundo ticket de la suite automática.",
    }, headers=auth_headers(student_token))
    assert r_create.status_code == 201, r_create.text
    ticket_id = r_create.json()["id"]
    _register_ticket_cleanup(volatile, ticket_id)

    r_resolve = client.patch(
        f"/api/v1/admin/support-tickets/{ticket_id}/resolve",
        json={"admin_response": "Resuelto por teacher_admin (flow-tests)."},
        headers=auth_headers(teacher_admin_token),
    )
    assert r_resolve.status_code == 200, r_resolve.text


def test_superadmin_cannot_create_ticket(client, superadmin_token):
    """
    Técnico: POST /support/tickets con token de superadmin espera 403 —
    solo student/teacher pueden abrir tickets.
    UX: el formulario de "Ayuda y soporte" es para usuarios finales
    (estudiantes/profesores) con una duda, no para el propio staff que
    los atiende.
    """
    r = client.post("/api/v1/support/tickets", json={
        "category": "question", "subject": "No debería crearse", "message": "x",
    }, headers=auth_headers(superadmin_token))
    assert r.status_code == 403
