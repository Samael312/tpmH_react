// Content-Security-Policy con nonce por petición (SEC-05, paso final).
//
// La construye proxy.ts en cada respuesta de página (ver
// node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md): Next.js lee el `nonce-…` del
// header y lo pone en sus scripts. Por eso las páginas deben renderizarse de forma dinámica (app/layout.tsx).
//
// script-src: SIN 'unsafe-inline'. Solo corre código con nonce, y `'strict-dynamic'` deja que ese código
// cargue otros scripts (p. ej. el cliente de Google Identity). Es el vector real de XSS.
// style-src conserva 'unsafe-inline': el HTML que genera React lleva atributos style="…" que un nonce no cubre
// y un CSS inyectado no ejecuta código. Es la excepción documentada de la guía de Next.js.

function backendOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
  try {
    return new URL(raw).origin;
  } catch {
    return "http://localhost:8000";
  }
}

export function buildCsp(nonce: string, isDev: boolean): string {
  const backend = backendOrigin();
  // wss:// explícito: algunos navegadores no extienden https://host a wss://host (chat interno por WebSocket).
  const backendWs = backend.replace(/^http/, "ws");
  const directives = [
    `default-src 'self'`,
    // https://accounts.google.com queda como respaldo para navegadores sin soporte de 'strict-dynamic'.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://accounts.google.com${isDev ? " 'unsafe-eval'" : ""}`,
    // fonts.googleapis.com: hoja @import de Poppins/DM Sans en globals.css.
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    // blob:/data: -> avatares generados y previews locales antes de subir
    `img-src 'self' blob: data: https://res.cloudinary.com https://ui-avatars.com https://lh3.googleusercontent.com`,
    // Videos de presentación (Cloudinary) + blob: para la vista previa local antes de subirlos.
    `media-src 'self' https://res.cloudinary.com blob:`,
    `font-src 'self' data: https://fonts.gstatic.com`,
    // blob: -> Three.js carga texturas de los .glb con fetch() sobre URLs blob: (lo rige connect-src).
    `connect-src 'self' ${backend} ${backendWs} https://accounts.google.com blob:`,
    // El botón de Google se renderiza dentro de un iframe de Google
    `frame-src https://accounts.google.com`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    // Nadie debería poder embeber el sitio en un <iframe> ajeno (clickjacking)
    `frame-ancestors 'none'`,
  ];
  if (!isDev) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}
