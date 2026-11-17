import cloudinary
import cloudinary.uploader
import cloudinary.api
import os
from dotenv import load_dotenv
import logging
import re
from urllib3 import Timeout

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
    # SEC-06: antes "application/pptx", que no es un MIME real: los .pptx llegan con este y se rechazaban.
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
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


# ─── Validación del contenido real del archivo (magic bytes) ────────────────
# `content_type` es el header Content-Type que declara el cliente dentro del
# multipart/form-data — lo controla por completo quien hace el request (no
# hace falta ni tocar el navegador, alcanza con un curl/Postman). Sin esto,
# cualquiera podía subir un archivo cualquiera (un .html con <script>, un
# ejecutable, etc.) declarando `content_type="image/png"` y pasaba la
# validación de ALL_ALLOWED_TYPES sin problema, porque esa lista solo mira
# lo que dice el cliente.
#
# Acá se compara la firma real de los primeros bytes del archivo (el
# "magic number") contra lo que el cliente declaró. No reemplaza un
# antivirus ni valida que el archivo esté 100% bien formado, pero corta el
# caso más común de "archivo malicioso con content-type falseado" sin
# agregar una dependencia de sistema (libmagic) al Docker image.
def _matches_declared_type(file_bytes: bytes, content_type: str) -> bool:
    # Solo se miran los primeros 16 bytes: basta pasar la cabecera, no el archivo entero.
    head = file_bytes[:16]

    if content_type == "application/pdf":
        return head.startswith(b"%PDF-")

    if content_type == "image/jpeg":
        return head.startswith(b"\xff\xd8\xff")
    if content_type == "image/png":
        return head.startswith(b"\x89PNG\r\n\x1a\n")
    if content_type == "image/gif":
        return head.startswith(b"GIF87a") or head.startswith(b"GIF89a")
    if content_type == "image/webp":
        return head[:4] == b"RIFF" and head[8:12] == b"WEBP"

    if content_type in ("video/mp4", "video/quicktime"):
        # Contenedor ISO-BMFF (mp4/mov): la caja "ftyp" suele arrancar en
        # el byte 4. Algunos .mov viejos arrancan directo con otra caja
        # (moov/mdat/wide/free/skip) sin ftyp — se aceptan también.
        return head[4:8] in (b"ftyp", b"moov", b"mdat", b"wide", b"free", b"skip")

    if content_type in ("audio/mpeg", "audio/mp3"):
        if head[:3] == b"ID3":
            return True
        # Frame header MPEG: byte de sync (0xFF) + versión/capa válidos
        return len(head) >= 2 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0

    if content_type == "application/msword":
        # Formato binario OLE (.doc viejo)
        return head.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1")

    if content_type in (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ):
        # .docx/.pptx son en el fondo un .zip (formato OOXML)
        return head[:4] == b"PK\x03\x04"

    # Tipo no contemplado explícitamente en esta función (no debería pasar:
    # ya se validó contra ALL_ALLOWED_TYPES antes de llegar acá). No
    # bloqueamos por las dudas, para no generar falsos positivos si se
    # agrega un tipo nuevo a la lista de permitidos y se olvida actualizar
    # esta función.
    return True


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

    _validate_upload(file_bytes[:16], len(file_bytes), content_type)
    return _send_to_cloudinary(file_bytes, filename, content_type, folder, display_name)


def _validate_upload(head: bytes, size: int, content_type: str) -> None:
    """Valida tamano y firma (magic bytes) sin necesitar el archivo completo."""
    if not _matches_declared_type(head, content_type):
        raise ValueError(
            "El contenido del archivo no coincide con su tipo declarado. "
            "Verificá que el archivo no esté corrupto o renombrado."
        )

    is_video = content_type in ALLOWED_VIDEO_TYPES
    max_size = MAX_VIDEO_SIZE if is_video else MAX_DOCUMENT_SIZE

    if size > max_size:
        if is_video:
            raise ValueError(
                f"El video supera el tamaño máximo permitido de {MAX_VIDEO_SIZE_MB} MB."
            )
        raise ValueError(
            f"El archivo supera el tamaño máximo permitido de {MAX_DOCUMENT_SIZE_MB} MB."
        )


def upload_file_stream(
    fileobj,
    filename: str,
    content_type: str,
    folder: str = "materials",
    display_name: str | None = None,
) -> dict:
    """
    Igual que upload_file, pero recibe un objeto tipo archivo (p. ej. `UploadFile.file`,
    que Starlette ya guarda en disco si pasa de 1 MB) en vez de bytes: el archivo nunca se
    carga entero en RAM. Valida tamano y firma ANTES de enviar nada, y los videos se suben por
    trozos (`upload_large`).
    """
    if content_type not in ALL_ALLOWED_TYPES:
        raise ValueError(f"Tipo de archivo no permitido: {content_type}")

    fileobj.seek(0, 2)
    size = fileobj.tell()
    fileobj.seek(0)
    head = fileobj.read(16)
    fileobj.seek(0)

    _validate_upload(head, size, content_type)
    return _send_to_cloudinary(fileobj, filename, content_type, folder, display_name)


# Sin esto una subida o un borrado colgado bloquea el hilo para siempre (urllib3 no tiene timeout por defecto).
# `read` es la espera entre bytes recibidos, no la duracion total: no corta subidas grandes que avanzan.
CLOUDINARY_TIMEOUT = Timeout(connect=10, read=float(os.getenv("CLOUDINARY_READ_TIMEOUT_SECONDS", "120")))


def _send_to_cloudinary(data, filename: str, content_type: str, folder: str, display_name: str | None) -> dict:
    """`data` puede ser bytes o un objeto tipo archivo."""
    is_video = content_type in ALLOWED_VIDEO_TYPES
    ext = filename.rsplit(".", 1)[-1] if "." in filename else ""
    base_name = _slugify(display_name) if display_name else _slugify(filename.rsplit(".", 1)[0])
    upload_filename = f"{base_name}.{ext}" if ext else base_name

    try:
        uploader = (
            cloudinary.uploader.upload_large
            if is_video and hasattr(data, "read")
            else cloudinary.uploader.upload
        )
        result = uploader(
            data,
            folder=folder,
            resource_type=_resource_type_for(content_type),
            filename=upload_filename,
            use_filename=True,
            unique_filename=True,
            timeout=CLOUDINARY_TIMEOUT,
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
            resource_type=resource_type,
            timeout=CLOUDINARY_TIMEOUT,
        )
        return result.get("result") == "ok"
    except Exception as e:
        logger.error(f"Error eliminando archivo de Cloudinary: {e}")
        return False