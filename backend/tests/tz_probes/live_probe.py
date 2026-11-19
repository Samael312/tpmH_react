"""
Auditoría TZ — sonda EN VIVO contra http://localhost:8000 (BD Neon dev).

Uso (desde backend/):  venv\\Scripts\\python.exe -m tests.tz_probes.live_probe <fase>
Fases: setup_avail | slots | book | validate | tz_teacher_madrid | tz_teacher_bogota |
       student_tz | dst | invalid_tz | dump
Requiere haber corrido tests.tz_probes.setup_qa (cuentas qa_tz_*).
Guarda estado en tests/tz_probes/out/state.json y cada resultado en out/<fase>.json.
"""
import json
import sys
from datetime import datetime, timedelta, date, time, timezone as dtz
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

BASE = "http://localhost:8000/api/v1"
PWD = "QaTz!2026audit"
OUT = Path(__file__).parent / "out"
OUT.mkdir(exist_ok=True)
STATE = OUT / "state.json"
UTC = dtz.utc
BOG, MAD, KOL, NY = (ZoneInfo(z) for z in ("America/Bogota", "Europe/Madrid", "Asia/Kolkata", "America/New_York"))

state = json.loads(STATE.read_text()) if STATE.exists() else {}
log: list = []


def save_state():
    STATE.write_text(json.dumps(state, indent=1, default=str))


def token(user):
    key = f"tok_{user}"
    if key not in state:
        r = httpx.post(f"{BASE}/auth/login", json={"login": user, "password": PWD}, timeout=90)
        r.raise_for_status()
        state[key] = r.json()["access_token"]
        save_state()
    return state[key]


def call(method, path, user=None, label=None, **kw):
    h = {"Authorization": f"Bearer {token(user)}"} if user else {}
    r = httpx.request(method, f"{BASE}{path}", headers=h, timeout=60, **kw)
    try:
        body = r.json()
    except Exception:
        body = r.text
    log.append({"label": label or path, "method": method, "path": path,
                "req": kw.get("json") or kw.get("params"), "status": r.status_code, "resp": body})
    return r.status_code, body


T, SM, SK = "qa_tz_teacher", "qa_tz_student_mad", "qa_tz_student_kol"

# ─── modelo esperado (hora local del profesor) ───
WEEKLY_LOCAL = [(d, "09:00", "12:00") for d in range(5)] + [(d, "18:00", "22:00") for d in range(5)]
EXC = [  # (date, end_date, full_day, start, end, is_available, reason)
    ("2026-12-02", None, True, None, None, False, "QA vacaciones dia completo"),
    ("2026-12-14", "2026-12-16", True, None, None, False, "QA vacaciones rango"),
    ("2026-12-01", None, False, "20:00", "21:00", False, "QA bloqueo parcial (tras medianoche UTC)"),
    ("2026-12-03", None, False, "10:00", "11:00", False, "QA bloqueo parcial manana"),
    ("2026-12-05", None, False, "14:00", "17:00", True, "QA disponibilidad extra sabado"),
]
OCC = 60  # 50 min + 10 margen regular
STEP = 30


def expected_starts(tzinfo, d0: date, d1: date, busy_utc=()):
    """Instantes UTC que deberían ofrecerse entre fechas LOCALES d0..d1 (incl.)."""
    res = set()
    d = d0
    while d <= d1:
        wins = []
        for dow, s, e in WEEKLY_LOCAL:
            if d.weekday() == dow:
                wins.append((s, e))
        blocks = []
        for (ds, de, full, s, e, avail, _r) in EXC:
            a = date.fromisoformat(ds)
            b = date.fromisoformat(de) if de else a
            if a <= d <= b:
                if avail:
                    wins.append((s, e))
                else:
                    if full:
                        blocks.append((datetime.combine(d, time(0), tzinfo).astimezone(UTC),
                                       datetime.combine(d + timedelta(days=1), time(0), tzinfo).astimezone(UTC)))
                    else:
                        blocks.append((datetime.combine(d, time.fromisoformat(s), tzinfo).astimezone(UTC),
                                       datetime.combine(d, time.fromisoformat(e), tzinfo).astimezone(UTC)))
        for s, e in wins:
            cur = datetime.combine(d, time.fromisoformat(s), tzinfo).astimezone(UTC)
            end = datetime.combine(d, time.fromisoformat(e), tzinfo).astimezone(UTC)
            while cur + timedelta(minutes=OCC) <= end:
                occ_end = cur + timedelta(minutes=OCC)
                if not any(cur < be and occ_end > bs for bs, be in list(blocks) + list(busy_utc)):
                    res.add(cur)
                cur += timedelta(minutes=STEP)
        d += timedelta(days=1)
    return res


