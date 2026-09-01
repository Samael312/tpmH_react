/**
 * Deriva la URL del primer frame de un video subido a Cloudinary,
 * sin necesidad de procesar/guardar un thumbnail aparte.
 *
 * Cloudinary genera imágenes de video "on the fly" insertando una
 * transformación en la propia URL: `so_0` (start_offset = 0s) devuelve
 * el primer frame como imagen. Solo hace falta cambiar el resource type
 * implícito (la extensión) de video a imagen.
 *
 * Ejemplo:
 *   .../video/upload/v123/teacher_videos/teacher_3/presentacion.mp4
 *   -> .../video/upload/so_0/v123/teacher_videos/teacher_3/presentacion.jpg
 *
 * Si la URL no es de Cloudinary (o no matchea el patrón esperado),
 * devuelve null y el caller debe usar un fallback visual (gradiente).
 */
export function getVideoFirstFrameUrl(videoUrl?: string | null): string | null {
  if (!videoUrl) return null;

  const uploadMarker = "/video/upload/";
  const markerIndex = videoUrl.indexOf(uploadMarker);
  if (markerIndex === -1) return null;

  const prefix = videoUrl.slice(0, markerIndex + uploadMarker.length);
  let rest = videoUrl.slice(markerIndex + uploadMarker.length);

  // Ya trae alguna transformación -> no insertamos, evitamos romper la URL.
  if (rest.startsWith("so_")) return prefix + rest.replace(/\.(mp4|mov|webm|avi|mkv)(\?.*)?$/i, ".jpg$2");

  rest = `so_0/${rest}`;
  rest = rest.replace(/\.(mp4|mov|webm|avi|mkv)(\?.*)?$/i, ".jpg$2");

  // Si no había extensión de video reconocida, no podemos garantizar
  // que el replace haya funcionado; evitamos devolver una URL inválida.
  if (!/\.jpg(\?.*)?$/i.test(rest)) return null;

  return prefix + rest;
}
