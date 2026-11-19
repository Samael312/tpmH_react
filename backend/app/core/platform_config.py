from typing import Optional

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


_SESSION_KEY = "platform_config"


def get_platform_config(db: Session) -> Optional[PlatformConfig]:
    """
    La fila única de PlatformConfig, leída UNA vez por sesión (= por petición) (Fase 14, E9).

    `db.query(PlatformConfig).first()` no usa el identity map (no es por clave primaria), así
    que cada llamada era una consulta: una reserva la leía 5 veces. Se guarda en `db.info` y se
    reutiliza mientras el objeto siga en esa sesión. Tras un commit sus atributos caducan y el
    siguiente acceso los recarga por clave primaria, así que nunca se lee un valor viejo de otra
    petición. No se memoriza el "no hay fila" (BD recién creada): se vuelve a mirar.
    """
    cached = db.info.get(_SESSION_KEY)
    if cached is not None and cached in db:
        return cached
    config = db.query(PlatformConfig).first()
    if config is not None:
        db.info[_SESSION_KEY] = config
    return config


def get_or_create_platform_config(db: Session) -> PlatformConfig:
    """Devuelve la fila (única) de configuración de plataforma, creándola
    con valores default si todavía no existe."""
    config = get_platform_config(db)
    if not config:
        config = PlatformConfig()
        db.add(config)
        db.commit()
        db.refresh(config)
        db.info[_SESSION_KEY] = config
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


# ─── Single-tenant: la plataforma gestiona solo las clases de la profesora destacada ───

def resolve_featured_teacher(db: Session, config: Optional[PlatformConfig] = None) -> Optional[TeacherProfile]:
    """La profesora destacada: la guardada en PlatformConfig o, si no hay, FEATURED_TEACHER_USERNAME del entorno.

    Es la misma resolución que usan la reserva, el estado de reserva y la landing; el cambio de modo la usa
    también para no perder a los alumnos cuando la destacada venía del entorno.
    """
    from app.core.config import settings

    config = config if config is not None else get_platform_config(db)
    if config and config.featured_teacher_id:
        teacher = db.get(TeacherProfile, config.featured_teacher_id)
        if teacher:
            return teacher
    username = settings.FEATURED_TEACHER_USERNAME
    if not username:
        return None
    return db.query(TeacherProfile).filter(TeacherProfile.user_username == username).first()


def ensure_featured_teacher_in_single_tenant(db: Session, teacher_id: int) -> None:
    """En single-tenant solo se agenda, compra o inscribe con la destacada (400 si es otro profesor).

    Sirve para lo que llega con un enrollment, paquete o grupo de otro profesor (p. ej. de una etapa multi
    anterior): esos créditos quedan para cuando la plataforma vuelva a multi o para un reembolso.
    """
    from fastapi import HTTPException, status

    config = get_platform_config(db)
    if not config or not config.is_single_tenant:
        return
    featured = resolve_featured_teacher(db, config)
    if featured is None or featured.id != teacher_id:
        name = (featured.user.name if featured and featured.user and featured.user.name else None) or "la profesora principal"
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"La plataforma solo gestiona las clases de {name}; no se puede agendar ni comprar con otro profesor.",
        )
