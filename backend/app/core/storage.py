import cloudinary
import cloudinary.uploader
import cloudinary.api
import os
from dotenv import load_dotenv
import logging
import re

load_dotenv()
logger = logging.getLogger(__name__)

cloudinary.config(
    cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"),
    api_key=os.getenv("CLOUDINARY_API_KEY"),
    api_secret=os.getenv("CLOUDINARY_API_SECRET"),
    secure=True
)

ALLOWED_DOCUMENT_TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/pptx"
}

ALLOWED_AUDIO_TYPES = {
    "audio/mpeg",
    "audio/mp3",
}

ALLOWED_IMAGE_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
}

ALLOWED_VIDEO_TYPES = {
    "video/mp4",
    "video/quicktime",
}

ALL_ALLOWED_TYPES = (
    ALLOWED_DOCUMENT_TYPES |
    ALLOWED_IMAGE_TYPES |
    ALLOWED_VIDEO_TYPES |
    ALLOWED_AUDIO_TYPES
)

# ─── Límites de tamaño por tipo de archivo ───────────────────────────────────
# Documentos, imágenes y audio (materiales de estudio): 10 MB.
MAX_DOCUMENT_SIZE_MB = 10
MAX_DOCUMENT_SIZE = MAX_DOCUMENT_SIZE_MB * 1024 * 1024

# Videos de presentación de profesor: configurable por entorno, según el
# límite real del plan de Cloudinary contratado. Por defecto 100 MB.
MAX_VIDEO_SIZE_MB = int(os.getenv("MAX_VIDEO_UPLOAD_MB", "100"))
MAX_VIDEO_SIZE = MAX_VIDEO_SIZE_MB * 1024 * 1024

# NOTA: si en el futuro se necesitan videos por encima de este límite
# práctico, el siguiente paso sería usar cloudinary.uploader.upload_large
# (subida chunked) en vez de cloudinary.uploader.upload. No implementado
# en esta iteración porque MAX_VIDEO_SIZE_MB=100 no lo requiere.


def _slugify(text: str) -> str:
    text = text.strip().lower()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s]+", "-", text)
    return text[:80] or "material"  


def _resource_type_for(content_type: str) -> str:
    """
    Determina el resource_type correcto de Cloudinary según el content_type.
    Crítico para video: si se sube con resource_type="auto" (o "raw"),
    Cloudinary puede aplicarle el límite de tamaño de imagen/raw del plan
    (mucho más bajo) en vez del límite específico para video.
    """
    if content_type in ALLOWED_VIDEO_TYPES:
        return "video"
    if content_type in ALLOWED_IMAGE_TYPES:
        return "image"
    # Documentos y audio: dejamos que Cloudinary lo determine, pero
    # nunca aplica aquí el límite de video.
    return "auto"


def upload_file(
    file_bytes: bytes,
    filename: str,
    content_type: str,
    folder: str = "materials",
    display_name: str | None = None
) -> dict:
    if content_type not in ALL_ALLOWED_TYPES:
        raise ValueError(f"Tipo de archivo no permitido: {content_type}")

    is_video = content_type in ALLOWED_VIDEO_TYPES
    max_size = MAX_VIDEO_SIZE if is_video else MAX_DOCUMENT_SIZE

    if len(file_bytes) > max_size:
        if is_video:
            raise ValueError(
                f"El video supera el tamaño máximo permitido de {MAX_VIDEO_SIZE_MB} MB."
            )
        raise ValueError(
            f"El archivo supera el tamaño máximo permitido de {MAX_DOCUMENT_SIZE_MB} MB."
        )

    ext = filename.rsplit(".", 1)[-1] if "." in filename else ""
    base_name = _slugify(display_name) if display_name else _slugify(filename.rsplit(".", 1)[0])
    upload_filename = f"{base_name}.{ext}" if ext else base_name

    try:
        result = cloudinary.uploader.upload(
            file_bytes,
            folder=folder,
            resource_type=_resource_type_for(content_type),
            filename=upload_filename,
            use_filename=True,
            unique_filename=True,
        )

        return {
            "url": result["secure_url"],
            "public_id": result["public_id"],
            "resource_type": result.get("resource_type", "auto"),
            "format": result.get("format", ""),
            "size_bytes": result.get("bytes", 0),
        }

    except Exception as e:
        logger.error(f"Error subiendo archivo a Cloudinary: {e}")
        raise ValueError(f"Error al subir el archivo: {str(e)}")


def delete_file(public_id: str, resource_type: str = "image") -> bool:
    try:
        result = cloudinary.uploader.destroy(
            public_id,
            resource_type=resource_type
        )
        return result.get("result") == "ok"
    except Exception as e:
        logger.error(f"Error eliminando archivo de Cloudinary: {e}")
        return False