def get_slots(user, dates):
    """Devuelve {fecha_consultada: [slots]} y el conjunto de instantes ofrecidos."""
    by_date, offered, busy, dup = {}, set(), set(), []
    for ds in dates:
        st, body = call("GET", f"/availability/{T}/slots", user, label=f"slots {ds}",
                        params={"date": ds, "duration": 50, "class_type": "regular"})
        by_date[ds] = body if st == 200 else {"status": st, "body": body}
        if st != 200:
            continue
        for s in body:
            t = datetime.fromisoformat(s["start_time_utc"].replace("Z", "+00:00")).astimezone(UTC)
            if s["is_available"] and not s["is_past"] and not s["too_soon"]:
                if t in offered:
                    dup.append(t.isoformat())
                offered.add(t)
            elif not s["is_available"]:
                busy.add(t)
    return by_date, offered, busy, dup


def fmt(ts, z):
    return sorted(t.astimezone(z).strftime("%a %Y-%m-%d %H:%M") for t in ts)


def daterange(a, b):
    d = date.fromisoformat(a)
    e = date.fromisoformat(b)
    while d <= e:
        yield d.isoformat()
        d += timedelta(days=1)


def compare(label, user, local_tz, d0, d1, q0, q1, busy_utc=()):
    exp = expected_starts(local_tz, date.fromisoformat(d0), date.fromisoformat(d1), busy_utc)
    _, offered, busy, dup = get_slots(user, list(daterange(q0, q1)))
    lo = datetime.combine(date.fromisoformat(d0), time(0), local_tz).astimezone(UTC)
    hi = datetime.combine(date.fromisoformat(d1) + timedelta(days=1), time(0), local_tz).astimezone(UTC)
    offered_in = {t for t in offered if lo <= t < hi}
    return {
        "label": label, "viewer": user,
        "missing_UTC": sorted(t.isoformat() for t in exp - offered_in),
        "extra_UTC": sorted(t.isoformat() for t in offered_in - exp),
        "missing_local_teacher": fmt(exp - offered_in, local_tz),
        "extra_local_teacher": fmt(offered_in - exp, local_tz),
        "duplicates": dup,
        "n_expected": len(exp), "n_offered": len(offered_in),
        "busy_marked_UTC": sorted(t.isoformat() for t in busy),
    }


# ─── fases ───

def setup_avail():
    st, body = call("PUT", "/availability/me/weekly", T, label="PUT weekly Bogota",
                    json={"timezone": "America/Bogota", "slots": [
                        {"day_of_week": d, "start_time_local": s, "end_time_local": e} for d, s, e in WEEKLY_LOCAL]})
    # limpia excepciones previas QA
    _, exs = call("GET", "/availability/me/exceptions", T)
    for x in exs if isinstance(exs, list) else []:
        call("DELETE", f"/availability/me/exceptions/{x['id']}", T)
    ids = []
    for (ds, de, full, s, e, avail, reason) in EXC:
        payload = {"date": ds, "end_date": de, "timezone": "America/Bogota", "is_full_day": full,
                   "start_time_local": s, "end_time_local": e, "is_available": avail, "reason": reason}
        st2, b2 = call("POST", "/availability/me/exceptions", T, label=f"POST exc {reason}", json=payload)
        if st2 == 201:
            ids += [x["id"] for x in b2]
    state["exception_ids"] = ids
    call("GET", "/availability/me/weekly", T, label="GET weekly tras PUT")
    call("GET", "/availability/me/exceptions", T, label="GET exceptions tras POST")
    save_state()


def slots():
    res = []
    for viewer in (SM, SK):
        # fechas locales del profesor 30-nov..6-dic y 13..17-dic; se consultan todas las fechas UTC que la UI podría pedir
        res.append(compare("semana 30-nov", viewer, BOG, "2026-11-30", "2026-12-06", "2026-11-29", "2026-12-07",
                           busy_utc=state.get("busy_utc_list") and [tuple(datetime.fromisoformat(x) for x in p) for p in state["busy_utc_list"]] or ()))
        res.append(compare("vacaciones 14-16 dic", viewer, BOG, "2026-12-13", "2026-12-17", "2026-12-12", "2026-12-18"))
    # vista "como la UI": el alumno elige un día LOCAL y el front lo manda tal cual como date
    ui = {}
    for viewer, z in ((SM, MAD), (SK, KOL)):
        for ds in ("2026-11-30", "2026-12-01"):
            st, body = call("GET", f"/availability/{T}/slots", viewer, label=f"ui-view {ds}",
                            params={"date": ds, "duration": 50, "class_type": "regular"})
            ui[f"{viewer} elige {ds}"] = [
                datetime.fromisoformat(s["start_time_utc"].replace("Z", "+00:00")).astimezone(z).strftime("%a %d %H:%M")
                + ("" if s["is_available"] else " [ocupado]") for s in body]
    return {"compare": res, "ui_view_local": ui}


