from pydantic import BaseModel, field_validator
from typing import Optional, List, Dict


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
        allowed = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"]
        if v not in allowed:
            raise ValueError(f"Voz inválida. Opciones: {allowed}")
        return v

    @field_validator("speed")
    @classmethod
    def validate_speed(cls, v):
        if not 0.25 <= v <= 2.0:
            raise ValueError("La velocidad debe estar entre 0.25 y 2.0")
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
        if len(v) > 50:
            raise ValueError("Máximo 50 palabras por request")
        return [w.strip() for w in v if w.strip()]


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