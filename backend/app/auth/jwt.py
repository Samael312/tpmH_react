from datetime import datetime, timedelta, timezone
from typing import Optional
from jose import JWTError, jwt
from app.core.config import settings

def create_access_token(user_id: int, role: str) -> str:
    """
    Genera un token JWT con el id y rol del usuario.
    Expira según ACCESS_TOKEN_EXPIRE_MINUTES del .env
    """
    # Use timezone-aware UTC datetime
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    
    payload = {
        "sub": str(user_id),
        "role": role,
        "exp": expire,
        "iat": now
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

OAUTH_STATE_TTL_MINUTES = 10


def create_oauth_state(teacher_id: int, purpose: str = "gcal") -> str:
    """
    `state` firmado y de vida corta para el flujo OAuth (SEC-06): ata la autorizacion al profesor que la
    inicio y evita que un atacante inyecte su propio `code` en la sesion de otro. Usa `tid` y `typ`
    (no `sub`/`role`) para que NUNCA se pueda usar como token de acceso.
    """
    now = datetime.now(timezone.utc)
    payload = {
        "tid": int(teacher_id),
        "typ": f"oauth_state:{purpose}",
        "iat": now,
        "exp": now + timedelta(minutes=OAUTH_STATE_TTL_MINUTES),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_oauth_state(state: str, purpose: str = "gcal") -> Optional[int]:
    """Devuelve el teacher_id del `state`, o None si es invalido, vencido o de otro tipo."""
    try:
        payload = jwt.decode(state, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        return None
    if payload.get("typ") != f"oauth_state:{purpose}" or "tid" not in payload:
        return None
    return int(payload["tid"])


def decode_access_token(token: str) -> Optional[dict]:
    """
    Verifica y decodifica un token.
    Retorna None si el token es inválido o expiró.
    """
    try:
        payload = jwt.decode(
            token, 
            settings.SECRET_KEY, 
            algorithms=[settings.ALGORITHM]
        )
    except JWTError:
        return None
    # Solo son tokens de acceso los que traen `sub` numerico y NO traen `typ` (los demas JWT firmados con la
    # misma clave, como el `state` de OAuth, no deben servir para autenticar; antes provocaban un 500).
    if "typ" in payload or not str(payload.get("sub", "")).isdigit():
        return None
    return payload