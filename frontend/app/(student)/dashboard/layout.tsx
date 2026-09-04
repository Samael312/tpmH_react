"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import NavBar from "@/components/layout/NavBar";
import DashboardTopbar from "@/components/layout/DashboardTopbar";

const FULLSCREEN_ROUTES = ["/dashboard/onboarding"];

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, token, setUser, hasHydrated } = useAuthStore();
  const [checked, setChecked] = useState(false);

  const isFullscreen = FULLSCREEN_ROUTES.some((r) => pathname.startsWith(r));
  const isHome = pathname === "/dashboard";

  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    if (!hasHydrated) return;
    const currentUser = userRef.current;
    if (!currentUser || !token) {
      router.replace("/login");
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

    Promise.all([
      api.get("/users/me"),
      api.get("/users/me/student-profile").catch(() => ({ data: {} })),
    ]).then(([meRes, spRes]) => {
      const userData = meRes.data;
      const studentData = spRes.data;
      const onboardingCompleted = userData.onboarding_completed ?? false;
      const latestUser = userRef.current;
      if (!latestUser) return;

      setUser({
        ...latestUser,
        onboarding_completed: onboardingCompleted,
        // solo sobreescribe si el perfil trae un valor real — nunca con "UTC" falso
        timezone: studentData?.timezone || latestUser.timezone,
        goal: studentData?.goal ?? latestUser.goal,
      });

      if (!onboardingCompleted) {
        router.replace("/dashboard/onboarding");
      } else {
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
  }, [pathname, hasHydrated, token, router, setUser]);

  // Si el store ya no tiene user/token (p.ej. logout en curso), no renderizar
  // el dashboard con datos nulos: mostrar spinner mientras se redirige.
  if (hasHydrated && (!user || !token) && !isFullscreen) {
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

      {/* ─── Área de Contenido ─── */}
      <main className="flex-1 flex flex-col min-w-0 bg-slate-50 pt-14 pb-20 md:pt-0 md:pb-0">
       {!isHome && <DashboardTopbar variant="student" />}

        <div className="flex-1 overflow-y-auto relative">
          <div className="max-w-7xl mx-auto px-6 py-8 md:px-10 md:py-4 min-h-full flex flex-col">
            <div className="flex-1">{children}</div>
            <footer className="text-center py-6 mt-12 text-slate-400 text-sm font-medium border-t border-slate-200/60">
              © {new Date().getFullYear()} TuProfeMaria. Todos los derechos reservados.
            </footer>
          </div>
        </div>
      </main>
    </div>
  );
}