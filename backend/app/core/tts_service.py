from openai import AsyncOpenAI
from app.core.config import settings
from app.core.storage import upload_file
import hashlib
import logging

logger = logging.getLogger(__name__)

client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

# Voces disponibles en OpenAI TTS
# alloy, echo, fable, onyx, nova, shimmer
DEFAULT_VOICE = "nova"       # Voz femenina natural — ideal para inglés
DEFAULT_SPEED = 0.9          # Ligeramente más lento para aprendizaje

# Caché en memoria por sesión del servidor
# Mapea: hash(palabra+voz) → url de Cloudinary
_audio_cache: dict[str, str] = {}


def _get_cache_key(word: str, voice: str, speed: float) -> str:
    """
    Genera una clave única para cada combinación de palabra + voz + velocidad.
    Usamos hash para tener claves cortas y consistentes.
    """
    raw = f"{word.lower().strip()}_{voice}_{speed}"
    return hashlib.md5(raw.encode()).hexdigest()


async def generate_word_audio(
    word: str,
    voice: str = DEFAULT_VOICE,
    speed: float = DEFAULT_SPEED,
) -> str:
    """
    Genera audio de alta calidad para una palabra usando OpenAI TTS.
    Cachea el resultado en Cloudinary para no regenerar.

    Args:
        word: la palabra a pronunciar
        voice: voz de OpenAI (nova, alloy, echo, fable, onyx, shimmer)
        speed: velocidad (0.25 - 4.0)

    Returns:
        URL del audio en Cloudinary

    Cost note:
        OpenAI TTS cuesta ~$0.015 por 1000 caracteres
        Una palabra promedio = 6 chars = $0.00009
        1000 palabras únicas = ~$0.09
        Con caché solo pagas una vez por palabra
    """
    cache_key = _get_cache_key(word, voice, speed)

    # 1. Revisar caché en memoria
    if cache_key in _audio_cache:
        logger.info(f"TTS cache hit (memory): {word}")
        return _audio_cache[cache_key]

    # 2. Generar con OpenAI TTS
    try:
        logger.info(f"Generando TTS para: '{word}' voz={voice} speed={speed}")

        response = await client.audio.speech.create(
            model="tts-1",          # tts-1 = rápido y económico
            voice=voice,            # tts-1-hd = mayor calidad pero más caro
            input=word,
            speed=speed,
        )

        # 3. Obtener los bytes del audio
        audio_bytes = response.content

        # 4. Subir a Cloudinary
        upload_result = upload_file(
            file_bytes=audio_bytes,
            filename=f"{cache_key}.mp3",
            content_type="audio/mpeg",
            folder="tts_cache",
        )

        url = upload_result["url"]

        # 5. Guardar en caché de memoria
        _audio_cache[cache_key] = url

        return url

    except Exception as e:
        logger.error(f"Error generando TTS para '{word}': {e}")
        raise ValueError(f"No se pudo generar el audio para '{word}'")


async def generate_batch_audio(
    words: list[str],
    voice: str = DEFAULT_VOICE,
    speed: float = DEFAULT_SPEED,
) -> dict[str, str]:
    """
    Genera audio para múltiples palabras de forma eficiente.
    Solo genera las que no están en caché.

    Returns:
        dict: {"apple": "https://...", "banana": "https://...", ...}
    """
    result = {}
    words_to_generate = []

    # Separar palabras en caché vs nuevas
    for word in words:
        cache_key = _get_cache_key(word, voice, speed)
        if cache_key in _audio_cache:
            result[word] = _audio_cache[cache_key]
        else:
            words_to_generate.append(word)

    logger.info(
        f"TTS batch: {len(result)} en caché, "
        f"{len(words_to_generate)} a generar"
    )

    # Generar las que faltan
    import asyncio
    tasks = [
        generate_word_audio(word, voice, speed)
        for word in words_to_generate
    ]

    if tasks:
        audio_urls = await asyncio.gather(*tasks, return_exceptions=True)

        for word, url_or_error in zip(words_to_generate, audio_urls):
            if isinstance(url_or_error, Exception):
                logger.error(f"Error con '{word}': {url_or_error}")
                result[word] = None  # null en la respuesta
            else:
                result[word] = url_or_error

    return result