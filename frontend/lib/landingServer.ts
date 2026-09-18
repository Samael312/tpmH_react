import { cache } from "react";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import type { LandingData } from "@/hooks/useLandingData";
import { LANDING_CONTENT_DEFAULTS } from "@/hooks/useLandingData";

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
 * `revalidate` en 60s, igual al TTL del cache en memoria que ya aplica el
 * backend para este mismo endpoint (ver LANDING_CACHE_TTL_SECONDS en
 * public.py) — así ninguna de las dos capas puede quedar más desactualizada
 * que la otra. Antes esto estaba en 5 min mientras el backend cachea 60s
 * y se invalida al instante ante cualquier cambio (ej. un admin alternando
 * single-tenant/multi-tenant desde /admin/settings); esa diferencia hacía
 * que un load fresco de la landing pudiera seguir sirviendo el HTML viejo
 * hasta 5 minutos después del cambio, aunque el backend ya tuviera la data
 * correcta. Si el backend no responde, devuelve null y tanto la metadata
 * como el render inicial caen a sus defaults (la página igual funciona: el
 * hook de cliente vuelve a intentar el fetch normal).
 *
 * generateMetadata() (layout.tsx, page.tsx, terms/privacy) se ejecuta para
 * CADA una de las ~50 páginas durante `next build`, al generar los HTML
 * estáticos — no solo para "/". El build corre en un contenedor efímero de
 * Railway, sin garantía de que el backend ya esté arriba (o mientras se
 * está re-deployando en simultáneo): el fetch recibe un 502 de su gateway
 * en vez de una conexión rechazada, y eso tarda varios segundos por página
 * en vez de fallar al instante. Multiplicado por ~50 páginas dispara el
 * timeout interno de Next.js (60s por página, 3 reintentos cada una) y el
 * build se vuelve carísimo o falla directamente.
 * Por eso: (1) en fase de build no llamamos al backend en absoluto — esos
 * fetches no aportan nada que el ISR de `revalidate: 60` no repita en el
 * primer request real ya en producción — y (2) el fetch en runtime lleva
 * un timeout corto propio, para que un backend caído o lento en ese
 * momento tampoco cuelgue el render de una página real.
 */
export const getLandingDataServer = cache(async (): Promise<LandingData | null> => {
  if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) {
    return null;
  }

  try {
    const res = await fetch(`${API_URL}/public/landing`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(5000),
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
      landingContent: { ...LANDING_CONTENT_DEFAULTS, ...(data.landing_content ?? {}) },
    };
  } catch (err) {
    // Server logs (Railway/Vercel/etc): esto es lo único que nos avisa si
    // el backend está caído o inalcanzable durante el build/SSR — antes
    // se perdía del todo y la página caía a metadata genérica sin rastro.
    console.error("[landing][ssr] fallo al traer /public/landing:", err);
    return null;
  }
});

/**
 * Corrección QA: título por defecto de la pestaña del navegador, para
 * TODA la plataforma (usado por el RootLayout en generateMetadata).
 *
 * Antes el tagline configurado por el admin (Settings → Tagline) solo se
 * incorporaba al título en app/page.tsx (la landing "/"), porque ese
 * archivo arma su propio `title` en su generateMetadata. Next.js resuelve
 * el <title> por ruta: cualquier página que NO define su propio `title`
 * hereda el del layout más cercano -- y el RootLayout tenía un título fijo
 * sin tagline. Resultado: en cuanto el usuario salía de "/" (dashboard,
 * login, perfil de profesor, admin, etc.) la pestaña volvía al título
 * genérico, como si el tagline solo existiera en la landing.
 *
 * Esta función centraliza el título "por defecto" (con tagline si el admin
 * configuró uno) para que sea consistente en todo el sitio, no solo en "/".
 * Páginas que necesiten su propio título específico (ej. terms/privacy)
 * siguen pudiendo sobreescribirlo con su propio generateMetadata/metadata,
 * como ya hacían.
 */
export function buildDefaultSiteTitle(data: LandingData | null): string {
  const platformName = data?.platformName || "TuProfeMaria";
  return data?.platformTagline
    ? `${platformName} — ${data.platformTagline}`
    : `${platformName} - Plataforma de clases`;
}
