"""
Creación/normalización idempotente de los 4 usuarios fijos de pruebas.

`ensure_fixed_users(db)` puede llamarse tantas veces como se quiera: si el
usuario no existe lo crea, y si ya existe reinicia los campos de estado que
los tests necesitan en un estado limpio conocido (activo, no baneado,
onboarding completo, perfil de profesor aprobado con video, etc.) sin tocar
su `id`, para que las referencias (teacher_id/student_id) sigan siendo
válidas de una corrida a otra.

No pasa por /auth/register a propósito: ese endpoint solo permite crear
'student' o 'teacher' (ver RegisterRequest.validate_role), así que
superadmin y teacher_admin solo se pueden sembrar directamente por ORM.
"""
from dataclasses import dataclass
from sqlalchemy.orm import Session

from app.models.user import User, UserRole
from app.models.teacher import TeacherProfile, TeacherStatus
from app.models.student import StudentProfile
from app.auth.passwords import hash_password

from tests.flow.constants import SUPERADMIN, TEACHER_ADMIN, TEACHER, STUDENT, ALL_FIXED_USERS


@dataclass
class FixedUser:
    id: int
    email: str
    username: str
    password: str
    role: str


def _get_or_create_user(db: Session, spec: dict) -> User:
    user = db.query(User).filter(User.email == spec["email"]).first()
    if user is None:
        user = User(
            email=spec["email"],
            username=spec["username"],
            name=spec["name"],
            surname=spec["surname"],
            password_hash=hash_password(spec["password"]),
            role=UserRole(spec["role"]),
        )
        db.add(user)
        db.flush()
    else:
        # Reinicia el hash por si la contraseña fija cambió en constants.py,
        # y normaliza el rol (por si alguien lo tocó a mano en el dashboard).
        user.password_hash = hash_password(spec["password"])
        user.role = UserRole(spec["role"])

    # Estado base que SIEMPRE debe cumplirse para que los tests no se topen
    # con un 403 "cuenta desactivada" o quedan atascados en onboarding.
    user.is_active = True
    user.is_banned = False
    user.ban_reason = None
    user.banned_at = None
    user.onboarding_completed = True
    user.is_test_account = True
    db.flush()
    return user


def _ensure_teacher_profile(db: Session, user: User, profile_spec: dict) -> TeacherProfile:
    profile = db.query(TeacherProfile).filter(TeacherProfile.user_id == user.id).first()
    if profile is None:
        profile = TeacherProfile(user_id=user.id, user_username=user.username)
        db.add(profile)
        db.flush()

    profile.user_username = user.username
    profile.bio = profile_spec["bio"]
    profile.title = profile_spec["title"]
    profile.timezone = profile_spec["timezone"]
    profile.languages = profile_spec["languages"]
    profile.subjects = profile_spec["subjects"]
    profile.status = TeacherStatus(profile_spec["status"])
    profile.video_url = profile_spec["video_url"]
    profile.theme_color = profile_spec["theme_color"]
    # Limpia cualquier rastro de un ciclo de rechazo/apelación de una
    # corrida anterior que haya tocado esta cuenta a mano.
    profile.rejection_reason = None
    profile.rejection_feedback_seen = True
    profile.appeal_count = 0
    profile.appeal_exhausted = False
    db.flush()
    return profile


def _ensure_student_profile(db: Session, user: User, profile_spec: dict) -> StudentProfile:
    profile = db.query(StudentProfile).filter(StudentProfile.user_id == user.id).first()
    if profile is None:
        profile = StudentProfile(user_id=user.id, user_username=user.username)
        db.add(profile)
        db.flush()

    profile.user_username = user.username
    profile.timezone = profile_spec["timezone"]
    profile.goal = profile_spec["goal"]
    db.flush()
    return profile


def ensure_fixed_users(db: Session) -> dict[str, FixedUser]:
    """Crea (o normaliza) los 4 usuarios fijos y devuelve sus datos + id."""
    result: dict[str, FixedUser] = {}

    superadmin = _get_or_create_user(db, SUPERADMIN)
    result["superadmin"] = FixedUser(superadmin.id, SUPERADMIN["email"], SUPERADMIN["username"], SUPERADMIN["password"], "superadmin")

    teacher_admin = _get_or_create_user(db, TEACHER_ADMIN)
    result["teacher_admin"] = FixedUser(teacher_admin.id, TEACHER_ADMIN["email"], TEACHER_ADMIN["username"], TEACHER_ADMIN["password"], "teacher_admin")

    teacher = _get_or_create_user(db, TEACHER)
    _ensure_teacher_profile(db, teacher, TEACHER["teacher_profile"])
    result["teacher"] = FixedUser(teacher.id, TEACHER["email"], TEACHER["username"], TEACHER["password"], "teacher")

    student = _get_or_create_user(db, STUDENT)
    _ensure_student_profile(db, student, STUDENT["student_profile"])
    result["student"] = FixedUser(student.id, STUDENT["email"], STUDENT["username"], STUDENT["password"], "student")

    db.commit()
    return result
