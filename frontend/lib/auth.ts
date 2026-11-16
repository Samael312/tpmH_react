interface TokenPayload {
  sub: string;    // user id
  role: string;
  exp: number;
  iat: number;
}

// Decodifica el payload del JWT sin verificar firma. SOLO lo usa proxy.ts (servidor) para enrutar por rol:
// la verificación real la hace el backend. Desde SEC-05 el token vive en una cookie HttpOnly y el
// código del navegador ya no puede (ni debe) leerlo.
export function decodeToken(token: string): TokenPayload | null {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
}

export function isTokenExpired(token: string): boolean {
  const payload = decodeToken(token);
  if (!payload) return true;
  return Date.now() >= payload.exp * 1000;
}
