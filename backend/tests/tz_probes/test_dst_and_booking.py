"""Sondas de auditoria: DST en disponibilidad recurrente y precision de las reservas.

Convencion (igual que tests/tenant_probes): cada `test_bug_*` afirma el
comportamiento ACTUAL; si pasa, el hallazgo existe hoy. Los `test_ok_*` son
controles: si pasan, esa parte funciona bien.
SQLite del harness de tests/audit; no toca .env ni la BD real.

"Ahora" se congela parcheando `datetime` dentro de app.core.timezone (de ahi
salen utc_now() y la fecha de referencia de convert_local_time_to_utc), asi el
resultado no depende de la estacion en que se ejecute la suite.
"""
from datetime import datetime as _RealDT, timedelta, timezone as dt_tz
from zoneinfo import ZoneInfo

import pytest

import app.core.timezone as tzmod
from app.core.class_logic import is_within_teacher_availability
from app.models.availability import TeacherAvailability
from app.models.class_ import Class, ClassType
from app.models.group_cohort import GroupCohort, CohortStatus
from app.models.package import Package, Enrollment
from app.models.student import StudentProfile
from app.models.teacher import TeacherProfile, TeacherStatus
from tests.audit.conftest import hdr, _mk_user

API = "/api/v1"
UTC = dt_tz.utc
MAD = ZoneInfo("Europe/Madrid")
NY = ZoneInfo("America/New_York")
CCS = ZoneInfo("America/Caracas")


# ─── helpers ────────────────────────────────────────────────────────────────

def _freeze(monkeypatch, iso_utc):
    fixed = _RealDT.fromisoformat(iso_utc)

    class FakeDT(_RealDT):
        @classmethod
        def now(cls, tz=None):
            return fixed.astimezone(tz) if tz else fixed.replace(tzinfo=None)

    monkeypatch.setattr(tzmod, "datetime", FakeDT)
    return fixed


def _put_weekly(client, user, tz, slots):
    body = {"timezone": tz, "slots": [
        {"day_of_week": d, "start_time_local": s, "end_time_local": e} for d, s, e in slots]}
    r = client.put(f"{API}/availability/me/weekly", json=body, headers=hdr(user))
    assert r.status_code == 200, r.text
    return r.json()


def _slots(client, date, user=None, duration=25, class_type="trial"):
    r = client.get(f"{API}/availability/profe/slots",
                   params={"date": date, "duration": duration, "class_type": class_type},
                   headers=hdr(user))
    assert r.status_code == 200, r.text
    return r.json()


def _utc(s):
    return _RealDT.fromisoformat(s.replace("Z", "+00:00")).astimezone(UTC)


def _book_trial(client, w, start_iso):
    return client.post(f"{API}/payments/book", json={
        "teacher_username": "profe", "start_time_utc": start_iso,
        "end_time_utc": start_iso, "duration_minutes": 25}, headers=hdr(w["s_user"]))


def _confirmed_cohort(db, w):
    tp = w["tp"]
    gp = Package(teacher_id=tp.id, name="G", subject="English", classes_count=4, price=80,
                 price_per_class=20, duration_minutes=50, is_active=True, is_group=True,
                 min_students=1, max_students=5)
    db.add(gp); db.flush()
    c = GroupCohort(package_id=gp.id, teacher_id=tp.id, status=CohortStatus.confirmed,
                    min_students=1, max_students=5)
    db.add(c); db.flush()
    db.add(Enrollment(student_id=w["sp"].id, package_id=gp.id, teacher_id=tp.id, cohort_id=c.id,
                      payment_status="paid", unlocked_credits=4))
    db.commit()
    return c


def _session(client, w, cohort, start_iso):
    return client.post(f"{API}/cohorts/{cohort.id}/sessions",
                       json={"start_time_utc": start_iso, "duration_minutes": 50},
                       headers=hdr(w["t_user"]))


# ═══ D: DST en disponibilidad recurrente ════════════════════════════════════

# D1: Madrid guarda 09-12 en invierno -> en verano se ofrece 10-13 hora local.
def test_bug_madrid_winter_schedule_shifts_one_hour_in_summer(client, world, db, monkeypatch):
    _freeze(monkeypatch, "2026-11-19T10:00:00+00:00")
    rows = _put_weekly(client, world["t_user"], "Europe/Madrid", [(0, "09:00", "12:00")])
    assert rows[0]["start_time_utc"] == "08:00"  # CET +1
    winter = _slots(client, "2027-01-04", user=world["s_user"])  # lunes, CET
    summer = _slots(client, "2027-04-05", user=world["s_user"])  # lunes, CEST
    w_local = [_utc(s["start_time_utc"]).astimezone(MAD).strftime("%H:%M") for s in winter]
    s_local = [_utc(s["start_time_utc"]).astimezone(MAD).strftime("%H:%M") for s in summer]
    assert w_local[0] == "09:00" and w_local[-1] == "11:30"
    # el profesor dijo 09:00-12:00, pero en verano se reserva 10:00-12:30 local
    assert s_local[0] == "10:00" and s_local[-1] == "12:30"
    assert "09:00" not in s_local


# D1b: Nueva York igual; un alumno de Caracas (sin DST) ve la misma hora todo el año.
def test_bug_newyork_shift_while_caracas_student_sees_constant(client, world, db, monkeypatch):
    _freeze(monkeypatch, "2026-11-19T10:00:00+00:00")
    _put_weekly(client, world["t_user"], "America/New_York", [(0, "09:00", "12:00")])
    winter = _slots(client, "2027-01-04", user=world["s_user"])
    summer = _slots(client, "2027-04-05", user=world["s_user"])
    first_w, first_s = _utc(winter[0]["start_time_utc"]), _utc(summer[0]["start_time_utc"])
    assert first_w.astimezone(NY).hour == 9
    assert first_s.astimezone(NY).hour == 10          # profesor: corrido 1 h
    assert first_w.astimezone(CCS).hour == first_s.astimezone(CCS).hour == 10  # Caracas: fijo


# D2: guardar justo antes del cambio de hora mezcla desfases dentro de la misma semana.
def test_bug_saving_near_dst_mixes_offsets_in_same_week(client, world, db, monkeypatch):
    # jueves 22-oct-2026; Madrid pasa a CET el domingo 25
    _freeze(monkeypatch, "2026-10-22T10:00:00+00:00")
    _put_weekly(client, world["t_user"], "Europe/Madrid", [(d, "09:00", "12:00") for d in range(7)])
    rows = {r.local_day_of_week: r.start_time_utc for r in
            db.query(TeacherAvailability).filter(TeacherAvailability.teacher_id == world["tp"].id)}
    assert {rows[3], rows[4], rows[5]} == {"07:00"}           # jue-sab con CEST (+2)
    assert {rows[0], rows[1], rows[2], rows[6]} == {"08:00"}  # lun-mie y dom con CET (+1)
    # en noviembre el jueves se ofrece a las 08:00 locales, no a las 09:00
    th = _slots(client, "2026-11-26", user=world["s_user"])
    assert _utc(th[0]["start_time_utc"]).astimezone(MAD).strftime("%H:%M") == "08:00"


# D3: serie recurrente de cohorte: las fechas se calculan bien con DST,
# pero se validan contra la disponibilidad congelada en UTC -> las de verano fallan.
def test_bug_recurring_cohort_sessions_after_dst_rejected(client, world, db, monkeypatch):
    from app.api.v1.endpoints.cohorts import _generate_recurring_dates
    _freeze(monkeypatch, "2026-11-19T10:00:00+00:00")
    _put_weekly(client, world["t_user"], "Europe/Madrid", [(0, "09:00", "12:00")])
    occ = _generate_recurring_dates([0], "09:00", "Europe/Madrid",
                                    _RealDT(2027, 3, 15, 8, 0, tzinfo=UTC), 4)
    assert [o.hour for o in occ] == [8, 8, 7, 7]  # control: 09:00 Madrid antes y despues del 28-mar
    ok = [is_within_teacher_availability(world["tp"].id, o, o + timedelta(minutes=60), db)[0] for o in occ]
    assert ok == [True, True, False, False]


