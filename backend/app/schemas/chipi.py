from pydantic import BaseModel, Field
from typing import List, Literal

# SEC-02: topes de entrada. Sin ellos un anonimo podia enviar 200 KB por request (coste en
# OpenAI) y mensajes con role "system" para reescribir las instrucciones del asistente.
MAX_CHIPI_MESSAGE_CHARS = 2000
MAX_CHIPI_HISTORY_MESSAGES = 20


class ChatMessage(BaseModel):
    """Un mensaje del historial"""
    role: Literal["user", "assistant"]   # nunca "system"/"tool": el prompt de sistema lo arma el backend
    content: str = Field(max_length=MAX_CHIPI_MESSAGE_CHARS)


class ChipiRequest(BaseModel):
    """
    Lo que envía el frontend al chatbot.
    El historial se envía desde el frontend porque
    el backend es stateless — no guarda conversaciones.
    Esto es intencional: más simple y más escalable.
    """
    message: str = Field(min_length=1, max_length=MAX_CHIPI_MESSAGE_CHARS)
    screen: str = Field(max_length=100)  # Pantalla actual del usuario
    history: List[ChatMessage] = Field(default_factory=list, max_length=MAX_CHIPI_HISTORY_MESSAGES)
    stream: bool = True                 # True = streaming, False = respuesta completa


class ChipiResponse(BaseModel):
    """Respuesta cuando stream=False"""
    response: str
    screen: str