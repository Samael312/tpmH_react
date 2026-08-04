import cloudinary
import cloudinary.uploader
import cloudinary.api
import os
from dotenv import load_dotenv
import logging
import re

load_dotenv()
logger = logging.getLogger(__name__)

# Configuración de Cloudinary
cloudinary.config(
    cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"),
    api_key=os.getenv("CLOUDINARY_API_KEY"),
    api_secret=os.getenv("CLOUDINARY_API_SECRET"),
    secure=True
)

# Tipos de archivo permitidos por categoría
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

# Tamaño máximo: 150MB
MAX_FILE_SIZE = 150 * 1024 * 1024

def _slugify(text: str) -> str:
    """Convierte un texto en un nombre de archivo seguro para Cloudinary"""
    text = text.strip().lower()
    text = re.sub(r"[^\w\s-]", "", text)      # quita caracteres raros
    text = re.sub(r"[\s]+", "-", text)        # espacios -> guiones
    return text[:80] or "material"  

def upload_file(
    file_bytes: bytes,
    filename: str,
    content_type: str,
    folder: str = "materials",
    display_name: str | None = None
) -> dict:
    """
    Sube un archivo a Cloudinary.

    Args:
        file_bytes: contenido del archivo
        filename: nombre original del archivo
        content_type: MIME type del archivo
        folder: carpeta en Cloudinary
        display_name: nombre para mostrar del archivo

    Returns:
        dict con url, public_id y resource_type
    """

    if content_type not in ALL_ALLOWED_TYPES:
        raise ValueError(f"Tipo de archivo no permitido: {content_type}")

    if len(file_bytes) > MAX_FILE_SIZE:
        raise ValueError("El archivo supera el tamaño máximo de 150MB")

    ext = filename.rsplit(".", 1)[-1] if "." in filename else ""
    base_name = _slugify(display_name) if display_name else _slugify(filename.rsplit(".", 1)[0])
    upload_filename = f"{base_name}.{ext}" if ext else base_name

    try:
        # Usar resource_type="auto" permite que Cloudinary detecte 
        # correctamente los PDFs (como imágenes/documentos con extensión)
        result = cloudinary.uploader.upload(
            file_bytes,
            folder=folder,
            resource_type="auto",
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
    """
    Elimina un archivo de Cloudinary.

    Returns:
        True si se eliminó correctamente
    """
    try:
        result = cloudinary.uploader.destroy(
            public_id,
            resource_type=resource_type
        )
        return result.get("result") == "ok"
    except Exception as e:
        logger.error(f"Error eliminando archivo de Cloudinary: {e}")
        return False