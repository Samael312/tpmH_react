from passlib.context import CryptContext

# bcrypt es el algoritmo estándar para contraseñas
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str) -> str:
    """Convierte 'mipassword123' en '$2b$12$...' (irreversible)"""
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Compara la contraseña introducida con el hash guardado"""
    return pwd_context.verify(plain_password, hashed_password)