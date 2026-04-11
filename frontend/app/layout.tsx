import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "TPMH - Plataforma de clases",
  description: "Aprende idiomas con los mejores profesores",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      {/* AÑADE suppressHydrationWarning AQUÍ */}
      <body className={inter.className} suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}