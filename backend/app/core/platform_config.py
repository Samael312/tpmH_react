from sqlalchemy.orm import Session
from app.models.payment_config import PlatformConfig
from app.models.teacher import TeacherProfile


def get_or_create_platform_config(db: Session) -> PlatformConfig:
    """Devuelve la fila (única) de configuración de plataforma, creándola
    con valores default si todavía no existe."""
    config = db.query(PlatformConfig).first()
    if not config:
        config = PlatformConfig()
        db.add(config)
        db.commit()
        db.refresh(config)
    return config


def serialize_platform_config(db: Session, config: PlatformConfig) -> dict:
    """Convierte PlatformConfig al dict público que ya consumía el
    frontend desde /admin/platform-config. Extraído para poder
    reutilizarlo también en el endpoint agregado de landing."""
    featured_teacher = None
    if config.featured_teacher_id:
        teacher = db.query(TeacherProfile).filter(
            TeacherProfile.id == config.featured_teacher_id
        ).first()
        if teacher:
            featured_teacher = {
                "username": teacher.user_username,
                "name": f"{teacher.user.name} {teacher.user.surname}",
                "title": teacher.title,
                "bio": teacher.bio,
                "avatar": teacher.user.avatar,
                "subjects": teacher.subjects,
            }

    return {
        "platform_name": config.platform_name,
        "platform_tagline": config.platform_tagline,
        "is_single_tenant": config.is_single_tenant,
        "featured_teacher": featured_teacher,
    }
