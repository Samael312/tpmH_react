"""Sondas de auditoria de zonas horarias: Google Calendar (import Preply / busy / export), correos y jobs.

Cada test `test_bug_*` afirma el comportamiento ACTUAL: un assert que pasa = hallazgo confirmado.
Los `test_ok_*` confirman lo que funciona bien. Google se simula con un servicio falso en memoria
(nunca se llama a la API real); los correos se capturan con monkeypatch.
"""
from datetime import datetime, timedelta

import httplib2
import pytest
from googleapiclient.errors import HttpError

from tests.audit.conftest import _mk_user, hdr, future
from app.core import google_calendar as gc
from app.core import scheduler as sch
from app.core.class_logic import can_book_slot
from app.core.timezone import UTC, utc_now, format_local_datetime
from app.models.availability import TeacherAvailability
from app.models.class_ import Class, ClassType
from app.models.google_calendar import GoogleCalendarToken
from app.models.teacher import TeacherProfile, TeacherStatus


# ─── Servicio de Google Calendar falso ───────────────────────────────────────

def _http_error(status):
    return HttpError(httplib2.Response({"status": str(status)}), b"{}")


def _parse(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


class _Req:
    def __init__(self, fn):
        self._fn = fn

    def execute(self, *a, **k):
        return self._fn()


class FakeCalendar:
    """Calendario en memoria: events().list/get/insert/update/delete y freebusy().query."""

    def __init__(self, events=None, busy=None, update_error=None, freebusy_result=None):
        self.events_by_id = {e["id"]: e for e in (events or [])}
        self.busy = busy or []                  # [(start, end)] aware
        self.update_error = update_error        # status HTTP con que falla update()
        self.freebusy_result = freebusy_result
        self.calls = []
        self._n = 0

    # API estilo googleapiclient
    def events(self):
        return self

    def freebusy(self):
        return self

    def query(self, body):
        self.calls.append(("freebusy", body["timeMin"], body["timeMax"]))
        if self.freebusy_result is not None:
            return _Req(lambda: self.freebusy_result)
        tmin, tmax = _parse(body["timeMin"]), _parse(body["timeMax"])
        out = []
        for s, e in self.busy:  # Google devuelve solo lo que cae en la ventana (recortado)
            if s < tmax and e > tmin:
                out.append({"start": max(s, tmin).isoformat(), "end": min(e, tmax).isoformat()})
        return _Req(lambda: {"calendars": {"primary": {"busy": out}}})

    def list(self, calendarId, timeMin, timeMax, **kw):
        self.calls.append(("list", timeMin, timeMax))
        tmin, tmax = _parse(timeMin), _parse(timeMax)
        # Semantica real de Google: timeMin filtra por FIN del evento, timeMax por INICIO.
        items = [e for e in self.events_by_id.values()
                 if _parse(e["end"]["dateTime"]) > tmin and _parse(e["start"]["dateTime"]) < tmax]
        return _Req(lambda: {"items": [dict(e) for e in items]})

    def get(self, calendarId, eventId):
        self.calls.append(("get", eventId))

        def _do():
            if eventId not in self.events_by_id:
                raise _http_error(404)
            return {k: (dict(v) if isinstance(v, dict) else v) for k, v in self.events_by_id[eventId].items()}
        return _Req(_do)

    def insert(self, calendarId, body, **kw):
        self._n += 1
        eid = f"own-{self._n}"
        self.calls.append(("insert", eid, body))

        def _do():
            self.events_by_id[eid] = {**body, "id": eid}
            return {"id": eid}
        return _Req(_do)

    def update(self, calendarId, eventId, body, **kw):
        self.calls.append(("update", eventId, body))

        def _do():
            if self.update_error:
                raise _http_error(self.update_error)
            self.events_by_id[eventId] = body
            return body
        return _Req(_do)

    def delete(self, calendarId, eventId):
        self.calls.append(("delete", eventId))

        def _do():
            self.events_by_id.pop(eventId, None)
            return {}
        return _Req(_do)


def _preply(eid, start, minutes=50, **extra):
    return {"id": eid, "summary": "Preply lesson with Ana", "status": "confirmed",
            "start": {"dateTime": start.isoformat(), "timeZone": "Europe/Madrid"},
            "end": {"dateTime": (start + timedelta(minutes=minutes)).isoformat(), "timeZone": "Europe/Madrid"},
            **extra}


def _connect(db, world, monkeypatch, cal):
    db.add(GoogleCalendarToken(user_id=world["t_user"].id, teacher_id=world["tp"].id,
                               access_token="x", refresh_token="y", is_active=True, needs_reauth=False))
    db.commit()
    monkeypatch.setattr(gc, "get_calendar_service_for_token", lambda token, d: cal)
    return cal


def _externals(db, tid):
    db.expire_all()
    return db.query(Class).filter(Class.teacher_id == tid, Class.class_type == ClassType.external).all()


# ═══ G — Google Calendar ═════════════════════════════════════════════════════

# G1: la sync empuja las clases externas (Preply) como si fueran propias: reescribe el evento de Preply.
def test_bug_g1_sync_rewrites_imported_preply_event(db, world, monkeypatch):
    start = future(72)
    cal = _connect(db, world, monkeypatch, FakeCalendar(events=[_preply("preply-1", start)]))
    r = gc.sync_calendar_logic(world["tp"].id, db)
    assert r["imported_new_count"] == 1
    # El bucle de push incluye la clase external y hace update() sobre el evento ORIGINAL de Preply
    assert any(c[0] == "update" and c[1] == "preply-1" for c in cal.calls)
    assert r["updated_count"] == 1  # cuenta como "clase propia actualizada"


# G1b: si Google no deja editar el evento de Preply (403), se crea un evento propio duplicado y en la
# siguiente sync la clase external se duplica (la vieja queda "cancelled"). Bucle en cada sync.
def test_bug_g1b_preply_update_forbidden_duplicates_every_sync(db, world, monkeypatch):
    start = future(72)
    cal = _connect(db, world, monkeypatch,
                   FakeCalendar(events=[_preply("preply-1", start)], update_error=403))
    gc.sync_calendar_logic(world["tp"].id, db)
    ext = _externals(db, world["tp"].id)
    assert len(ext) == 1 and ext[0].google_event_id == "own-1"   # perdio el id de Preply
    assert any(c[0] == "insert" for c in cal.calls)              # evento "Clase: Estudiante — Preply…" creado
    gc.sync_calendar_logic(world["tp"].id, db)
    ext = _externals(db, world["tp"].id)
    assert len(ext) == 2                                          # misma clase de Preply, 2 filas
    assert sorted(c.status for c in ext) == ["cancelled", "confirmed"]
    assert sum(1 for c in cal.calls if c[0] == "insert") == 2     # un evento propio nuevo por sync


# G2: un evento de Preply EN CURSO se reimporta como clase nueva en cada sync (la consulta de
# existentes filtra start >= now, pero Google devuelve los eventos cuyo FIN es > now).
def test_bug_g2_ongoing_external_event_duplicated(db, world):
    now = utc_now()
    cal = FakeCalendar(events=[_preply("preply-live", now - timedelta(minutes=10))])
    for _ in range(3):
        gc.import_external_classes_for_teacher(world["tp"].id, cal, "primary", db, now, now + timedelta(days=30))
        db.commit()
    ext = _externals(db, world["tp"].id)
    assert len(ext) == 3 and {c.google_event_id for c in ext} == {"preply-live"}


# G3: la validacion de reserva (can_book_slot) ignora el busy de Google: solo la lista de slots lo respeta.
def test_bug_g3_booking_ignores_google_busy(client, db, world, monkeypatch):
    d = (utc_now() + timedelta(days=3)).date()
    s = datetime(d.year, d.month, d.day, 15, 0, tzinfo=UTC)
    _connect(db, world, monkeypatch, FakeCalendar(busy=[(s, s + timedelta(hours=1))]))
    slots = client.get(f"/api/v1/availability/{world['tp'].user_username}/slots",
                       params={"date": d.isoformat(), "duration": 50}, headers=hdr(world["s_user"])).json()
    at15 = [x for x in slots if _parse(x["start_time_utc"]) == s]
    assert at15 and at15[0]["is_available"] is False          # la UI lo muestra ocupado ...
    ok, _ = can_book_slot(s, world["tp"].id, world["sp"].id, s + timedelta(minutes=60), db,
                          enforce_availability=True)
    assert ok is True                                         # ... pero reservar por API pasa


# G4: el busy de Google se pide solo para el dia UTC [D 00:00, D+1 00:00): un slot que cruza la
# medianoche UTC no ve el evento de Google que empieza a las 00:00 del dia siguiente.
def test_bug_g4_google_busy_window_cut_at_utc_midnight(client, db, world, monkeypatch):
    d = (utc_now() + timedelta(days=3)).date()
    u = _mk_user(db, "teacher", "noche")
    tp = TeacherProfile(user_id=u.id, user_username="noche", status=TeacherStatus.approved,
                        timezone="America/Bogota", languages=["English"], subjects=["English"], video_url="v")
    db.add(tp)
    db.flush()
    # 17:00-21:00 en Bogota = 22:00-02:00 UTC (cruza la medianoche UTC)
    db.add(TeacherAvailability(teacher_id=tp.id, day_of_week=d.weekday(), is_available=True,
                               start_time_utc="22:00", end_time_utc="02:00"))
    db.add(GoogleCalendarToken(user_id=u.id, teacher_id=tp.id, access_token="x", is_active=True,
                               needs_reauth=False))
    db.commit()
    midnight = datetime(d.year, d.month, d.day, tzinfo=UTC) + timedelta(days=1)
    cal = FakeCalendar(busy=[(midnight, midnight + timedelta(hours=1))])   # dentista 19:00-20:00 Bogota
    monkeypatch.setattr(gc, "get_calendar_service_for_token", lambda token, d_: cal)
    slots = client.get("/api/v1/availability/noche/slots",
                       params={"date": d.isoformat(), "duration": 50}, headers=hdr(world["s_user"])).json()
    late = {_parse(x["start_time_utc"]): x["is_available"] for x in slots}
    s2330 = midnight - timedelta(minutes=30)
    s0030 = midnight + timedelta(minutes=30)
    assert late[s2330] is True and late[s0030] is True            # ambos chocan con el evento de Google
    assert cal.calls[0][2].startswith(midnight.isoformat()[:19])  # timeMax = D+1 00:00 UTC


# G5: freebusy falla abierto: un error del calendario (notFound/403 dentro de la respuesta) o un
# HttpError devuelven [] sin señal -> todos los huecos se ofrecen como libres.
def test_bug_g5_freebusy_fails_open():
    t0 = utc_now()
    cal = FakeCalendar(freebusy_result={"calendars": {"primary": {"errors": [{"reason": "notFound"}]}}})
    assert gc.get_busy_ranges(cal, "primary", t0, t0 + timedelta(days=1)) == []

    class Boom(FakeCalendar):
        def query(self, body):
            return _Req(lambda: (_ for _ in ()).throw(_http_error(403)))
    assert gc.get_busy_ranges(Boom(), "primary", t0, t0 + timedelta(days=1)) == []


# G6: un evento Preply rechazado por el profesor (declined) o marcado "libre" (transparent) se importa
# igual y bloquea la agenda (freebusy de Google si los ignora).
def test_bug_g6_declined_or_transparent_preply_imported(db, world):
    s = future(72)
    ev = _preply("p-dec", s, attendees=[{"email": "t@x", "self": True, "responseStatus": "declined"}])
    ev2 = _preply("p-free", s + timedelta(hours=3), transparency="transparent")
    assert gc._match_external_source(ev) == "preply"
    assert gc._match_external_source(ev2) == "preply"


# ── Lo que funciona bien en Google ──
def test_ok_import_respects_event_offset_and_skips_all_day_and_own(db, world):
    s = datetime(2027, 3, 28, 9, 0, tzinfo=UTC)  # dia del cambio de hora en Madrid
    ev = _preply("p-tz", s)
    ev["start"]["dateTime"] = "2027-03-28T11:00:00+02:00"   # 09:00 UTC expresado en CEST
    ev["end"]["dateTime"] = "2027-03-28T11:50:00+02:00"
    allday = {"id": "p-ad", "summary": "Preply", "start": {"date": "2027-03-29"}, "end": {"date": "2027-03-30"}}
    own = {**_preply("p-own", s), "extendedProperties": {"private": {"tpmh_managed": "true"}}}
    assert gc._match_external_source(allday) is None and gc._match_external_source(own) is None
    now = datetime(2027, 3, 1, tzinfo=UTC)
    cal = FakeCalendar(events=[ev])
    gc.import_external_classes_for_teacher(world["tp"].id, cal, "primary", db, now, now + timedelta(days=30))
    # En memoria el instante es correcto (+02:00 == 09:00 UTC). Ojo: no se normaliza a UTC; en Postgres
    # (timestamptz) se guarda bien, en SQLite se perderia el offset (11:00 "UTC").
    (c,) = [o for o in db.new if isinstance(o, Class)]
    assert c.start_time_utc == s and c.start_time_utc.utcoffset() == timedelta(hours=2) and c.duration == 50
    db.rollback()


def test_ok_export_event_body_in_utc():
    cal = FakeCalendar()
    s = datetime(2027, 3, 28, 0, 30, tzinfo=UTC)
    gc.create_calendar_event(cal, "primary", "t", s, s + timedelta(minutes=50))
    body = cal.calls[-1][2]
    assert body["start"] == {"dateTime": "2027-03-28T00:30:00+00:00", "timeZone": "UTC"}


# ═══ E — Correos ═════════════════════════════════════════════════════════════

@pytest.fixture
def mails(monkeypatch):
    sent = []
    for name in ("send_class_reminder_email", "send_class_reminder_teacher_email",
                 "send_class_reminders_teacher_digest_email"):
        monkeypatch.setattr(sch, name, lambda *a, _n=name, **k: sent.append((_n, k)) or True)
    return sent


def _cls(db, w, start, status="confirmed", minutes=50, **kw):
    c = Class(teacher_id=w["tp"].id, student_id=w["sp"].id, start_time_utc=start,
              end_time_utc=start + timedelta(minutes=minutes), duration=minutes, status=status,
              subject="English", **kw)
    db.add(c)
    db.commit()
    return c


# E1: reagendar no reinicia reminder_sent_at: tras el recordatorio, si la clase se mueve a otro dia
# el alumno nunca recibe el recordatorio del nuevo horario.
def test_bug_e1_reschedule_keeps_reminder_sent(client, db, world, mails):
    c = _cls(db, world, future(24, minute=30))
    sch.send_class_reminders()
    assert [m[0] for m in mails].count("send_class_reminder_email") == 1
    new = future(96)
    r = client.patch(f"/api/v1/classes/{c.id}/reschedule", headers=hdr(world["s_user"]),
                     json={"start_time_utc": new.isoformat(),
                           "end_time_utc": (new + timedelta(minutes=50)).isoformat()})
    assert r.status_code == 200, r.text
    db.expire_all()
    c = db.get(Class, c.id)
    assert c.start_time_utc == new and c.reminder_sent_at is not None
    assert sch._due_reminders(sch._JOBS_BY_ID["class_reminders"], db, utc_now()) is None


# E2: solo hay recordatorio de 24 h (ventana 23-25 h): una clase reservada con < 23 h no recibe
# ninguno, no existe recordatorio de 1 h, y las pruebas pending_trial nunca reciben recordatorio.
def test_bug_e2_short_notice_and_trial_never_reminded(db, world, mails):
    _cls(db, world, future(12))
    _cls(db, world, future(24, minute=30), status="pending_trial", minutes=25)
    sch.send_class_reminders()
    assert mails == []
    assert sch._due_reminders(sch._JOBS_BY_ID["class_reminders"], db, utc_now()) is None


# E3: la hora de los correos no dice en que zona esta, y una zona invalida/ausente cae a UTC en silencio.
def test_bug_e3_email_time_without_zone_label_and_silent_utc_fallback():
    dt = datetime(2026, 11, 20, 15, 0, tzinfo=UTC)
    bog = format_local_datetime(dt, "America/Bogota")
    assert bog == "20 de noviembre de 2026 · 10:00"           # sin "hora de Bogota"/"GMT-5"
    assert format_local_datetime(dt, "Marte/Base") == format_local_datetime(dt, "UTC") == \
        "20 de noviembre de 2026 · 15:00"


def test_ok_email_dst_and_recipient_tz(db, world, mails):
    # DST de Madrid: 01:30 UTC del 28-mar-2027 = 03:30 CEST
    assert format_local_datetime(datetime(2027, 3, 28, 1, 30, tzinfo=UTC), "Europe/Madrid").endswith("03:30")
    world["sp"].timezone = "America/Bogota"
    world["tp"].timezone = "Europe/Madrid"
    db.commit()
    c = _cls(db, world, future(24, minute=30))
    sch.send_class_reminders()
    st = [k for n, k in mails if n == "send_class_reminder_email"][0]
    te = [k for n, k in mails if n == "send_class_reminder_teacher_email"][0]
    assert st["class_start_local"] == format_local_datetime(c.start_time_utc, "America/Bogota")
    assert te["class_start_local"] == format_local_datetime(c.start_time_utc, "Europe/Madrid")


# ═══ J — Jobs ════════════════════════════════════════════════════════════════

# J1: el scheduler se crea sin timezone: los CronTrigger "03:00 UTC" y "lunes 14:00" usan la zona
# local del servidor.
def test_bug_j1_cron_jobs_use_server_local_tz():
    from tzlocal import get_localzone
    assert str(sch.scheduler.timezone) == str(get_localzone())
    import inspect
    src = inspect.getsource(sch.start_scheduler)
    assert "CronTrigger(hour=3, minute=0)" in src and "timezone" not in src


def test_ok_due_triggers_are_utc_and_precise(db, world):
    c = _cls(db, world, future(48))
    due = sch._due_reminders(sch._JOBS_BY_ID["class_reminders"], db, utc_now())
    assert due == c.start_time_utc - timedelta(hours=25) and due.tzinfo is not None
    fin = sch._due_finalize(sch._JOBS_BY_ID["finalize_expired_classes"], db, utc_now())
    assert fin == c.end_time_utc + timedelta(seconds=1)
