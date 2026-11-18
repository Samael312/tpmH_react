"""Fase 13 — chat eficiente: número fijo de consultas por petición y mismos resultados que antes.

Cada listado se mide con pocas y con muchas conversaciones/mensajes: si el número de sentencias SQL crece con
las filas, hay un N+1. Además se comprueban los no leídos (con y sin estado de lectura), las conversaciones de
grupo del alumno, el catch-up de entregas al abrir el socket y la caché de ajustes del chat.
"""
from datetime import timedelta

from sqlalchemy import event

from app.core import chat as chat_core
from app.core.timezone import utc_now
from app.db.base import engine
from app.models.chat import ChatConversation, ChatConversationType, ChatMessage, ChatReadState
from app.models.group_cohort import GroupCohort
from app.models.package import Enrollment, EnrollmentStatus
from app.models.payment_config import PlatformConfig
from app.models.student import StudentProfile
from tests.audit.conftest import _mk_user, hdr
from tests.audit.helpers import API


def _count_sql(fn):
    statements = []

    def hook(conn, cursor, statement, params, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", hook)
    try:
        result = fn()
    finally:
        event.remove(engine, "before_cursor_execute", hook)
    return len(statements), result


def _seed_direct(db, w, start, k, messages_each=3):
    """k alumnos, cada uno con su conversación directa y `messages_each` mensajes suyos al profesor."""
    convos = []
    for i in range(start, start + k):
        u = _mk_user(db, "student", f"chatq{i}")
        sp = StudentProfile(user_id=u.id, user_username=u.username, timezone="UTC")
        db.add(sp)
        db.flush()
        c = ChatConversation(conversation_type=ChatConversationType.direct, teacher_id=w["tp"].id,
                             student_id=sp.id, last_message_at=utc_now() - timedelta(minutes=i))
        db.add(c)
        db.flush()
        for m in range(messages_each):
            db.add(ChatMessage(conversation_id=c.id, sender_id=u.id, content=f"hola {m}",
                               created_at=utc_now() - timedelta(minutes=30 - m)))
        convos.append(c)
    db.commit()
    return convos


def test_conversation_list_and_unread_use_a_fixed_number_of_queries(client, db, world):
    h = hdr(world["t_user"])
    _seed_direct(db, world, 0, 2)
    client.get(f"{API}/chat/conversations", headers=h)  # calienta la caché de ajustes (una lectura cada 30 s)
    few_list, r = _count_sql(lambda: client.get(f"{API}/chat/conversations", headers=h))
    assert r.status_code == 200
    few_unread, _ = _count_sql(lambda: client.get(f"{API}/chat/conversations/unread-count", headers=h))
    _seed_direct(db, world, 2, 10)
    many_list, r = _count_sql(lambda: client.get(f"{API}/chat/conversations", headers=h))
    assert r.status_code == 200 and len(r.json()) == 12 and r.headers["X-Total-Count"] == "12"
    many_unread, r2 = _count_sql(lambda: client.get(f"{API}/chat/conversations/unread-count", headers=h))
    assert r2.json()["unread_count"] == 36
    assert many_list == few_list, (few_list, many_list)
    assert many_unread == few_unread, (few_unread, many_unread)
    assert many_unread <= 4  # usuario + perfil + recuento (los ajustes salen de la caché)


def test_list_is_sorted_by_last_activity_and_paginated_in_sql(client, db, world):
    convos = _seed_direct(db, world, 0, 5)  # chatq0 es el más reciente
    h = hdr(world["t_user"])
    page1 = client.get(f"{API}/chat/conversations?limit=2&offset=0", headers=h)
    page2 = client.get(f"{API}/chat/conversations?limit=2&offset=2", headers=h)
    assert page1.headers["X-Total-Count"] == "5"
    ids = [c["id"] for c in page1.json() + page2.json()]
    assert ids == [c.id for c in convos[:4]]
    assert page1.json()[0]["other_username"] == "chatq0"


def test_unread_respects_read_state(client, db, world):
    c1, c2 = _seed_direct(db, world, 0, 2)
    t_user = world["t_user"]
    # c1 leída después de todos sus mensajes; c2 leída a mitad (quedan los 2 más nuevos)
    db.add(ChatReadState(conversation_id=c1.id, user_id=t_user.id, last_read_at=utc_now()))
    db.add(ChatReadState(conversation_id=c2.id, user_id=t_user.id, last_read_at=utc_now() - timedelta(minutes=29, seconds=30)))
    # un mensaje propio nunca cuenta como no leído
    db.add(ChatMessage(conversation_id=c1.id, sender_id=t_user.id, content="mío"))
    db.commit()
    h = hdr(t_user)
    assert client.get(f"{API}/chat/conversations/unread-count", headers=h).json()["unread_count"] == 2
    by_id = {c["id"]: c["unread_count"] for c in client.get(f"{API}/chat/conversations", headers=h).json()}
    assert by_id == {c1.id: 0, c2.id: 2}


def test_messages_history_does_not_query_per_message(client, db, world):
    (convo,) = _seed_direct(db, world, 0, 1, messages_each=2)
    convo_id = convo.id  # leerlo dentro de la medición recargaría el objeto del test (consulta ajena al endpoint)
    h = hdr(world["t_user"])
    client.get(f"{API}/chat/conversations/{convo_id}/messages", headers=h)  # calienta la caché de ajustes
    few, r = _count_sql(lambda: client.get(f"{API}/chat/conversations/{convo_id}/messages", headers=h))
    assert r.status_code == 200 and len(r.json()) == 2
    sender = db.query(ChatMessage).filter_by(conversation_id=convo_id).first().sender_id
    for m in range(30):
        db.add(ChatMessage(conversation_id=convo_id, sender_id=sender, content=f"más {m}"))
    db.commit()
    many, r = _count_sql(lambda: client.get(f"{API}/chat/conversations/{convo_id}/messages", headers=h))
    assert len(r.json()) == 32 and all(m["sender_username"] == "chatq0" for m in r.json())
    assert many == few, (few, many)


def test_admin_conversation_list_counts_messages_in_one_query(client, db, world):
    h = hdr(world["admin"])
    _seed_direct(db, world, 0, 2)
    client.get(f"{API}/chat/admin/conversations", headers=h)
    few, r = _count_sql(lambda: client.get(f"{API}/chat/admin/conversations", headers=h))
    assert r.status_code == 200 and all(c["message_count"] == 3 for c in r.json())
    _seed_direct(db, world, 2, 8)
    many, r = _count_sql(lambda: client.get(f"{API}/chat/admin/conversations", headers=h))
    assert len(r.json()) == 10 and many == few, (few, many)


def test_student_sees_direct_and_active_group_conversations_only(client, db, world):
    w = world
    cohort = GroupCohort(package_id=w["pkg"].id, teacher_id=w["tp"].id, min_students=1, max_students=5)
    old_cohort = GroupCohort(package_id=w["pkg"].id, teacher_id=w["tp"].id, min_students=1, max_students=5)
    db.add_all([cohort, old_cohort])
    db.flush()
    db.add(Enrollment(student_id=w["sp"].id, package_id=w["pkg"].id, teacher_id=w["tp"].id, cohort_id=cohort.id,
                      status=EnrollmentStatus.active, classes_total=4, classes_used=0, payment_status="paid"))
    db.add(Enrollment(student_id=w["sp"].id, package_id=w["pkg"].id, teacher_id=w["tp"].id, cohort_id=old_cohort.id,
                      status=EnrollmentStatus.completed, classes_total=4, classes_used=4, payment_status="paid"))
    direct = ChatConversation(conversation_type=ChatConversationType.direct, teacher_id=w["tp"].id, student_id=w["sp"].id)
    group = ChatConversation(conversation_type=ChatConversationType.group, teacher_id=w["tp"].id, cohort_id=cohort.id)
    old_group = ChatConversation(conversation_type=ChatConversationType.group, teacher_id=w["tp"].id, cohort_id=old_cohort.id)
    db.add_all([direct, group, old_group])
    db.flush()
    db.add(ChatMessage(conversation_id=group.id, sender_id=w["t_user"].id, content="hola grupo"))
    db.add(ChatMessage(conversation_id=old_group.id, sender_id=w["t_user"].id, content="viejo"))
    db.commit()
    h = hdr(w["s_user"])
    ids = {c["id"] for c in client.get(f"{API}/chat/conversations", headers=h).json()}
    assert ids == {direct.id, group.id}
    assert client.get(f"{API}/chat/conversations/unread-count", headers=h).json()["unread_count"] == 1
    assert chat_core.conversation_participant_user_ids(db, group) == {w["t_user"].id, w["s_user"].id}
    assert chat_core.conversation_participant_user_ids(db, direct) == {w["t_user"].id, w["s_user"].id}


def test_catch_up_marks_pending_messages_delivered_in_bulk(db, world):
    convos = _seed_direct(db, world, 0, 3, messages_each=2)
    already = db.query(ChatMessage).filter_by(conversation_id=convos[0].id).first()
    already.delivered_at = utc_now() - timedelta(hours=1)
    db.commit()
    by_sender = chat_core.catch_up_deliveries(db, world["t_user"])
    assert sum(len(v) for v in by_sender.values()) == 5
    assert db.query(ChatMessage).filter(ChatMessage.delivered_at.is_(None)).count() == 0
    assert chat_core.catch_up_deliveries(db, world["t_user"]) == {}


def test_chat_settings_are_cached_and_invalidated_on_save(client, db, world):
    h = hdr(world["t_user"])
    assert client.get(f"{API}/chat/conversations", headers=h).status_code == 200
    # Cambio directo en la BD: la caché sigue respondiendo hasta que se invalida (o vencen 30 s)
    db.query(PlatformConfig).update({"chat_enabled": False})
    db.commit()
    assert client.get(f"{API}/chat/conversations", headers=h).status_code == 200
    # Guardar los ajustes desde el panel la invalida en el acto
    r = client.patch(f"{API}/admin/platform-config", json={"chat_enabled": False}, headers=hdr(world["admin"]))
    assert r.status_code == 200, r.text
    assert client.get(f"{API}/chat/conversations", headers=h).status_code == 403
    client.patch(f"{API}/admin/platform-config", json={"chat_enabled": True}, headers=hdr(world["admin"]))
    assert client.get(f"{API}/chat/conversations", headers=h).status_code == 200
