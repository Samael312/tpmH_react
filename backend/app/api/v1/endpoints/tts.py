from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import Optional

from app.db.base import get_db
from app.auth.dependencies import get_current_user
from app.models.user import User
from app.models.material import Material
from app.core.tts_service import generate_word_audio, generate_batch_audio
from app.schemas.tts import (
    TTSWordRequest,
    TTSWordResponse,
    TTSBatchRequest,
    TTSBatchResponse,
)

router = APIRouter()


@router.post("/word", response_model=TTSWordResponse)
async def get_word_audio(
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
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.post("/batch", response_model=TTSBatchResponse)
async def get_batch_audio(
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
    try:
        audio_urls = await generate_batch_audio(
            words=data.words,
            voice=data.voice,
            speed=data.speed,
        )

        # Contar resultados
        generated = sum(
            1 for w in data.words
            if audio_urls.get(w) is not None
        )
        failed = sum(
            1 for w in data.words
            if audio_urls.get(w) is None
        )

        # Las cacheadas son las que ya estaban antes del request
        # Por simplicidad las contamos como generated - failed
        cached = len(data.words) - generated - failed

        return TTSBatchResponse(
            audio_urls=audio_urls,
            generated=max(0, generated - cached),
            cached=cached,
            failed=failed,
        )

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error generando audios: {str(e)}"
        )


@router.post("/vocabulary/{material_id}")
async def get_vocabulary_audio(
    material_id: int,
    voice: str = "nova",
    speed: float = 0.9,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Genera audio para todas las palabras de un material
    de tipo vocabulario.

    Endpoint de conveniencia — el frontend solo envía el
    material_id y recibe todos los audios de una vez.
    """
    # Verificar que el material existe y tiene vocabulario
    material = db.query(Material).filter(
        Material.id == material_id,
        Material.category == "vocabulary",
        Material.is_active == True
    ).first()

    if not material:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Material de vocabulario no encontrado"
        )

    if not material.vocabulary_words:
        return TTSBatchResponse(
            audio_urls={},
            generated=0,
            cached=0,
            failed=0,
        )

    # Verificar que el usuario tiene acceso al material
    # (debe tener una asignación activa)
    from app.models.material import MaterialAssignment
    from app.models.user import UserRole

    if current_user.role == UserRole.student:
        assignment = db.query(MaterialAssignment).filter(
            MaterialAssignment.material_id == material_id,
            MaterialAssignment.student_id == current_user.student_profile.id
        ).first()

        if not assignment:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tienes acceso a este material"
            )

    # Generar audios para todas las palabras
    try:
        audio_urls = await generate_batch_audio(
            words=material.vocabulary_words,
            voice=voice,
            speed=speed,
        )

        generated = sum(1 for url in audio_urls.values() if url)
        failed = sum(1 for url in audio_urls.values() if not url)

        return TTSBatchResponse(
            audio_urls=audio_urls,
            generated=generated,
            cached=0,
            failed=failed,
        )

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )