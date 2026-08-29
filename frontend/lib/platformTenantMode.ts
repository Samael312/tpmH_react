"use client";

import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";

/**
 * Determina si la plataforma está en modo single-tenant (una sola profesora,
 * sin selector de rol) o multi-tenant (marketplace, con selector Estudiante/Profesor).
 *
 * Usa react-query como cache: el resultado se comparte entre /register y
 * /register/google-complete dentro de la misma sesión de navegación sin
 * repetir el round-trip a /admin/platform-config, y sigue disponible
 * (aunque revalidándose) si el usuario vuelve a visitar la pantalla.
 */
export function usePlatformTenantMode() {
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["platform-config", "tenant-mode"],
    queryFn: async () => {
      const res = await api.get("/admin/platform-config");
      return Boolean(res.data?.is_single_tenant);
    },
    staleTime: 10 * 60 * 1000, // 10 min: este valor casi nunca cambia en caliente
    // Fallback seguro si falla: asumir single-tenant en vez de romper el formulario
    retry: 1,
  });

  return {
    isSingleTenant: data ?? true,
    configLoaded: !isLoading,
    isFetching,
    refetch,
  };
}
