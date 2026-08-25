import axios from "axios";
import Cookies from "js-cookie";
import { useAuthStore } from "@/store/authStore";

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
    
    return Promise.reject(err);
  }
);

export default api;