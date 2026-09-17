"""
Suite: Chat interno (N1) y su toggle/retención/reactivación desde
/admin/settings (N2).

Cubre:
  - Autorización del chat directo contra TeacherProfile.students (NO
    StudentTeacherLink — ver core/chat.py, motivo documentado ahí y en
    informe_verificacion_chat_interno.md).
  - Flujo feliz 1:1: abrir conversación, mandar mensajes en ambos
    sentidos por REST, contador de no leídos, marcar como leído.
  - Chat grupal: solo quien tiene Enrollment activo en la cohorte (o es
    su profesor) puede entrar; un tercero sin enrollment no puede.
  - El toggle chat_enabled bloquea TODO el acceso REST (no solo el UI),
    y lo puede togglear tanto superadmin como teacher_admin.
  - Purga por retención (core.chat.purge_old_messages), llamada directo
    (no hay endpoint HTTP para esto — es un job del scheduler).
"""
import pytest
from datetime import timedelta

from app.models.teacher import TeacherProfile
from app.models.student import StudentProfile
from app.models.package import Package, Enrollment
from app.models.group_cohort import GroupCohort
from app.models.chat import ChatConversation, ChatConversationType, ChatMessage, ChatReadState
from app.models.payment import Payment
from app.core.timezone import utc_now
from tests.flow.conftest import auth_headers

pytestmark = [pytest.mark.integration, pytest.mark.destructive]


# ─── Fixtures de setup/cleanup ─────────────────────────────────────────────

@pytest.fixture
def linked_student_teacher(db, fixed_users, volatile):
    """
    Vincula al student y teacher fijos vía TeacherProfile.students (la
    fuente de verdad usada por core/chat.py en AMBOS modos de tenant —
    ver informe). Restaura la lista original al terminar, y borra
    cualquier ChatConversation/Message/ReadState que haya quedado entre
    este par puntual.
    """
    teacher = db.query(TeacherProfile).filter(TeacherProfile.user_id == fixed_users["teacher"].id).first()
    student = db.query(StudentProfile).filter(StudentProfile.user_id == fixed_users["student"].id).first()
    original_students = list(teacher.students or [])

    if student.id not in original_students:
        teacher.students = original_students + [student.id]
        db.commit()

    def _cleanup():
        from app.db.base import SessionLocal
        s = SessionLocal()
        try:
            t = s.query(TeacherProfile).filter(TeacherProfile.id == teacher.id).first()
            t.students = original_students
            s.commit()
            convo_ids = [
                c.id for c in s.query(ChatConversation).filter(
                    ChatConversation.teacher_id == teacher.id,
                    ChatConversation.student_id == student.id,
                ).all()
            ]
            if convo_ids:
                s.query(ChatMessage).filter(ChatMessage.conversation_id.in_(convo_ids)).delete(synchronize_session=False)
                s.query(ChatReadState).filter(ChatReadState.conversation_id.in_(convo_ids)).delete(synchronize_session=False)
                s.query(ChatConversation).filter(ChatConversation.id.in_(convo_ids)).delete(synchronize_session=False)
            s.commit()
        finally:
            s.close()

    volatile.custom(_cleanup, label="restaurar TeacherProfile.students + borrar conversación directa del par fijo")
    return {"teacher_id": teacher.id, "student_id": student.id}


@pytest.fixture
def unlinked_student_teacher(db, fixed_users):
    """Mismo par fijo, pero SIN tocar TeacherProfile.students — para probar que sin
    vínculo el chat directo se rechaza."""
    teacher = db.query(TeacherProfile).filter(TeacherProfile.user_id == fixed_users["teacher"].id).first()
    student = db.query(StudentProfile).filter(StudentProfile.user_id == fixed_users["student"].id).first()
    # Salvaguarda: si un test anterior dejó el vínculo puesto, lo saca.
    if student.id in (teacher.students or []):
        teacher.students = [sid for sid in teacher.students if sid != student.id]
        db.commit()
    return {"teacher_id": teacher.id, "student_id": student.id}


