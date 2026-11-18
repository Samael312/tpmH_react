import axios from "axios";
import { useAuthStore } from "@/store/authStore";
import { reportFrontendError } from "@/lib/errorReporting";
import { getErrorMessage } from "@/lib/errorMessage";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

// SEC-05: la sesión vive en cookies HttpOnly que fija el backend; el navegador las envía solo con
// withCredentials. Ya no hay token en JS ni cabecera Authorization.
const api = axios.create({
  baseURL: API_BASE,
  headers: { "Content-Type": "application/json" },
  withCredentials: true,
});

// Un único refresh en vuelo: si varias peticiones reciben 401 a la vez, todas esperan al mismo
// POST /auth/refresh (el refresh token rota: dos refresh simultáneos revocarían la sesión).
let refreshInFlight: Promise<void> | null = null;
export function refreshSession(): Promise<void> {
  if (!refreshInFlight) {
    refreshInFlight = axios
      .post(`${API_BASE}/auth/refresh`, null, { withCredentials: true })
      .then(() => undefined)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

// Endpoints donde un 401 significa "credenciales incorrectas", no "sesión vencida".
const NO_REFRESH_URLS = ["/auth/login", "/auth/google", "/auth/register", "/auth/refresh", "/auth/logout"];

// ── Response: refrescar user en store si el backend devuelve datos actualizados
api.interceptors.response.use(
  (res) => {
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
      // BUG-07 fix: usar setUser() en vez de mutar store.user directamente.
      // Zustand solo notifica a los componentes suscritos y persiste a
      // localStorage cuando el cambio pasa por set()/setUser(); la
      // asignación directa nunca disparaba re-render ni persistía.
      if (current && "id" in current && current.id === data.id) {
        store.setUser({
          ...current,
          ...data,
        });
      }
    }
    return res;
  },
  async (err) => {
    const config = err.config as (typeof err.config & { _retried?: boolean }) | undefined;
    const isAuthEndpoint = NO_REFRESH_URLS.some((u) => config?.url?.includes(u));

    // 401 con sesión vencida: un intento de refresh y se reintenta la petición original una vez.
    if (err.response?.status === 401 && config && !isAuthEndpoint && !config._retried) {
      config._retried = true;
      try {
        await refreshSession();
        return api(config);
      } catch {
        // refresh fallido: la sesión terminó de verdad (cae al logout de abajo)
      }
    }

    // 401 definitivo → logout (no si se está iniciando sesión)
    if (err.response?.status === 401 && !isAuthEndpoint) {
      // Se espera el POST /auth/logout: la navegación dura lo abortaría y las cookies sobrevivirían.
      await useAuthStore.getState().logout();
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
        window.location.href = "/login";
      }
    }

    // Reportamos a la pantalla de Logs cualquier otro fallo de API
    // (4xx/5xx). El 401 se excluye a propósito: es parte del flujo
    // normal de sesión vencida, no un error a investigar.
    if (typeof window !== "undefined" && err.response?.status !== 401) {
      const status = err.response?.status;
      reportFrontendError({
        message: getErrorMessage(err, err.message || "Error de red al llamar a la API"),
        screen: window.location.pathname,
        level: status && status < 500 ? "warning" : "error",
        status_code: status,
        extra: {
          url: err.config?.url,
          method: err.config?.method,
        },
      });
    }

    return Promise.reject(err);
  }
);

export default api;