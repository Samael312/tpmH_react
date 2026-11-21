"""Fase 17: Google Calendar y Preply (G1-G5 + identidad de cuenta). Google simulado en memoria."""
import importlib.util
import pathlib
from datetime import datetime, timedelta

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

from tests.audit.conftest import _mk_user, hdr, future
from tests.tz_probes.test_calendar_emails_jobs import (  # noqa: F401
    FakeCalendar, _preply, _connect, _externals, _http_error, _parse, _Req,
)
from app.core import google_calendar as gc
from app.core.timezone import UTC, utc_now
from app.models.class_ import Class, ClassType
from app.models.google_calendar import GoogleCalendarToken

API = "/api/v1"


# ─── Paso 1: externas fuera del push, dedupe e indice unico ──────────────────

def test_g1_external_classes_never_pushed_even_cancelled(db, world, monkeypatch):
    start = future(72)
    cal = _connect(db, world, monkeypatch, FakeCalendar(events=[_preply("preply-1", start)]))
    gc.sync_calendar_logic(world["tp"].id, db)
    (c,) = _externals(db, world["tp"].id)
    c.status = "cancelled"
    db.commit()
    cal.calls.clear()
    gc.sync_calendar_logic(world["tp"].id, db)
    assert not any(x[0] in ("update", "insert", "delete") for x in cal.calls)
    assert "preply-1" in cal.events_by_id   # el evento de Preply sigue intacto


def test_g2_unique_index_blocks_duplicate_event_per_teacher(db, world):
    def mk(eid):
        s = future(10)
        return Class(teacher_id=world["tp"].id, class_type=ClassType.external, start_time_utc=s,
                     end_time_utc=s + timedelta(minutes=50), duration=50, buffer_minutes=0,
                     status="confirmed", google_event_id=eid)
    db.add(mk("dup"))
    db.commit()
    db.add(mk("dup"))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
    # google_event_id NULL puede repetirse (indice parcial)
    db.add(mk(None))
    db.add(mk(None))
    db.commit()


def test_g2_import_ignores_integrity_error_gracefully(db, world):
    now = utc_now()
    ev = _preply("race-1", now + timedelta(days=2))
    cal = FakeCalendar(events=[ev, _preply("ok-2", now + timedelta(days=3))])
    # Otra sync "ganó la carrera": la fila existe pero la consulta de existentes no la ve.
    s = now + timedelta(days=2)
    db.add(Class(teacher_id=world["tp"].id, class_type=ClassType.external, start_time_utc=s,
                 end_time_utc=s + timedelta(minutes=50), duration=50, buffer_minutes=0,
                 status="confirmed", google_event_id="race-1"))
    db.commit()
    real_query = db.query

    class _Q:
        def __init__(self, q):
            self.q = q

        def filter(self, *a, **k):
            return _Q(self.q.filter(*a, **k))

        def all(self):
            return []   # simula que no ve nada
    db.query = lambda *a, **k: _Q(real_query(*a, **k)) if a and a[0] is Class else real_query(*a, **k)
    try:
        r = gc.import_external_classes_for_teacher(world["tp"].id, cal, "primary", db, now, now + timedelta(days=30))
    finally:
        db.query = real_query
    db.commit()
    assert r["new_count"] == 1   # race-1 se ignora (IntegrityError), ok-2 se importa
    assert len([c for c in _externals(db, world["tp"].id) if c.google_event_id == "race-1"]) == 1


def test_g2_cancels_external_that_disappeared_from_google(db, world, monkeypatch):
    start = future(72)
    cal = _connect(db, world, monkeypatch, FakeCalendar(events=[_preply("p-gone", start)]))
    gc.sync_calendar_logic(world["tp"].id, db)
    cal.events_by_id.clear()
    gc.sync_calendar_logic(world["tp"].id, db)
    (c,) = _externals(db, world["tp"].id)
    assert c.status == "cancelled"