@pytest.fixture
def chat_config_restorer(db, volatile):
    """Restaura chat_enabled/retention/reactivation al valor que tenían antes del test."""
    from app.core.platform_config import get_or_create_platform_config
    config = get_or_create_platform_config(db)
    original = {
        "chat_enabled": config.chat_enabled,
        "chat_retention_days": config.chat_retention_days,
        "chat_reactivation_hours": config.chat_reactivation_hours,
    }

    def _restore():
        from app.db.base import SessionLocal
        s = SessionLocal()
        try:
            c = get_or_create_platform_config(s)
            c.chat_enabled = original["chat_enabled"]
            c.chat_retention_days = original["chat_retention_days"]
            c.chat_reactivation_hours = original["chat_reactivation_hours"]
            s.commit()
        finally:
            s.close()

    volatile.custom(_restore, label="restaurar chat_enabled/retention/reactivation")
    return original


@pytest.fixture
def group_cohort_ids(client, teacher_token, student_token, fixed_users, db, volatile):
    from app.models.payment_config import PaymentConfig
    payment_config = db.query(PaymentConfig).first()
    if not payment_config:
        payment_config = PaymentConfig(paypal_enabled=True)
        db.add(payment_config)
        db.commit()
    elif not payment_config.paypal_enabled:
        payment_config.paypal_enabled = True
        db.commit()

    package_payload = {
        "name": "Flow-test chat grupal", "subject": "English", "price": 80.0,
        "price_per_class": 10.0,
        "classes_count": 8, "duration_minutes": 50,
        "is_group": True, "min_students": 1, "max_students": 6,
    }
    r_pkg = client.post("/api/v1/packages/", json=package_payload, headers=auth_headers(teacher_token))
    assert r_pkg.status_code == 201, r_pkg.text
    package_id = r_pkg.json()["id"]

    r_cohort = client.post("/api/v1/cohorts/", json={
        "package_id": package_id, "min_students": 1, "max_students": 6,
    }, headers=auth_headers(teacher_token))
    assert r_cohort.status_code == 201, r_cohort.text
    cohort_id = r_cohort.json()["id"]

    r_enroll = client.post(f"/api/v1/cohorts/{cohort_id}/enroll", json={
        "cohort_id": cohort_id, "payment_method": "paypal", "transaction_reference": "flow-tests-chat-cohort",
    }, headers=auth_headers(student_token))
    assert r_enroll.status_code == 201, r_enroll.text
    enrollment_id = r_enroll.json()["enrollment_id"]

    def _cleanup():
        from app.db.base import SessionLocal
        s = SessionLocal()
        try:
            convo_ids = [c.id for c in s.query(ChatConversation).filter(ChatConversation.cohort_id == cohort_id).all()]
            if convo_ids:
                s.query(ChatMessage).filter(ChatMessage.conversation_id.in_(convo_ids)).delete(synchronize_session=False)
                s.query(ChatReadState).filter(ChatReadState.conversation_id.in_(convo_ids)).delete(synchronize_session=False)
                s.query(ChatConversation).filter(ChatConversation.id.in_(convo_ids)).delete(synchronize_session=False)
            s.query(Payment).filter(Payment.student_id == fixed_users["student"].id).delete(synchronize_session=False)
            s.query(Enrollment).filter(Enrollment.id == enrollment_id).delete(synchronize_session=False)
            s.query(GroupCohort).filter(GroupCohort.id == cohort_id).delete(synchronize_session=False)
            s.query(Package).filter(Package.id == package_id).delete(synchronize_session=False)
            s.commit()
        finally:
            s.close()

    volatile.custom(_cleanup, label="limpieza cohorte de chat grupal (paquete/cohorte/enrollment/conversación)")
    return {"cohort_id": cohort_id, "package_id": package_id, "enrollment_id": enrollment_id}


