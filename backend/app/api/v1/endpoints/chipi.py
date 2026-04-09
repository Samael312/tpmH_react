from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import Optional
import json

from app.db.base import get_db
from app.auth.dependencies import get_current_user
from app.models.user import User
from app.schemas.chipi import ChipiRequest, ChipiResponse
from app.core.chipi.prompts import build_system_prompt
from app.core.chipi.context import (
    get_student_data_for_chipi,
    get_teacher_data_for_chipi,
)
from app.core.chipi.service import (
    get_chipi_response,
    stream_chipi_response,
)

router = APIRouter()


def _get_optional_user(
    db: Session = Depends(get_db),
) -> Optional[User]:
    """
    Dependencia opcional — no falla si no hay token.
    Chipi funciona tanto para usuarios autenticados como visitantes.
    """
    return None


@router.post("/chat")
async def chat_with_chipi(
    data: ChipiRequest,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """
    Endpoint principal del chatbot Chipi.
    Soporta streaming y respuesta completa.

    El frontend envía:
    - El mensaje del usuario
    - La pantalla donde está
    - El historial de la conversación (últimos N mensajes)

    El backend construye el prompt con contexto real
    del usuario desde la BD y llama a OpenAI.
    """

    # 1. Obtener datos del usuario para enriquecer el prompt
    role = None
    user_data = None

    if current_user:
        role = current_user.role.value

        if role == "student":
            user_data = get_student_data_for_chipi(current_user, db)
        elif role == "teacher":
            user_data = get_teacher_data_for_chipi(current_user, db)

    # 2. Construir el prompt del sistema
    system_prompt = build_system_prompt(
        role=role,
        screen=data.screen,
        user_data=user_data,
    )

    # 3. Convertir historial al formato de OpenAI
    history = [
        {"role": msg.role, "content": msg.content}
        for msg in data.history
    ]

    # 4. Respuesta con streaming
    if data.stream:
        async def generate():
            """
            Generador que envía los chunks como Server-Sent Events.
            El frontend recibe el texto token a token.
            """
            try:
                async for chunk in stream_chipi_response(
                    message=data.message,
                    system_prompt=system_prompt,
                    history=history,
                ):
                    # Formato SSE: data: <contenido>\n\n
                    yield f"data: {json.dumps({'chunk': chunk})}\n\n"

                # Señal de fin del stream
                yield f"data: {json.dumps({'done': True})}\n\n"

            except Exception as e:
                yield f"data: {json.dumps({'error': str(e)})}\n\n"

        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
            headers={
                # Necesario para que el streaming funcione
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            }
        )

    # 5. Respuesta sin streaming (más simple)
    try:
        response = await get_chipi_response(
            message=data.message,
            system_prompt=system_prompt,
            history=history,
        )
        return ChipiResponse(response=response, screen=data.screen)

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )