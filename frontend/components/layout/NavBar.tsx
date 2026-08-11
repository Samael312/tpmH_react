"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import {
  LayoutDashboard, Users, GraduationCap, Calendar, Settings, LogOut,
  MonitorPlay, UserCircle, ClipboardEdit, CreditCard, Book, BarChart, ChevronLeft,
  MoreHorizontal, Package as PackageIcon,
} from "lucide-react";
import BottomSheet from "@/components/ui/BottomSheet";
import { useMobileTopBar } from "@/lib/mobileTopBar";
import RefreshButton from "@/components/ui/RefreshButton";

interface TabItem { href: string; label: string; icon: React.ReactNode; }

// ─── Config de tabs móviles por rol (máx. 4 fijos + resto en "Más") ──────────
const STUDENT_MAIN: TabItem[] = [
  { href: "/dashboard", label: "Inicio", icon: <LayoutDashboard size={20} /> },
  { href: "/dashboard/schedule", label: "Horario", icon: <Calendar size={20} /> },
  { href: "/dashboard/classes", label: "Clases", icon: <MonitorPlay size={20} /> },
  { href: "/dashboard/profile", label: "Perfil", icon: <UserCircle size={20} /> },
];
const STUDENT_MORE: TabItem[] = [
  { href: "/dashboard/availability", label: "Disponibilidad", icon: <Users size={20} /> },
  { href: "/dashboard/materials", label: "Materiales", icon: <Book size={20} /> },
  { href: "/dashboard/homework", label: "Tareas", icon: <ClipboardEdit size={20} /> },
  { href: "/dashboard/teachers", label: "Profesores", icon: <GraduationCap size={20} /> },
];

const TEACHER_MAIN: TabItem[] = [
  { href: "/teacher/dashboard", label: "Clases", icon: <LayoutDashboard size={20} /> },
  { href: "/teacher/availability", label: "Horario", icon: <Calendar size={20} /> },
  { href: "/teacher/students", label: "Estudiantes", icon: <GraduationCap size={20} /> },
  { href: "/teacher/profile", label: "Perfil", icon: <UserCircle size={20} /> },
];
const TEACHER_MORE: TabItem[] = [
  { href: "/teacher/materials", label: "Materiales", icon: <Book size={20} /> },
  { href: "/teacher/homework", label: "Tareas", icon: <ClipboardEdit size={20} /> },
  { href: "/teacher/packages", label: "Paquetes", icon: <CreditCard size={20} /> },
  { href: "/teacher/wallet", label: "Ganancias", icon: <BarChart size={20} /> },
];

const ADMIN_MAIN: TabItem[] = [
  { href: "/admin/dashboard", label: "Global", icon: <LayoutDashboard size={20} /> },
  { href: "/admin/teachers", label: "Profesores", icon: <Book size={20} /> },
  { href: "/admin/students", label: "Estudiantes", icon: <GraduationCap size={20} /> },
  { href: "/admin/payments", label: "Pagos", icon: <CreditCard size={20} /> },
];
// Flow Tester queda fuera del menú móvil a propósito — es exclusivo de escritorio.
const ADMIN_MORE: TabItem[] = [
  { href: "/admin/package-requests", label: "Solicitudes", icon: <PackageIcon size={20} /> },
  { href: "/admin/settings", label: "Configuración", icon: <Settings size={20} /> },
];

// ─── Top bar móvil (título de página + refresh, vía contexto) ───────────────
function MobileTopBar() {
  const { title, onRefresh, isFetching } = useMobileTopBar();
  return (
    <header
      className="md:hidden fixed top-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md
                 border-b border-slate-100 flex items-center justify-between px-4 shadow-sm"
      style={{
        paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)",
        paddingBottom: "0.75rem",
      }}
    >
      <h1 className="text-sm font-black text-slate-800 truncate">{title || "TPMH"}</h1>
      {onRefresh && <RefreshButton onRefresh={onRefresh} isFetching={isFetching} className="w-8 h-8" />}
    </header>
  );
}

