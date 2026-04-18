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
  const { user, token, logout, setUser } = useAuthStore();
  const [collapsed, setCollapsed] = useState(false);
  const [checked, setChecked] = useState(false);

  const isFullscreen = FULLSCREEN_ROUTES.some((r) => pathname.startsWith(r));

  useEffect(() => {
    if (!user || !token) {
      router.push("/login");
      return;
    }

    if (user.role !== "student") {
      router.push("/login");
      return;
    }

    // If already on onboarding, don't re-check
    if (pathname.startsWith("/dashboard/onboarding")) {
      setChecked(true);
      return;
    }

    // Fetch fresh user data from API to get correct onboarding_completed
    api.get("/users/me").then(res => {
      const userData = res.data;
      const onboardingCompleted = userData.onboarding_completed ?? false;

      // Update store with fresh data
      setUser({
        ...user,
        onboarding_completed: onboardingCompleted,
        timezone: userData.student_profile?.timezone || userData.timezone || user.timezone,
        goal: userData.student_profile?.goal || userData.goal,
      });

      if (!onboardingCompleted) {
        router.push("/dashboard/onboarding");
      } else {
        setChecked(true);
      }
    }).catch(() => {
      // Fallback to store value if API fails
      if (!user.onboarding_completed) {
        router.push("/dashboard/onboarding");
      } else {
        setChecked(true);
      }
    });
  }, [pathname]);

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

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
      <main className="flex-1 h-screen overflow-y-auto relative bg-slate-50">
        <div className="max-w-7xl mx-auto px-6 py-8 md:px-10 md:py-12 min-h-full flex flex-col">
          <div className="flex-1">{children}</div>
          <footer className="text-center py-6 mt-12 text-slate-400 text-sm font-medium border-t border-slate-200/60">
            © {new Date().getFullYear()} TuProfeMaria. Todos los derechos reservados.
          </footer>
        </div>
      </main>
    </div>
  );
}