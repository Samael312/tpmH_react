import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// El origen del backend (protocolo+host, sin el path /api/v1) para
// autorizarlo en `connect-src` del CSP. Si NEXT_PUBLIC_API_URL no es una
// URL válida (no debería pasar, pero por las dudas) caemos a localhost:8000
// para no romper el desarrollo local.
function backendOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
  try {
    return new URL(raw).origin;
  } catch {
    return "http://localhost:8000";
  }
}

// Content-Security-Policy sin nonces (headers() no tiene acceso al request,
// así que no se puede generar un nonce distinto por response desde acá —
// para eso haría falta moverlo a proxy.ts con rendering dinámico en todas
// las páginas, lo cual tiene un costo de performance/arquitectura grande
// que no se justifica todavía). Usa 'unsafe-inline' para script/style
// siguiendo la recomendación oficial de Next.js para el caso "sin nonces"
// (ver node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
// No es tan estricto como un CSP con nonces, pero sigue bloqueando lo más
// importante: carga de scripts/conexiones a dominios no autorizados,
// clickjacking (frame-ancestors) y hijacking de <form> (form-action).
function buildCsp(): string {
  const backend = backendOrigin();
  const directives = [
    `default-src 'self'`,
    // Google Identity Services (botón de "Iniciar sesión con Google") se
    // inyecta como <script src="https://accounts.google.com/gsi/client">
    `script-src 'self' 'unsafe-inline' https://accounts.google.com${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    // blob:/data: -> avatares generados y previews locales antes de subir
    `img-src 'self' blob: data: https://res.cloudinary.com https://ui-avatars.com https://lh3.googleusercontent.com`,
    // Videos de presentación de profesores, servidos desde Cloudinary.
    // blob: además es necesario para la vista previa local del video antes
    // de subirlo (onboarding de profesor: URL.createObjectURL(file) en el
    // <video>) — sin esto el navegador bloquea la carga silenciosamente y
    // el reproductor se queda en negro sin ningún error visible en la UI.
    `media-src 'self' https://res.cloudinary.com blob:`,
    `font-src 'self' data:`,
    // 'self' + el backend (dominio distinto en producción) + Google (el
    // script de GSI hace sus propias requests de auth) + blob: (Three.js
    // usa THREE.ImageBitmapLoader para las texturas embebidas en los .glb,
    // que hace fetch() sobre URLs blob: creadas con URL.createObjectURL;
    // ese fetch() lo rige connect-src, no img-src, así que sin blob: acá
    // el navegador lo bloquea silenciosamente y GLTFLoader tira
    // "Couldn't load texture" aunque el archivo esté perfecto)
    `connect-src 'self' ${backend} https://accounts.google.com blob:`,
    // El botón de Google se renderiza dentro de un iframe de Google
    `frame-src https://accounts.google.com`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    // Nadie debería poder embeber el sitio en un <iframe> ajeno (clickjacking)
    `frame-ancestors 'none'`,
  ];
  if (!isDev) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

const securityHeaders = [
  { key: "Content-Security-Policy", value: buildCsp() },
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
    ];
  },

  // Variables de entorno públicas disponibles en el cliente
  env: {
  NEXT_PUBLIC_API_URL:
    process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1",
  NEXT_PUBLIC_FEATURED_TEACHER_USERNAME:
    process.env.NEXT_PUBLIC_FEATURED_TEACHER_USERNAME ?? "mar12",
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "",
},
};

export default nextConfig;