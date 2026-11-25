from openai import AsyncOpenAI
from app.core.config import settings
from app.core.storage import upload_file
from app.core.spoken_languages import language_key
import asyncio
import hashlib
import io
import os
import logging
import base64
import weakref
import wave
from starlette.concurrency import run_in_threadpool

logger = logging.getLogger(__name__)

# El valor por defecto del SDK es 600 s y 2 reintentos: una respuesta colgada dejaria la peticion abierta muchos minutos.
client = AsyncOpenAI(
    api_key=settings.OPENAI_API_KEY,
    timeout=float(os.getenv("OPENAI_TIMEOUT_SECONDS", "30")),
    max_retries=1,
)

# Voces que acepta nuestra API (esquema `TTS_VOICES`).
# alloy, echo, fable, onyx, nova, shimmer
DEFAULT_VOICE = "nova"       # Voz femenina natural — ideal para inglés
# Solo forma parte de la clave de caché: la API Realtime no usa la velocidad (probado: sin efecto claro en la duración).
DEFAULT_SPEED = 0.9

# OpenAI apaga `tts-1`, `tts-1-hd` y `gpt-4o-mini-tts` el 2027-01-06. El sustituto es un modelo Realtime: una sesión
# (WebSocket) por palabra, solo audio. Se puede cambiar por entorno sin tocar el código.
REALTIME_MODEL = os.getenv("TTS_REALTIME_MODEL", "gpt-realtime-2.1-mini")
# Mismas voces que ya ofrecía la API; las que Realtime no tiene se sustituyen por la más parecida.
_REALTIME_VOICES = {"nova": "marin", "onyx": "cedar", "fable": "verse", "alloy": "alloy", "echo": "echo", "shimmer": "shimmer"}
PCM_SAMPLE_RATE = 24000      # Realtime devuelve PCM de 16 bits, mono, a 24 kHz

# Sesiones Realtime simultáneas en todo el servidor. El resto de palabras espera su turno (cola de N en N): un lote de 20
# palabras se genera de 5 en 5. Más sesiones a la vez agotarían los límites de OpenAI y no acelerarían de forma útil.
TTS_MAX_CONCURRENCY = max(1, int(os.getenv("TTS_MAX_CONCURRENCY", "5")))
# Tiempo máximo de una palabra (abrir sesión + generar) y reintentos ante un fallo de red o de la sesión.
TTS_WORD_TIMEOUT_SECONDS = float(os.getenv("TTS_WORD_TIMEOUT_SECONDS", "45"))
TTS_WORD_ATTEMPTS = max(1, int(os.getenv("TTS_WORD_ATTEMPTS", "2")))

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

# Un semáforo por bucle de eventos (en producción hay uno solo; las pruebas crean varios con asyncio.run).
_semaphores: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore]" = weakref.WeakKeyDictionary()


def _semaphore() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    sem = _semaphores.get(loop)
    if sem is None:
        sem = _semaphores[loop] = asyncio.Semaphore(TTS_MAX_CONCURRENCY)
    return sem


def _clean_language(language: str | None) -> str | None:
    """Idioma sin espacios sobrantes; vacío o nulo -> None (la palabra se dice en su propio idioma)."""
    language = (language or "").strip()
    return language or None


def english_language_name(language: str) -> str:
    """Nombre en inglés de un idioma del catálogo, para la instrucción del TTS."""
    return _ENGLISH_NAMES.get(language_key(language), language.strip())


def realtime_voice(voice: str) -> str:
    """Voz Realtime equivalente a una voz de nuestra API."""
    return _REALTIME_VOICES.get(voice, "marin")


def _instructions(language: str | None) -> str:
    """Instrucción de sesión: dice SOLO la palabra, una vez, con acento nativo."""
    if language:
        name = english_language_name(language)
        return (
            f"You are a pronunciation tool. The user sends one {name} word. Say ONLY that word, once, clearly and "
            f"naturally, with a native {name} accent. Never add anything else."
        )
    return (
        "You are a pronunciation tool. The user sends one word. Say ONLY that word, once, clearly and naturally, "
        "in the language the word belongs to, with a native accent. Never add anything else."
    )


def pcm_to_wav(pcm: bytes, sample_rate: int = PCM_SAMPLE_RATE) -> bytes:
    """PCM de 16 bits mono -> archivo WAV (lo reproduce cualquier navegador con <audio>, sin librerías extra)."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm)
    return buf.getvalue()


def _get_cache_key(word: str, voice: str, speed: float, language: str | None = None) -> str:
    """
    Genera una clave única para cada combinación de palabra + voz + velocidad (+ idioma).
    Usamos hash para tener claves cortas y consistentes. Sin idioma la clave es la de siempre; con idioma, la misma
    palabra en dos idiomas no comparte audio.
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


