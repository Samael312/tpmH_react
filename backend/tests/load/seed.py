"""
Siembra los usuarios de la prueba de carga (idempotente).

Uso (desde backend/):
    LOADTEST_DB_HOST=<host> python -m tests.load.seed [alumnos] [profesores]

Crea por ORM (todo con prefijo `lt_` e `is_test_account=True`):
- 1 superadmin `lt_admin`, para aprobar los pagos de la semilla;
- N profesores aprobados con disponibilidad de 24 h todos los días y un
  paquete de 200 clases de 50 min;
- M alumnos verificados y con el onboarding hecho.

Luego, a cada alumno sin paquete activo le pasa por el flujo REAL, con
la app en proceso (TestClient): reserva la prueba, el profesor la confirma
y la completa, y el alumno compra el paquete, que aprueba `lt_admin`. Así
la prueba de carga reserva con un enrollment válido, igual que un alumno
real. Escribe `tests/load/.seed.json` (usuarios y profesor de cada alumno)
para el locustfile.
"""
import json
import sys
from datetime import datetime, timedelta, timezone

from tests.load.common import (
    EMAIL_DOMAIN, PASSWORD, PREFIX, SEED_FILE, add_backend_to_path, disable_outbound, guard_database,
)

API = "/api/v1"


def _user(db, User, UserRole, hash_password, username, role):
    u = db.query(User).filter(User.username == username).first()
    if u is None:
        u = User(email=f"{username}@{EMAIL_DOMAIN}", username=username, name=username, surname="Loadtest",
                 password_hash=hash_password(PASSWORD), role=UserRole(role))
        db.add(u)
    u.email = f"{username}@{EMAIL_DOMAIN}"
    u.is_active = True
    u.is_verified = True
    u.is_banned = False
    u.onboarding_completed = True
    u.is_test_account = True
    db.flush()
    return u