def book():
    enr = 689
    out = {}
    for key, local in (("A_lunes_0900_bog", datetime(2026, 11, 30, 9, 0, tzinfo=BOG)),
                       ("B_lunes_1800_bog", datetime(2026, 11, 30, 18, 0, tzinfo=BOG)),
                       ("C_lunes_2000_bog_tras_medianoche_utc", datetime(2026, 11, 30, 20, 0, tzinfo=BOG)),
                       ("D_jueves_2100_bog_tras_medianoche_utc", datetime(2026, 12, 3, 21, 0, tzinfo=BOG))):
        s = local.astimezone(UTC)
        st, body = call("POST", "/payments/book", SM, label=f"book {key}", json={
            "enrollment_id": enr, "start_time_utc": s.isoformat(),
            "end_time_utc": (s + timedelta(minutes=50)).isoformat(), "duration_minutes": 50})
        out[key] = {"utc": s.isoformat(), "status": st, "resp": body}
        if st == 201:
            state.setdefault("class_ids", []).append(body["class_id"])
    save_state()
    return out


def validate():
    enr = 689
    cases = {
        "naive": ("2026-12-07T15:00:00", "2026-12-07T15:50:00"),
        "misaligned_0907_bog": ("2026-12-07T14:07:00+00:00", "2026-12-07T14:57:00+00:00"),
        "outside_avail_1300_bog": ("2026-12-07T18:00:00+00:00", "2026-12-07T18:50:00+00:00"),
        "inside_vacation_2dic_1000_bog": ("2026-12-02T15:00:00+00:00", "2026-12-02T15:50:00+00:00"),
        "inside_partial_block_3dic_1000_bog": ("2026-12-03T15:00:00+00:00", "2026-12-03T15:50:00+00:00"),
        "overlap_A_plus_30": ("2026-11-30T14:30:00+00:00", "2026-11-30T15:20:00+00:00"),
        "end_minus_start_ne_duration": ("2026-12-08T14:00:00+00:00", "2026-12-08T16:00:00+00:00"),
        "past": ("2026-11-10T14:00:00+00:00", "2026-11-10T14:50:00+00:00"),
        "too_soon_+20min": None,
        "offset_-05_explicit_1000_bog": ("2026-12-09T10:00:00-05:00", "2026-12-09T10:50:00-05:00"),
        "duration_80_not_package": ("2026-12-10T14:00:00+00:00", "2026-12-10T15:20:00+00:00", 80),
    }
    out = {}
    now = datetime.now(UTC)
    for k, v in cases.items():
        if v is None:
            s = (now + timedelta(minutes=20)).replace(second=0, microsecond=0)
            v = (s.isoformat(), (s + timedelta(minutes=50)).isoformat())
        dur = v[2] if len(v) > 2 else 50
        st, body = call("POST", "/payments/book", SM, label=f"validate {k}", json={
            "enrollment_id": enr, "start_time_utc": v[0], "end_time_utc": v[1], "duration_minutes": dur})
        out[k] = {"start": v[0], "end": v[1], "status": st, "resp": body}
        if st == 201:
            state.setdefault("class_ids", []).append(body["class_id"])
    save_state()
    return out


def snapshot(label):
    return {
        "label": label,
        "teacher_profile_tz": call("GET", "/teachers/me/profile", T)[1].get("timezone"),
        "weekly": call("GET", "/availability/me/weekly", T)[1],
        "exceptions": call("GET", "/availability/me/exceptions", T)[1],
        "teacher_classes": [
            {k: c.get(k) for k in ("id", "start_time_utc", "end_time_utc", "status", "teacher_timezone", "student_timezone")}
            for c in (lambda b: b if isinstance(b, list) else b.get("items", b.get("classes", [])))(call("GET", "/classes/teacher/classes", T)[1])
        ],
    }


def tz_teacher(new_tz):
    before = snapshot("antes")
    st, body = call("PATCH", "/teachers/me/profile", T, label=f"PATCH tz {new_tz}", json={"timezone": new_tz})
    after = snapshot("despues")
    z = ZoneInfo(new_tz)
    return {"patch_status": st, "before": before, "after": after}


def tz_slots_after_madrid():
    """Tras pasar el profesor a Madrid: ¿qué se ofrece la semana 30-nov en hora de Madrid?"""
    res = []
    for viewer in (SM,):
        res.append(compare("semana 30-nov (prof. Madrid, reglas con hora local preservada)", viewer, MAD,
                           "2026-11-30", "2026-12-06", "2026-11-29", "2026-12-07"))
    return res


