from sqlalchemy.orm import Session
from app.models.payment_config import PlatformConfig
from app.models.teacher import TeacherProfile


# ─── Contenido editable del landing (mini-CMS, N3) ──────────────────────────
# Estos son los textos que se mostraban hardcodeados en LandingPageClient.tsx.
# Un admin los puede sobreescribir desde /admin/settings; lo que no
# sobreescribe cae acá. Los campos "_single"/"_multi" varían según
# is_single_tenant — el resto es igual en ambos modos.
LANDING_CONTENT_DEFAULTS: dict = {
    "hero_title_single": "Aprende idiomas a tu ritmo",
    "hero_title_multi": "El conocimiento que buscas, como tú lo prefieres",
    "about_label_single": "Sobre mí",
    "about_label_multi": "Nuestro equipo",
    "about_title_single": "Conoceme un poco mejor",
    "about_title_multi": "Conoce a nuestros profesores",
    "about_description_single": (
        "Una apasionada del idioma con años de experiencia enseñando a "
        "estudiantes de todos los niveles y países."
    ),
    "about_description_multi": (
        "Un equipo de profesores certificados, cada uno con su propia "
        "especialidad, listos para acompañarte."
    ),
    "videos_title_single": "Escucha a tu profesora",
    "videos_title_multi": "Escucha a nuestros profesores",
    "videos_subtitle": "Antes de reservar tu clase, mira quién estará al otro lado de la pantalla.",
    "plans_label": "Planes y precios",
    "plans_title": "Elige tu plan",
    "plans_subtitle": "Sin contratos. Sin letra pequeña. Solo aprendizaje.",
    "group_plans_title": "Aprende en grupo, paga menos",
    "group_plans_subtitle_single": (
        "Comparte la clase con otros estudiantes de tu nivel y ahorra "
        "frente al plan individual."
    ),
    "group_plans_subtitle_multi": (
        "Varios de nuestros profesores arman grupos reducidos por nivel e "
        "idioma. Comparten la clase, comparten el precio."
    ),
    "group_steps": [
        {
            "title": "Te inscribes",
            "desc": "Eliges un paquete grupal y reservas tu cupo. Cada grupo tiene un mínimo y un máximo de alumnos.",
        },
        {
            "title": "Se completa el grupo",
            "desc": "Cuando se alcanza el mínimo de estudiantes, el horario del grupo queda confirmado para todos.",
        },
        {
            "title": "Empiezan las clases",
            "desc": "Si el grupo no se llega a completar, siempre puedes pasar tu cupo a clases individuales.",
        },
    ],
    "reviews_title_single": "Lo que dicen mis alumnos",
    "reviews_title_multi": "Historias de Éxito",
    "reviews_subtitle": "Personas reales, resultados reales.",
    "cta_title": "¿Listo para empezar?",
    "cta_subtitle": "Tu primera clase de prueba es gratuita. Sin compromisos, sin tarjeta de crédito.",
    "footer_tagline": "Empoderando estudiantes",
    # Mapa campo_de_título -> id de gradiente predefinido (ver
    # frontend/lib/gradientTitle.tsx). Las palabras a resaltar se marcan
    # directamente en el texto de cada campo con {{palabra}}; acá solo se
    # guarda qué gradiente aplica a cada campo (o ninguno).
    "title_gradients": {},
}


def get_landing_content(config: PlatformConfig) -> dict:
    """Defaults + lo que el admin haya sobreescrito en config.landing_content.
    Nunca falta ninguna clave (aunque el admin solo haya guardado un
    subconjunto, o la fila sea vieja y landing_content sea None)."""
    merged = dict(LANDING_CONTENT_DEFAULTS)
    overrides = config.landing_content or {}
    for key, value in overrides.items():
        if value is not None and value != "":
            merged[key] = value
    return merged


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
        "show_teacher_whatsapp": config.show_teacher_whatsapp,
        "chat_enabled": config.chat_enabled,
        "chat_retention_days": config.chat_retention_days,
        "chat_reactivation_hours": config.chat_reactivation_hours,
        "landing_content": get_landing_content(config),
    }
