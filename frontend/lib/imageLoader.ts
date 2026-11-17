"use client";

import { cloudinaryOptimized, withWidthParam } from "@/lib/cloudinaryImage";

/**
 * Cargador de `next/image` (configurado con `images.loaderFile` en next.config.ts): las imágenes de Cloudinary las
 * redimensiona y comprime Cloudinary; el resto (logo local, avatares de Google y de ui-avatars, que ya son pequeños)
 * se sirve tal cual, sin pasar por el optimizador de Next ni gastar CPU en el servidor.
 */
export default function imageLoader({ src, width }: { src: string; width: number; quality?: number }): string {
  const optimized = cloudinaryOptimized(src, width);
  return optimized === src ? withWidthParam(src, width) : optimized;
}
