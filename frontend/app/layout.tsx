import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Providers from "./providers";
import { getLandingDataServer } from "@/lib/landingServer";

const inter = Inter({ subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const data = await getLandingDataServer();
  const platformName = data?.platformName || "TuProfeMaria";
  return {
    title: `${platformName} - Plataforma de clases`,
    description: "Aprende idiomas con los mejores profesores",
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