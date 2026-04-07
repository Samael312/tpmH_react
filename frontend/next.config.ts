/** @type {import('next').NextConfig} */
const nextConfig = {
  // En Next.js 16, muévelo fuera de experimental
  devIndicators: {
    appIsrStatus: false,
  },
  // Si sigue fallando como "unrecognized", bórralo por ahora. 
  // localhost siempre está permitido por defecto.
  allowedDevOrigins: ['172.29.160.1'], 
};

export default nextConfig;