// ─── Bottom tab bar móvil ─────────────────────────────────────────────────
function BottomTabBar({
  mainItems, moreItems, onLogout,
}: { mainItems: TabItem[]; moreItems: TabItem[]; onLogout: () => void }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <>
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-slate-100
                   shadow-[0_-4px_12px_rgba(0,0,0,0.05)] flex items-stretch"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {mainItems.slice(0, 4).map(item => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-bold transition-colors
                ${active ? "text-pink-600" : "text-slate-400"}`}
            >
              <span className={active ? "scale-110 transition-transform" : ""}>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
        {moreItems.length > 0 && (
          <button
            onClick={() => setMoreOpen(true)}
            className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-bold text-slate-400"
          >
            <MoreHorizontal size={20} />
            Más
          </button>
        )}
      </nav>

      <BottomSheet open={moreOpen} onClose={() => setMoreOpen(false)} title="Más opciones">
        <div className="grid grid-cols-3 gap-3 pb-1">
          {moreItems.map(item => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMoreOpen(false)}
              className="flex flex-col items-center justify-center gap-2 py-4 rounded-2xl bg-slate-50
                         hover:bg-pink-50 text-slate-600 hover:text-pink-600 transition-colors text-xs font-bold text-center"
            >
              {item.icon}
              {item.label}
            </Link>
          ))}
          <button
            onClick={onLogout}
            className="flex flex-col items-center justify-center gap-2 py-4 rounded-2xl bg-rose-50
                       text-rose-500 text-xs font-bold col-span-3 mt-1"
          >
            <LogOut size={18} />
            Cerrar sesión
          </button>
        </div>
      </BottomSheet>
    </>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────
export default function DashboardSidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const [collapsed, setCollapsed] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => { setIsMounted(true); }, []);

  const role = user?.role || "";
  const showAdminMenu = ["superadmin", "teacher_admin"].includes(role);
  const showTeacherMenu = ["teacher", "teacher_admin"].includes(role);
  const showStudentMenu = role === "student";

  const handleLogout = () => {
    logout();
    window.location.href = "/login";
  };

  const isActive = (path: string) => pathname === path || pathname.startsWith(path + "/");

  // Prioridad para decidir qué tabs móviles mostrar si el usuario tiene rol mixto
  const mobileMain = showStudentMenu ? STUDENT_MAIN : showTeacherMenu ? TEACHER_MAIN : ADMIN_MAIN;
  const mobileMore = showStudentMenu ? STUDENT_MORE : showTeacherMenu ? TEACHER_MORE : ADMIN_MORE;

  if (!isMounted) {
    return <aside className="hidden md:flex w-64 bg-white border-r border-pink-100 min-h-screen shadow-xl shadow-pink-500/5 flex-shrink-0 z-50" />;
  }

  return (
    <>
      {/* ─── Sidebar: SOLO desktop ─── */}
      <aside className={`
        hidden md:flex flex-col bg-white border-r border-pink-100 shadow-xl shadow-pink-500/5
        transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] flex-shrink-0 z-50
        ${collapsed ? "w-20" : "w-64"}
      `}>
        <div className="flex items-center gap-3 px-5 py-8">
          <div className="w-10 h-10 bg-gradient-to-br from-pink-500 to-rose-400 rounded-2xl flex-shrink-0 flex items-center justify-center shadow-lg shadow-pink-200 transform hover:rotate-12 transition-transform">
            <span className="text-white text-xl font-black">T</span>
          </div>
          {!collapsed && (
            <div className="animate-in fade-in duration-300">
              <span className="font-black text-lg text-slate-800 tracking-tight block leading-none">TPMH</span>
              <span className="text-[11px] font-bold text-pink-400 uppercase tracking-widest">Portal</span>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto py-2 px-3 space-y-6 scrollbar-none">
          {showStudentMenu && (
            <div>
              {!collapsed ? (
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 px-4">Mi Portal</h3>
              ) : (
                <div className="h-px bg-slate-100 my-4 mx-4"></div>
              )}
              <nav className="space-y-1">
                <NavItem href="/dashboard" icon={<LayoutDashboard size={20} />} label="Inicio" active={pathname === "/dashboard"} collapsed={collapsed} />
                <NavItem href="/dashboard/schedule" icon={<Calendar size={20} />} label="Horario" active={isActive("/dashboard/schedule")} collapsed={collapsed} />
                <NavItem href="/dashboard/availability" icon={<Users size={20} />} label="Disponibilidad" active={isActive("/dashboard/availability")} collapsed={collapsed} />
                <NavItem href="/dashboard/classes" icon={<MonitorPlay size={20} />} label="Mis Clases" active={isActive("/dashboard/classes")} collapsed={collapsed} />
                <NavItem href="/dashboard/materials" icon={<Book size={20} />} label="Materiales" active={isActive("/dashboard/materials")} collapsed={collapsed} />
                <NavItem href="/dashboard/homework" icon={<ClipboardEdit size={20} />} label="Mis Tareas" active={isActive("/dashboard/homework")} collapsed={collapsed} />
                <NavItem href="/dashboard/teachers" icon={<GraduationCap size={20} />} label="Profesores" active={isActive("/dashboard/teachers")} collapsed={collapsed} />
                <NavItem href="/dashboard/profile" icon={<UserCircle size={20} />} label="Mi Perfil" active={isActive("/dashboard/profile")} collapsed={collapsed} />
              </nav>
            </div>
          )}

          {showTeacherMenu && (
            <div>
              {!collapsed ? (
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 px-4 mt-4">Aula Virtual</h3>
              ) : (
                <div className="h-px bg-slate-100 my-4 mx-4"></div>
              )}
              <nav className="space-y-1">
                <NavItem href="/teacher/dashboard" icon={<LayoutDashboard size={20} />} label="Mis Clases" active={pathname === "/teacher/dashboard"} collapsed={collapsed} />
                <NavItem href="/teacher/availability" icon={<Calendar size={20} />} label="Disponibilidad" active={isActive("/teacher/availability")} collapsed={collapsed} />
                <NavItem href="/teacher/students" icon={<GraduationCap size={20} />} label="Estudiantes" active={isActive("/teacher/students")} collapsed={collapsed} />
                <NavItem href="/teacher/materials" icon={<Book size={20} />} label="Materiales" active={isActive("/teacher/materials")} collapsed={collapsed} />
                <NavItem href="/teacher/homework" icon={<ClipboardEdit size={20} />} label="Tareas" active={isActive("/teacher/homework")} collapsed={collapsed} />
                <NavItem href="/teacher/packages" icon={<CreditCard size={20} />} label="Paquetes" active={isActive("/teacher/packages")} collapsed={collapsed} />
                <NavItem href="/teacher/wallet" icon={<BarChart size={20} />} label="Ganancias" active={isActive("/teacher/wallet")} collapsed={collapsed} />
                <NavItem href="/teacher/profile" icon={<UserCircle size={20} />} label="Mi Perfil" active={isActive("/teacher/profile")} collapsed={collapsed} />
              </nav>
            </div>
          )}

          {showAdminMenu && (
            <div>
              {!collapsed ? (
                <h3 className="text-[10px] font-bold text-pink-500 uppercase tracking-widest mb-3 px-4 mt-4">Administración</h3>
              ) : (
                <div className="h-px bg-pink-100 my-4 mx-4"></div>
              )}
              <nav className="space-y-1">
                <NavItem href="/admin/dashboard" icon={<LayoutDashboard size={20} />} label="Vista Global" active={pathname === "/admin/dashboard"} collapsed={collapsed} />
                <NavItem href="/admin/teachers" icon={<Book size={20} />} label="Profesores" active={isActive("/admin/teachers")} collapsed={collapsed} />
                <NavItem href="/admin/students" icon={<GraduationCap size={20} />} label="Estudiantes" active={isActive("/admin/students")} collapsed={collapsed} />
                <NavItem href="/admin/package-requests" icon={<PackageIcon size={20} />} label="Solicitudes de Paquetes" active={isActive("/admin/package-requests")} collapsed={collapsed} />
                <NavItem href="/admin/payments" icon={<CreditCard size={20} />} label="Pagos y Facturas" active={isActive("/admin/payments")} collapsed={collapsed} />
                <NavItem href="/admin/settings" icon={<Settings size={20} />} label="Configuración" active={isActive("/admin/settings")} collapsed={collapsed} />
                <NavItem href="/admin/flow-tester" icon={<LayoutDashboard size={20} />} label="Flow Tester" active={isActive("/admin/flow-tester")} collapsed={collapsed} />
              </nav>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-50 space-y-2 bg-white">
          {!collapsed && user && (
            <div className="px-4 py-3 mb-2 bg-slate-50 rounded-2xl border border-slate-100 animate-in fade-in">
              <p className="text-slate-800 text-xs font-bold truncate">{user.name}</p>
              <p className="text-pink-400 text-[10px] font-black uppercase tracking-tighter">
                {role.replace("_", " ")}
              </p>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-slate-400 hover:text-pink-500 rounded-xl hover:bg-pink-50 transition-all duration-200 text-sm font-bold"
            title={collapsed ? "Expandir" : "Contraer"}
          >
            <ChevronLeft className={`w-5 h-5 flex-shrink-0 transition-transform duration-500 ${collapsed ? "rotate-180" : ""}`} />
            {!collapsed && <span>Contraer</span>}
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-slate-400 hover:text-rose-500 rounded-xl hover:bg-rose-50 transition-all duration-200 text-sm font-bold"
            title={collapsed ? "Cerrar Sesión" : undefined}
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            {!collapsed && <span>Cerrar Sesión</span>}
          </button>
        </div>
      </aside>

      {/* ─── Mobile: top bar + bottom tab bar ─── */}
      <MobileTopBar />
      <BottomTabBar mainItems={mobileMain} moreItems={mobileMore} onLogout={handleLogout} />
    </>
  );
}

function NavItem({ href, icon, label, active, collapsed }: { href: string; icon: React.ReactNode; label: string; active: boolean; collapsed: boolean }) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-sm transition-all duration-300 group ${
        active
          ? "bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-md shadow-pink-100"
          : "text-slate-500 hover:text-pink-500 hover:bg-pink-50/50"
      }`}
    >
      <span className={`flex-shrink-0 transition-transform duration-300 group-hover:scale-110 ${
        active ? "text-white" : "text-slate-400 group-hover:text-pink-400"
      }`}>
        {icon}
      </span>
      {!collapsed && <span className="font-semibold tracking-tight whitespace-nowrap">{label}</span>}
    </Link>
  );
}