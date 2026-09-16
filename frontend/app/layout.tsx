import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Providers from "./providers";
import { getLandingDataServer, buildDefaultSiteTitle } from "@/lib/landingServer";

const inter = Inter({ subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const data = await getLandingDataServer();
  // Corrección QA: antes era un título fijo sin tagline -- por eso el
  // tagline configurado por el admin solo se veía en la pestaña estando en
  // "/" y desaparecía en el resto de la plataforma (ver buildDefaultSiteTitle
  // para el detalle de por qué pasaba esto).
  return {
    title: buildDefaultSiteTitle(data),
    description: data?.platformTagline || "Aprende idiomas con los mejores profesores",
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // necesario para que env(safe-area-inset-*) funcione en iOS
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={inter.className} suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}