# ─── Chat directo 1:1 ───────────────────────────────────────────────────

def test_direct_chat_happy_path(client, teacher_token, student_token, linked_student_teacher):
    """
    Técnico: con el vínculo puesto en TeacherProfile.students, el alumno
    abre la conversación con GET /chat/conversations/direct/{username},
    ambos mandan mensajes por REST (POST .../messages), el mensaje del
    profesor aparece en el historial del alumno (GET .../messages) y
    viceversa, el contador de no leídos sube y baja al marcar como leído.
    UX: es el flujo central de N1 — alumno y profesor hablando 1:1.
    """
    from tests.flow import constants as C

    r_open = client.get(f"/api/v1/chat/conversations/direct/{C.TEACHER['username']}", headers=auth_headers(student_token))
    assert r_open.status_code == 200, r_open.text
    convo = r_open.json()
    assert convo["conversation_type"] == "direct"
    conversation_id = convo["id"]

    r_send_student = client.post(
        f"/api/v1/chat/conversations/{conversation_id}/messages",
        json={"content": "Hola profe, flow-test aquí"},
        headers=auth_headers(student_token),
    )
    assert r_send_student.status_code == 200, r_send_student.text

    r_send_teacher = client.post(
        f"/api/v1/chat/conversations/{conversation_id}/messages",
        json={"content": "Hola! Todo bien"},
        headers=auth_headers(teacher_token),
    )
    assert r_send_teacher.status_code == 200, r_send_teacher.text

    r_history = client.get(f"/api/v1/chat/conversations/{conversation_id}/messages", headers=auth_headers(teacher_token))
    assert r_history.status_code == 200
    contents = [m["content"] for m in r_history.json()]
    assert "Hola profe, flow-test aquí" in contents
    assert "Hola! Todo bien" in contents

    # El alumno tiene 1 no leído (el mensaje del profe); el profe tiene 0
    # tras haber mandado el suyo (no cuenta los propios).
    r_unread_student = client.get("/api/v1/chat/conversations/unread-count", headers=auth_headers(student_token))
    assert r_unread_student.status_code == 200
    assert r_unread_student.json()["unread_count"] >= 1

    r_read = client.post(f"/api/v1/chat/conversations/{conversation_id}/read", headers=auth_headers(student_token))
    assert r_read.status_code == 200, r_read.text

    r_unread_student_after = client.get("/api/v1/chat/conversations/unread-count", headers=auth_headers(student_token))
    assert r_unread_student_after.json()["unread_count"] == 0


def test_direct_chat_requires_real_link_not_student_teacher_link(
    client, student_token, unlinked_student_teacher,
):
    """
    Técnico: REGRESIÓN a propósito. Sin TeacherProfile.students poblado
    (aunque StudentTeacherLink pudiera decir cualquier otra cosa, esa
    tabla ya NO es la fuente de verdad — ver core/chat.py), el alumno NO
    puede abrir conversación con ese profesor: 403.
    UX: nadie debería poder chatear con un profesor que no es el suyo.
    """
    from tests.flow import constants as C

    r_open = client.get(f"/api/v1/chat/conversations/direct/{C.TEACHER['username']}", headers=auth_headers(student_token))
    assert r_open.status_code == 403, r_open.text


# ─── Chat grupal ─────────────────────────────────────────────────────────

