import type { NextConfig } from "next";

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

  // Variables de entorno públicas disponibles en el cliente
  env: {
    NEXT_PUBLIC_API_URL:
      process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1",
    NEXT_PUBLIC_FEATURED_TEACHER_USERNAME:
      process.env.NEXT_PUBLIC_FEATURED_TEACHER_USERNAME ?? "Mar12",
  },
};

export default nextConfig;