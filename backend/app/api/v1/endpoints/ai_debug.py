from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import List, Optional
import httpx
import json
import logging

from app.auth.dependencies import get_current_staff
from app.models.user import User
from app.core.config import settings

router = APIRouter()
logger = logging.getLogger(__name__)


class TestFailureAnalysisRequest(BaseModel):
    test_name: str
    method: str
    path: str
    description: str
    http_status: int
    error: Optional[str] = None
    response_data: Optional[str] = None
    failed_assertions: List[str] = []


class TestFailureAnalysisResponse(BaseModel):
    root_cause: str
    issues: List[str]
    fix: List[str]


@router.post("/analyze-test-failure", response_model=TestFailureAnalysisResponse)
async def analyze_test_failure(
    data: TestFailureAnalysisRequest,
    current_user: User = Depends(get_current_staff),
):
    """
    Analiza un test fallido del flow-tester usando Gemini.
    La API key vive solo en el backend — nunca se expone al frontend.
    """
    if not settings.GEMINI_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GEMINI_API_KEY no está configurada en el servidor"
        )

    prompt = f"""Eres un QA engineer experto en FastAPI + Next.js analizando TPM.

Test fallido:
- Nombre: {data.test_name}
- Endpoint: {data.method} {data.path}
- Descripción: {data.description}
- Status HTTP recibido: {data.http_status}
- Error: {data.error or "none"}
- Response: {(data.response_data or "")[:500]}
- Assertions fallidas: {", ".join(data.failed_assertions)}

Responde SOLO en JSON (sin markdown):
{{"root_cause":"una frase","issues":["máx 2 causas"],"fix":["máx 2 soluciones concretas"]}}"""

    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"gemini-2.0-flash:generateContent?key={settings.GEMINI_API_KEY}"
    )

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            res = await client.post(
                url,
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"temperature": 0.2, "maxOutputTokens": 300},
                },
            )
        data_json = res.json()
        text = (
            data_json.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "")
        )
        clean = text.replace("```json", "").replace("```", "").strip()
        parsed = json.loads(clean)
        return TestFailureAnalysisResponse(
            root_cause=parsed.get("root_cause", ""),
            issues=parsed.get("issues", []),
            fix=parsed.get("fix", []),
        )
    except Exception as e:
        logger.error(f"Error analizando con Gemini: {e}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Error consultando el servicio de análisis IA"
        )