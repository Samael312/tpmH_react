import cloudinary
import cloudinary.uploader
import cloudinary.api
import os
from dotenv import load_dotenv
import logging

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
    ALLOWED_VIDEO_TYPES
)

# Tamaño máximo: 50MB
MAX_FILE_SIZE = 50 * 1024 * 1024


def upload_file(
    file_bytes: bytes,
    filename: str,
    content_type: str,
    folder: str = "materials",
) -> dict:
    """
    Sube un archivo a Cloudinary.

    Args:
        file_bytes: contenido del archivo
        filename: nombre original del archivo
        content_type: MIME type del archivo
        folder: carpeta en Cloudinary

    Returns:
        dict con url, public_id y resource_type
    """

    if content_type not in ALL_ALLOWED_TYPES:
        raise ValueError(f"Tipo de archivo no permitido: {content_type}")

    if len(file_bytes) > MAX_FILE_SIZE:
        raise ValueError("El archivo supera el tamaño máximo de 50MB")

    # Determinar resource_type para Cloudinary
    if content_type in ALLOWED_IMAGE_TYPES:
        resource_type = "image"
    elif content_type in ALLOWED_VIDEO_TYPES:
        resource_type = "video"
    else:
        resource_type = "raw"  # PDFs y documentos

    try:
        result = cloudinary.uploader.upload(
            file_bytes,
            folder=folder,
            resource_type=resource_type,
            use_filename=True,
            unique_filename=True,
        )

        return {
            "url": result["secure_url"],
            "public_id": result["public_id"],
            "resource_type": resource_type,
            "format": result.get("format", ""),
            "size_bytes": result.get("bytes", 0),
        }

    except Exception as e:
        logger.error(f"Error subiendo archivo a Cloudinary: {e}")
        raise ValueError(f"Error al subir el archivo: {str(e)}")


def delete_file(public_id: str, resource_type: str = "raw") -> bool:
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