from openai import AsyncOpenAI
from app.core.config import settings
from app.core.storage import upload_file
from app.core.spoken_languages import language_key
import hashlib
import os
import logging
from starlette.concurrency import run_in_threadpool

logger = logging.getLogger(__name__)

# El valor por defecto del SDK es 600 s y 2 reintentos: una respuesta colgada dejaria la peticion abierta muchos minutos.
client = AsyncOpenAI(
    api_key=settings.OPENAI_API_KEY,
    timeout=float(os.getenv("OPENAI_TIMEOUT_SECONDS", "30")),
    max_retries=1,
)

# Voces disponibles en OpenAI TTS
# alloy, echo, fable, onyx, nova, shimmer
DEFAULT_VOICE = "nova"       # Voz femenina natural — ideal para inglés
DEFAULT_SPEED = 0.9          # Ligeramente más lento para aprendizaje

# Sin idioma: `tts-1`, que solo recibe la palabra y adivina el idioma (bien en inglés; una palabra suelta en otro
# idioma suena con fonética inglesa). Con idioma: un modelo que acepta `instructions` para fijar la pronunciación.
LEGACY_MODEL = "tts-1"
LANGUAGE_MODEL = "gpt-4o-mini-tts"

# El catálogo de idiomas (`spoken_languages`) está en español; la instrucción se da en inglés. Un idioma que el
# administrador añada al catálogo y no esté aquí se pasa tal cual (el modelo entiende «Catalán», «Hindi»…).
_ENGLISH_NAMES = {
    "espanol": "Spanish", "ingles": "English", "portugues": "Portuguese", "frances": "French",
    "italiano": "Italian", "aleman": "German", "chino": "Chinese (Mandarin)", "arabe": "Arabic",
    "ruso": "Russian", "japones": "Japanese", "coreano": "Korean", "neerlandes": "Dutch",
}

# Caché en memoria por sesión del servidor
# Mapea: hash(palabra+voz+velocidad[+idioma]) → url de Cloudinary
_audio_cache: dict[str, str] = {}


def _clean_language(language: str | None) -> str | None:
    """Idioma sin espacios sobrantes; vacío o nulo -> None (comportamiento anterior)."""
    language = (language or "").strip()
    return language or None


def english_language_name(language: str) -> str:
    """Nombre en inglés de un idioma del catálogo, para la instrucción del TTS."""
    return _ENGLISH_NAMES.get(language_key(language), language.strip())


def _get_cache_key(word: str, voice: str, speed: float, language: str | None = None) -> str:
    """
    Genera una clave única para cada combinación de palabra + voz + velocidad (+ idioma).
    Usamos hash para tener claves cortas y consistentes. Sin idioma la clave es la de siempre (los audios ya
    generados se siguen reutilizando); con idioma, la misma palabra en dos idiomas no comparte audio.
    """
    raw = f"{word.lower().strip()}_{voice}_{speed}"
    language = _clean_language(language)
    if language:
        raw += f"_{language_key(language)}"
    return hashlib.md5(raw.encode()).hexdigest()


def count_cached(words: list[str], voice: str = DEFAULT_VOICE, speed: float = DEFAULT_SPEED,
                 language: str | None = None) -> int:
    """Cuantas de estas palabras ya tienen audio en cache (consultar ANTES de generar, para informar cached)."""
    return sum(1 for w in words if _get_cache_key(w, voice, speed, language) in _audio_cache)


async def generate_word_audio(
    word: str,
    voice: str = DEFAULT_VOICE,
    speed: float = DEFAULT_SPEED,
    language: str | None = None,
) -> str:
    """
    Genera audio de alta calidad para una palabra usando OpenAI TTS.
    Cachea el resultado en Cloudinary para no regenerar.

    Args:
        word: la palabra a pronunciar
        voice: voz de OpenAI (nova, alloy, echo, fable, onyx, shimmer)
        speed: velocidad (0.25 - 4.0)
        language: idioma de la palabra (nombre del catálogo, p. ej. "Español"). Opcional: sin él se usa el
            modelo de siempre.

    Returns:
        URL del audio en Cloudinary

    Cost note:
        OpenAI TTS cuesta ~$0.015 por 1000 caracteres
        Una palabra promedio = 6 chars = $0.00009
        1000 palabras únicas = ~$0.09
        Con caché solo pagas una vez por palabra
    """
    language = _clean_language(language)
    cache_key = _get_cache_key(word, voice, speed, language)

    # 1. Revisar caché en memoria
    if cache_key in _audio_cache:
        logger.info(f"TTS cache hit (memory): {word}")
        return _audio_cache[cache_key]

    # 2. Generar con OpenAI TTS
    try:
        logger.info(f"Generando TTS para: '{word}' voz={voice} speed={speed} idioma={language}")

        request = {"voice": voice, "input": word, "speed": speed}
        if language:
            name = english_language_name(language)
            request["model"] = LANGUAGE_MODEL
            request["instructions"] = (
                f"Pronounce this single {name} word clearly and naturally, with a native {name} accent. "
                "Say only the word, nothing else."
            )
        else:
            request["model"] = LEGACY_MODEL  # tts-1 = rápido y económico
        response = await client.audio.speech.create(**request)

        # 3. Obtener los bytes del audio
        audio_bytes = response.content

        # 4. Subir a Cloudinary
        # upload_file es sincrono (Cloudinary): en un hilo para no bloquear el bucle de eventos (Fase 21).
        upload_result = await run_in_threadpool(
            upload_file,
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
    language: str | None = None,
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
        cache_key = _get_cache_key(word, voice, speed, language)
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
        generate_word_audio(word, voice, speed, language)
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