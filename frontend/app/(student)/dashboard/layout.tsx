"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { fetchMe } from "@/lib/me";
import NavBar from "@/components/layout/NavBar";
import DashboardTopbar from "@/components/layout/DashboardTopbar";
import ChatWidget from "@/components/chat/ChatWidget";
import VerifyEmailBanner from "@/components/layout/VerifyEmailBanner";
import { useLandingData } from "@/hooks/useLandingData";
import { usePlatformConfig } from "@/hooks/useStudentData";
import { useChatSocketBootstrap } from "@/hooks/useChat";

const FULLSCREEN_ROUTES = ["/dashboard/onboarding"];

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const qc = useQueryClient();
  const pathname = usePathname();
  const { user, setUser, hasHydrated } = useAuthStore();
  const { platformName } = useLandingData();
  const { config: platformConfig } = usePlatformConfig();
  const [checked, setChecked] = useState(false);

  // N3: conexión WS global del chat interno — se mantiene viva en TODO el
  // dashboard, no solo en /dashboard/chat (ver store/chatStore.ts). Antes
  // el socket se abría/cerraba junto con la pantalla de chat, así que no
  // había forma de recibir mensajes en tiempo real estando en otra parte
  // de la app.
  useChatSocketBootstrap(!!user && platformConfig?.chat_enabled === true);

  const isFullscreen = FULLSCREEN_ROUTES.some((r) => pathname.startsWith(r));
  const isHome = pathname === "/dashboard";

  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // El onboarding se verifica contra la API UNA vez por sesión del layout. Antes se repetía en cada cambio de
  // ruta (2 peticiones, /users/me y el perfil, por cada clic del menú).
  const verifiedRef = useRef(false);
  const hasUser = !!user;

  useEffect(() => {
    if (!hasHydrated) return;
    const currentUser = userRef.current;
    if (!currentUser) {
      verifiedRef.current = false;
      // SEC-05 / UX-01: sesión por cookie HttpOnly pero sin `user` en localStorage -> se recupera de /users/me.
      // Si la sesión no es válida, el interceptor de api.ts intenta el refresh y, si falla, redirige al login.
      fetchMe(qc).then((me) => setUser({ ...me })).catch(() => router.replace("/login"));
      return;
    }

    if (currentUser.role !== "student") {
      router.replace("/login");
      return;
    }

    // If already on onboarding, don't re-check
    if (pathname.startsWith("/dashboard/onboarding")) {
      return;
    }

    // Ya verificado en esta sesión: `checked` sigue en true (el layout no se desmonta al navegar).
    if (verifiedRef.current) return;

    Promise.all([
      fetchMe(qc).then((data) => ({ data })),
      api.get("/users/me/student-profile").catch(() => ({ data: {} })),
    ]).then(([meRes, spRes]) => {
      const userData = meRes.data;
      const studentData = spRes.data;
      const onboardingCompleted = userData.onboarding_completed ?? false;
      const latestUser = userRef.current;
      if (!latestUser) return;

      setUser({
        ...latestUser,
        id: userData.id ?? latestUser.id, // el login no trae el id; el chat lo necesita (antes salía del JWT)
        onboarding_completed: onboardingCompleted,
        // solo sobreescribe si el perfil trae un valor real — nunca con "UTC" falso
        timezone: studentData?.timezone || latestUser.timezone,
        goal: studentData?.goal ?? latestUser.goal,
      });

      if (!onboardingCompleted) {
        router.replace("/dashboard/onboarding");
      } else {
        verifiedRef.current = true;
        setChecked(true);
      }
    }).catch(() => {
      const latestUser = userRef.current;
      if (!latestUser?.onboarding_completed) {
        router.replace("/dashboard/onboarding");
      } else {
        setChecked(true);
      }
    });
  }, [pathname, hasHydrated, hasUser, router, setUser, qc]);

  // Si el store ya no tiene user/token (p.ej. logout en curso), no renderizar
  // el dashboard con datos nulos: mostrar spinner mientras se redirige.
  if (hasHydrated && !user && !isFullscreen) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-pink-200 border-t-pink-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!checked && !isFullscreen) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-pink-200 border-t-pink-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (isFullscreen) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <NavBar />
      {/* En /dashboard/chat el widget flotante sería redundante (ya estás
          en la pantalla completa del chat) — ahí solo va el ChipiWidget,
          que cada página monta por su cuenta. */}
      {!pathname.startsWith("/dashboard/chat") && <ChatWidget />}

      {/* ─── Área de Contenido ─── */}
      <main className="flex-1 flex flex-col min-w-0 bg-slate-50 pt-14 pb-20 md:pt-0 md:pb-0">
       {!isHome && <DashboardTopbar variant="student" />}

        <div className="flex-1 overflow-y-auto relative">
          <div className="max-w-7xl mx-auto px-6 py-8 md:px-10 md:py-4 min-h-full flex flex-col">
            <VerifyEmailBanner />
            <div className="flex-1">{children}</div>
            <footer className="text-center py-6 mt-12 text-slate-400 text-sm font-medium border-t border-slate-200/60">
              © {new Date().getFullYear()} {platformName}. Todos los derechos reservados.
            </footer>
          </div>
        </div>
      </main>
    </div>
  );
}