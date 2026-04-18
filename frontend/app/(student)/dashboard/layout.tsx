"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/store/authStore";
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

const STUDENT_NAV_ITEMS = [
  { href: "/dashboard",           label: "Inicio",     icon: <Home className="w-5 h-5" /> },
  { href: "/dashboard/schedule",  label: "Agendar",    icon: <CalendarDays className="w-5 h-5" /> },
  { href: "/dashboard/classes",   label: "Mis Clases", icon: <MonitorPlay className="w-5 h-5" /> },
  { href: "/dashboard/materials", label: "Materiales", icon: <Library className="w-5 h-5" /> },
  { href: "/dashboard/homework",  label: "Tareas",     icon: <ClipboardEdit className="w-5 h-5" /> },
  { href: "/dashboard/teacher",   label: "Profesora",  icon: <GraduationCap className="w-5 h-5" /> },
  { href: "/dashboard/profile",   label: "Mi Perfil",  icon: <UserCircle className="w-5 h-5" /> },
];

// Rutas donde el layout se renderiza limpio (sin sidebar)
const FULLSCREEN_ROUTES = ["/dashboard/onboarding"];

export default function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router   = useRouter();
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const [collapsed, setCollapsed] = useState(false);
  const [checked, setChecked]     = useState(false);

  const isFullscreen = FULLSCREEN_ROUTES.some((r) => pathname.startsWith(r));

  useEffect(() => {
    // Sin usuario → al login
    if (!user) {
      router.push("/login");
      return;
    }

    // Rol incorrecto → al login
    if (user.role !== "student") {
      router.push("/login");
      return;
    }

    // Onboarding pendiente → forzar onboarding
    // (no redirigir si ya está en onboarding)
    if (!user.onboarding_completed && !pathname.startsWith("/dashboard/onboarding")) {
      router.push("/dashboard/onboarding");
      return;
    }

    setChecked(true);
  }, [user, pathname, router]);

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  // Spinner mientras verificamos auth
  if (!checked && !isFullscreen) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-pink-200 border-t-pink-500
                          rounded-full animate-spin" />
      </div>
    );
  }

  // Layout limpio para onboarding (sin sidebar, sin footer)
  if (isFullscreen) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">

      {/* ─── Sidebar Lateral ─── */}
      <aside className={`
        flex flex-col bg-white border-r border-pink-100 shadow-xl shadow-pink-500/5
        transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] flex-shrink-0 z-50
        ${collapsed ? "w-20" : "w-64"}
      `}>
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-8">
          <div className="w-10 h-10 bg-gradient-to-br from-pink-500 to-rose-400
                            rounded-2xl flex-shrink-0 flex items-center justify-center
                            shadow-lg shadow-pink-200 transform hover:rotate-12
                            transition-transform">
            <span className="text-white text-xl font-black">T</span>
          </div>
          {!collapsed && (
            <div className="animate-in fade-in duration-300">
              <span className="font-black text-lg text-slate-800 tracking-tight
                               block leading-none">
                TPMH
              </span>
              <span className="text-[11px] font-bold text-pink-400 uppercase
                               tracking-widest">
                Student Hub
              </span>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 space-y-2 px-3 overflow-y-auto scrollbar-none">
          {STUDENT_NAV_ITEMS.map((item) => {
            const isActive =
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`
                  flex items-center gap-3 px-4 py-3 rounded-2xl
                  text-sm transition-all duration-300 group
                  ${isActive
                    ? "bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-md shadow-pink-100"
                    : "text-slate-500 hover:text-pink-500 hover:bg-pink-50/50"
                  }
                `}
                title={collapsed ? item.label : undefined}
              >
                <span className={`
                  flex-shrink-0 transition-transform duration-300 group-hover:scale-110
                  ${isActive
                    ? "text-white"
                    : "text-slate-400 group-hover:text-pink-400"
                  }
                `}>
                  {item.icon}
                </span>
                {!collapsed && (
                  <span className="font-bold tracking-tight">{item.label}</span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* User & Footer */}
        <div className="p-4 border-t border-slate-50 space-y-2 bg-white">
          {!collapsed && user && (
            <div className="px-4 py-3 mb-2 bg-slate-50 rounded-2xl
                              border border-slate-100 animate-in fade-in">
              <p className="text-slate-800 text-xs font-bold truncate">
                {user.name}
              </p>
              <p className="text-pink-400 text-[10px] font-black uppercase
                             tracking-tighter">
                ESTUDIANTE
              </p>
            </div>
          )}

          <button
            onClick={() => setCollapsed(!collapsed)}
            className="w-full flex items-center gap-3 px-4 py-2.5
                         text-slate-400 hover:text-pink-500 rounded-xl
                         hover:bg-pink-50 transition-all duration-200 text-sm font-bold"
            title={collapsed ? "Expandir" : "Contraer"}
          >
            <ChevronLeft className={`
              w-5 h-5 flex-shrink-0 transition-transform duration-500
              ${collapsed ? "rotate-180" : ""}
            `} />
            {!collapsed && <span>Contraer</span>}
          </button>

          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-2.5
                         text-slate-400 hover:text-rose-500 rounded-xl
                         hover:bg-rose-50 transition-all duration-200 text-sm font-bold"
            title={collapsed ? "Cerrar Sesión" : undefined}
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            {!collapsed && <span>Cerrar Sesión</span>}
          </button>
        </div>
      </aside>

      {/* ─── Área de Contenido ─── */}
      <main className="flex-1 h-screen overflow-y-auto relative bg-slate-50">
        <div className="max-w-7xl mx-auto px-6 py-8 md:px-10 md:py-12
                          min-h-full flex flex-col">
          <div className="flex-1">{children}</div>
          <footer className="text-center py-6 mt-12 text-slate-400 text-sm
                               font-medium border-t border-slate-200/60">
            © {new Date().getFullYear()} TuProfeMaria. Todos los derechos reservados.
          </footer>
        </div>
      </main>
    </div>
  );
}