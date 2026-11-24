"""
Levanta el backend REAL con SQLite + datos semilla, para pruebas manuales o
con Chrome (frontend en http://localhost:3000). Nunca toca una BD real.

Uso (desde backend/):
    python -m tests.audit.run_server            # puerto 8000
Cuentas (contraseña Password123): admin / profe / alumno  (@audit-tpm.com)
"""
import os
import sys
import tempfile
from datetime import timezone as _tz

_db = os.path.join(tempfile.gettempdir(), "tpm_audit_server.db")
if os.path.exists(_db):
    os.remove(_db)
os.environ["DATABASE_URL"] = f"sqlite:///{_db}"
os.environ.setdefault("SECRET_KEY", "audit-secret")
os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("GOOGLE_CLIENT_ID", "audit-client")
os.environ.setdefault("OPENAI_API_KEY", "sk-dummy")
os.environ.setdefault("GEMINI_API_KEY", "dummy")
os.environ.setdefault("FRONTEND_URL", "http://localhost:3000")

# SEGURIDAD: app/db/base.py hace load_dotenv(override=True). Si existe backend/.env (BD real),
# pisaría el DATABASE_URL de SQLite y las pruebas tocarían datos reales. Se anula antes de importar la app.
import dotenv as _dotenv  # noqa: E402
_dotenv.load_dotenv = lambda *a, **k: False
from sqlalchemy.dialects.postgresql import JSONB  # noqa: E402
from sqlalchemy.dialects.sqlite import DATETIME as _DT  # noqa: E402
from sqlalchemy.ext.compiler import compiles  # noqa: E402


@compiles(JSONB, "sqlite")
def _jsonb(t, c, **kw):
    return "JSON"


_orig = _DT.result_processor


def _aware(self, dialect, coltype):
    base = _orig(self, dialect, coltype)

    def p(v):
        v = base(v) if base else v
        if v is not None and getattr(v, "tzinfo", None) is None:
            v = v.replace(tzinfo=_tz.utc)
        return v
    return p


_DT.result_processor = _aware

import resend  # noqa: E402

resend.Emails.send = lambda *a, **k: {"id": "audit"}

import app.models as _m  # noqa: E402,F401
from app.db.base import Base, SessionLocal, engine  # noqa: E402
from app.auth.passwords import hash_password  # noqa: E402
from app.models.user import User, UserRole  # noqa: E402
from app.models.teacher import TeacherProfile, TeacherStatus  # noqa: E402
from app.models.student import StudentProfile  # noqa: E402
from app.models.package import Package  # noqa: E402
from app.models.payment_config import PaymentConfig, PlatformConfig  # noqa: E402
from app.models.availability import TeacherAvailability  # noqa: E402


assert engine.url.get_backend_name() == "sqlite", "ABORTADO: la BD no es SQLite"


def seed():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    mk = lambda role, u: User(email=f"{u}@audit-tpm.com", username=u, name=u.title(), surname="Audit",
                              password_hash=hash_password("Password123"), role=UserRole(role),
                              is_active=True, onboarding_completed=True, is_verified=True)
    admin, tu, su = mk("superadmin", "admin"), mk("teacher", "profe"), mk("student", "alumno")
    nuevo = mk("student", "nuevo")          # alumno que aun no termino el onboarding (pruebas E2E)
    nuevo.onboarding_completed = False
    db.add_all([admin, tu, su, nuevo]); db.flush()
    db.add(StudentProfile(user_id=nuevo.id, user_username="nuevo", timezone="UTC"))
    tp = TeacherProfile(user_id=tu.id, user_username="profe", status=TeacherStatus.approved, timezone="UTC",
                        languages=["English"], subjects=["English"], video_url="http://v", title="Profe de prueba")
    sp = StudentProfile(user_id=su.id, user_username="alumno", timezone="UTC")
    db.add_all([tp, sp]); db.flush()
    for d in range(7):
        db.add(TeacherAvailability(teacher_id=tp.id, day_of_week=d, is_available=True,
                                   start_time_local="08:00", end_time_local="20:00"))
    db.add(Package(teacher_id=tp.id, name="Paquete 4", subject="English", classes_count=4, price=100.0,
                   price_per_class=25.0, duration_minutes=50, is_active=True))
    db.add(PaymentConfig(bank_transfer_enabled=True, paypal_enabled=False, binance_enabled=False,
                         mobile_payment_enabled=False, bank_transfer_details="Banco AUDIT 000-123"))
    db.add(PlatformConfig(is_single_tenant=False))
    # Catalogos minimos (en produccion los crea la migracion): sin ellos los selectores del onboarding/perfil no cargan.
    from app.models.system_catalog import SystemCatalog
    db.add(SystemCatalog(key="spoken_languages", label="Idiomas que habla el usuario",
                         value=["Español", "Inglés", "Portugués", "Francés"]))
    db.add(SystemCatalog(key="languages", label="Idiomas", value=["Ingles", "Frances"]))
    db.commit(); db.close()


def e2e_hooks():
    """Ganchos SOLO de pruebas (este servidor nunca es produccion): lo que un E2E no puede hacer por la interfaz.
    - POST /__e2e__/student/{username}: crea un alumno verificado y con onboarding hecho (idempotente).
    - POST /__e2e__/age-class/{class_id}: mueve una clase al pasado para poder completarla (AUD-04)."""
    from datetime import datetime, timedelta, timezone
    from fastapi import APIRouter
    from app.models.class_ import Class
    router = APIRouter(prefix="/__e2e__")

    @router.post("/student/{username}")
    def make_student(username: str):
        db = SessionLocal()
        try:
            u = db.query(User).filter(User.username == username).first()
            if not u:
                u = User(email=f"{username}@audit-tpm.com", username=username, name=username.title(), surname="E2E",
                         password_hash=hash_password("Password123"), role=UserRole("student"),
                         is_active=True, onboarding_completed=True, is_verified=True)
                db.add(u); db.flush()
                db.add(StudentProfile(user_id=u.id, user_username=username, timezone="UTC"))
                db.commit()
            return {"username": username}
        finally:
            db.close()

    @router.post("/age-class/{class_id}")
    def age_class(class_id: int, hours: int = 3):
        db = SessionLocal()
        try:
            c = db.get(Class, class_id)
            c.start_time_utc = datetime.now(timezone.utc) - timedelta(hours=hours)
            c.end_time_utc = c.start_time_utc + timedelta(minutes=c.duration)
            db.commit()
            return {"class_id": class_id}
        finally:
            db.close()

    return router


if __name__ == "__main__":
    seed()
    # Solo en este servidor de pruebas: las suites E2E (varios proyectos, muchos logins desde la misma IP) agotan
    # el 10/minuto del login. En producción el límite sigue activo.
    from app.core.rate_limit import limiter
    limiter.enabled = False
    import uvicorn
    from app.main import app
    app.include_router(e2e_hooks())
    # E2E_BACKEND_HOST: en Linux "::" acepta IPv4 e IPv6 a la vez (WebKit puede resolver `localhost` a ::1). Por
    # defecto solo 127.0.0.1: en Windows "::" no acepta IPv4.
    uvicorn.run(app, host=os.environ.get("E2E_BACKEND_HOST", "127.0.0.1"),
                port=int(sys.argv[1]) if len(sys.argv) > 1 else 8000)
