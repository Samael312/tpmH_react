import traceback

from fastapi import FastAPI, Request, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from app.core.config import settings
from app.api.v1.router import api_router
from app.core.scheduler import start_scheduler, stop_scheduler
from app.db.base import SessionLocal
from app.core.error_log import log_error, get_user_from_request, is_reportable_business_error

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Arranca el scheduler al iniciar el servidor y lo detiene al apagarlo"""
    start_scheduler()
    yield
    stop_scheduler()

app = FastAPI(
    title=settings.APP_NAME,
    lifespan=lifespan,
    description="API de TPM - Plataforma de clases particulares",
    version="1.0.0",
    # En producción desactivamos la documentación pública
    docs_url="/docs" if settings.ENVIRONMENT != "production" else None,
    redoc_url="/redoc" if settings.ENVIRONMENT == "development" else None,
)

origins = [
    settings.FRONTEND_URL,
    "http://localhost:3000",
]

# CORS — permite que el frontend en localhost:3000 hable con el backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Logs centralizados de errores (pantalla de Logs en /admin) ──────
#
# Dos handlers, sobre el mismo mecanismo pero distinto criterio:
#   1) Exception genérica -> siempre es un bug real (500), se loguea
#      siempre como "error".
#   2) HTTPException -> son parte del flujo normal la mayoría de las
#      veces (404, 403, validaciones...). Solo se loguean como
#      "warning" cuando caen en una ruta de negocio crítica (pagos,
#      clases, cohortes, paquetes) — ver CRITICAL_PATH_PREFIXES.
# En ambos casos la respuesta al cliente queda exactamente igual que
# sin estos handlers; lo único que agregan es la escritura del log.

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    db = SessionLocal()
    try:
        user = get_user_from_request(db, request)
        log_error(
            source="backend",
            level="error",
            message=f"{type(exc).__name__}: {exc}",
            detail="".join(traceback.format_exception(type(exc), exc, exc.__traceback__)),
            screen=request.url.path,
            method=request.method,
            status_code=500,
            user=user,
            extra={"query_params": dict(request.query_params)} if request.query_params else None,
            db=db,
        )
    finally:
        db.close()

    return JSONResponse(
        status_code=500,
        content={"detail": "Ocurrió un error interno del servidor."},
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    if is_reportable_business_error(request.url.path, exc.status_code):
        db = SessionLocal()
        try:
            user = get_user_from_request(db, request)
            log_error(
                source="backend",
                level="warning",
                message=str(exc.detail),
                screen=request.url.path,
                method=request.method,
                status_code=exc.status_code,
                user=user,
                db=db,
            )
        finally:
            db.close()

    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers=getattr(exc, "headers", None),
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    # Errores de validación de Pydantic (body/query mal formados). Se
    # loguean con el mismo criterio de "ruta crítica" que un HTTPException,
    # porque en pagos/clases/cohortes/paquetes suelen indicar un dato mal
    # enviado desde el frontend que vale la pena investigar.
    if is_reportable_business_error(request.url.path, 422):
        db = SessionLocal()
        try:
            user = get_user_from_request(db, request)
            log_error(
                source="backend",
                level="warning",
                message="Error de validación en el request",
                detail=str(exc.errors()),
                screen=request.url.path,
                method=request.method,
                status_code=422,
                user=user,
                db=db,
            )
        finally:
            db.close()

    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors()},
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
