import { create } from "zustand";
import { persist } from "zustand/middleware";
import Cookies from "js-cookie";

export interface User {
  id?: number;
  username: string;
  name: string;
  surname: string;
  email: string;
  role: "superadmin" | "teacher" | "teacher_admin" | "student";
  // Extended fields
  timezone?: string;
  goal?: string;
  phone_number?: string;
  preferred_payment_methods?: string[];
  onboarding_completed?: boolean;
  avatar_url?: string | null;
}

interface AuthStore {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  hasHydrated: boolean;

  login: (token: string, user: User) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
  setUser: (user: User) => void;
  setHasHydrated: (hydrated: boolean) => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: null,
      token: Cookies.get("access_token") || null,
      isLoading: false,
      hasHydrated: false,

      login: (token, user) => {
        Cookies.set("access_token", token, { expires: 7, secure: true });
        set({ user, token, isLoading: false });
      },

      logout: () => {
        Cookies.remove("access_token");
        set({ user: null, token: null, isLoading: false });
      },

      setLoading: (loading) => set({ isLoading: loading }),

      setUser: (user) => set({ user }),

      setHasHydrated: (hydrated) => set({ hasHydrated: hydrated }),
    }),
    {
      name: "auth-storage",
      partialize: (state) => ({
        token: state.token,
        user: state.user,
      }),
      onRehydrateStorage: () => (state) => {
        // Se llama cuando Zustand termina de leer localStorage
        state?.setHasHydrated(true);
      },
    }
  )
);