def _load_migration(name):
    path = next(pathlib.Path(__file__).resolve().parents[2].joinpath("alembic/versions").glob(f"{name}*.py"))
    spec = importlib.util.spec_from_file_location("mig_" + name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _run_migration(engine, mod, fn="upgrade"):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            getattr(mod, fn)()


def test_g2_migration_dedupes_keeping_oldest_and_is_fk_safe():
    eng = sa.create_engine("sqlite://")
    with eng.begin() as c:
        c.execute(sa.text("CREATE TABLE classes (id INTEGER PRIMARY KEY, teacher_id INT, google_event_id TEXT, class_type TEXT)"))
        for t in ("payments", "class_participants", "support_tickets"):
            c.execute(sa.text(f"CREATE TABLE {t} (id INTEGER PRIMARY KEY, class_id INT)"))
        rows = [
            (1, 1, "e1", "external"), (2, 1, "e1", "external"), (3, 1, "e1", "external"),   # 2,3 duplicados
            (4, 1, "e2", "regular"), (5, 1, "e2", "regular"),                               # no external -> solo limpiar
            (6, 2, "e1", "external"),                                                       # otro profesor: ok
            (7, 1, None, "regular"), (8, 1, None, "regular"),
        ]
        for r in rows:
            c.execute(sa.text("INSERT INTO classes VALUES (:a,:b,:c,:d)"), dict(zip("abcd", r)))
        c.execute(sa.text("INSERT INTO payments (class_id) VALUES (3)"))   # el 3 tiene dependiente
    mod = _load_migration("e4a1b2c3d4f5")
    _run_migration(eng, mod)
    with eng.connect() as c:
        got = {r[0]: r[1] for r in c.execute(sa.text("SELECT id, google_event_id FROM classes"))}
    assert 2 not in got                       # duplicado external sin dependientes: borrado
    assert got[1] == "e1" and got[6] == "e1"  # el mas antiguo se queda
    assert 3 in got and got[3] is None        # con pago: se conserva, sin event id
    assert got[4] == "e2" and got[5] is None  # no external: se limpia, no se borra
    assert got[7] is None and got[8] is None
    with eng.begin() as c:
        with pytest.raises(IntegrityError):
            c.execute(sa.text("INSERT INTO classes VALUES (99,1,'e1','external')"))
    _run_migration(eng, mod, "downgrade")


# ─── Paso 2: identidad de la cuenta de Google ────────────────────────────────

from app.auth.jwt import create_oauth_state  # noqa: E402
from app.core.class_logic import can_book_slot  # noqa: E402
from app.models.notification import Notification  # noqa: E402
from app.models.teacher import TeacherProfile, TeacherStatus  # noqa: E402


def _second_teacher(db, username="otra"):
    u = _mk_user(db, "teacher", username)
    tp = TeacherProfile(user_id=u.id, user_username=username, status=TeacherStatus.approved,
                        timezone="UTC", languages=["English"], subjects=["English"], video_url="v")
    db.add(tp)
    db.commit()
    return u, tp


def _fake_exchange(monkeypatch, sub="sub-1", email="g@gmail.com"):
    monkeypatch.setattr("app.api.v1.endpoints.calendar.exchange_code_for_tokens",
                        lambda code, code_verifier=None: {"access_token": "a", "refresh_token": "r",
                                                          "token_expiry": None, "google_sub": sub,
                                                          "google_email": email})
    # La sync en segundo plano no debe tocar Google real
    monkeypatch.setattr(gc, "sync_calendar_logic", lambda tid, d: {"ok": True})


def _callback(client, user, tp_id):
    return client.post(f"{API}/calendar/callback", json={"code": "c", "state": create_oauth_state(tp_id)},
                       headers=hdr(user))


def test_callback_stores_primary_and_google_identity(client, db, world, monkeypatch):
    _fake_exchange(monkeypatch)
    r = _callback(client, world["t_user"], world["tp"].id)
    assert r.status_code == 200, r.text
    db.expire_all()
    t = db.query(GoogleCalendarToken).filter_by(teacher_id=world["tp"].id).one()
    assert t.calendar_id == "primary"                      # ya NO el email de la plataforma
    assert t.google_account_sub == "sub-1" and t.google_account_email == "g@gmail.com"
    st = client.get(f"{API}/calendar/status", headers=hdr(world["t_user"])).json()
    assert st["calendar_id"] == "primary" and st["connected"] is True


def test_one_google_account_per_teacher(client, db, world, monkeypatch):
    _fake_exchange(monkeypatch, sub="shared")
    assert _callback(client, world["t_user"], world["tp"].id).status_code == 200
    u2, tp2 = _second_teacher(db)
    r = _callback(client, u2, tp2.id)
    assert r.status_code == 409
    db.expire_all()
    assert db.query(GoogleCalendarToken).filter_by(teacher_id=tp2.id).count() == 0
    # el mismo profesor puede reconectar su propia cuenta
    assert _callback(client, world["t_user"], world["tp"].id).status_code == 200
    # y otro profesor con OTRA cuenta si puede conectar
    _fake_exchange(monkeypatch, sub="distinta")
    assert _callback(client, u2, tp2.id).status_code == 200


def test_unique_index_on_google_account_sub(db, world):
    u2, tp2 = _second_teacher(db)
    db.add(GoogleCalendarToken(user_id=world["t_user"].id, teacher_id=world["tp"].id, access_token="x",
                               google_account_sub="dup"))
    db.commit()
    db.add(GoogleCalendarToken(user_id=u2.id, teacher_id=tp2.id, access_token="x", google_account_sub="dup"))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_legacy_email_calendar_id_is_treated_as_primary(db, world):
    t = GoogleCalendarToken(user_id=world["t_user"].id, teacher_id=world["tp"].id, access_token="x",
                            calendar_id="profe@plataforma.com")
    assert gc.calendar_id_for(t) == "primary"
    t.calendar_id = None
    assert gc.calendar_id_for(t) == "primary"


def test_identity_from_id_token():
    import jwt
    tok = jwt.encode({"sub": "123", "email": "A@Gmail.com"}, "k", algorithm="HS256")
    assert gc._identity_from_id_token(tok) == ("123", "a@gmail.com")
    assert gc._identity_from_id_token(None) == (None, None)
    assert gc._identity_from_id_token("basura") == (None, None)


def test_account_change_keeps_old_preply_classes(client, db, world, monkeypatch):
    _fake_exchange(monkeypatch, sub="old")
    _callback(client, world["t_user"], world["tp"].id)
    s = future(48)
    db.add(Class(teacher_id=world["tp"].id, class_type=ClassType.external, start_time_utc=s,
                 end_time_utc=s + timedelta(minutes=50), duration=50, buffer_minutes=0, status="confirmed",
                 google_event_id="p1"))
    db.commit()
    _fake_exchange(monkeypatch, sub="new")
    _callback(client, world["t_user"], world["tp"].id)
    (c,) = _externals(db, world["tp"].id)
    assert c.status == "confirmed" and c.google_event_id == "p1"   # regla del dueno: nada se cancela


# ─── Paso 3: sync tras conectar, desconexion, reauth, toggle, invitado ───────

def test_callback_triggers_background_sync_for_that_teacher(client, db, world, monkeypatch):
    calls = []
    monkeypatch.setattr("app.api.v1.endpoints.calendar.exchange_code_for_tokens",
                        lambda code, code_verifier=None: {"access_token": "a", "refresh_token": "r",
                                                          "token_expiry": None, "google_sub": "s", "google_email": "e"})
    monkeypatch.setattr(gc, "sync_calendar_logic", lambda tid, d: calls.append(tid) or {"ok": True})
    assert _callback(client, world["t_user"], world["tp"].id).status_code == 200
    assert calls == [world["tp"].id]


def _ext(db, tp_id, hours, eid, status="confirmed"):
    s = future(hours)
    c = Class(teacher_id=tp_id, class_type=ClassType.external, start_time_utc=s,
              end_time_utc=s + timedelta(minutes=50), duration=50, buffer_minutes=0, status=status,
              google_event_id=eid)
    db.add(c)
    db.commit()
    return c


def can_book(db, world, start):
    return can_book_slot(start, world["tp"].id, world["sp"].id, start + timedelta(minutes=50), db,
                         enforce_min_notice=False)


def test_disconnect_keeps_future_external_classes(client, db, world, monkeypatch):
    monkeypatch.setattr("app.api.v1.endpoints.calendar.revoke_token", lambda t: None)
    _connect(db, world, monkeypatch, FakeCalendar())
    fut = _ext(db, world["tp"].id, 48, "f1")
    past = _ext(db, world["tp"].id, -48, "p1", status="finalized")
    r = client.post(f"{API}/calendar/disconnect", headers=hdr(world["t_user"]))
    assert r.status_code == 200
    db.expire_all()
    assert db.get(Class, fut.id).status == "confirmed" and db.get(Class, fut.id).google_event_id == "f1"
    assert db.get(Class, past.id).status == "finalized"          # el historico no se toca
    assert db.query(GoogleCalendarToken).count() == 0


def test_disconnected_preply_class_keeps_blocking_the_slot(client, db, world, monkeypatch):
    monkeypatch.setattr("app.api.v1.endpoints.calendar.revoke_token", lambda t: None)
    _connect(db, world, monkeypatch, FakeCalendar())
    c = _ext(db, world["tp"].id, 48, "f1")
    assert can_book(db, world, c.start_time_utc)[0] is False
    client.post(f"{API}/calendar/disconnect", headers=hdr(world["t_user"]))
    db.expire_all()
    assert can_book(db, world, c.start_time_utc)[0] is False   # aceptado por el dueno: sigue bloqueando


class _RevokedCreds:
    expired = True
    refresh_token = "r"
    token = "a"
    expiry = None

    def __init__(self, *a, **k):
        pass

    def refresh(self, request):
        from google.auth.exceptions import RefreshError
        raise RefreshError("invalid_grant")


def test_reauth_keeps_externals_and_notifies(db, world, monkeypatch):
    sent = []
    monkeypatch.setattr("app.core.email.send_calendar_reauth_teacher_email", lambda *a, **k: sent.append(a) or True)
    monkeypatch.setattr(gc, "Credentials", _RevokedCreds)
    db.add(GoogleCalendarToken(user_id=world["t_user"].id, teacher_id=world["tp"].id, access_token="x",
                               refresh_token="y", is_active=True, needs_reauth=False,
                               token_expiry=utc_now() - timedelta(hours=1)))
    db.commit()
    c = _ext(db, world["tp"].id, 48, "f1")
    r = gc.sync_calendar_logic(world["tp"].id, db)
    assert r["ok"] is False
    db.expire_all()
    t = db.query(GoogleCalendarToken).one()
    assert t.needs_reauth is True and t.is_active is False
    assert db.get(Class, c.id).status == "confirmed"
    notes = db.query(Notification).filter(Notification.type == "calendar_reauth_required").all()
    assert len(notes) == 1 and notes[0].recipient_user_id == world["t_user"].id
    assert len(sent) == 1
    # una segunda sync no repite el aviso (el token ya esta marcado y la sync ni lo intenta)
    gc.sync_calendar_logic(world["tp"].id, db)
    assert db.query(Notification).filter(Notification.type == "calendar_reauth_required").count() == 1


def test_toggle_cannot_reenable_token_needing_reauth(client, db, world):
    db.add(GoogleCalendarToken(user_id=world["t_user"].id, teacher_id=world["tp"].id, access_token="x",
                               is_active=False, needs_reauth=True))
    db.commit()
    h = hdr(world["t_user"])
    assert client.post(f"{API}/calendar/toggle", json={"enabled": True}, headers=h).status_code == 409
    assert client.post(f"{API}/calendar/toggle", json={}, headers=h).status_code == 409   # alterna -> encender
    db.expire_all()
    assert db.query(GoogleCalendarToken).one().is_active is False
    assert client.post(f"{API}/calendar/toggle", json={"enabled": False}, headers=h).status_code == 200


def _own_class(db, world, hours=24):
    s = future(hours)
    c = Class(teacher_id=world["tp"].id, student_id=world["sp"].id, class_type=ClassType.regular,
              start_time_utc=s, end_time_utc=s + timedelta(minutes=50), duration=50, buffer_minutes=10,
              status="confirmed", subject="English")
    db.add(c)
    db.commit()
    return c


def test_sync_create_and_update_pass_teacher_as_attendee(db, world, monkeypatch):
    cal = _connect(db, world, monkeypatch, FakeCalendar())
    c = _own_class(db, world)
    gc.sync_calendar_logic(world["tp"].id, db)
    ins = [x for x in cal.calls if x[0] == "insert"]
    assert len(ins) == 1
    assert [a["email"] for a in ins[0][2]["attendees"]] == [world["t_user"].email]
    c.start_time_utc += timedelta(hours=1)
    c.end_time_utc += timedelta(hours=1)
    db.commit()
    gc.sync_calendar_logic(world["tp"].id, db)
    upd = [x for x in cal.calls if x[0] == "update"]
    assert len(upd) == 1 and [a["email"] for a in upd[0][2]["attendees"]] == [world["t_user"].email]


# ─── Paso 4: eficiencia ──────────────────────────────────────────────────────

def test_sync_skips_update_when_nothing_changed(db, world, monkeypatch):
    cal = _connect(db, world, monkeypatch, FakeCalendar())
    c = _own_class(db, world)
    gc.sync_calendar_logic(world["tp"].id, db)
    assert [x[0] for x in cal.calls].count("insert") == 1
    cal.calls.clear()
    r = gc.sync_calendar_logic(world["tp"].id, db)
    assert r["skipped_count"] == 1 and r["updated_count"] == 0
    assert not any(x[0] in ("get", "update", "insert", "delete") for x in cal.calls)   # cero llamadas por clase
    c.meet_link = "https://meet.google.com/abc"           # un cambio real si se empuja
    db.commit()
    cal.calls.clear()
    r = gc.sync_calendar_logic(world["tp"].id, db)
    assert r["updated_count"] == 1 and any(x[0] == "update" for x in cal.calls)


def test_sync_recreates_own_event_deleted_in_google_when_class_changes(db, world, monkeypatch):
    cal = _connect(db, world, monkeypatch, FakeCalendar())
    c = _own_class(db, world)
    gc.sync_calendar_logic(world["tp"].id, db)
    cal.events_by_id.clear()                                # lo borraron en Google
    c.start_time_utc += timedelta(hours=1)
    c.end_time_utc += timedelta(hours=1)
    db.commit()
    gc.sync_calendar_logic(world["tp"].id, db)
    assert len(cal.events_by_id) == 1


def test_transient_google_error_does_not_recreate_event(db, world, monkeypatch):
    """403/5xx al editar NO significa que el evento no exista: antes se recreaba y se duplicaba."""
    cal = _connect(db, world, monkeypatch, FakeCalendar())
    c = _own_class(db, world)
    gc.sync_calendar_logic(world["tp"].id, db)
    cal.update_error = 403
    c.start_time_utc += timedelta(hours=1)
    c.end_time_utc += timedelta(hours=1)
    db.commit()
    monkeypatch.setattr(gc, "MAX_RETRIES", 1)
    r = gc.sync_calendar_logic(world["tp"].id, db)
    assert r["error_count"] == 1
    assert sum(1 for x in cal.calls if x[0] == "insert") == 1      # no hubo segundo insert
    db.expire_all()
    assert "permiso" in (db.query(GoogleCalendarToken).one().last_error or "").lower()


def _http_err_with_reason(status, reason):
    import json
    import httplib2
    from googleapiclient.errors import HttpError
    body = json.dumps({"error": {"errors": [{"reason": reason}]}}).encode()
    return HttpError(httplib2.Response({"status": str(status)}), body)


def test_http_error_kind_distinguishes_permission_and_quota():
    err = _http_err_with_reason
    assert gc.http_error_kind(err(403, "forbidden")) == "permission"
    assert gc.http_error_kind(err(403, "rateLimitExceeded")) == "quota"
    assert gc.http_error_kind(err(403, "userRateLimitExceeded")) == "quota"
    assert gc.http_error_kind(err(429, "x")) == "quota"
    assert gc.http_error_kind(err(404, "notFound")) == "gone"
    assert gc.http_error_kind(err(500, "x")) == "other"


def test_quota_403_is_retried_then_permission_403_is_not(monkeypatch):
    from googleapiclient.errors import HttpError
    monkeypatch.setattr(gc.time, "sleep", lambda s: None)

    def mk(reason):
        n = {"n": 0}

        def fn():
            n["n"] += 1
            raise _http_err_with_reason(403, reason)
        return fn, n
    fn, n = mk("rateLimitExceeded")
    with pytest.raises(HttpError):
        gc._with_retries(fn)
    assert n["n"] == gc.MAX_RETRIES
    fn, n = mk("forbidden")
    with pytest.raises(HttpError):
        gc._with_retries(fn)
    assert n["n"] == 1


def test_run_all_only_processes_teachers_with_classes_in_active_window_or_stale(db, world, monkeypatch):
    u2, tp2 = _second_teacher(db)
    u3, tp3 = _second_teacher(db, "tercera")
    now = utc_now()
    db.add_all([
        GoogleCalendarToken(user_id=world["t_user"].id, teacher_id=world["tp"].id, access_token="x",
                            is_active=True, needs_reauth=False, last_synced_at=now - timedelta(minutes=10)),
        GoogleCalendarToken(user_id=u2.id, teacher_id=tp2.id, access_token="x", is_active=True,
                            needs_reauth=False, last_synced_at=now - timedelta(minutes=10)),
        GoogleCalendarToken(user_id=u3.id, teacher_id=tp3.id, access_token="x", is_active=True,
                            needs_reauth=False, last_synced_at=now - timedelta(hours=7)),     # vieja -> ciclo ocioso
    ])
    s = now + timedelta(hours=1)
    db.add(Class(teacher_id=world["tp"].id, student_id=world["sp"].id, class_type=ClassType.regular,
                 start_time_utc=s, end_time_utc=s + timedelta(minutes=50), duration=50, buffer_minutes=10,
                 status="confirmed"))
    # tp2: solo una clase de Preply en la ventana: no cuenta como "clase activa"
    db.add(Class(teacher_id=tp2.id, class_type=ClassType.external, start_time_utc=s,
                 end_time_utc=s + timedelta(minutes=50), duration=50, buffer_minutes=0, status="confirmed",
                 google_event_id="px"))
    db.commit()
    seen = []
    monkeypatch.setattr(gc, "sync_calendar_logic", lambda tid, d: seen.append(tid) or {"ok": True})
    r = gc.run_calendar_sync_for_all_teachers(db)
    assert sorted(seen) == sorted([world["tp"].id, tp3.id])
    assert r["teachers_skipped"] == 1


def test_one_teacher_failing_does_not_stop_the_others(db, world, monkeypatch):
    u2, tp2 = _second_teacher(db)
    for u, tp in ((world["t_user"], world["tp"]), (u2, tp2)):
        db.add(GoogleCalendarToken(user_id=u.id, teacher_id=tp.id, access_token="x", is_active=True,
                                   needs_reauth=False))
    db.commit()
    seen = []

    def fake(tid, d):
        seen.append(tid)
        if len(seen) == 1:
            raise RuntimeError("boom")
        return {"ok": True}
    monkeypatch.setattr(gc, "sync_calendar_logic", fake)
    r = gc.run_calendar_sync_for_all_teachers(db)
    assert len(seen) == 2 and sorted(x["ok"] for x in r["results"]) == [False, True]


def _slots_url(world):
    return f"{API}/availability/{world['tp'].user_username}/slots"


def test_slots_endpoint_is_rate_limited_per_ip(client, world):
    from app.core.rate_limit import limiter
    limiter.reset()
    d = (utc_now() + timedelta(days=3)).date().isoformat()
    codes = [client.get(_slots_url(world), params={"date": d, "duration": 50},
                        headers=hdr(world["s_user"])).status_code for _ in range(125)]
    assert codes[:120] == [200] * 120 and 429 in codes[120:]
    limiter.reset()


def test_failed_freebusy_is_not_cached_and_fails_open(client, db, world, monkeypatch):
    class Boom(FakeCalendar):
        def query(self, body):
            self.calls.append(("freebusy", body["timeMin"], body["timeMax"]))
            return _Req(lambda: (_ for _ in ()).throw(_http_error(500)))
    cal = _connect(db, world, monkeypatch, Boom())
    monkeypatch.setattr(gc, "MAX_RETRIES", 1)
    d = (utc_now() + timedelta(days=3)).date().isoformat()
    from app.core import cache
    cache.cache_invalidate_prefix("slots:")
    r1 = client.get(_slots_url(world), params={"date": d, "duration": 50}, headers=hdr(world["s_user"]))
    assert r1.status_code == 200 and any(x["is_available"] for x in r1.json())      # falla abierto
    n1 = sum(1 for c in cal.calls if c[0] == "freebusy")
    client.get(_slots_url(world), params={"date": d, "duration": 50}, headers=hdr(world["s_user"]))
    assert sum(1 for c in cal.calls if c[0] == "freebusy") == n1 + 1                  # no se cacheo: pregunta otra vez
    # control: con Google sano la segunda peticion SI sale de la cache
    cal2 = FakeCalendar()
    monkeypatch.setattr(gc, "get_calendar_service_for_token", lambda token, d_: cal2)
    d2 = (utc_now() + timedelta(days=4)).date().isoformat()
    for _ in range(2):
        client.get(_slots_url(world), params={"date": d2, "duration": 50}, headers=hdr(world["s_user"]))
    assert sum(1 for c in cal2.calls if c[0] == "freebusy") == 1


def test_freebusy_strict_raises_on_calendar_errors():
    t0 = utc_now()
    cal = FakeCalendar(freebusy_result={"calendars": {"primary": {"errors": [{"reason": "notFound"}]}}})
    with pytest.raises(gc.FreebusyError):
        gc.get_busy_ranges(cal, "primary", t0, t0 + timedelta(days=1), strict=True)
    assert gc.get_busy_ranges(cal, "primary", t0, t0 + timedelta(days=1)) == []           # por defecto sigue abierto


def test_freebusy_accepts_real_email_key_instead_of_primary():
    t0 = utc_now()
    cal = FakeCalendar(freebusy_result={"calendars": {"prof@gmail.com": {"busy": [
        {"start": t0.isoformat(), "end": (t0 + timedelta(hours=1)).isoformat()}]}}})
    assert len(gc.get_busy_ranges(cal, "primary", t0, t0 + timedelta(days=1))) == 1


# ─── Paso 5: reserva vs Google ───────────────────────────────────────────────

def _slot_in_availability(db, world):
    from app.models.availability import TeacherAvailability
    d = (utc_now() + timedelta(days=3)).date()
    db.add(TeacherAvailability(teacher_id=world["tp"].id, day_of_week=d.weekday(), is_available=True,
                               start_time_local="08:00", end_time_local="20:00"))
    db.commit()
    return datetime(d.year, d.month, d.day, 15, 0, tzinfo=UTC)


def test_can_book_slot_rejects_google_busy_and_allows_free(db, world, monkeypatch):
    s = _slot_in_availability(db, world)
    _connect(db, world, monkeypatch, FakeCalendar(busy=[(s, s + timedelta(hours=1))]))
    assert can_book(db, world, s)[0] is False
    assert can_book(db, world, s + timedelta(hours=3))[0] is True


def test_can_book_slot_fails_open_when_google_errors(db, world, monkeypatch):
    s = _slot_in_availability(db, world)

    class Boom(FakeCalendar):
        def query(self, body):
            return _Req(lambda: (_ for _ in ()).throw(_http_error(500)))
    monkeypatch.setattr(gc, "MAX_RETRIES", 1)
    _connect(db, world, monkeypatch, Boom())
    assert can_book(db, world, s)[0] is True
    # tambien si ni siquiera se puede crear el servicio
    monkeypatch.setattr(gc, "get_calendar_service_for_token", lambda t, d: None)
    assert can_book(db, world, s)[0] is True


def test_can_book_slot_ignores_google_when_no_active_token(db, world):
    s = _slot_in_availability(db, world)
    assert can_book(db, world, s)[0] is True


def test_reschedule_ignores_the_classes_own_google_event(db, world, monkeypatch):
    s = _slot_in_availability(db, world)
    own = Class(teacher_id=world["tp"].id, student_id=world["sp"].id, class_type=ClassType.regular,
                start_time_utc=s, end_time_utc=s + timedelta(minutes=50), duration=50, buffer_minutes=0,
                status="confirmed")
    db.add(own)
    db.commit()
    _connect(db, world, monkeypatch, FakeCalendar(busy=[(s, s + timedelta(minutes=50))]))   # su propio evento
    new_start = s + timedelta(minutes=30)                                                     # solapa con el viejo
    ok, msg = can_book_slot(new_start, world["tp"].id, world["sp"].id, new_start + timedelta(minutes=50), db,
                            exclude_class_id=own.id, enforce_min_notice=False)
    assert ok is True, msg
