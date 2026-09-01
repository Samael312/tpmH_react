import os
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.base import get_db
from app.models.teacher import TeacherProfile, TeacherStatus
from app.models.user import User
from app.models.review import Review
from app.models.package import Package
from app.schemas.teacher import TeacherPublicResponse
from app.schemas.reviews import ReviewResponse
from app.schemas.packages import PackageResponse
from app.core.platform_config import get_or_create_platform_config, serialize_platform_config
from app.core.cache import cached, cache_invalidate
from app.api.v1.endpoints.teachers import _to_public

router = APIRouter()

# Mismo fallback que ya usaba availability.py — si no hay featured_teacher
# configurado en PlatformConfig, ni FEATURED_TEACHER_USERNAME en el entorno.
FALLBACK_FEATURED_USERNAME = os.getenv("FEATURED_TEACHER_USERNAME", "mar12")

MAX_MULTI_TENANT_TEACHERS = 5

# ── Cache en memoria ──
# Es la única data pública que golpea la DB en cada visita a la landing;
# con un TTL corto evitamos recalcularla en cada request sin arriesgar
# demasiada data desactualizada. Los endpoints que modifican algo que
# aparece en la landing (config de plataforma, estado/perfil/video del
# profesor, paquetes, reseñas) invalidan el cache al guardar, así que
# el TTL es sobre todo un techo de seguridad ante datos que cambian sin
# pasar por esos endpoints.
LANDING_CACHE_KEY = "public:landing"
LANDING_CACHE_TTL_SECONDS = int(os.getenv("LANDING_CACHE_TTL_SECONDS", "60"))


def invalidate_landing_cache() -> None:
    """Llamar desde cualquier endpoint que modifique data que aparece en
    la landing (config, profesores, paquetes, reseñas)."""
    cache_invalidate(LANDING_CACHE_KEY)


class LandingPackageOut(PackageResponse):
    teacher_username: str
    teacher_name: str
    teacher_avatar: Optional[str] = None


class LandingReviewOut(ReviewResponse):
    teacher_username: Optional[str] = None


class LandingResponse(BaseModel):
    platform_name: str
    platform_tagline: Optional[str] = None
    is_single_tenant: bool
    teachers: List[TeacherPublicResponse]
    reviews: List[LandingReviewOut]
    packages: List[LandingPackageOut]


def _display_name(t: TeacherProfile) -> str:
    full = f"{t.name or ''} {t.surname or ''}".strip()
    if full:
        return full
    return (t.user_username or "Profesor").replace("_", " ").replace(".", " ")


@router.get("/landing", response_model=LandingResponse)
def get_landing_data(db: Session = Depends(get_db)):
    """
    Toda la data que necesita la landing page en una sola respuesta:
    configuración de plataforma, profesores, reseñas y paquetes.

    Reemplaza el fan-out que hacía el frontend (1 request de config +
    hasta 1+2×5 requests más en multi-tenant: reviews y packages por
    cada profesor). Acá se resuelve con 3 queries a la base de datos,
    sin importar cuántos profesores haya — y el resultado se cachea
    en memoria por LANDING_CACHE_TTL_SECONDS para no repetir ni esas
    3 queries en cada visita.

    Endpoint público — no requiere autenticación.
    """
    return cached(LANDING_CACHE_KEY, LANDING_CACHE_TTL_SECONDS, lambda: _build_landing_response(db))


def _build_landing_response(db: Session) -> LandingResponse:
    config = get_or_create_platform_config(db)
    cfg_data = serialize_platform_config(db, config)
    is_single_tenant = bool(cfg_data["is_single_tenant"])

    if is_single_tenant:
        username = (cfg_data["featured_teacher"] or {}).get("username") or FALLBACK_FEATURED_USERNAME
        teacher_profiles = db.query(TeacherProfile).join(
            User, TeacherProfile.user_id == User.id
        ).filter(
            TeacherProfile.user_username == username,
            TeacherProfile.status == TeacherStatus.approved,
            User.is_test_account.is_(False),
        ).all()
    else:
        teacher_profiles = (
            db.query(TeacherProfile)
            .join(User, TeacherProfile.user_id == User.id)
            .filter(
                TeacherProfile.status == TeacherStatus.approved,
                User.is_test_account.is_(False),
            )
            # ORDER BY random() en vez de id.asc(): así no son siempre los
            # mismos 5 primeros que se registraron — la muestra rota en
            # cada refresco del cache (LANDING_CACHE_TTL_SECONDS), dando
            # visibilidad pareja a todos los profesores aprobados.
            .order_by(func.random())
            .limit(MAX_MULTI_TENANT_TEACHERS)
            .all()
        )

    teacher_ids = [t.id for t in teacher_profiles]
    teacher_by_id = {t.id: t for t in teacher_profiles}
    teachers_out = [_to_public(t) for t in teacher_profiles]

    # ── Reseñas de todos los profesores en una sola query ──
    reviews_out: List[LandingReviewOut] = []
    if teacher_ids:
        reviews = (
            db.query(Review)
            .filter(Review.teacher_id.in_(teacher_ids))
            .order_by(Review.created_at.desc())
            .all()
        )
        for r in reviews:
            # Reseñas legacy cargadas vía Modo Dios pueden no tener
            # student_id (el alumno no tiene cuenta en este sistema) —
            # en ese caso se muestra legacy_student_name en su lugar.
            if r.student_id and r.student and r.student.user:
                student_user = r.student.user
                student_name = f"{student_user.name} {student_user.surname}"
                student_username = student_user.username
            else:
                student_name = r.legacy_student_name
                student_username = None
            reviews_out.append(LandingReviewOut(
                id=r.id,
                teacher_id=r.teacher_id,
                student_id=r.student_id,
                rating=r.rating,
                comment=r.comment,
                created_at=r.created_at,
                student_name=student_name,
                student_username=student_username,
                is_legacy=r.is_legacy,
                legacy_student_name=r.legacy_student_name,
                teacher_username=teacher_by_id[r.teacher_id].user_username,
            ))

    # ── Paquetes activos de todos los profesores en una sola query ──
    packages_out: List[LandingPackageOut] = []
    if teacher_ids:
        packages = (
            db.query(Package)
            .filter(Package.teacher_id.in_(teacher_ids), Package.is_active == True)
            .all()
        )
        for p in packages:
            t = teacher_by_id[p.teacher_id]
            packages_out.append(LandingPackageOut(
                **PackageResponse.model_validate(p).model_dump(),
                teacher_username=t.user_username,
                teacher_name=_display_name(t),
                teacher_avatar=t.profile_photo_url,
            ))

    return LandingResponse(
        platform_name=cfg_data["platform_name"] or "TuProfeMaria",
        platform_tagline=cfg_data["platform_tagline"],
        is_single_tenant=is_single_tenant,
        teachers=teachers_out,
        reviews=reviews_out,
        packages=packages_out,
    )
