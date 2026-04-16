import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface User {
  id: number;
  username: string;
  name: string;
  surname: string;
  email: string;
  role: "student" | "teacher" | "teacher_admin" | "superadmin";
  // Perfil extendido
  timezone?: string;
  goal?: string;
  preferred_payment_methods?: string[];
  onboarding_completed?: boolean;
  // Foto
  avatar_url?: string | null;
}

interface AuthState {
  user: User | null;
  token: string | null;
  setAuth: (user: User, token: string) => void;
  setUser: (user: User) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user:  null,
      token: null,

      setAuth: (user, token) => set({ user, token }),

      // ← ya no da "declared but never read" porque lo usamos en el perfil
      setUser: (user) => set({ user }),

      logout: () => set({ user: null, token: null }),
    }),
    {
      name: "auth-storage",
      // Solo persistir token; user se rehidrata en cada carga
      partialize: (state) => ({
        token: state.token,
        user:  state.user,
      }),
    }
  )
);