# D4: excepcion en la hora que no existe (28-mar-2027 02:30 Madrid) -> fin antes que inicio.
def test_bug_exception_in_dst_gap_stored_with_negative_duration(client, world, db):
    r = client.post(f"{API}/availability/me/exceptions", json={
        "date": "2027-03-28", "timezone": "Europe/Madrid", "is_full_day": False,
        "start_time_local": "02:30", "end_time_local": "03:00", "is_available": False},
        headers=hdr(world["t_user"]))
    assert r.status_code == 201, r.text
    e = r.json()[0]
    assert _utc(e["end_time_utc"]) < _utc(e["start_time_utc"])


# D5: "todo el dia" en un dia de 23 h (cambio de hora) se devuelve como is_full_day=False.
def test_bug_full_day_exception_on_23h_day_not_full_day(client, world, db):
    r = client.post(f"{API}/availability/me/exceptions", json={
        "date": "2027-03-28", "timezone": "Europe/Madrid", "is_full_day": True, "is_available": False},
        headers=hdr(world["t_user"]))
    assert r.status_code == 201, r.text
    e = r.json()[0]
    assert _utc(e["end_time_utc"]) - _utc(e["start_time_utc"]) == timedelta(hours=23)
    assert e["is_full_day"] is False
    lst = client.get(f"{API}/availability/me/exceptions", headers=hdr(world["t_user"])).json()
    assert lst[0]["is_full_day"] is False


def test_ok_full_day_exception_on_25h_day(client, world, db):
    r = client.post(f"{API}/availability/me/exceptions", json={
        "date": "2026-10-25", "timezone": "Europe/Madrid", "is_full_day": True, "is_available": False},
        headers=hdr(world["t_user"]))
    e = r.json()[0]
    assert _utc(e["end_time_utc"]) - _utc(e["start_time_utc"]) == timedelta(hours=25)
    assert e["is_full_day"] is True


# ═══ Rangos que cruzan medianoche UTC (America: tardes) ═════════════════════

# D6: Bogota 17-21 = 22:00-02:00 UTC. El listado del lunes ofrece 00:00-01:30 UTC
# (martes), pero reservar ahi da 409: el validador mira el day_of_week del martes.
def test_bug_evening_slots_after_midnight_utc_offered_but_rejected(client, world, db, monkeypatch):
    _freeze(monkeypatch, "2026-11-19T10:00:00+00:00")
    _put_weekly(client, world["t_user"], "America/Bogota", [(0, "17:00", "21:00")])
    sl = _slots(client, "2026-11-30", user=world["s_user"])
    starts = [s["start_time_utc"] for s in sl if s["is_available"]]
    tue = [s for s in starts if _utc(s).day == 1]
    assert len(tue) == 4  # 00:00, 00:30, 01:00, 01:30 UTC = 19:00-20:30 Bogota
    r = _book_trial(client, world, "2026-12-01T00:30:00Z")
    assert r.status_code == 409 and "disponibilidad" in r.json()["detail"]
    r_ok = _book_trial(client, world, "2026-11-30T22:30:00Z")
    assert r_ok.status_code == 201, r_ok.text


# D7: en ese tramo tras medianoche, una clase ya reservada no marca el slot como ocupado.
def test_bug_class_after_midnight_not_busy_in_previous_day_listing(client, world, db, monkeypatch):
    _freeze(monkeypatch, "2026-11-19T10:00:00+00:00")
    _put_weekly(client, world["t_user"], "America/Bogota", [(0, "17:00", "21:00")])
    s = _RealDT(2026, 12, 1, 1, 0, tzinfo=UTC)
    db.add(Class(teacher_id=world["tp"].id, student_id=world["sp"].id, class_type=ClassType.regular,
                 start_time_utc=s, end_time_utc=s + timedelta(minutes=50), duration=50,
                 buffer_minutes=10, status="confirmed"))
    db.commit()
    sl = {s["start_time_utc"]: s["is_available"] for s in _slots(client, "2026-11-30", user=world["s_user"])}
    k = next(k for k in sl if _utc(k) == s)
    assert sl[k] is True


