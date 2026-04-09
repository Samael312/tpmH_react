from openai import AsyncOpenAI
from typing import AsyncGenerator, List, Optional
from app.core.config import settings
import logging

logger = logging.getLogger(__name__)

client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

# Máximo de mensajes del historial que enviamos a OpenAI
# Más mensajes = más contexto pero más costo
MAX_HISTORY_MESSAGES = 10


async def get_chipi_response(
    message: str,
    system_prompt: str,
    history: List[dict],
) -> str:
    """
    Obtiene respuesta de Chipi sin streaming.
    Más simple — para cuando no necesitas streaming.
    """
    messages = [{"role": "system", "content": system_prompt}]

    # Añadir historial reciente (limitado para no sobrecargar)
    recent_history = history[-MAX_HISTORY_MESSAGES:]
    messages.extend(recent_history)

    # Añadir mensaje actual
    messages.append({"role": "user", "content": message})

    try:
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            temperature=0.7,
            max_tokens=500,
        )
        return response.choices[0].message.content
    except Exception as e:
        logger.error(f"Error en OpenAI: {e}")
        raise ValueError("Error al procesar tu mensaje. Inténtalo de nuevo.")


async def stream_chipi_response(
    message: str,
    system_prompt: str,
    history: List[dict],
) -> AsyncGenerator[str, None]:
    """
    Obtiene respuesta de Chipi con streaming.
    El texto aparece letra a letra en el frontend.
    Mejor experiencia de usuario.
    """
    messages = [{"role": "system", "content": system_prompt}]
    recent_history = history[-MAX_HISTORY_MESSAGES:]
    messages.extend(recent_history)
    messages.append({"role": "user", "content": message})

    try:
        stream = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            temperature=0.7,
            max_tokens=500,
            stream=True,
        )

        async for chunk in stream:
            delta = chunk.choices[0].delta
            if delta.content:
                yield delta.content

    except Exception as e:
        logger.error(f"Error en OpenAI streaming: {e}")
        yield "Lo siento, tuve un problema procesando tu mensaje. 🔌 ¿Me lo repites?"