def student_tz():
    out = {}
    out["set_prefs"] = call("POST", "/users/me/preferences", SM, label="prefs Madrid lun 18-21",
                            json={"timezone": "Europe/Madrid", "slots": [
                                {"day_of_week": 0, "start_time_local": "18:00", "end_time_local": "21:00"},
                                {"day_of_week": 1, "start_time_local": "00:30", "end_time_local": "02:00"}]})
    out["prefs_before"] = call("GET", "/users/me/preferences", SM)[1]
    out["classes_before"] = call("GET", "/classes/my-classes", SM)[1]
    out["patch_kolkata"] = call("PATCH", "/users/me/student-profile", SM, json={"timezone": "Asia/Kolkata"})
    out["prefs_after_kolkata"] = call("GET", "/users/me/preferences", SM)[1]
    out["classes_after"] = call("GET", "/classes/my-classes", SM)[1]
    out["slots_preferred_mon"] = [
        (s["start_time_utc"], s["is_preferred"]) for s in
        call("GET", f"/availability/{T}/slots", SM, params={"date": "2026-11-30", "duration": 50})[1]]
    out["patch_back_madrid"] = call("PATCH", "/users/me/student-profile", SM, json={"timezone": "Europe/Madrid"})
    out["prefs_after_back"] = call("GET", "/users/me/preferences", SM)[1]
    return out


def dst():
    out = {}
    for viewer, z, label, d_before, d_after in (
        (SM, MAD, "Madrid DST 28-mar-2027", "2027-03-26", "2027-03-29"),
        (SM, NY, "New York DST 14-mar-2027 (vista NY)", "2027-03-12", "2027-03-15"),
        (SM, BOG, "vista Bogota", "2027-03-26", "2027-03-29"),
    ):
        row = {}
        for ds in (d_before, d_after):
            st, body = call("GET", f"/availability/{T}/slots", viewer, label=f"dst {ds}",
                            params={"date": ds, "duration": 50})
            row[ds] = [datetime.fromisoformat(s["start_time_utc"].replace("Z", "+00:00")).astimezone(z).strftime("%H:%M")
                       + "/" + s["start_time_utc"][11:16] + "Z" for s in body] if st == 200 else (st, body)
        out[label] = row
    return out


def invalid_tz():
    out = {}
    out["teacher_tz_invalid"] = call("PATCH", "/teachers/me/profile", T, json={"timezone": "Mars/Olympus"})
    out["teacher_profile_after"] = call("GET", "/teachers/me/profile", T)[1].get("timezone")
    out["student_tz_invalid"] = call("PATCH", "/users/me/student-profile", SK, json={"timezone": "Mars/Olympus"})
    out["student_profile_after"] = call("GET", "/users/me/student-profile", SK)[1].get("timezone")
    out["student_tz_empty"] = call("PATCH", "/users/me/student-profile", SK, json={"timezone": ""})
    out["weekly_put_invalid_tz"] = call("PUT", "/availability/me/weekly", T, json={"timezone": "Mars/Olympus", "slots": []})
    out["weekly_put_end_before_start"] = call("PUT", "/availability/me/weekly", T,
                                              json={"timezone": "America/Bogota",
                                                    "slots": [{"day_of_week": 5, "start_time_local": "22:00", "end_time_local": "02:00"}]})
    out["weekly_after_cross_midnight_put"] = call("GET", "/availability/me/weekly", T)[1]
    out["slots_sat_after_cross"] = call("GET", f"/availability/{T}/slots", SM, params={"date": "2026-12-05", "duration": 50})[1]
    out["slots_sun_after_cross"] = call("GET", f"/availability/{T}/slots", SM, params={"date": "2026-12-06", "duration": 50})[1]
    # restaurar horario semanal QA
    out["restore"] = call("PUT", "/availability/me/weekly", T, json={"timezone": "America/Bogota", "slots": [
        {"day_of_week": d, "start_time_local": s_, "end_time_local": e} for d, s_, e in WEEKLY_LOCAL]})[0]
    return out


PHASES = {
    "setup_avail": setup_avail, "slots": slots, "book": book, "validate": validate,
    "tz_teacher_madrid": lambda: tz_teacher("Europe/Madrid"),
    "tz_teacher_bogota": lambda: tz_teacher("America/Bogota"),
    "slots_madrid": tz_slots_after_madrid,
    "student_tz": student_tz, "dst": dst, "invalid_tz": invalid_tz,
    "dump": lambda: snapshot("dump"),
}

if __name__ == "__main__":
    ph = sys.argv[1]
    result = PHASES[ph]()
    (OUT / f"{ph}.json").write_text(json.dumps({"result": result, "calls": log}, indent=1, default=str, ensure_ascii=False),
                                    encoding="utf-8")
    print(json.dumps(result, indent=1, default=str, ensure_ascii=False)[:6000])
