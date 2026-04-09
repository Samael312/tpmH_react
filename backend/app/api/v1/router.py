from fastapi import APIRouter
from app.api.v1.endpoints import (
    auth, users, teachers,
    availability, classes,
    materials, homework,
    admin, reviews, chipi, tts
)


api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["Autenticación"])
api_router.include_router(users.router, prefix="/users", tags=["Usuarios"])
api_router.include_router(teachers.router, prefix="/teachers", tags=["Profesores"])
api_router.include_router(availability.router, prefix="/availability", tags=["Disponibilidad"])
api_router.include_router(classes.router, prefix="/classes", tags=["Clases"])
api_router.include_router(materials.router, prefix="/materials", tags=["Materiales"])
api_router.include_router(homework.router, prefix="/homework", tags=["Tareas"])
api_router.include_router(admin.router, prefix="/admin", tags=["Superadmin"])
api_router.include_router(reviews.router,prefix="/reviews",tags=["Reseñas"])
api_router.include_router(chipi.router, prefix="/chipi", tags=["Chatbot"])
api_router.include_router(tts.router, prefix="/tts", tags=["Text-to-Speech"])