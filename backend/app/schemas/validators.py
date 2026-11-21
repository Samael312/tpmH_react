"""Validadores compartidos de nombre de usuario, nombre/apellido y email (Fase 21, S3 y menores 1)."""
import re

USERNAME_RE = re.compile(r"^[a-z0-9_.-]{3,30}$")
# Nombres de usuario que no se pueden registrar (suplantan al equipo o chocan con rutas/servicios).
RESERVED_USERNAMES = frozenset({
    "admin", "administrator", "administrador", "superadmin", "root", "system", "sistema", "soporte", "support",
    "help", "ayuda", "api", "staff", "moderator", "moderador", "tpm", "tuprofemaria", "profemaria", "chipi",
    "null", "undefined", "me", "teacher", "teachers", "profesor", "student", "students", "alumno", "login",
    "logout", "register", "registro", "dashboard", "webmaster", "postmaster", "info", "contacto", "contact",
    "billing", "pagos", "payments", "security", "seguridad", "noreply", "no-reply", "mail", "www",
})
# Letras (cualquier alfabeto, con acentos) separadas por un unico espacio, guion o apostrofe.
NAME_RE = re.compile(r"^[^\W\d_]+(?:[ '’-][^\W\d_]+)*\.?$")
NAME_MAX = 60


def clean_username(v: str) -> str:
    v = (v or "").strip().lower()
    if not USERNAME_RE.match(v):
        raise ValueError("El usuario debe tener de 3 a 30 caracteres: minúsculas, números, punto, guion o guion bajo")
    if v in RESERVED_USERNAMES:
        raise ValueError("Este nombre de usuario no está disponible")
    return v


def clean_person_name(v: str) -> str:
    v = re.sub(r"\s+", " ", (v or "").strip())
    if not v:
        raise ValueError("Este campo no puede estar vacío")
    if len(v) > NAME_MAX:
        raise ValueError(f"Máximo {NAME_MAX} caracteres")
    if not NAME_RE.match(v):
        raise ValueError("Solo letras, espacios, guiones y apóstrofes")
    return v


ALLOWED_MEDIA_HOSTS = ("res.cloudinary.com",)


def check_cloudinary_url(v):
    """URL de imagen/medio: vacía o https en el host de Cloudinary de la plataforma (nada de javascript:, data: ni hosts ajenos)."""
    from urllib.parse import urlparse
    if v is None or v == "":
        return v
    try:
        u = urlparse(v)
    except Exception:
        raise ValueError("URL no válida")
    if u.scheme != "https" or (u.hostname or "").lower() not in ALLOWED_MEDIA_HOSTS or len(v) > 500:
        raise ValueError("La imagen debe estar alojada en la plataforma (res.cloudinary.com)")
    return v
