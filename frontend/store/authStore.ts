import { create } from "zustand";
import Cookies from "js-cookie";

interface User {
  username: string;
  name: string;
  role: "superadmin" | "teacher" | "student";
}

interface AuthStore {
  user: User | null;
  token: string | null;
  isLoading: boolean;

  // Acciones
  login: (token: string, user: User) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  token: Cookies.get("access_token") || null,
  isLoading: true,

  login: (token, user) => {
    // Guarda el token en cookie (expira en 1 día)
    Cookies.set("access_token", token, { expires: 1, secure: true });
    set({ user, token, isLoading: false });
  },

  logout: () => {
    Cookies.remove("access_token");
    set({ user: null, token: null, isLoading: false });
  },

  setLoading: (loading) => set({ isLoading: loading }),
}));