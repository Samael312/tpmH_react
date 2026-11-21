import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.db.base import get_db
from app.auth.dependencies import get_current_user
from app.core.rate_limit import limiter, user_or_ip_key
from app.models.user import User
from app.models.material import Material
from app.core.tts_service import generate_word_audio, generate_batch_audio, count_cached
from app.schemas.tts import (
    TTS_MAX_SPEED,
    TTS_MIN_SPEED,
    TTS_MAX_WORDS,
    TTS_VOICES,
    TTSWordRequest,
    TTSWordResponse,
    TTSBatchRequest,
    TTSBatchResponse,
)

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/word", response_model=TTSWordResponse)
@limiter.limit("60/minute;1000/day", key_func=user_or_ip_key)  # SEC-02: cada audio nuevo cuesta TTS
async def get_word_audio(
    request: Request,
    data: TTSWordRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Genera o recupera el audio de alta calidad para una palabra.
    Cualquier usuario autenticado puede usarlo.

    El audio se cachea automáticamente — si ya fue generado
    antes devuelve la URL cacheada sin costo adicional.
    """
    try:
        audio_url = await generate_word_audio(
            word=data.word,
            voice=data.voice,
            speed=data.speed,
        )
        return TTSWordResponse(
            word=data.word,
            audio_url=audio_url,
            voice=data.voice,
            speed=data.speed,
        )
    except ValueError:
        logger.exception("TTS: fallo generando una palabra")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No se pudo generar el audio. Inténtalo de nuevo.",
        )


async def _batch_response(words: list[str], voice: str, speed: float) -> TTSBatchResponse:
    """Genera el lote y cuenta cuántas ya estaban en caché (se mide ANTES de generar)."""
    already_cached = count_cached(words, voice, speed)
    try:
        audio_urls = await generate_batch_audio(words=words, voice=voice, speed=speed)
    except Exception:
        # No se devuelve str(e): puede traer detalles de OpenAI/Cloudinary.
        logger.exception("TTS: fallo generando el lote")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No se pudieron generar los audios. Inténtalo de nuevo.",
        )
    ok = sum(1 for w in words if audio_urls.get(w))
    return TTSBatchResponse(
        audio_urls=audio_urls,
        generated=max(0, ok - already_cached),
        cached=min(already_cached, ok),
        failed=len(words) - ok,
    )


@router.post("/batch", response_model=TTSBatchResponse)
@limiter.limit("6/minute;60/day", key_func=user_or_ip_key)
async def get_batch_audio(
    request: Request,
    data: TTSBatchRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Genera audio para múltiples palabras de una vez.
    Ideal para precargar un set de vocabulario completo.

    Proceso:
    1. Revisa qué palabras ya están en caché
    2. Genera solo las nuevas (más eficiente)
    3. Devuelve todas las URLs

    El frontend puede mostrar una barra de progreso
    mientras espera el resultado.
    """
    return await _batch_response(data.words, data.voice, data.speed)


def _can_use_vocabulary(db: Session, user: User, material_id: int) -> tuple[Optional[Material], bool]:
    """(material, acceso): profesor dueño (o teacher_admin), alumno con el material asignado, o superadmin."""
    from app.models.material import MaterialAssignment
    from app.models.user import UserRole

    material = db.query(Material).filter(
        Material.id == material_id,
        Material.category == "vocabulary",
        Material.is_active == True,  # noqa: E712
    ).first()
    if not material:
        return None, False
    if user.role == UserRole.superadmin:
        return material, True
    if user.role in (UserRole.teacher, UserRole.teacher_admin):
        tp = user.teacher_profile
        return material, bool(tp and material.teacher_id == tp.id)
    if user.role == UserRole.student:
        sp = user.student_profile
        assigned = bool(sp) and db.query(MaterialAssignment).filter(
            MaterialAssignment.material_id == material_id,
            MaterialAssignment.student_id == sp.id,
        ).first() is not None
        return material, assigned
    return material, False


@router.post("/vocabulary/{material_id}")
@limiter.limit("6/minute;60/day", key_func=user_or_ip_key)
async def get_vocabulary_audio(
    request: Request,
    material_id: int,
    voice: str = Query("nova"),
    speed: float = Query(0.9, ge=TTS_MIN_SPEED, le=TTS_MAX_SPEED),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Genera audio para las palabras de un material de tipo vocabulario (máximo 50 por petición).

    Acceso: el profesor dueño del material, un alumno al que se le asignó, o el superadmin.
    Voz y velocidad se validan igual que en /word.
    """
    if voice not in TTS_VOICES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Voz inválida. Opciones: {TTS_VOICES}")

    material, allowed = await run_in_threadpool(_can_use_vocabulary, db, current_user, material_id)
    if not material:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material de vocabulario no encontrado")
    if not allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tienes acceso a este material")

    words = list(dict.fromkeys(w.strip() for w in (material.vocabulary_words or []) if w and w.strip()))[:TTS_MAX_WORDS]
    words = [w[:100] for w in words]
    if not words:
        return TTSBatchResponse(audio_urls={}, generated=0, cached=0, failed=0)

    return await _batch_response(words, voice, speed)
