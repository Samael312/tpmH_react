"""
Harness de la suite de auditoría (backend/tests/audit).

A diferencia de tests/flow (que necesita PostgreSQL + .env reales), esta
suite corre SIN .env y SIN PostgreSQL: usa SQLite en un archivo temporal y
la propia app FastAPI en proceso. Sirve para verificar lógica de negocio
(agendado, créditos, comisiones, permisos) en cualquier máquina o CI.

Limitaciones conocidas de SQLite frente a Postgres: no hay SELECT ... FOR
UPDATE real ni concurrencia real, así que los tests de carreras (doble
reserva simultánea) quedan fuera (ver ANALISIS.md, sección "Pendientes").
"""
import os
import tempfile
from datetime import timedelta

# Variables de entorno ANTES de importar la app (config/base leen al importar).
_DB_DIR = tempfile.mkdtemp(prefix="tpm_audit_")
os.environ["DATABASE_URL"] = f"sqlite:///{_DB_DIR}/audit.db"
os.environ.setdefault("SECRET_KEY", "audit-secret")
os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("GOOGLE_CLIENT_ID", "audit-client")
os.environ.setdefault("OPENAI_API_KEY", "sk-dummy")
os.environ.setdefault("GEMINI_API_KEY", "dummy")

# SEGURIDAD: app/db/base.py hace load_dotenv(override=True). Si existe backend/.env (BD real),
# pisaría el DATABASE_URL de SQLite y las pruebas tocarían datos reales. Se anula antes de importar la app.
import dotenv as _dotenv  # noqa: E402
_dotenv.load_dotenv = lambda *a, **k: False
import pytest
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles


@compiles(JSONB, "sqlite")
def _jsonb_as_json(type_, compiler, **kw):  # pragma: no cover
    return "JSON"


# SQLite devuelve datetimes "naive" incluso para DateTime(timezone=True);
# Postgres los devuelve aware (UTC). Se emula ese comportamiento para que
# la suite sea fiel al entorno real.
from datetime import timezone as _tz  # noqa: E402
from sqlalchemy.dialects.sqlite import DATETIME as _SQLITE_DT  # noqa: E402

_orig_result_processor = _SQLITE_DT.result_processor


def _aware_result_processor(self, dialect, coltype):
    base = _orig_result_processor(self, dialect, coltype)

    def process(value):
        v = base(value) if base else value
        if v is not None and getattr(v, "tzinfo", None) is None:
            v = v.replace(tzinfo=_tz.utc)
        return v
    return process


_SQLITE_DT.result_processor = _aware_result_processor

import resend  # noqa: E402

resend.Emails.send = lambda *a, **k: {"id": "audit"}  # no enviar emails reales

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.db.base import Base, SessionLocal, engine  # noqa: E402
import app.models as _models  # noqa: E402,F401
assert engine.url.get_backend_name() == "sqlite", "ABORTADO: la suite de auditoría solo puede usar SQLite"
from app.auth.jwt import create_access_token  # noqa: E402
from app.auth.passwords import hash_password  # noqa: E402
from app.core.timezone import utc_now  # noqa: E402
from app.models.user import User, UserRole  # noqa: E402
from app.models.teacher import TeacherProfile, TeacherStatus  # noqa: E402
from app.models.student import StudentProfile  # noqa: E402
from app.models.package import Package  # noqa: E402
from app.models.payment_config import PaymentConfig, PlatformConfig  # noqa: E402
from app.models.availability import TeacherAvailability  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_db():
    from app.core.rate_limit import limiter
    limiter.reset()  # el limite de registro (5/hora) se acumulaba entre tests
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield


@pytest.fixture
def db():
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()


@pytest.fixture
def client():
    return TestClient(app, raise_server_exceptions=False)


def _mk_user(db, role, username):
    u = User(
        email=f"{username}@audit-tpm.com", username=username, name=username.title(),
        surname="Audit", password_hash=hash_password("Password123"),
        role=UserRole(role), is_active=True, onboarding_completed=True,
    )
    db.add(u)
    db.flush()
    return u


def hdr(user):
    return {"Authorization": f"Bearer {create_access_token(user.id, user.role.value if hasattr(user.role,'value') else user.role)}"}


@pytest.fixture
def world(db):
    """Superadmin + profesor aprobado (con disponibilidad L-D 00:00-23:59 UTC)
    + alumno + paquete de 4 clases + métodos de pago habilitados."""
    admin = _mk_user(db, "superadmin", "admin")
    t_user = _mk_user(db, "teacher", "profe")
    s_user = _mk_user(db, "student", "alumno")
    tp = TeacherProfile(user_id=t_user.id, user_username=t_user.username,
                        status=TeacherStatus.approved, timezone="UTC",
                        languages=["English"], subjects=["English"], video_url="http://v")
    sp = StudentProfile(user_id=s_user.id, user_username=s_user.username, timezone="UTC")
    db.add_all([tp, sp])
    db.flush()
    for dow in range(7):
        db.add(TeacherAvailability(teacher_id=tp.id, day_of_week=dow, is_available=True,
                                   start_time_utc="00:00", end_time_utc="00:00"))
    pkg = Package(teacher_id=tp.id, name="P4", subject="English", classes_count=4,
                  price=100.0, price_per_class=25.0, duration_minutes=50, is_active=True)
    db.add(pkg)
    db.add(PaymentConfig(bank_transfer_enabled=True, paypal_enabled=False, binance_enabled=False, mobile_payment_enabled=False))
    db.add(PlatformConfig(is_single_tenant=False))
    db.commit()
    return dict(admin=admin, t_user=t_user, s_user=s_user, tp=tp, sp=sp, pkg=pkg)


def future(hours=48, minute=0):
    d = utc_now() + timedelta(hours=hours)
    return d.replace(minute=minute, second=0, microsecond=0)
