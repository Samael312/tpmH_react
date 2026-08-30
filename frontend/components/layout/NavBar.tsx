"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { 
  LayoutDashboard, Users, GraduationCap, Calendar, Settings, LogOut, 
  MonitorPlay, UserCircle, ClipboardEdit, CreditCard, Book, BarChart, ChevronLeft,
  CheckCheck, Package as PackageIcon, MoreHorizontal, Users2, LifeBuoy, Crown
} from "lucide-react";
import { useUnreadNotificationCount } from "@/hooks/useAdminData";
import { useUnreadSupportCount } from "@/hooks/useSupport";

import { useMobileTopBar } from "@/lib/mobileTopBar";
import RefreshButton from "@/components/ui/RefreshButton";
import BottomSheet from "@/components/ui/BottomSheet";

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
  { href: "/dashboard/support", label: "Soporte", icon: <LifeBuoy size={20} /> },
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
  { href: "/teacher/cohorts", label: "Grupos", icon: <Users2 size={20} /> },
  { href: "/teacher/wallet", label: "Ganancias", icon: <BarChart size={20} /> },
  { href: "/teacher/support", label: "Soporte", icon: <LifeBuoy size={20} /> },
];

const ADMIN_MAIN: TabItem[] = [
  { href: "/admin/dashboard", label: "Global", icon: <LayoutDashboard size={20} /> },
  { href: "/admin/teachers", label: "Profesores", icon: <Book size={20} /> },
  { href: "/admin/students", label: "Estudiantes", icon: <GraduationCap size={20} /> },
  { href: "/admin/payments", label: "Pagos", icon: <CreditCard size={20} /> },
];
const ADMIN_MORE: TabItem[] = [
  { href: "/admin/god-mode", label: "Modo Dios", icon: <Crown size={20} /> },
  { href: "/admin/package-requests", label: "Solicitudes", icon: <PackageIcon size={20} /> },
  { href: "/admin/support", label: "Soporte", icon: <LifeBuoy size={20} /> },
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

  const role = user?.role || "";
  const showAdminMenu = ["superadmin", "teacher_admin"].includes(role);
  const showTeacherMenu = ["teacher", "teacher_admin"].includes(role);
  const showStudentMenu = role === "student";
  const { count: unreadCount } = useUnreadNotificationCount(showAdminMenu);
  const { count: unreadSupportCount } = useUnreadSupportCount(showStudentMenu || (showTeacherMenu && role === "teacher"));

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const handleLogout = () => {
    logout();
    // Recarga completa (en vez de router.push) para evitar que el layout
    // quede montado un instante con user=null y renderice en blanco/crashee,
    // sobre todo en mobile donde la navegación client-side es más lenta.
    window.location.href = '/login';
  };

  if (!isMounted) {
    return <aside className="hidden md:flex w-64 bg-white border-r border-pink-100 min-h-screen shadow-xl shadow-pink-500/5 flex-shrink-0 z-50" />;
  }

  const isActive = (path: string) => pathname === path || pathname.startsWith(path + "/");

  // Prioridad para decidir qué tabs móviles mostrar
  const mobileMain = showStudentMenu ? STUDENT_MAIN : showTeacherMenu ? TEACHER_MAIN : ADMIN_MAIN;
  const mobileMore = showStudentMenu ? STUDENT_MORE : showTeacherMenu ? TEACHER_MORE : ADMIN_MORE;

  return (
    <>
      {/* ─── Sidebar: SOLO desktop ─── */}
      <aside className={`
        hidden md:flex flex-col bg-white border-r border-pink-100 shadow-xl shadow-pink-500/5
        transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] flex-shrink-0 z-50 min-h-screen
        ${collapsed ? "w-20" : "w-64"}
      `}>
        {/* Cabecera Sidebar */}
        <div
          className={`flex items-center py-6 ${
            collapsed ? "flex-col gap-3 px-2" : "justify-between px-5"
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-pink-500 to-rose-400 rounded-2xl flex-shrink-0 flex items-center justify-center shadow-lg shadow-pink-200 transform hover:rotate-12 transition-transform overflow-hidden">
              <img
                src="/assets/logo.png"
                alt="TPMH"
                className="w-full h-full object-contain p-1.5"
              />
            </div>
            {!collapsed && (
              <div className="animate-in fade-in duration-300">
                <span className="font-black text-lg text-slate-800 tracking-tight block leading-none">TPMH</span>
                <span className="text-[11px] font-bold text-pink-400 uppercase tracking-widest">Portal</span>
              </div>
            )}
          </div>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1.5 rounded-xl text-slate-400 hover:text-pink-600 hover:bg-pink-50 transition-colors flex-shrink-0"
            title={collapsed ? "Expandir" : "Colapsar"}
          >
            <ChevronLeft className={`w-5 h-5 transition-transform duration-300 ${collapsed ? "rotate-180" : ""}`} />
          </button>
        </div>

        {/* Lista de navegación */}
        <div className="flex-1 overflow-y-auto py-2 px-3 space-y-6 scrollbar-none">
          {/* 🎓 MENÚ ESTUDIANTE */}
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
                <NavItem href="/dashboard/support" icon={<LifeBuoy size={20} />} label="Soporte" active={isActive("/dashboard/support")} collapsed={collapsed} badge={unreadSupportCount > 0 ? unreadSupportCount : undefined} />
                <NavItem href="/dashboard/profile" icon={<UserCircle size={20} />} label="Mi Perfil" active={isActive("/dashboard/profile")} collapsed={collapsed} />
              </nav>
            </div>
          )}

          {/* 👨‍🏫 MENÚ PROFESOR */}
          {showTeacherMenu && (
            <div>
              {!collapsed ? (
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 px-4 mt-2">Aula Virtual</h3>
              ) : (
                <div className="h-px bg-slate-100 my-4 mx-4"></div>
              )}
              <nav className="space-y-1">
                <NavItem href="/teacher/dashboard" icon={<LayoutDashboard size={20} />} label="Mis Clases" active={pathname === "/teacher/dashboard"} collapsed={collapsed} />
                <NavItem href="/teacher/availability" icon={<Calendar size={20} />} label="Disponibilidad" active={isActive("/teacher/availability")} collapsed={collapsed} />
                <NavItem href="/teacher/students" icon={<GraduationCap size={20} />} label="Estudiantes" active={isActive("/teacher/students")} collapsed={collapsed} />
                <NavItem href="/teacher/materials" icon={<Book size={20} />} label="Materiales" active={isActive("/teacher/materials")} collapsed={collapsed} />
                <NavItem href="/teacher/payments" icon={<CreditCard size={20} />} label="Pagos" active={isActive("/teacher/payments")} collapsed={collapsed} />
                <NavItem href="/teacher/homework" icon={<ClipboardEdit size={20} />} label="Tareas" active={isActive("/teacher/homework")} collapsed={collapsed} />
                <NavItem href="/teacher/packages" icon={<CreditCard size={20} />} label="Paquetes" active={isActive("/teacher/packages")} collapsed={collapsed} />
                <NavItem href="/teacher/cohorts" icon={<Users2 size={20} />} label="Grupos" active={isActive("/teacher/cohorts")} collapsed={collapsed} />
                <NavItem href="/teacher/wallet" icon={<BarChart size={20} />} label="Ganancias" active={isActive("/teacher/wallet")} collapsed={collapsed} />
                <NavItem href="/teacher/support" icon={<LifeBuoy size={20} />} label="Soporte" active={isActive("/teacher/support")} collapsed={collapsed} badge={unreadSupportCount > 0 ? unreadSupportCount : undefined} />
                <NavItem href="/teacher/profile" icon={<UserCircle size={20} />} label="Mi Perfil" active={isActive("/teacher/profile")} collapsed={collapsed} />
              </nav>
            </div>
          )}

          {/* 👑 MENÚ ADMIN */}
          {showAdminMenu && (
            <div>
              {!collapsed ? (
                <h3 className="text-[10px] font-bold text-pink-500 uppercase tracking-widest mb-3 px-4 mt-2">Administración</h3>
              ) : (
                <div className="h-px bg-pink-100 my-4 mx-4"></div>
              )}
              <nav className="space-y-1">
                <NavItem
                  href="/admin/dashboard"
                  icon={<LayoutDashboard size={20} />}
                  label="Vista Global"
                  active={pathname === "/admin/dashboard"}
                  collapsed={collapsed}
                  badge={unreadCount > 0 ? unreadCount : undefined}
                />
                <NavItem href="/admin/teachers" icon={<Book size={20} />} label="Profesores" active={isActive("/admin/teachers")} collapsed={collapsed} />
                <NavItem href="/admin/students" icon={<GraduationCap size={20} />} label="Estudiantes" active={isActive("/admin/students")} collapsed={collapsed} />
                <NavItem href="/admin/users" icon={<Users size={20} />} label="Edición de Usuarios" active={isActive("/admin/users")} collapsed={collapsed} />
                <NavItem href="/admin/god-mode" icon={<Crown size={20} />} label="Modo Dios" active={isActive("/admin/god-mode")} collapsed={collapsed} />
                <NavItem href="/admin/payments" icon={<CreditCard size={20} />} label="Pagos y Facturas" active={isActive("/admin/payments")} collapsed={collapsed} />
                <NavItem href="/admin/support" icon={<LifeBuoy size={20} />} label="Soporte" active={isActive("/admin/support")} collapsed={collapsed} />
                <NavItem href="/admin/settings" icon={<Settings size={20} />} label="Configuración" active={isActive("/admin/settings")} collapsed={collapsed} />
                <NavItem href="/admin/flow-tester" icon={<CheckCheck size={20} />} label="Flow Tester" active={isActive("/admin/flow-tester")} collapsed={collapsed} />
              </nav>
            </div>
          )}

          
        </div>

        {/* Footer del Sidebar Desktop */}
        <div className="p-3 border-t border-pink-100">

          {!collapsed && user && (
          <div className="px-4 py-3 mb-2 bg-slate-50 rounded-2xl border border-slate-100 animate-in fade-in">
            <p className="text-slate-800 text-xs font-bold truncate">{user.name}</p>
            <p className="text-pink-400 text-[10px] font-black uppercase tracking-tighter">
              {role.replace("_", " ")}
            </p>
          </div>
        )}
        
          <button
            onClick={handleLogout}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold text-rose-500 hover:bg-rose-50 transition-colors ${
              collapsed ? "justify-center" : ""
            }`}
            title={collapsed ? "Cerrar sesión" : undefined}
          >
            <LogOut size={20} className="flex-shrink-0" />
            {!collapsed && <span>Cerrar sesión</span>}
          </button>
        </div>
      </aside>

      {/* ─── Mobile: top bar + bottom tab bar ─── */}
      <MobileTopBar />
      <BottomTabBar mainItems={mobileMain} moreItems={mobileMore} onLogout={handleLogout} />
    </>
  );
}

function NavItem({
  href, icon, label, active, collapsed, badge,
}: {
  href: string; icon: React.ReactNode; label: string; active: boolean; collapsed: boolean; badge?: number;
}) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className={`relative flex items-center gap-3 px-4 py-3 rounded-2xl text-sm transition-all duration-300 group ${
        active 
          ? "bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-md shadow-pink-100" 
          : "text-slate-500 hover:text-pink-500 hover:bg-pink-50/50"
      }`}
    >
      <span className={`relative flex-shrink-0 transition-transform duration-300 group-hover:scale-110 ${
        active ? "text-white" : "text-slate-400 group-hover:text-pink-400"
      }`}>
        {icon}
        {!!badge && collapsed && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </span>
      {!collapsed && (
        <span className="flex-1 flex items-center justify-between gap-2 min-w-0">
          <span className="font-semibold tracking-tight whitespace-nowrap truncate">{label}</span>
          {!!badge && (
            <span className={`flex-shrink-0 min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-black flex items-center justify-center ${
              active ? "bg-white/25 text-white" : "bg-rose-500 text-white"
            }`}>
              {badge > 99 ? "99+" : badge}
            </span>
          )}
        </span>
      )}
    </Link>
  );
}