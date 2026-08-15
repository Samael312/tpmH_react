"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import NavBar from "@/components/layout/NavBar";
import { PageSkeleton, RefreshButton } from "@/components/ui";
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

  if (!checked && !isFullscreen) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <PageSkeleton />
      </div>
    );
  }

  if (isFullscreen) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen bg-slate-50 overflow-hidden">
      <NavBar />
      <RefreshButton onRefresh={() => window.location.reload()} className="fixed right-4 top-4 z-[60] bg-white md:right-6" />

      {/* ─── Área de Contenido ─── */}
      <main className="flex-1 min-h-screen overflow-y-auto relative bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 md:px-10 md:py-12 min-h-full flex flex-col">
          <div className="flex-1">{children}</div>
          <footer className="text-center py-6 mt-12 text-slate-400 text-sm font-medium border-t border-slate-200/60">
            © {new Date().getFullYear()} TuProfeMaria. Todos los derechos reservados.
          </footer>
        </div>
      </main>
    </div>
  );
}