# D8: preferencias del alumno que cruzan medianoche UTC nunca marcan is_preferred.
def test_bug_preference_crossing_midnight_utc_never_preferred(client, world, db, monkeypatch):
    _freeze(monkeypatch, "2026-11-19T10:00:00+00:00")
    r = client.put(f"{API}/users/me/preferences", json={"timezone": "America/Caracas", "slots": [
        {"day_of_week": 0, "start_time_local": "19:00", "end_time_local": "21:00"}]},
        headers=hdr(world["s_user"]))
    assert r.status_code == 200, r.text
    assert (r.json()[0]["start_time_utc"], r.json()[0]["end_time_utc"]) == ("23:00", "01:00")
    sl = _slots(client, "2026-11-30", user=world["s_user"])
    at23 = [s for s in sl if _utc(s["start_time_utc"]).hour == 23]
    assert at23 and not any(s["is_preferred"] for s in at23)


# ═══ T: zona horaria del alumno ═════════════════════════════════════════════

def test_bug_student_invalid_timezone_accepted(client, world, db):
    r = client.patch(f"{API}/users/me/student-profile", json={"timezone": "Mars/Olympus"},
                     headers=hdr(world["s_user"]))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(StudentProfile, world["sp"].id).timezone == "Mars/Olympus"


def test_bug_teacher_invalid_timezone_500(client, world, db):
    r = client.patch(f"{API}/teachers/me/profile", json={"timezone": "Mars/Olympus"},
                     headers=hdr(world["t_user"]))
    assert r.status_code == 500


# ═══ B: precision de las reservas ═══════════════════════════════════════════

def _future_iso(days=3, hour=10, minute=0):
    d = (tzmod.utc_now() + timedelta(days=days)).replace(hour=hour, minute=minute, second=0, microsecond=0)
    return d


def test_bug_book_misaligned_start_accepted(client, world, db):
    s = _future_iso(minute=7)
    r = _book_trial(client, world, s.isoformat())
    assert r.status_code == 201, r.text
    assert db.get(Class, r.json()["class_id"]).start_time_utc.minute == 7


def test_bug_no_max_advance_booking(client, world, db):
    s = _future_iso(days=3 * 365)
    r = _book_trial(client, world, s.isoformat())
    assert r.status_code == 201, r.text


def test_bug_staff_trial_naive_datetime_500(client, world, db):
    s = _future_iso().replace(tzinfo=None)
    r = client.post(f"{API}/classes/trial", json={
        "teacher_username": "profe", "student_id": world["sp"].id, "subject": "English",
        "start_time_utc": s.isoformat(), "end_time_utc": s.isoformat(), "duration_minutes": 25},
        headers=hdr(world["admin"]))
    assert r.status_code == 500


def test_bug_staff_trial_offset_not_normalized_day_of_week(client, world, db):
    s = _future_iso(hour=20, minute=30)  # 20:30 UTC = 02:00 del dia siguiente en +05:30
    local = s.astimezone(dt_tz(timedelta(hours=5, minutes=30)))
    r = client.post(f"{API}/classes/trial", json={
        "teacher_username": "profe", "student_id": world["sp"].id, "subject": "English",
        "start_time_utc": local.isoformat(), "end_time_utc": local.isoformat(), "duration_minutes": 25},
        headers=hdr(world["admin"]))
    assert r.status_code == 201, r.text
    from app.api.v1.endpoints.payments import DAYS_ES
    c = db.get(Class, r.json()["id"])
    assert c.day_of_week == DAYS_ES[local.weekday()] != DAYS_ES[s.weekday()]


def test_bug_god_mode_create_naive_500_when_class_nearby(client, world, db):
    s = _future_iso()
    body = {"teacher_id": world["tp"].id, "student_id": world["sp"].id, "duration_minutes": 50,
            "reason": "sonda tz", "start_time_utc": s.isoformat()}
    assert client.post(f"{API}/god-mode/classes", json=body, headers=hdr(world["admin"])).status_code == 201
    body["start_time_utc"] = (s + timedelta(hours=2)).replace(tzinfo=None).isoformat()
    r = client.post(f"{API}/god-mode/classes", json=body, headers=hdr(world["admin"]))
    assert r.status_code == 500


