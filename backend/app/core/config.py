from pydantic_settings import BaseSettings
from typing import Optional
from dotenv import load_dotenv
import os

load_dotenv()
class Settings(BaseSettings):

    # Base de datos
    DATABASE_URL: str

    # JWT
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    # SEC-05: con la cookie HttpOnly + refresh el access token puede (y debe) ser corto: 30 min en produccion.
    # El valor por defecto sigue siendo el antiguo para no cerrar sesiones hasta que el frontend con refresh
    # este desplegado; luego basta con poner ACCESS_TOKEN_EXPIRE_MINUTES=30 en el entorno.
    ACCESS_TOKEN_EXPIRE_MINUTES: int = os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 10080)
    REFRESH_TOKEN_EXPIRE_DAYS: int = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", 30))

    # Bloqueo por cuenta tras logins fallidos (Fase 13, A1). Se complementa con el limite por IP del endpoint.
    LOGIN_MAX_FAILED: int = int(os.getenv("LOGIN_MAX_FAILED", 8))
    LOGIN_LOCK_MINUTES: int = int(os.getenv("LOGIN_LOCK_MINUTES", 15))

    # Correos fuera del camino de la peticion (Fase 14, E1): Resend tarda 200-800 ms por correo y antes bloqueaba
    # un hilo del servidor hasta responder. EMAIL_ASYNC=false los envia en linea (tests, depuracion).
    EMAIL_ASYNC: bool = os.getenv("EMAIL_ASYNC", "true").lower() not in ("0", "false", "no")
    EMAIL_WORKERS: int = int(os.getenv("EMAIL_WORKERS", 2))

    # Cookies de sesion (SEC-05). Produccion mismo sitio: COOKIE_DOMAIN=.tuprofemaria.com, SameSite=lax.
    # Si frontend y API estuvieran en sitios distintos habria que usar COOKIE_SAMESITE=none (exige Secure).
    COOKIE_DOMAIN: Optional[str] = os.getenv("COOKIE_DOMAIN") or None
    COOKIE_SAMESITE: str = os.getenv("COOKIE_SAMESITE", "lax")
    COOKIE_SECURE: Optional[bool] = None  # None => True solo si ENVIRONMENT=production

    # Google OAuth
    GOOGLE_CLIENT_ID: Optional[str] = None
    GOOGLE_CLIENT_SECRET: Optional[str] = None
    GOOGLE_REDIRECT_URI: Optional[str] = None

    GEMINI_API_KEY: Optional[str] = None

    # Cloudinary
    CLOUDINARY_CLOUD_NAME: Optional[str] = None
    CLOUDINARY_API_KEY: Optional[str] = None
    CLOUDINARY_API_SECRET: Optional[str] = None
    MAX_VIDEO_UPLOAD_MB: int = int(os.getenv("MAX_VIDEO_UPLOAD_MB", 100))
    TTS_CACHE_FOLDER: str = "tts_cache"

    # Configuración de la app
    FEATURED_TEACHER_USERNAME: Optional[str] = None

    # OpenAI
    OPENAI_API_KEY: Optional[str] = None

    # Resend
    RESEND_API_KEY: Optional[str] = None
    EMAIL_FROM: str = "Soporte TuProfeMaria <soporte@mail.tuprofemaria.com>"

    # App
    APP_NAME: str = "TPM"
    FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:3000")
    BACKEND_URL: str = os.getenv("BACKEND_URL", "http://localhost:8000")
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")

    class Config:
        env_file = ".env"
        case_sensitive = True

# Instancia global que importas en cualquier archivo
settings = Settings()