"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/store/authStore";
import { getValidToken, decodeToken } from "@/lib/auth";
import api from "@/lib/api";

export function useAuth() {
  const { user, token, isLoading, login, logout, setLoading } = useAuthStore();

  useEffect(() => {
    const initAuth = async () => {
      const validToken = getValidToken();

      if (!validToken) {
        setLoading(false);
        return;
      }

      // Si hay token válido pero no hay usuario en memoria
      // (por ejemplo al recargar la página) recuperamos los datos
      if (!user) {
        try {
          const payload = decodeToken(validToken);
          if (!payload) {
            logout();
            return;
          }

          // Llamamos al backend para obtener los datos actualizados del usuario
          const response = await api.get("/users/me");
          login(validToken, {
            username: response.data.username,
            name: response.data.name,
            role: response.data.role,
          });
        } catch {
          logout();
        }
      }

      setLoading(false);
    };

    initAuth();
  }, []);

  return { user, token, isLoading, logout };
}