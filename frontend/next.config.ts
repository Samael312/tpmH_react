import type { NextConfig } from "next";

// La Content-Security-Policy ya NO vive aquí: necesita un nonce distinto por petición, así que la genera
// proxy.ts (ver lib/csp.ts). Estos son los demás encabezados de seguridad, que sí son estáticos.
const securityHeaders = [
  // Redundante con frame-ancestors del CSP, pero lo dejamos por
  // compatibilidad con navegadores/herramientas que todavía lo miran.
  { key: "X-Frame-Options", value: "DENY" },
  // Evita que el navegador intente "adivinar" el tipo de un archivo
  // servido y lo ejecute como algo distinto a lo que dice su Content-Type.
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Este sitio no necesita cámara, micrófono ni geolocalización.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Solo tiene efecto real sobre HTTPS (Railway sirve el sitio así en
  // producción); los navegadores la ignoran sobre HTTP plano en dev.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
      {
        protocol: "https",
        hostname: "ui-avatars.com",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com", // Google avatars
      },
    ],
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      // Archivos de public/ (modelo 3D, imágenes): no llevan hash en el nombre, así que no pueden ser `immutable`;
      // 7 días con revalidación en segundo plano evita volver a bajar 22 MB en cada visita. Si se sustituye un
      // archivo con el mismo nombre, tarda hasta 7 días en verse: cambia el nombre al sustituirlo.
      {
        source: "/models/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }],
      },
      {
        source: "/assets/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }],
      },
    ];
  },

  // Variables de entorno públicas disponibles en el cliente
  env: {
  NEXT_PUBLIC_API_URL:
    process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1",
  NEXT_PUBLIC_FEATURED_TEACHER_USERNAME:
    process.env.NEXT_PUBLIC_FEATURED_TEACHER_USERNAME ?? "",
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "",
},
};

export default nextConfig;