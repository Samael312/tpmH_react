"""Fase 13 (A9): aviso al profesor (campana «Avisos») cuando una clase pasa sola a `no_show`."""
from datetime import timedelta

from tests.audit.conftest import hdr, _mk_user
from app.core import retention
from app.core.class_logic import CLASS_STATUS_WINDOW_HOURS, finalize_past_classes
from app.core.notifications import create_notification
from app.core.timezone import utc_now
from app.models.class_ import Class
from app.models.notification import Notification

API = "/api/v1/teachers/me/notifications"


def _finalized(db, w, hours_ago, subject="English", class_type="regular"):
    end = utc_now() - timedelta(hours=hours_ago)
    c = Class(teacher_id=w["tp"].id, student_id=w["sp"].id, start_time_utc=end - timedelta(minutes=50),
              end_time_utc=end, duration=50, status="finalized", subject=subject, class_type=class_type)
    db.add(c)
    db.commit()
    return c


def test_auto_no_show_creates_one_notification_for_that_teacher(client, db, world):
    _finalized(db, world, CLASS_STATUS_WINDOW_HOURS + 1)
    assert finalize_past_classes(db) == 1
    rows = db.query(Notification).filter(Notification.type == "class_auto_no_show").all()
    assert len(rows) == 1
    n = rows[0]
    assert n.recipient_user_id == world["t_user"].id and n.recipient_role == "teacher" and not n.is_read
    assert "English" in n.message and "No asistió" in n.title
    # no aparece entre las notificaciones del staff
    assert db.query(Notification).filter(Notification.recipient_role == "staff").count() == 0


def test_several_classes_in_one_pass_make_a_single_notification(db, world):
    for h in (80, 90, 100):
        _finalized(db, world, h)
    assert finalize_past_classes(db) == 3
    rows = db.query(Notification).filter(Notification.type == "class_auto_no_show").all()
    assert len(rows) == 1 and "3 clases" in rows[0].title


def test_long_list_is_capped(db, world):
    for i in range(8):
        _finalized(db, world, 80 + i)
    finalize_past_classes(db)
    msg = db.query(Notification).one().message
    assert msg.count("•") == 5 and "y 3 más" in msg


def test_inside_the_window_and_external_classes_do_not_notify(db, world):
    _finalized(db, world, CLASS_STATUS_WINDOW_HOURS - 5)           # aun puede marcarla
    _finalized(db, world, 200, class_type="external")                # externas: no se resuelven solas
    assert finalize_past_classes(db) == 0
    assert db.query(Notification).count() == 0


def test_manually_marked_class_does_not_notify(db, world):
    c = _finalized(db, world, 100)
    c.status = "completed"
    db.commit()
    finalize_past_classes(db)
    assert db.query(Notification).count() == 0


def test_teacher_lists_counts_and_marks_read(client, db, world):
    _finalized(db, world, 100)
    finalize_past_classes(db)
    h = hdr(world["t_user"])
    assert client.get(f"{API}/unread-count", headers=h).json() == {"unread_count": 1}
    lst = client.get(API, headers=h)
    assert lst.status_code == 200 and len(lst.json()) == 1 and int(lst.headers["X-Total-Count"]) == 1
    nid = lst.json()[0]["id"]
    assert client.patch(f"{API}/{nid}/read", headers=h).status_code == 200
    assert client.get(f"{API}/unread-count", headers=h).json() == {"unread_count": 0}
    assert client.get(f"{API}?unread_only=true", headers=h).json() == []


def test_mark_all_read(client, db, world):
    for i in range(3):
        create_notification(db, "class_auto_no_show", f"t{i}", recipient_role="teacher", recipient_user_id=world["t_user"].id)
    db.commit()
    h = hdr(world["t_user"])
    assert client.post(f"{API}/mark-all-read", headers=h).status_code == 200
    assert client.get(f"{API}/unread-count", headers=h).json()["unread_count"] == 0


def test_a_teacher_never_sees_or_touches_another_teachers_notifications(client, db, world):
    other = _mk_user(db, "teacher", "profe2")
    n = create_notification(db, "class_auto_no_show", "ajena", recipient_role="teacher", recipient_user_id=other.id)
    db.commit()
    h = hdr(world["t_user"])
    assert client.get(API, headers=h).json() == []
    assert client.get(f"{API}/unread-count", headers=h).json()["unread_count"] == 0
    assert client.patch(f"{API}/{n.id}/read", headers=h).status_code == 404
    client.post(f"{API}/mark-all-read", headers=h)
    db.expire_all()
    assert db.get(Notification, n.id).is_read is False


def test_students_and_anonymous_cannot_use_it(client, world):
    assert client.get(API, headers=hdr(world["s_user"])).status_code == 403
    assert client.get(API).status_code == 401


def test_staff_notification_endpoints_do_not_leak_teacher_notifications(client, db, world):
    create_notification(db, "class_auto_no_show", "para profe", recipient_role="teacher", recipient_user_id=world["t_user"].id)
    db.commit()
    r = client.get("/api/v1/admin/notifications", headers=hdr(world["admin"]))
    assert r.status_code == 200 and r.json() == []
    assert client.get("/api/v1/admin/notifications/unread-count", headers=hdr(world["admin"])).json()["unread_count"] == 0


def test_purge_removes_only_old_read_user_notifications(db, world):
    old = utc_now() - timedelta(days=120)
    keep_unread = create_notification(db, "x", "no leida", recipient_role="teacher", recipient_user_id=world["t_user"].id)
    drop = create_notification(db, "x", "leida vieja", recipient_role="teacher", recipient_user_id=world["t_user"].id)
    staff = create_notification(db, "x", "staff vieja", recipient_role="staff")
    for n in (keep_unread, drop, staff):
        n.created_at = old
    drop.is_read = True
    staff.is_read = True
    db.commit()
    assert retention.purge_user_notifications(db) == 1
    left = {n.title for n in db.query(Notification).all()}
    assert left == {"no leida", "staff vieja"}
