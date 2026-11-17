/**
 * Imágenes de Cloudinary optimizadas por el propio Cloudinary (Fase 11).
 *
 * Con el optimizador de Next.js cada imagen se descarga de Cloudinary, se recodifica en el servidor de Railway
 * (CPU y RAM) y se vuelve a servir. Cloudinary ya sabe hacerlo en su CDN: `f_auto` elige AVIF/WebP/JPEG según el
 * navegador, `q_auto` ajusta la calidad y `w_<ancho>,c_limit` reduce sin ampliar nunca. El resultado se cachea en su
 * CDN y el servidor de Railway no trabaja.
 *
 * Solo se toca una URL que (1) es de res.cloudinary.com, (2) es una imagen (no vídeo ni PDF) subida con `upload` y
 * (3) no lleva ya transformaciones propias. Cualquier otra URL se devuelve tal cual.
 */
const HOST = "https://res.cloudinary.com/";

/**
 * Para las demás URLs (logo local, avatares de Google y de ui-avatars) se añade un `w=<ancho>` que sus servidores
 * ignoran: Next lo exige para saber que el cargador "implementa el ancho" y evita su aviso en desarrollo.
 */
export function withWidthParam(src: string, width: number): string {
  if (/^(data|blob):/.test(src)) return src;
  return `${src}${src.includes("?") ? "&" : "?"}w=${Math.round(width)}`;
}

export function cloudinaryOptimized(src: string, width: number): string {
  if (!src.startsWith(HOST)) return src;

  const marker = "/image/upload/";
  const at = src.indexOf(marker);
  if (at === -1) return src; // vídeo, raw, fetch, authenticated…: no se toca

  const head = src.slice(0, at + marker.length);
  const rest = src.slice(at + marker.length);
  const firstSegment = rest.split("/")[0];

  // Ya trae transformaciones (w_100,h_100…, e_…, c_…): se respeta la decisión de quien guardó la URL.
  // La versión (v1699999999) y la ruta de la carpeta no son transformaciones.
  if (/^[a-z]{1,3}_[^/]*/.test(firstSegment) && !/^v\d+$/.test(firstSegment)) return src;

  const w = Math.max(16, Math.round(width));
  return `${head}f_auto,q_auto,c_limit,w_${w}/${rest}`;
}