async def _synthesize_pcm(word: str, voice: str, language: str | None) -> bytes:
    """Una sesión Realtime (solo audio) que dice la palabra. Devuelve el PCM de 16 bits a 24 kHz."""
    pcm = bytearray()
    async with client.realtime.connect(model=REALTIME_MODEL) as conn:
        await conn.session.update(session={
            "type": "realtime",
            "model": REALTIME_MODEL,
            "output_modalities": ["audio"],
            "instructions": _instructions(language),
            "audio": {"output": {"voice": realtime_voice(voice),
                                 "format": {"type": "audio/pcm", "rate": PCM_SAMPLE_RATE}}},
        })
        await conn.conversation.item.create(item={
            "type": "message", "role": "user", "content": [{"type": "input_text", "text": word}],
        })
        await conn.response.create()
        async for event in conn:
            kind = event.type
            if kind in ("response.output_audio.delta", "response.audio.delta"):
                pcm += base64.b64decode(event.delta)
            elif kind == "response.done":
                response = event.response
                if getattr(response, "status", "completed") not in ("completed", None):
                    raise RuntimeError(f"La respuesta de audio terminó con estado {response.status}")
                break
            elif kind == "error":
                raise RuntimeError(f"Error de la sesión Realtime: {getattr(event, 'error', event)}")
    if not pcm:
        raise RuntimeError("La sesión Realtime no devolvió audio")
    return bytes(pcm)


async def generate_word_audio(
    word: str,
    voice: str = DEFAULT_VOICE,
    speed: float = DEFAULT_SPEED,
    language: str | None = None,
) -> str:
    """
    Genera audio para una palabra con la API Realtime de OpenAI (sesión por palabra, solo audio, formato WAV).
    Cachea el resultado en Cloudinary para no regenerar.

    Args:
        word: la palabra a pronunciar
        voice: voz de nuestra API (nova, alloy, echo, fable, onyx, shimmer); se traduce a una voz Realtime
        speed: no se usa en la generación (solo en la clave de caché)
        language: idioma de la palabra (nombre del catálogo, p. ej. "Español"). Opcional: sin él la palabra se dice
            en su propio idioma.

    Returns:
        URL del audio en Cloudinary

    Concurrencia: a la vez hay como mucho `TTS_MAX_CONCURRENCY` sesiones en todo el servidor; el resto espera turno.

    Cost note (precios de OpenAI a 2026-11-25 para gpt-realtime-2.1-mini, por 1M de tokens: texto de entrada $0.60,
    texto de salida $2.40, audio de salida $20; ~20 tokens de audio por segundo):
        Medido con palabras sueltas: ~$0.00038 por palabra (~$0.38 por 1000 palabras únicas).
        Con caché solo se paga una vez por palabra e idioma. No hay cargo aparte por abrir la sesión.
    """
    language = _clean_language(language)
    cache_key = _get_cache_key(word, voice, speed, language)

    # 1. Revisar caché en memoria
    if cache_key in _audio_cache:
        logger.info(f"TTS cache hit (memory): {word}")
        return _audio_cache[cache_key]

    # 2. Generar con la API Realtime (con turno: como mucho TTS_MAX_CONCURRENCY a la vez)
    try:
        logger.info(f"Generando TTS para: '{word}' voz={voice} idioma={language}")
        pcm = None
        async with _semaphore():
            for attempt in range(1, TTS_WORD_ATTEMPTS + 1):
                try:
                    pcm = await asyncio.wait_for(_synthesize_pcm(word, voice, language), TTS_WORD_TIMEOUT_SECONDS)
                    break
                except Exception as e:
                    if attempt >= TTS_WORD_ATTEMPTS:
                        raise
                    logger.warning(f"TTS: intento {attempt} fallido para '{word}' ({type(e).__name__}); reintentando")
        audio_bytes = pcm_to_wav(pcm)

        # 3. Subir a Cloudinary
        # upload_file es sincrono (Cloudinary): en un hilo para no bloquear el bucle de eventos (Fase 21).
        upload_result = await run_in_threadpool(
            upload_file,
            file_bytes=audio_bytes,
            filename=f"{cache_key}.wav",
            content_type="audio/wav",
            folder="tts_cache",
        )

        url = upload_result["url"]

        # 4. Guardar en caché de memoria
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
    Solo genera las que no están en caché. Se generan en cola de `TTS_MAX_CONCURRENCY` en `TTS_MAX_CONCURRENCY`
    (por defecto de 5 en 5): las demás esperan su turno dentro de `generate_word_audio`.

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
