from sqlalchemy import Column, Integer, String, Boolean, DateTime, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from app.db.base import Base

class UserRole(str, enum.Enum):
    superadmin = "superadmin"
    teacher_admin = "teacher_admin"
    teacher = "teacher"
    student = "student"

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=True)
    role = Column(Enum(UserRole), nullable=False, default=UserRole.student)
    username = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    surname = Column(String, nullable=False)
    avatar = Column(String, nullable=True)
    phone_number = Column(String, nullable=True, unique=True) # <-- FUENTE ÚNICA DE VERDAD
    nationality = Column(String, nullable=True) 
    is_active = Column(Boolean, default=True)
    is_verified = Column(Boolean, default=False)
    google_id = Column(String, nullable=True, unique=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    onboarding_completed = Column(Boolean, default=False)

    # ─── Baneo (distinto de la desactivación simple is_active) ───
    # Un usuario baneado también queda con is_active=False, pero el baneo
    # además cancela sus enrollments/clases y queda registrado con motivo.
    # El email queda "quemado" (unique constraint existente) por lo que
    # no puede volver a registrarse con el mismo correo.
    is_banned = Column(Boolean, default=False)
    ban_reason = Column(String, nullable=True)
    banned_at = Column(DateTime(timezone=True), nullable=True)

    # ─── Cuentas fijas de la suite backend/tests/flow ───
    # Marca las 4 cuentas de prueba (superadmin/teacher_admin/teacher/
    # student) que se reutilizan entre corridas. Se usa para ocultarlas de
    # superficies públicas/de cara al usuario (p. ej. el marketplace de
    # profesores en /teachers/) sin tener que borrarlas ni afectar accesos
    # directos por username (perfil, disponibilidad, reservas), que los
    # propios tests necesitan seguir pudiendo hacer.
    is_test_account = Column(Boolean, default=False, nullable=False, server_default="false")

    # Relaciones
    teacher_profile = relationship("TeacherProfile", back_populates="user", uselist=False)
    student_profile = relationship("StudentProfile", back_populates="user", uselist=False)
    calendar_tokens = relationship("GoogleCalendarToken", back_populates="user")