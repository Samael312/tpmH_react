"""
Pruebas de CONCURRENCIA contra el backend en vivo (http://127.0.0.1:8000) y la BD real del .env (PostgreSQL).
Solo localhost. Crea datos con la etiqueta CONC (emails @audit-conc.com) y los BORRA al terminar.

    cd backend && python -m tests.audit.run_dev_server &      # emails desactivados
    python -m tests.audit.concurrency_live

Cada escenario imprime el resultado esperado vs el observado. No es pytest: es un diagnóstico.
"""
import sys
import threading
import time
from datetime import timedelta

import httpx
from sqlalchemy import text

import app.models  # noqa: F401
from app.auth.jwt import create_access_token
from app.auth.passwords import hash_password
from app.core.timezone import utc_now
from app.db.base import SessionLocal, engine
from app.models.availability import TeacherAvailability
from app.models.package import Package
from app.models.student import StudentProfile
from app.models.teacher import TeacherProfile, TeacherStatus
from app.models.user import User, UserRole

BASE = "http://127.0.0.1:8000/api/v1"
TAG = "conc" + str(int(time.time()))[-6:]
assert engine.url.get_backend_name() == "postgresql", "se esperaba PostgreSQL"
assert httpx.get("http://127.0.0.1:8000/health", timeout=30).status_code == 200, "backend no disponible"

RESULTS = []
created_user_ids = []


def check(name, expected, observed, ok):
    RESULTS.append((name, expected, observed, ok))
    print(("OK   " if ok else "FALLO"), name, "| esperado:", expected, "| observado:", observed, flush=True)


def tok(u):
    return {"Authorization": "Bearer " + create_access_token(u.id, u.role.value)}


def mk_user(db, role, name):
    u = User(email=f"{name}@audit-conc.com", username=name, name=name, surname="Conc",
             password_hash=hash_password("Password123"), role=UserRole(role), is_active=True,
             onboarding_completed=True, is_verified=True)
    db.add(u)
    db.flush()
    created_user_ids.append(u.id)
    return u


def future(h, minute=0):
    return (utc_now() + timedelta(hours=h)).replace(minute=minute, second=0, microsecond=0)


