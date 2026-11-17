import type { Metadata, Viewport } from "next";
import { Inter, Poppins, DM_Sans } from "next/font/google";
import "./globals.css";
import { connection } from "next/server";
import Providers from "./providers";
import { getLandingDataServer, buildDefaultSiteTitle } from "@/lib/landingServer";

const inter = Inter({ subsets: ["latin"] });
// Poppins (titulos) y DM Sans (texto) se descargan en el build y se sirven desde el propio sitio: antes iban por un
// @import de Google Fonts que bloqueaba el pintado. Solo los pesos que usa la interfaz. Tailwind las lee por variable.
const poppins = Poppins({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-poppins", display: "swap" });
const dmSans = DM_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-dm-sans", display: "swap" });

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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // CSP con nonce (lib/csp.ts, proxy.ts): el nonce solo se aplica si la página se renderiza por petición.
  await connection();
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${inter.className} ${poppins.variable} ${dmSans.variable}`} suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}