def test_group_chat_cohort_members_can_talk(client, teacher_token, student_token, group_cohort_ids):
    """
    Técnico: profesor y alumno inscrito (Enrollment real vía
    /cohorts/{id}/enroll) pueden abrir y usar la conversación grupal de
    la cohorte.
    UX: el chat grupal de N1 — todos los que están en el grupo pueden
    hablar entre sí y con el profesor.
    """
    cohort_id = group_cohort_ids["cohort_id"]

    r_open_teacher = client.get(f"/api/v1/chat/conversations/group/{cohort_id}", headers=auth_headers(teacher_token))
    assert r_open_teacher.status_code == 200, r_open_teacher.text
    conversation_id = r_open_teacher.json()["id"]
    assert r_open_teacher.json()["conversation_type"] == "group"

    r_open_student = client.get(f"/api/v1/chat/conversations/group/{cohort_id}", headers=auth_headers(student_token))
    assert r_open_student.status_code == 200
    assert r_open_student.json()["id"] == conversation_id

    r_send = client.post(
        f"/api/v1/chat/conversations/{conversation_id}/messages",
        json={"content": "Hola grupo, flow-test"},
        headers=auth_headers(student_token),
    )
    assert r_send.status_code == 200, r_send.text


def test_group_chat_rejects_non_member(client, teacher_admin_token, group_cohort_ids):
    """
    Técnico: un usuario que NO tiene Enrollment en la cohorte (acá, el
    teacher_admin fijo, que no es ni el profesor ni un alumno inscrito)
    recibe 403 al intentar abrir la conversación grupal.
    UX: privacidad del chat grupal — solo los del grupo entran.
    """
    cohort_id = group_cohort_ids["cohort_id"]
    r = client.get(f"/api/v1/chat/conversations/group/{cohort_id}", headers=auth_headers(teacher_admin_token))
    assert r.status_code == 403, r.text


# ─── Toggle N2 ────────────────────────────────────────────────────────────

def test_chat_toggle_blocks_backend_not_just_ui(
    client, superadmin_token, student_token, linked_student_teacher, chat_config_restorer,
):
    """
    Técnico: apagar chat_enabled vía PATCH /admin/platform-config hace
    que TODOS los endpoints de /chat devuelvan 403 (no solo que el
    frontend oculte el botón) — abrir conversación, historial y envío,
    aunque el vínculo profesor-alumno siga siendo válido.
    UX: N2 tal como se especificó — "ocultar tanto en UI como bloqueo en
    backend para evitar inyección de datos".
    """
    from tests.flow import constants as C

    r_open_before = client.get(f"/api/v1/chat/conversations/direct/{C.TEACHER['username']}", headers=auth_headers(student_token))
    assert r_open_before.status_code == 200, r_open_before.text
    conversation_id = r_open_before.json()["id"]

    r_toggle_off = client.patch("/api/v1/admin/platform-config", json={"chat_enabled": False}, headers=auth_headers(superadmin_token))
    assert r_toggle_off.status_code == 200, r_toggle_off.text

    r_config = client.get("/api/v1/admin/platform-config")
    assert r_config.status_code == 200
    assert r_config.json()["chat_enabled"] is False

    r_list_blocked = client.get("/api/v1/chat/conversations", headers=auth_headers(student_token))
    assert r_list_blocked.status_code == 403

    r_history_blocked = client.get(f"/api/v1/chat/conversations/{conversation_id}/messages", headers=auth_headers(student_token))
    assert r_history_blocked.status_code == 403

    r_send_blocked = client.post(
        f"/api/v1/chat/conversations/{conversation_id}/messages",
        json={"content": "esto no debería enviarse"},
        headers=auth_headers(student_token),
    )
    assert r_send_blocked.status_code == 403

    # Reactivarlo desbloquea de nuevo (confirma que el 403 es por el
    # toggle y no por otra causa).
    r_toggle_on = client.patch("/api/v1/admin/platform-config", json={"chat_enabled": True}, headers=auth_headers(superadmin_token))
    assert r_toggle_on.status_code == 200
    r_list_unblocked = client.get("/api/v1/chat/conversations", headers=auth_headers(student_token))
    assert r_list_unblocked.status_code == 200


