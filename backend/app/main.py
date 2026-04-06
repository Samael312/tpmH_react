from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.v1.router import api_router

app = FastAPI(
    title=settings.APP_NAME,
    description="API de TPMH - Plataforma de clases particulares",
    version="1.0.0",
    # En producción desactivamos la documentación pública
    docs_url="/docs" if settings.ENVIRONMENT == "development" else None,
    redoc_url="/redoc" if settings.ENVIRONMENT == "development" else None,
)

# CORS — permite que el frontend en localhost:3000 hable con el backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ruta de salud — para verificar que el servidor está vivo
@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "environment": settings.ENVIRONMENT,
        "app": settings.APP_NAME
    }

# Rutas de la API
app.include_router(api_router, prefix="/api/v1")