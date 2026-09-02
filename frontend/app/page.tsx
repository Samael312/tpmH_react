import type { Metadata } from "next";
import { getLandingDataServer } from "@/lib/landingServer";
import { displayName } from "@/lib/displayName";
import LandingPageClient from "@/components/landing/LandingPageClient";

export async function generateMetadata(): Promise<Metadata> {
  const data = await getLandingDataServer();

  const platformName = data?.platformName || "TuProfeMaria";
  const mainTeacher = data?.teachers?.[0];

  // El tagline configurado por el superadmin (Settings → Tagline) tiene
  // prioridad sobre los títulos genéricos por defecto.
  const title = data?.platformTagline
    ? `${platformName} — ${data.platformTagline}`
    : data?.isSingleTenant && mainTeacher
      ? `${platformName} — Clases con ${displayName(mainTeacher)}`
      : `${platformName} — Encuentra tu profesor ideal`;

  const description =
    data?.platformTagline ||
    (data?.isSingleTenant
      ? `Clases particulares 100% online con ${mainTeacher ? displayName(mainTeacher) : "una profesora certificada"}. Reserva tu clase de prueba.`
      : "Conectá con profesores particulares certificados y aprendé a tu ritmo, 100% online.");

  // En single-tenant usamos la foto real de la profesora como preview del
  // link (más personal); si no hay, o es multi-tenant, cae al logo.
  const ogImage = (data?.isSingleTenant && mainTeacher?.profile_photo_url) || "/assets/logo.png";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: [{ url: ogImage }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function Page() {
  const initialData = await getLandingDataServer();
  return <LandingPageClient initialData={initialData} />;
}
