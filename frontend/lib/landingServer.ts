import { cache } from "react";
import type { LandingData } from "@/hooks/useLandingData";

// Solo se importa desde Server Components (app/page.tsx). No usar desde
// código "use client" — ahí corresponde el hook useLandingData/axios normal.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

/**
 * Trae la data pública de la landing directamente en el servidor, para:
 *  1. generateMetadata() — título/descripción/OG reales, no genéricos.
 *  2. El primer render del Server Component — así el HTML que llega al
 *     navegador (y a bots que no ejecutan JS, como los de WhatsApp/Slack/
 *     Twitter al generar la vista previa de un link) ya trae el contenido
 *     real en vez de un shell vacío a la espera de hidratación.
 *
 * `revalidate` en 5 min, igual al staleTime que ya usaba el hook en
 * cliente — así ambas capas quedan consistentes en cuánto toleran data
 * desactualizada. Si el backend no responde, devuelve null y tanto la
 * metadata como el render inicial caen a sus defaults (la página igual
 * funciona: el hook de cliente vuelve a intentar el fetch normal).
 */
export const getLandingDataServer = cache(async (): Promise<LandingData | null> => {
  try {
    const res = await fetch(`${API_URL}/public/landing`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) {
      console.error(
        `[landing][ssr] /public/landing respondió ${res.status} ${res.statusText}`
      );
      return null;
    }

    const data = await res.json();
    return {
      isSingleTenant: data.is_single_tenant,
      platformName: data.platform_name || "TuProfeMaria",
      platformTagline: data.platform_tagline ?? null,
      teachers: data.teachers ?? [],
      reviews: data.reviews ?? [],
      packages: data.packages ?? [],
    };
  } catch (err) {
    // Server logs (Railway/Vercel/etc): esto es lo único que nos avisa si
    // el backend está caído o inalcanzable durante el build/SSR — antes
    // se perdía del todo y la página caía a metadata genérica sin rastro.
    console.error("[landing][ssr] fallo al traer /public/landing:", err);
    return null;
  }
});
