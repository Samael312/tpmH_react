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

    # SEC-04: el emisor debe ser Google y el email debe estar verificado por Google. Sin esto, una
    # cuenta de Google con un email no verificado podia reclamar la cuenta local con ese email.
    if data.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        raise ValueError("Token de Google inválido")
    if str(data.get("email_verified")).lower() != "true":
        raise ValueError("El email de tu cuenta de Google no está verificado")

    return {
        "google_id": data["sub"],
        "email": data["email"].strip().lower(),
        "name": data.get("given_name", ""),
        "surname": data.get("family_name", ""),
        "avatar": data.get("picture"),
        "is_verified": True,  # ya comprobado arriba
    }