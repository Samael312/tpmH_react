"""
Auditoría TZ (sonda en vivo) — crea/normaliza cuentas QA `qa_tz_*` en Neon DEV.

Uso (desde backend/):  venv\\Scripts\\python.exe -m tests.tz_probes.setup_qa
Imprime JSON con los ids creados. Idempotente. NO usar contra producción.
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone as tz

from app.core.config import settings  # noqa: F401  (carga .env)

from app.db import base as _base
DB = str(_base.DATABASE_URL or "")
if "ep-patient-band-akv3610u" not in DB:
    sys.exit("ABORT: DATABASE_URL no es la rama dev de Neon")

from app.db.base import SessionLocal
from app.models.user import User, UserRole
from app.models.teacher import TeacherProfile, TeacherStatus
from app.models.student import StudentProfile
from app.models.package import Package, Enrollment, EnrollmentStatus
from app.models.class_ import Class, ClassType
from app.models.student_teacher_link import StudentTeacherLink
from app.auth.passwords import hash_password

PWD = "QaTz!2026audit"
DOMAIN = "audit-tpm.invalid"


def user(db, username, role):
    u = db.query(User).filter(User.username == username).first()
    if u is None:
        u = User(email=f"{username}@{DOMAIN}", username=username, name="QA", surname=username,
                 password_hash=hash_password(PWD), role=UserRole(role))
        db.add(u)
        db.flush()
    u.password_hash = hash_password(PWD)
    u.is_active = True
    u.is_verified = True
    u.is_banned = False
    u.onboarding_completed = True
    u.is_test_account = True
    db.flush()
    return u


def main():
    db = SessionLocal()
    out = {}
    t = user(db, "qa_tz_teacher", "teacher")
    tp = db.query(TeacherProfile).filter(TeacherProfile.user_id == t.id).first()
    if tp is None:
        tp = TeacherProfile(user_id=t.id, user_username=t.username)
        db.add(tp)
        db.flush()
    tp.timezone = "America/Bogota"
    tp.status = TeacherStatus.approved
    tp.bio = "QA timezone audit"
    tp.title = "QA TZ"
    tp.languages = ["Inglés"]
    tp.subjects = ["Inglés"]
    tp.video_url = "https://example.invalid/v"
    db.flush()
    out["teacher"] = {"user_id": t.id, "profile_id": tp.id}

    pkg = db.query(Package).filter(Package.teacher_id == tp.id, Package.name == "QA TZ P10").first()
    if pkg is None:
        pkg = Package(teacher_id=tp.id, name="QA TZ P10", subject="Inglés", price=100.0,
                      classes_count=10, duration_minutes=50, price_per_class=10.0)
        db.add(pkg)
        db.flush()
    out["package_id"] = pkg.id

    for key, uname, stz in (("student_mad", "qa_tz_student_mad", "Europe/Madrid"),
                            ("student_kol", "qa_tz_student_kol", "Asia/Kolkata")):
        s = user(db, uname, "student")
        sp = db.query(StudentProfile).filter(StudentProfile.user_id == s.id).first()
        if sp is None:
            sp = StudentProfile(user_id=s.id, user_username=s.username)
            db.add(sp)
            db.flush()
        sp.timezone = stz
        sp.goal = "QA"
        db.flush()
        link = db.query(StudentTeacherLink).filter_by(student_id=sp.id, teacher_id=tp.id).first()
        if link is None:
            link = StudentTeacherLink(student_id=sp.id, teacher_id=tp.id)
            db.add(link)
            db.flush()
        if sp.id not in (tp.students or []):
            tp.students = list(tp.students or []) + [sp.id]
        info = {"user_id": s.id, "profile_id": sp.id, "link_id": link.id}
        if key == "student_mad":
            # prueba completada en el pasado + paquete pagado (10 créditos)
            trial = db.query(Class).filter(Class.student_id == sp.id, Class.teacher_id == tp.id,
                                           Class.class_type == ClassType.trial).first()
            if trial is None:
                st = datetime(2026, 11, 2, 15, 0, tzinfo=tz.utc)
                trial = Class(teacher_id=tp.id, student_id=sp.id, class_type=ClassType.trial,
                              subject="Inglés", start_time_utc=st, end_time_utc=st + timedelta(minutes=25),
                              duration=25, buffer_minutes=5, status="completed",
                              teacher_timezone="America/Bogota", student_timezone=stz)
                db.add(trial)
                db.flush()
            enr = db.query(Enrollment).filter(Enrollment.student_id == sp.id, Enrollment.teacher_id == tp.id,
                                              Enrollment.status == EnrollmentStatus.active).first()
            if enr is None:
                enr = Enrollment(student_id=sp.id, teacher_id=tp.id, package_id=pkg.id, classes_used=0,
                                 classes_total=10, unlocked_credits=10, payment_status="paid",
                                 status=EnrollmentStatus.active, activated_at=datetime.now(tz.utc))
                db.add(enr)
                db.flush()
            info.update(trial_class_id=trial.id, enrollment_id=enr.id)
        out[key] = info
    db.commit()
    print(json.dumps(out))


if __name__ == "__main__":
    main()