def main(n_students: int, n_teachers: int) -> None:
    host = guard_database()
    add_backend_to_path()
    disable_outbound()

    from fastapi.testclient import TestClient
    from app.main import app as fastapi_app
    from app.db.base import SessionLocal
    import app.models as _models  # noqa: F401
    from app.auth.jwt import create_access_token
    from app.auth.passwords import hash_password
    from app.models.availability import TeacherAvailability
    from app.models.class_ import Class
    from app.models.package import Enrollment, EnrollmentStatus, Package
    from app.models.payment import Payment
    from app.models.payment_config import PaymentConfig
    from app.models.student import StudentProfile
    from app.models.teacher import TeacherProfile, TeacherStatus
    from app.models.user import User, UserRole

    print(f"[seed] BD {host}: {n_students} alumnos, {n_teachers} profesores")
    db = SessionLocal()
    admin = _user(db, User, UserRole, hash_password, f"{PREFIX}admin", "superadmin")
    teachers = []
    for i in range(n_teachers):
        u = _user(db, User, UserRole, hash_password, f"{PREFIX}teacher_{i}", "teacher")
        tp = db.query(TeacherProfile).filter(TeacherProfile.user_id == u.id).first()
        if tp is None:
            tp = TeacherProfile(user_id=u.id, user_username=u.username, timezone="UTC",
                                languages=["English"], subjects=["English"], video_url="http://loadtest/video")
            db.add(tp)
            db.flush()
        tp.status = TeacherStatus.approved
        if not db.query(TeacherAvailability).filter(TeacherAvailability.teacher_id == tp.id).count():
            for dow in range(7):
                db.add(TeacherAvailability(teacher_id=tp.id, day_of_week=dow, is_available=True,
                                           start_time_utc="00:00", end_time_utc="00:00"))
        pkg = db.query(Package).filter(Package.teacher_id == tp.id, Package.name == "LT200").first()
        if pkg is None:
            pkg = Package(teacher_id=tp.id, name="LT200", subject="English", classes_count=200,
                          price=1000.0, price_per_class=5.0, duration_minutes=50, is_active=True)
            db.add(pkg)
            db.flush()
        teachers.append((u, tp, pkg))
    students = []
    for j in range(n_students):
        u = _user(db, User, UserRole, hash_password, f"{PREFIX}student_{j}", "student")
        sp = db.query(StudentProfile).filter(StudentProfile.user_id == u.id).first()
        if sp is None:
            sp = StudentProfile(user_id=u.id, user_username=u.username, timezone="UTC")
            db.add(sp)
            db.flush()
        students.append((u, sp))
    db.commit()

    def hdr(user):
        return {"Authorization": f"Bearer {create_access_token(user.id, user.role.value)}"}

    # El primer método de pago habilitado en esta BD (no se toca la configuración).
    cfg = db.query(PaymentConfig).first()
    method = next((m for m in ("bank_transfer", "mobile_payment", "binance", "paypal")
                   if cfg is None or getattr(cfg, f"{m}_enabled")), None)
    if method is None:
        sys.exit("[seed] no hay ningún método de pago habilitado en esta BD")

    client = TestClient(fastapi_app)
    out = {"password": PASSWORD, "students": []}
    # Pruebas a partir de 4 días vista, cada alumno en su hora: sin choques entre ellos.
    base = (datetime.now(timezone.utc) + timedelta(days=4)).replace(hour=0, minute=0, second=0, microsecond=0)
    for j, (su, sp) in enumerate(students):
        tu, tp, pkg = teachers[j % n_teachers]
        enr = db.query(Enrollment).filter(Enrollment.student_id == sp.id, Enrollment.teacher_id == tp.id,
                                          Enrollment.status == EnrollmentStatus.active).first()
        trial_done = db.query(Class).filter(Class.student_id == sp.id, Class.teacher_id == tp.id,
                                            Class.status == "completed").first()
        if enr is None and trial_done is None:
            start = base + timedelta(hours=j)
            r = client.post(f"{API}/payments/book", headers=hdr(su), json={
                "teacher_username": tu.username, "start_time_utc": start.isoformat(),
                "end_time_utc": (start + timedelta(minutes=50)).isoformat(), "duration_minutes": 50})
            if r.status_code != 201:
                sys.exit(f"[seed] prueba de {su.username}: {r.status_code} {r.text}")
            cid = r.json()["class_id"]
            r = client.patch(f"{API}/classes/{cid}/status", json={"status": "confirmed"}, headers=hdr(tu))
            assert r.status_code == 200, r.text
            c = db.get(Class, cid)  # solo se completa una clase ya empezada (AUD-04)
            c.start_time_utc = datetime.now(timezone.utc) - timedelta(hours=3)
            c.end_time_utc = c.start_time_utc + timedelta(minutes=50)
            db.commit()
            r = client.patch(f"{API}/classes/{cid}/status", json={"status": "completed"}, headers=hdr(tu))
            assert r.status_code == 200, r.text
        if enr is None:
            r = client.post(f"{API}/payments/notify-payment", headers=hdr(su), json={
                "type": "package", "package_id": pkg.id, "payment_method": method,
                "transaction_reference": f"LT-{su.username}"})
            assert r.status_code == 200, r.text
            pid = r.json()["payment_id"]
            r = client.patch(f"{API}/payments/{pid}/validate", json={"action": "approve"}, headers=hdr(admin))
            assert r.status_code == 200, r.text
            db.expire_all()
            enr = db.get(Enrollment, db.get(Payment, pid).enrollment_id)
            print(f"[seed] {su.username}: prueba + paquete ({method}) -> enrollment {enr.id}")
        out["students"].append({"username": su.username, "teacher": tu.username, "enrollment_id": enr.id})
    out["teachers"] = [t[0].username for t in teachers]
    db.close()
    SEED_FILE.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"[seed] listo: {SEED_FILE}")


if __name__ == "__main__":
    args = [int(a) for a in sys.argv[1:3]]
    main(args[0] if args else 30, args[1] if len(args) > 1 else 3)
