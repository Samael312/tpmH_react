import axios from "axios";
import Cookies from "js-cookie";
import { useAuthStore } from "@/store/authStore";
import { reportFrontendError } from "@/lib/errorReporting";
import { getErrorMessage } from "@/lib/errorMessage";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1",
  headers: { "Content-Type": "application/json" },
});

// ── Request: adjuntar token ──
// BUG-16 fix: leer el token directamente de la cookie 'access_token' en vez
// de useAuthStore.getState().token. La cookie es la única fuente de verdad
// (proxy.ts, el middleware de rutas protegidas, corre en el servidor/edge y
// solo puede leer cookies) — mantener el token también en Zustand/localStorage
// duplicaba la fuente de verdad y podía desincronizarse.
api.interceptors.request.use((config) => {
  const token = Cookies.get("access_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

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
  (err) => {
    // 👇 SOLUCIÓN: Verificamos si la petición fue al endpoint de login
    const isLoginEndpoint = err.config?.url?.includes("/auth/login");

    // 401 → logout (SOLO si no estamos intentando iniciar sesión)
    if (err.response?.status === 401 && !isLoginEndpoint) {
      useAuthStore.getState().logout();
      window.location.href = "/login";
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