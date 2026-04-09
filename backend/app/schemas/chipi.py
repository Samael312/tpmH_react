from pydantic import BaseModel
from typing import List, Optional


class ChatMessage(BaseModel):
    """Un mensaje del historial"""
    role: str       # "user" o "assistant"
    content: str


class ChipiRequest(BaseModel):
    """
    Lo que envía el frontend al chatbot.
    El historial se envía desde el frontend porque
    el backend es stateless — no guarda conversaciones.
    Esto es intencional: más simple y más escalable.
    """
    message: str
    screen: str                         # Pantalla actual del usuario
    history: List[ChatMessage] = []     # Últimos mensajes de la conversación
    stream: bool = True                 # True = streaming, False = respuesta completa


class ChipiResponse(BaseModel):
    """Respuesta cuando stream=False"""
    response: str
    screen: str