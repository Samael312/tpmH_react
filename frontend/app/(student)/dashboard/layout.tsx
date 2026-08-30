"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import NavBar from "@/components/layout/NavBar";
import {
  Home,
  CalendarDays,
  MonitorPlay,
  Library,
  ClipboardEdit,
  GraduationCap,
  UserCircle,
  LogOut,
  ChevronLeft,
} from "lucide-react";

const FULLSCREEN_ROUTES = ["/dashboard/onboarding"];

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, token, logout, setUser, hasHydrated } = useAuthStore();
  const [collapsed, setCollapsed] = useState(false);
  const [checked, setChecked] = useState(false);

  const isFullscreen = FULLSCREEN_ROUTES.some((r) => pathname.startsWith(r));

  useEffect(() => {
    if (!hasHydrated) return;
    if (!user || !token) {
      router.replace("/login");
      return;
    }

    if (user.role !== "student") {
      router.replace("/login");
      return;
    }

    // If already on onboarding, don't re-check
    if (pathname.startsWith("/dashboard/onboarding")) {
      setChecked(true);
      return;
    }

    Promise.all([
      api.get("/users/me"),
      api.get("/users/me/student-profile").catch(() => ({ data: {} })),
    ]).then(([meRes, spRes]) => {
      const userData = meRes.data;
      const studentData = spRes.data;
      const onboardingCompleted = userData.onboarding_completed ?? false;

      setUser({
        ...user,
        onboarding_completed: onboardingCompleted,
        // solo sobreescribe si el perfil trae un valor real — nunca con "UTC" falso
        timezone: studentData?.timezone || user.timezone,
        goal: studentData?.goal ?? user.goal,
      });

      if (!onboardingCompleted) {
        router.replace("/dashboard/onboarding");
      } else {
        setChecked(true);
      }
    }).catch(() => {
      if (!user.onboarding_completed) {
        router.replace("/dashboard/onboarding");
      } else {
        setChecked(true);
      }
    });
  }, [pathname, hasHydrated]);

  const handleLogout = () => {
    logout();
    router.replace("/login");
  };

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
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto relative bg-slate-50 pt-14 pb-20 md:pt-0 md:pb-0">
        {/* Topbar: SOLO desktop (en mobile ya existe MobileTopBar dentro de NavBar) */}
        <header className="hidden md:flex h-20 sticky top-0 z-10 border-b border-pink-100/50
                           bg-white/80 backdrop-blur-md px-8
                           items-center justify-between shadow-sm shadow-slate-100/50">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-black text-white bg-pink-500 px-2 py-0.5 rounded-full uppercase tracking-tighter shadow-sm shadow-pink-200">
              Live
            </span>
            <div className="text-xs text-slate-400 font-bold uppercase tracking-[0.2em]">
              Dashboard
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex flex-col items-end">
              <span className="text-xs font-bold text-slate-700">{user?.name}</span>
              <span className="text-[10px] text-pink-400 font-medium italic leading-none">
                Estudiante
              </span>
            </div>
            <div className="w-10 h-10 rounded-full bg-pink-100 border-2 border-white shadow-sm flex items-center justify-center text-pink-500 font-bold">
              {user?.name?.charAt(0)}
            </div>
          </div>
        </header>

        <div className="max-w-7xl mx-auto px-6 py-8 md:px-10 md:py-12 min-h-full flex flex-col w-full">
          <div className="flex-1">{children}</div>
          <footer className="text-center py-6 mt-12 text-slate-400 text-sm font-medium border-t border-slate-200/60">
            © {new Date().getFullYear()} TuProfeMaria. Todos los derechos reservados.
          </footer>
        </div>
      </main>
    </div>
  );
}