def test_bug_god_mode_create_offset_day_of_week(client, world, db):
    s = _future_iso(hour=20, minute=30)
    local = s.astimezone(dt_tz(timedelta(hours=5, minutes=30)))
    r = client.post(f"{API}/god-mode/classes", json={
        "teacher_id": world["tp"].id, "student_id": world["sp"].id, "duration_minutes": 50,
        "reason": "sonda tz", "start_time_utc": local.isoformat()}, headers=hdr(world["admin"]))
    assert r.status_code == 201, r.text
    assert r.json()["day_of_week"] != __import__("app.api.v1.endpoints.payments", fromlist=["DAYS_ES"]).DAYS_ES[s.weekday()]


def test_bug_group_session_naive_500(client, world, db):
    c = _confirmed_cohort(db, world)
    r = _session(client, world, c, _future_iso().replace(tzinfo=None).isoformat())
    assert r.status_code == 500


def test_bug_group_session_in_past_accepted(client, world, db):
    c = _confirmed_cohort(db, world)
    r = _session(client, world, c, (tzmod.utc_now() - timedelta(days=2)).replace(microsecond=0).isoformat())
    assert r.status_code == 201, r.text


def test_bug_group_session_overlaps_pending_trial(client, world, db):
    c = _confirmed_cohort(db, world)
    other = _mk_user(db, "student", "otro")
    sp2 = StudentProfile(user_id=other.id, user_username="otro", timezone="UTC")
    db.add(sp2); db.flush()
    s = _future_iso()
    db.add(Class(teacher_id=world["tp"].id, student_id=sp2.id, class_type=ClassType.trial,
                 start_time_utc=s, end_time_utc=s + timedelta(minutes=25), duration=25,
                 buffer_minutes=5, status="pending_trial"))
    db.commit()
    r = _session(client, world, c, s.isoformat())
    assert r.status_code == 201, r.text


def test_bug_group_session_ignores_participant_other_class(client, world, db):
    c = _confirmed_cohort(db, world)
    u = _mk_user(db, "teacher", "profeb")
    tb = TeacherProfile(user_id=u.id, user_username="profeb", status=TeacherStatus.approved,
                        timezone="UTC", languages=["English"], subjects=["English"], video_url="http://v")
    db.add(tb); db.flush()
    s = _future_iso()
    db.add(Class(teacher_id=tb.id, student_id=world["sp"].id, class_type=ClassType.regular,
                 start_time_utc=s, end_time_utc=s + timedelta(minutes=50), duration=50,
                 buffer_minutes=10, status="confirmed"))
    db.commit()
    r = _session(client, world, c, s.isoformat())
    assert r.status_code == 201, r.text  # el alumno queda con dos clases a la vez


# ─── controles ──────────────────────────────────────────────────────────────

def test_ok_book_offset_normalized_and_naive_rejected(client, world, db):
    s = _future_iso(hour=20, minute=30)
    local = s.astimezone(dt_tz(timedelta(hours=5, minutes=30)))
    assert _book_trial(client, world, s.replace(tzinfo=None).isoformat()).status_code == 422
    r = _book_trial(client, world, local.isoformat())
    assert r.status_code == 201, r.text
    from app.api.v1.endpoints.payments import DAYS_ES
    assert db.get(Class, r.json()["class_id"]).day_of_week == DAYS_ES[s.weekday()]


def test_ok_book_inside_block_exception_rejected(client, world, db):
    s = _future_iso(days=5)
    loc = s.strftime("%Y-%m-%d")
    client.post(f"{API}/availability/me/exceptions", json={
        "date": loc, "timezone": "UTC", "is_full_day": True, "is_available": False},
        headers=hdr(world["t_user"]))
    assert _book_trial(client, world, s.isoformat()).status_code == 409


def test_ok_min_notice_boundary_consistent(client, world, db, monkeypatch):
    now = _freeze(monkeypatch, "2026-11-19T10:00:00+00:00")
    from app.core.class_logic import can_book_slot
    edge = now + timedelta(hours=1)
    assert can_book_slot(edge, world["tp"].id, world["sp"].id, edge + timedelta(minutes=30), db)[0]
    assert not can_book_slot(edge - timedelta(seconds=1), world["tp"].id, world["sp"].id,
                             edge + timedelta(minutes=30), db)[0]
    assert tzmod.is_slot_too_soon(edge, 60) is False
    assert tzmod.is_slot_too_soon(edge - timedelta(minutes=30), 60) is True
