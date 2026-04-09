from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    # Base de datos
    DATABASE_URL: str

    # JWT
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    # Google OAuth
    GOOGLE_CLIENT_ID: Optional[str] = None
    GOOGLE_CLIENT_SECRET: Optional[str] = None

    # Cloudinary
    CLOUDINARY_CLOUD_NAME: Optional[str] = None
    CLOUDINARY_API_KEY: Optional[str] = None
    CLOUDINARY_API_SECRET: Optional[str] = None
    TTS_CACHE_FOLDER: str = "tts_cache"


    # OpenAI
    OPENAI_API_KEY: Optional[str] = None

    # Resend
    RESEND_API_KEY: Optional[str] = None
    EMAIL_FROM: str = "tuprofemaria@gmail.com"

    # App
    APP_NAME: str = "TPMH"
    FRONTEND_URL: str = "http://localhost:3000"
    BACKEND_URL: str = "http://localhost:8000"
    ENVIRONMENT: str = "development"

    class Config:
        env_file = ".env"
        case_sensitive = True

# Instancia global que importas en cualquier archivo
settings = Settings()