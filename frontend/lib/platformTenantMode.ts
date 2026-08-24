"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";

const CACHE_KEY = "tpmh_platform_tenant_mode";

function readCache(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (raw === null) return null;
    return raw === "1";
  } catch {
    return null;
  }
}

function writeCache(value: boolean) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(CACHE_KEY, value ? "1" : "0");
  } catch {
    // sessionStorage puede fallar en modo privado/incógnito; no es crítico
  }
}

/**
 * Determina si la plataforma está en modo single-tenant (una sola profesora,
 * sin selector de rol) o multi-tenant (marketplace, con selector Estudiante/Profesor).
 *
 * Usa un cache en sessionStorage para que, dentro de la misma pestaña, no haya
 * que esperar el round-trip a /admin/platform-config en cada visita a /register
 * — eso es lo que causaba que el selector de rol tardara en aparecer/desaparecer.
 */
export function usePlatformTenantMode() {
  const cached = readCache();
  const [isSingleTenant, setIsSingleTenant] = useState<boolean>(cached ?? true);
  const [configLoaded, setConfigLoaded] = useState<boolean>(cached !== null);

  useEffect(() => {
    api
      .get("/admin/platform-config")
      .then((res) => {
        const value = Boolean(res.data?.is_single_tenant);
        setIsSingleTenant(value);
        writeCache(value);
      })
      .catch(() => setIsSingleTenant(true)) // fallback seguro: asumir single-tenant
      .finally(() => setConfigLoaded(true));
  }, []);

  return { isSingleTenant, configLoaded };
}
