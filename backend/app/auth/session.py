"""
Sesion por cookies HttpOnly + refresh token con rotacion (SEC-05).

Cookies (todas HttpOnly, SameSite configurable, Secure en produccion):
  tpm_access   JWT de acceso (vida corta). Path /.
  tpm_refresh  refresh token opaco (en BD solo su hash). Path /api/v1/auth: solo viaja a refresh/logout.
  tpm_session  marca "hay sesion" para que el proxy del frontend deje cargar la pagina cuando el access
               ya vencio pero el refresh sigue vigente (el cliente lo renueva). No es una credencial.
"""
import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Request, Response
from sqlalchemy.orm import Session

from app.auth.jwt import create_access_token
from app.core.config import settings
from app.core.timezone import utc_now
from app.models.refresh_token import RefreshToken
from app.models.user import User

ACCESS_COOKIE = "tpm_access"
REFRESH_COOKIE = "tpm_refresh"
SESSION_COOKIE = "tpm_session"
REFRESH_COOKIE_PATH = "/api/v1/auth"
# Ventana en la que reusar un refresh recien rotado NO se considera robo (dos pestanas que renuevan a la vez).
REFRESH_REUSE_GRACE_SECONDS = 10


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _secure() -> bool:
    if settings.COOKIE_SECURE is not None:
        return settings.COOKIE_SECURE
    return settings.ENVIRONMENT == "production"


def _set_cookie(response: Response, name: str, value: str, max_age: int, path: str = "/") -> None:
    response.set_cookie(
        name, value, max_age=max_age, path=path, domain=settings.COOKIE_DOMAIN or None,
        secure=_secure(), httponly=True, samesite=settings.COOKIE_SAMESITE.lower(),
    )


def _delete_cookie(response: Response, name: str, path: str = "/") -> None:
    response.delete_cookie(
        name, path=path, domain=settings.COOKIE_DOMAIN or None,
        secure=_secure(), httponly=True, samesite=settings.COOKIE_SAMESITE.lower(),
    )


def allowed_origins() -> list[str]:
    """Origenes del frontend que pueden hacer peticiones con cookies (mismo criterio que CORS)."""
    return [o.rstrip("/") for o in {settings.FRONTEND_URL, "http://localhost:3000"} if o]


def set_auth_cookies(response: Response, user: User, db: Session, family_id: Optional[str] = None) -> str:
    """Crea access + refresh, guarda el hash del refresh y fija las cookies. Devuelve el access token (solo para uso interno/tests; no se envia en el JSON)."""
    access = create_access_token(user.id, user.role)
    raw_refresh = secrets.token_urlsafe(48)
    refresh_seconds = int(settings.REFRESH_TOKEN_EXPIRE_DAYS) * 86400
    db.add(RefreshToken(
        user_id=user.id,
        token_hash=hash_token(raw_refresh),
        family_id=family_id or uuid.uuid4().hex,
        expires_at=utc_now() + timedelta(seconds=refresh_seconds),
    ))
    db.commit()
    _set_cookie(response, ACCESS_COOKIE, access, int(settings.ACCESS_TOKEN_EXPIRE_MINUTES) * 60)
    _set_cookie(response, REFRESH_COOKIE, raw_refresh, refresh_seconds, path=REFRESH_COOKIE_PATH)
    _set_cookie(response, SESSION_COOKIE, "1", refresh_seconds)
    return access


def clear_auth_cookies(response: Response) -> None:
    _delete_cookie(response, ACCESS_COOKIE)
    _delete_cookie(response, REFRESH_COOKIE, path=REFRESH_COOKIE_PATH)
    _delete_cookie(response, SESSION_COOKIE)


def _hard_revoked_at() -> datetime:
    """Instante de una revocación DEFINITIVA: se fecha fuera de la ventana de gracia de rotación, para que el token
    revocado no se acepte durante REFRESH_REUSE_GRACE_SECONDS como si fuera una carrera entre pestañas (Fase 21)."""
    return utc_now() - timedelta(seconds=REFRESH_REUSE_GRACE_SECONDS + 1)


def _revoke_family(db: Session, family_id: str) -> None:
    db.query(RefreshToken).filter(
        RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None)
    ).update({"revoked_at": _hard_revoked_at()}, synchronize_session=False)


def revoke_all_sessions(db: Session, user_id: int) -> None:
    """Cierra TODAS las sesiones del usuario (cambio/restablecimiento de contrasena, borrado de cuenta)."""
    db.query(RefreshToken).filter(
        RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None)
    ).update({"revoked_at": _hard_revoked_at()}, synchronize_session=False)
    # También los ya rotados hace instantes: siguen dentro de la ventana de gracia y valdrían unos segundos más.
    db.query(RefreshToken).filter(
        RefreshToken.user_id == user_id, RefreshToken.revoked_at > _hard_revoked_at()
    ).update({"revoked_at": _hard_revoked_at()}, synchronize_session=False)


def rotate_refresh_token(db: Session, raw: Optional[str]) -> Optional[tuple[User, str]]:
    """
    Valida el refresh y lo rota. Devuelve (usuario, family_id) o None si no es valido.
    - Desconocido o vencido -> None.
    - Ya revocado: dentro de la ventana de gracia se acepta (carrera entre pestanas); fuera de ella se asume
      reutilizacion/robo y se revoca TODA la familia.
    """
    if not raw:
        return None
    now = utc_now()
    rec = (
        db.query(RefreshToken)
        .filter(RefreshToken.token_hash == hash_token(raw))
        .with_for_update()
        .first()
    )
    if rec is None or _aware(rec.expires_at) <= now:
        return None
    if rec.revoked_at is not None:
        if (now - _aware(rec.revoked_at)).total_seconds() > REFRESH_REUSE_GRACE_SECONDS:
            _revoke_family(db, rec.family_id)
            db.commit()
            return None
    else:
        rec.revoked_at = now
    user = db.query(User).filter(User.id == rec.user_id).first()
    if user is None or not user.is_active:
        _revoke_family(db, rec.family_id)
        db.commit()
        return None
    db.flush()
    return user, rec.family_id


def revoke_refresh_family(db: Session, raw: Optional[str]) -> None:
    """Logout: revoca la familia del refresh presentado (si es valido o conocido)."""
    if not raw:
        return
    rec = db.query(RefreshToken).filter(RefreshToken.token_hash == hash_token(raw)).first()
    if rec is not None:
        _revoke_family(db, rec.family_id)
        db.commit()


def token_from_request(request: Request) -> Optional[str]:
    """Token de acceso de la peticion: solo la cookie HttpOnly (SEC-05; ya no se acepta Authorization)."""
    return request.cookies.get(ACCESS_COOKIE)
