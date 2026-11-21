from pydantic import BaseModel, field_validator
from typing import Optional, List, Dict


TTS_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"]
TTS_MIN_SPEED = 0.25
TTS_MAX_SPEED = 2.0
TTS_MAX_WORDS = 50  # tope por peticion (control de costes)


class TTSWordRequest(BaseModel):
    """Generar audio para una sola palabra"""
    word: str
    voice: str = "nova"
    speed: float = 0.9

    @field_validator("word")
    @classmethod
    def validate_word(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("La palabra no puede estar vacía")
        if len(v) > 100:
            raise ValueError("La palabra es demasiado larga")
        return v

    @field_validator("voice")
    @classmethod
    def validate_voice(cls, v):
        if v not in TTS_VOICES:
            raise ValueError(f"Voz inválida. Opciones: {TTS_VOICES}")
        return v

    @field_validator("speed")
    @classmethod
    def validate_speed(cls, v):
        if not TTS_MIN_SPEED <= v <= TTS_MAX_SPEED:
            raise ValueError(f"La velocidad debe estar entre {TTS_MIN_SPEED} y {TTS_MAX_SPEED}")
        return v


class TTSWordResponse(BaseModel):
    word: str
    audio_url: str
    voice: str
    speed: float


class TTSBatchRequest(BaseModel):
    """
    Generar audio para un set completo de vocabulario.
    Máximo 50 palabras por request para controlar costos.
    """
    words: List[str]
    voice: str = "nova"
    speed: float = 0.9

    @field_validator("words")
    @classmethod
    def validate_words(cls, v):
        if not v:
            raise ValueError("La lista de palabras no puede estar vacía")
        if len(v) > TTS_MAX_WORDS:
            raise ValueError(f"Máximo {TTS_MAX_WORDS} palabras por request")
        words = [w.strip() for w in v if w.strip()]
        if not words:
            raise ValueError("La lista de palabras no puede estar vacía")
        # SEC-02: el tope de 100 caracteres solo existia para /word; el batch aceptaba palabras enormes.
        if any(len(w) > 100 for w in words):
            raise ValueError("Cada palabra puede tener como máximo 100 caracteres")
        return words


class TTSBatchResponse(BaseModel):
    """
    Resultado del batch.
    audio_urls es un dict: {"apple": "url...", "banana": "url..."}
    Si una palabra falló su valor es null.
    """
    audio_urls: Dict[str, Optional[str]]
    generated: int    # cuántas se generaron nuevas
    cached: int       # cuántas ya estaban en caché
    failed: int       # cuántas fallaron