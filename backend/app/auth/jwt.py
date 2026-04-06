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
        return payload
    except JWTError:
        return None