def parallel(fns):
    out, bar = [None] * len(fns), threading.Barrier(len(fns))

    def run(i, f):
        bar.wait()
        try:
            out[i] = f()
        except Exception as e:  # noqa
            out[i] = e
    ts = [threading.Thread(target=run, args=(i, f)) for i, f in enumerate(fns)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    return out


def code(r):
    return r.status_code if hasattr(r, "status_code") else repr(r)[:60]


def post(c, path, user, **kw):
    return c.post(BASE + path, headers=tok(user), **kw)


def ensure_platform_config(db):
    """
    En una BD vacia (CI) no hay PlatformConfig ni PaymentConfig: sin ellos la plataforma cuenta como
    single-tenant sin profesor destacado y no hay metodo de pago. Se crean solo si FALTAN (no se tocan los existentes).
    """
    from app.models.payment_config import PaymentConfig, PlatformConfig
    if db.query(PlatformConfig).first() is None:
        db.add(PlatformConfig(is_single_tenant=False))
    if db.query(PaymentConfig).first() is None:
        db.add(PaymentConfig(bank_transfer_enabled=True, paypal_enabled=False, binance_enabled=False,
                             mobile_payment_enabled=False))
    db.commit()
    cfg = db.query(PlatformConfig).first()
    assert not cfg.is_single_tenant, "PlatformConfig es single-tenant: las reservas por teacher_username no aplican"


def setup_world(db):
    ensure_platform_config(db)
    admin = mk_user(db, "superadmin", f"{TAG}admin")
    tu = mk_user(db, "teacher", f"{TAG}prof")
    tp = TeacherProfile(user_id=tu.id, user_username=tu.username, status=TeacherStatus.approved, timezone="UTC",
                        languages=["English"], subjects=["English"], video_url="http://v")
    db.add(tp)
    db.flush()
    for d in range(7):
        db.add(TeacherAvailability(teacher_id=tp.id, day_of_week=d, is_available=True,
                                   start_time_local="00:00", end_time_local="23:59"))
    pkg = Package(teacher_id=tp.id, name="CONC4", subject="English", classes_count=4, price=100.0,
                  price_per_class=25.0, duration_minutes=50, is_active=True)
    db.add(pkg)
    db.commit()
    return admin, tu, tp, pkg


def age_class(db, cid):
    """AUD-04: solo se completa una clase que ya empezo -> mover al pasado por SQL."""
    db.execute(text("update classes set start_time_utc = now() - interval '3 hours', "
                    "end_time_utc = now() - interval '2 hours' where id=:i"), {"i": cid})
    db.commit()


def new_student(db, n):
    su = mk_user(db, "student", f"{TAG}al{n}")
    sp = StudentProfile(user_id=su.id, user_username=su.username, timezone="UTC")
    db.add(sp)
    db.commit()
    return su


def enroll(c, db, admin, tu, pkg, su, hours=3):
    """prueba completada + paquete comprado y aprobado. Devuelve (enrollment_id, payment_id)."""
    st = future(hours)
    r = post(c, "/payments/book", su, json={"teacher_username": tu.username, "start_time_utc": st.isoformat(),
            "end_time_utc": (st + timedelta(minutes=25)).isoformat(), "duration_minutes": 25})
    assert r.status_code == 201, r.text
    cid = r.json()["class_id"]
    for s in ("confirmed", "completed"):
        if s == "completed":
            age_class(db, cid)
        assert c.patch(f"{BASE}/classes/{cid}/status", json={"status": s}, headers=tok(tu)).status_code == 200
    cfg = c.get(BASE + "/payments/config").json()
    method = next((m for m, k in (("bank_transfer", "bank_transfer_enabled"), ("paypal", "paypal_enabled"),
                                  ("binance", "binance_enabled"), ("mobile_payment", "mobile_payment_enabled")) if cfg.get(k)), None)
    assert method, "no hay método de pago habilitado en PaymentConfig"
    r = post(c, "/payments/notify-payment", su, json={"type": "package", "package_id": pkg.id, "payment_method": method,
             "transaction_reference": "CONC"})
    assert r.status_code == 200, r.text
    pid = r.json()["payment_id"]
    r = c.patch(f"{BASE}/payments/{pid}/validate", json={"action": "approve"}, headers=tok(admin))
    assert r.status_code == 200, r.text
    row = db.execute(text("select enrollment_id from payments where id=:i"), {"i": pid}).first()
    return row[0], pid


def ensure_payment_method(db):
    """Garantiza un método de pago habilitado (una BD recién migrada, como la de CI, no trae PaymentConfig).
    Devuelve una función que deja la configuración como estaba."""
    from app.models.payment_config import PaymentConfig
    flags = ("bank_transfer_enabled", "paypal_enabled", "binance_enabled", "mobile_payment_enabled")
    row = db.query(PaymentConfig).first()
    if row and any(getattr(row, f) for f in flags):
        return lambda: None                      # ya hay uno: no se toca nada
    if row is None:
        row = PaymentConfig(bank_transfer_enabled=True, paypal_enabled=False, binance_enabled=False,
                            mobile_payment_enabled=False, bank_transfer_details="CONC")
        db.add(row)
        db.commit()
        rid = row.id
        def undo():
            db.rollback()
            db.query(PaymentConfig).filter(PaymentConfig.id == rid).delete()
            db.commit()
        return undo
    row.bank_transfer_enabled = True
    db.commit()
    rid = row.id
    def undo():
        db.rollback()
        db.query(PaymentConfig).filter(PaymentConfig.id == rid).update({"bank_transfer_enabled": False})
        db.commit()
    return undo


def main():
    db = SessionLocal()
    c = httpx.Client(timeout=120)
    undo_payment = ensure_payment_method(db)
    try:
        admin, tu, tp, pkg = setup_world(db)
        print("etiqueta", TAG, "| profesor", tp.id, flush=True)

        # R1: dos alumnos reservan el MISMO horario a la vez
        s1, s2 = new_student(db, 1), new_student(db, 2)
        e1, _ = enroll(c, db, admin, tu, pkg, s1, hours=3)
        e2, _ = enroll(c, db, admin, tu, pkg, s2, hours=6)
        slot = future(48, 0)
        body = lambda e: {"teacher_username": tu.username, "enrollment_id": e, "start_time_utc": slot.isoformat(),
                          "end_time_utc": (slot + timedelta(minutes=50)).isoformat(), "duration_minutes": 50}
        res = parallel([lambda: post(c, "/payments/book", s1, json=body(e1)), lambda: post(c, "/payments/book", s2, json=body(e2))])
        n = db.execute(text("select count(*) from classes where teacher_id=:t and start_time_utc=:s and status<>'cancelled'"),
                       {"t": tp.id, "s": slot}).scalar()
        check("R1 mismo horario, 2 alumnos simultáneos", "1 clase", f"{n} clases (HTTP {[code(r) for r in res]})", n == 1)

        # R2: sobre-reserva de créditos: 1 crédito libre, 4 reservas simultáneas en horarios distintos
        s3 = new_student(db, 3)
        e3, _ = enroll(c, db, admin, tu, pkg, s3, hours=9)
        for i in range(3):
            assert post(c, "/payments/book", s3, json={"teacher_username": tu.username, "enrollment_id": e3,
                        "start_time_utc": future(72 + 3 * i).isoformat(),
                        "end_time_utc": (future(72 + 3 * i) + timedelta(minutes=50)).isoformat(), "duration_minutes": 50}).status_code == 201
        fns = [(lambda k=k: post(c, "/payments/book", s3, json={"teacher_username": tu.username, "enrollment_id": e3,
                "start_time_utc": future(100 + 3 * k).isoformat(),
                "end_time_utc": (future(100 + 3 * k) + timedelta(minutes=50)).isoformat(), "duration_minutes": 50})) for k in range(4)]
        res = parallel(fns)
        n = db.execute(text("select count(*) from classes where enrollment_id=:e and status<>'cancelled'"), {"e": e3}).scalar()
        check("R2 créditos: 4 reservas simultáneas con 1 crédito libre", "4 clases en total", f"{n} clases (HTTP {[code(r) for r in res]})", n == 4)

        # R3: aprobar el MISMO pago 4 veces a la vez
        s4 = new_student(db, 4)
        st = future(12)
        r = post(c, "/payments/book", s4, json={"teacher_username": tu.username, "start_time_utc": st.isoformat(),
                 "end_time_utc": (st + timedelta(minutes=25)).isoformat(), "duration_minutes": 25})
        cid = r.json()["class_id"]
        for s in ("confirmed", "completed"):
            if s == "completed":
                age_class(db, cid)
            c.patch(f"{BASE}/classes/{cid}/status", json={"status": s}, headers=tok(tu))
        cfg = c.get(BASE + "/payments/config").json()
        method = next(m for m, k in (("bank_transfer", "bank_transfer_enabled"), ("paypal", "paypal_enabled"),
                      ("binance", "binance_enabled"), ("mobile_payment", "mobile_payment_enabled")) if cfg.get(k))
        pid = post(c, "/payments/notify-payment", s4, json={"type": "package", "package_id": pkg.id, "payment_method": method,
                   "transaction_reference": "CONC3"}).json()["payment_id"]
        before = db.execute(text("select coalesce(total_earned,0) from teacher_wallets where teacher_id=:t"), {"t": tp.id}).scalar() or 0
        res = parallel([lambda: c.patch(f"{BASE}/payments/{pid}/validate", json={"action": "approve"}, headers=tok(admin)) for _ in range(4)])
        db.expire_all()
        after = db.execute(text("select coalesce(total_earned,0) from teacher_wallets where teacher_id=:t"), {"t": tp.id}).scalar()
        check("R3 aprobar el mismo pago x4 a la vez", "+85.0 (una vez)", f"{after - before:+.2f} (HTTP {[code(r) for r in res]})", abs((after - before) - 85.0) < 0.01)

        # R4: 4 solicitudes de retiro del saldo completo a la vez
        bal = db.execute(text("select available_balance from teacher_wallets where teacher_id=:t"), {"t": tp.id}).scalar()
        res = parallel([lambda: post(c, "/payments/request-withdrawal", tu, json={"amount": float(bal), "payment_info": "CONC"}) for _ in range(4)])
        pend = db.execute(text("select count(*) from withdrawals where teacher_id=:t and status='pending'"), {"t": tp.id}).scalar()
        avail = db.execute(text("select available_balance from teacher_wallets where teacher_id=:t"), {"t": tp.id}).scalar()
        check("R4 retiro simultáneo x4", "1 retiro pendiente, saldo >= 0", f"{pend} pendientes, saldo {avail} (HTTP {[code(r) for r in res]})", pend == 1 and avail >= 0)

        # R5: cancelar la misma clase 3 veces a la vez (el crédito solo se devuelve una vez)
        s5 = new_student(db, 5)
        e5, _ = enroll(c, db, admin, tu, pkg, s5, hours=15)
        cid = post(c, "/payments/book", s5, json={"teacher_username": tu.username, "enrollment_id": e5,
                   "start_time_utc": future(200).isoformat(), "end_time_utc": (future(200) + timedelta(minutes=50)).isoformat(),
                   "duration_minutes": 50}).json()["class_id"]
        res = parallel([lambda: c.delete(f"{BASE}/classes/teacher/{cid}", headers=tok(tu)) for _ in range(3)])
        used = db.execute(text("select classes_used from enrollments where id=:e"), {"e": e5}).scalar()
        ok200 = sum(1 for r in res if code(r) == 200)
        check("R5 cancelación simultánea x3", "1 éxito, classes_used >= 0", f"{ok200} éxitos, classes_used={used}", ok200 == 1 and used >= 0)
    finally:
        cleanup(db)
        undo_payment()
        c.close()
    bad = [r for r in RESULTS if not r[3]]
    print(f"\nRESUMEN: {len(RESULTS) - len(bad)} OK, {len(bad)} FALLO", flush=True)
    sys.exit(1 if bad else 0)


def cleanup(db):
    """Borra TODO lo creado por esta ejecución (por ids de usuario de la etiqueta)."""
    db.rollback()
    ids = tuple(created_user_ids) or (0,)
    q = lambda s, **p: db.execute(text(s), {"ids": ids, **p})
    tp = [r[0] for r in q("select id from teacher_profiles where user_id in :ids".replace("in :ids", "= any(:ids)"), ids=list(ids))]
    sp = [r[0] for r in q("select id from student_profiles where user_id = any(:ids)", ids=list(ids))]
    steps = [
        "delete from class_participants where class_id in (select id from classes where teacher_id = any(:t) or student_id = any(:s))",
        "delete from reviews where teacher_id = any(:t) or student_id = any(:s)",
        "delete from classes where teacher_id = any(:t) or student_id = any(:s)",
        "delete from payments where teacher_id = any(:t) or student_id = any(:s)",
        "delete from enrollments where teacher_id = any(:t) or student_id = any(:s)",
        "delete from withdrawals where teacher_id = any(:t)",
        "delete from teacher_wallets where teacher_id = any(:t)",
        "delete from packages where teacher_id = any(:t)",
        "delete from teacher_availability where teacher_id = any(:t)",
        "delete from student_schedule_preferences where student_id = any(:s)",
        "delete from student_teacher_links where student_id = any(:s) or teacher_id = any(:t)",
        "delete from chat_messages where conversation_id in (select id from chat_conversations where student_id = any(:s) or teacher_id = any(:t))",
        "delete from chat_read_states where conversation_id in (select id from chat_conversations where student_id = any(:s) or teacher_id = any(:t))",
        "delete from chat_conversations where student_id = any(:s) or teacher_id = any(:t)",
    ]
    for s in steps:
        try:
            db.execute(text(s), {"t": tp or [0], "s": sp or [0]})
            db.commit()
        except Exception as e:  # tabla/columna distinta: se informa y se sigue
            db.rollback()
            print("  (limpieza omitida)", s.split(" from ")[1].split(" ")[0], "->", str(e).splitlines()[0][:90])
    for s in ("delete from error_logs where user_id = any(:u)", "delete from notifications where related_teacher_id = any(:t)",
              "delete from student_profiles where id = any(:s)", "delete from teacher_profiles where id = any(:t)",
              "delete from users where id = any(:u)"):
        try:
            db.execute(text(s), {"t": tp or [0], "s": sp or [0], "u": list(ids)})
            db.commit()
        except Exception as e:
            db.rollback()
            print("  (limpieza omitida)", s.split(" from ")[1].split(" ")[0], "->", str(e).splitlines()[0][:90])
    left = db.execute(text("select count(*) from users where email like '%@audit-conc.com'")).scalar()
    print("usuarios @audit-conc.com restantes:", left, flush=True)


if __name__ == "__main__":
    main()