def test_teacher_admin_can_toggle_and_configure_chat_settings(
    client, teacher_admin_token, chat_config_restorer,
):
    """
    Técnico: teacher_admin (no solo superadmin) puede togglear
    chat_enabled y ajustar chat_retention_days / chat_reactivation_hours
    desde el mismo PATCH /admin/platform-config.
    UX: confirmado explícitamente por el dueño del producto — "superadmin
    y teacher_admin" deben poder tocar este toggle.
    """
    r = client.patch("/api/v1/admin/platform-config", json={
        "chat_enabled": True, "chat_retention_days": 45, "chat_reactivation_hours": 12,
    }, headers=auth_headers(teacher_admin_token))
    assert r.status_code == 200, r.text

    r_config = client.get("/api/v1/admin/platform-config")
    assert r_config.json()["chat_retention_days"] == 45
    assert r_config.json()["chat_reactivation_hours"] == 12


def test_chat_config_rejects_negative_values(client, superadmin_token, chat_config_restorer):
    """
    Técnico: chat_retention_days / chat_reactivation_hours negativos se
    rechazan con 400 (ver admin.py — no tendría sentido una retención o
    ventana de reactivación negativa).
    """
    r = client.patch("/api/v1/admin/platform-config", json={"chat_retention_days": -5}, headers=auth_headers(superadmin_token))
    assert r.status_code == 400, r.text


# ─── Retención (purga) ────────────────────────────────────────────────────

def test_purge_old_messages_respects_retention_days(db, linked_student_teacher):
    """
    Técnico: core.chat.purge_old_messages borra solo los mensajes más
    viejos que N días, deja intactos los recientes, y con
    retention_days=0 no borra nada (política "sin límite"). Llamado
    directo a la función — es el mismo código que corre el job diario
    del scheduler (no hay endpoint HTTP para esto).
    """
    from app.core.chat import purge_old_messages

    teacher_id = linked_student_teacher["teacher_id"]
    student_id = linked_student_teacher["student_id"]

    convo = db.query(ChatConversation).filter(
        ChatConversation.teacher_id == teacher_id, ChatConversation.student_id == student_id,
    ).first()
    if not convo:
        convo = ChatConversation(conversation_type=ChatConversationType.direct, teacher_id=teacher_id, student_id=student_id)
        db.add(convo)
        db.commit()
        db.refresh(convo)

    student_user_id = db.query(StudentProfile).filter(StudentProfile.id == student_id).first().user_id
    old_msg = ChatMessage(conversation_id=convo.id, sender_id=student_user_id, content="viejo")
    recent_msg = ChatMessage(conversation_id=convo.id, sender_id=student_user_id, content="reciente")
    db.add_all([old_msg, recent_msg])
    db.commit()
    db.refresh(old_msg)
    db.refresh(recent_msg)
    old_msg_id = old_msg.id
    recent_msg_id = recent_msg.id

    # Retroceha la fecha del mensaje "viejo" manualmente (server_default
    # no se puede pasar por constructor).
    db.query(ChatMessage).filter(ChatMessage.id == old_msg_id).update(
        {"created_at": utc_now() - timedelta(days=100)}, synchronize_session=False,
    )
    db.commit()

    try:
        # retention_days=0 => no borra nada.
        deleted_none = purge_old_messages(db, 0)
        assert deleted_none == 0
        assert db.query(ChatMessage).filter(ChatMessage.id == old_msg_id).first() is not None

        # retention_days=90 => borra el de 100 días, no el reciente.
        deleted = purge_old_messages(db, 90)
        assert deleted >= 1
        assert db.query(ChatMessage).filter(ChatMessage.id == old_msg_id).first() is None
        assert db.query(ChatMessage).filter(ChatMessage.id == recent_msg_id).first() is not None
    finally:
        db.query(ChatMessage).filter(ChatMessage.conversation_id == convo.id).delete(synchronize_session=False)
        db.query(ChatConversation).filter(ChatConversation.id == convo.id).delete(synchronize_session=False)
        db.commit()
