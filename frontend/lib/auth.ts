import Cookies from "js-cookie";

interface TokenPayload {
  sub: string;    // user id
  role: string;
  exp: number;
  iat: number;
}

// Decodifica el payload del JWT sin verificar firma
// La verificación real la hace el backend
export function decodeToken(token: string): TokenPayload | null {
  try {
    const payload = token.split(".")[1];
    const decoded = JSON.parse(atob(payload));
    return decoded;
  } catch {
    return null;
  }
}

// Verifica si el token ha expirado en el cliente
export function isTokenExpired(token: string): boolean {
  const payload = decodeToken(token);
  if (!payload) return true;
  return Date.now() >= payload.exp * 1000;
}

// Obtiene el token actual y verifica que no ha expirado
export function getValidToken(): string | null {
  const token = Cookies.get("access_token");
  if (!token) return null;
  if (isTokenExpired(token)) {
    Cookies.remove("access_token");
    return null;
  }
  return token;
}