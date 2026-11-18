import bcrypt

def hash_password(password: str) -> str:
    """Convierte la contraseña en un hash seguro"""
    password_bytes = password.encode("utf-8")
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password_bytes, salt).decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Compara la contraseña introducida con el hash guardado"""
    password_bytes = plain_password.encode("utf-8")
    hashed_bytes = hashed_password.encode("utf-8")
    return bcrypt.checkpw(password_bytes, hashed_bytes)

# Hash de una contraseña inalcanzable: el login lo verifica cuando el usuario no existe (o es solo-Google)
# para que la respuesta tarde lo mismo y no revele qué cuentas existen.
_DUMMY_HASH = bcrypt.hashpw(b"dummy-never-matches", bcrypt.gensalt()).decode("utf-8")


def burn_password_check(plain_password: str) -> None:
    """Gasta el mismo tiempo que verify_password; el resultado se descarta."""
    verify_password(plain_password, _DUMMY_HASH)
