import httpx
from app.core.config import settings

async def verify_google_token(id_token: str) -> dict:
    """
    Verifica el token de Google y devuelve los datos del usuario.
    Lanza una excepción si el token es inválido.
    """
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"https://oauth2.googleapis.com/tokeninfo",
            params={"id_token": id_token}
        )

    if response.status_code != 200:
        raise ValueError("Token de Google inválido")

    data = response.json()

    # Verificar que el token es para nuestra aplicación
    if data.get("aud") != settings.GOOGLE_CLIENT_ID:
        raise ValueError("Token no corresponde a esta aplicación")

    return {
        "google_id": data["sub"],
        "email": data["email"],
        "name": data.get("given_name", ""),
        "surname": data.get("family_name", ""),
        "avatar": data.get("picture"),
        "is_verified": data.get("email_verified") == "true"
    }