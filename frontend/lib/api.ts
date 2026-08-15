import axios, { AxiosResponse } from "axios";
import { useAuthStore } from "@/store/authStore";

const CACHE_PREFIX = "tpmh:api-cache:";
const CACHE_TTL_MS = 5 * 60 * 1000;

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function cacheKey(url?: string, params?: unknown) {
  return `${CACHE_PREFIX}${url ?? ""}:${JSON.stringify(params ?? {})}`;
}

function readCachedResponse(key: string) {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt: number; data: unknown };
    if (Date.now() - parsed.savedAt > CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCachedResponse(key: string, data: unknown) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
  } catch {
    // Storage can be unavailable or full; API responses should still work normally.
  }
}

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1",
  headers: { "Content-Type": "application/json" },
});

// ── Request: adjuntar token y preparar cache para GET ──
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  if ((config.method ?? "get").toLowerCase() === "get") {
    config.headers["x-cache-key"] = cacheKey(config.url, config.params);
  }

  return config;
});

// ── Response: refrescar user en store si el backend devuelve datos actualizados
api.interceptors.response.use(
  (res) => {
    const key = res.config.headers?.["x-cache-key"] as string | undefined;
    if (key) writeCachedResponse(key, res.data);

    // Si el endpoint devuelve un objeto con 'id' y 'username',
    // asumimos que es el user actual y actualizamos el store
    const data = res.data;
    if (
      data &&
      typeof data === "object" &&
      "id" in data &&
      "username" in data &&
      "role" in data
    ) {
      const store = useAuthStore.getState();
      const current = store.user;
      // Solo actualizar si es el mismo usuario
      if (current && "id" in current && current.id === data.id) {
        store.user = {
          ...current,
          ...data,
        };
      }
    }
    return res;
  },
  (err) => {
    const isLoginEndpoint = err.config?.url?.includes("/auth/login");
    const key = err.config?.headers?.["x-cache-key"] as string | undefined;
    const cached = key ? readCachedResponse(key) : null;

    if (cached !== null && err.config) {
      return Promise.resolve({
        data: cached,
        status: 200,
        statusText: "OK (cache)",
        headers: err.response?.headers ?? {},
        config: err.config,
        request: err.request,
      } satisfies AxiosResponse);
    }

    // 401 → logout (SOLO si no estamos intentando iniciar sesión)
    if (err.response?.status === 401 && !isLoginEndpoint) {
      useAuthStore.getState().logout();
      window.location.href = "/login";
    }
    
    return Promise.reject(err);
  }
);

export default api;
