import { create } from "zustand";
import Cookies from "js-cookie";

export interface User {
  username: string;
  name: string;
  surname: string;
  email: string;
  role: "superadmin" | "teacher" | "student";
  // Campos extendidos
  timezone?: string;
  goal?: string;
  preferred_payment_methods?: string[];
  onboarding_completed?: boolean;
  avatar_url?: string | null;
}

interface AuthStore {
  user: User | null;
  token: string | null;
  isLoading: boolean;

  login: (token: string, user: User) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
  setUser: (user: User) => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user:      null,
  token:     Cookies.get("access_token") || null,
  isLoading: true,

  login: (token, user) => {
    Cookies.set("access_token", token, { expires: 1, secure: true });
    set({ user, token, isLoading: false });
  },

  logout: () => {
    Cookies.remove("access_token");
    set({ user: null, token: null, isLoading: false });
  },

  setLoading: (loading) => set({ isLoading: loading }),

  setUser: (user) => set({ user }),
}));