"use client";

import { useState, useEffect } from "react"; // 👈 Importamos useEffect
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { 
  LayoutDashboard, Users, GraduationCap, Calendar, Settings, LogOut, 
  MonitorPlay, UserCircle, ClipboardEdit, CreditCard, Book, BarChart, ChevronLeft
} from "lucide-react";

export default function DashboardSidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const [collapsed, setCollapsed] = useState(false);
  
  // 👇 1. ESTADO PARA EVITAR EL ERROR DE NEXT.JS
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // 👇 2. MIENTRAS CARGA, MOSTRAMOS UNA BARRA VACÍA (Evita el crasheo)
  if (!isMounted) {
    return <aside className="w-64 bg-white border-r border-pink-100 min-h-screen shadow-xl shadow-pink-500/5 flex-shrink-0 z-50 transition-all"></aside>;
  }

  const role = user?.role || "";

  // 🧠 Lógica de permisos
  const showAdminMenu = ["superadmin", "teacher_admin"].includes(role);
  const showTeacherMenu = ["teacher", "teacher_admin"].includes(role);
  const showStudentMenu = role === "student";

  // Función auxiliar para saber si un link está activo
  const isActive = (path: string) => pathname === path || pathname.startsWith(path + "/");

  return (
    <aside className={`
      flex flex-col bg-white border-r border-pink-100 shadow-xl shadow-pink-500/5
      transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] flex-shrink-0 z-50
      ${collapsed ? "w-20" : "w-64"}
    `}>
      {/* ─── LOGO SECTION ─── */}
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

      {/* ─── MENÚS SCROLLABLES ─── */}
      <div className="flex-1 overflow-y-auto py-2 px-3 space-y-6 scrollbar-none">
        
        {/* 👨‍🎓 MENÚ ESTUDIANTE */}
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
              <NavItem href="/dashboard/classes" icon={<MonitorPlay size={20} />} label="Mis Clases" active={isActive("/dashboard/classes")} collapsed={collapsed} />
              <NavItem href="/dashboard/materials" icon={<Book size={20} />} label="Materiales" active={isActive("/dashboard/materials")} collapsed={collapsed} />
              <NavItem href="/dashboard/homework" icon={<ClipboardEdit size={20} />} label="Mis Tareas" active={isActive("/dashboard/homework")} collapsed={collapsed} />
              <NavItem href="/dashboard/teacher" icon={<GraduationCap size={20} />} label="Profesores" active={isActive("/dashboard/teacher")} collapsed={collapsed} />
              <NavItem href="/dashboard/profile" icon={<UserCircle size={20} />} label="Mi Perfil" active={isActive("/dashboard/profile")} collapsed={collapsed} />
            </nav>
          </div>
        )}

        {/* 👨‍🏫 MENÚ PROFESOR */}
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
              <NavItem href="/teacher/materials" icon={<Book size={20} />} label="Materiales" active={isActive("/teacher/materials")} collapsed={collapsed} />
              <NavItem href="/teacher/homework" icon={<ClipboardEdit size={20} />} label="Tareas" active={isActive("/teacher/homework")} collapsed={collapsed} />
              <NavItem href="/teacher/wallet" icon={<BarChart size={20} />} label="Ganancias" active={isActive("/teacher/wallet")} collapsed={collapsed} />
              <NavItem href="/teacher/profile" icon={<UserCircle size={20} />} label="Mi Perfil" active={isActive("/teacher/profile")} collapsed={collapsed} />
            </nav>
          </div>
        )}

        {/* 👑 MENÚ ADMIN */}
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
              <NavItem href="/admin/payments" icon={<CreditCard size={20} />} label="Pagos y Facturas" active={isActive("/admin/payments")} collapsed={collapsed} />
              <NavItem href="/admin/settings" icon={<Settings size={20} />} label="Configuración" active={isActive("/admin/settings")} collapsed={collapsed} />
            </nav>
          </div>
        )}
      </div>

      {/* ─── FOOTER & USER INFO ─── */}
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
          onClick={() => {
            logout();
            window.location.href = "/login";
          }}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-slate-400 hover:text-rose-500 rounded-xl hover:bg-rose-50 transition-all duration-200 text-sm font-bold"
          title={collapsed ? "Cerrar Sesión" : undefined}
        >
          <LogOut className="w-5 h-5 flex-shrink-0" />
          {!collapsed && <span>Cerrar Sesión</span>}
        </button>
      </div>
    </aside>
  );
}

// Subcomponente para los botones del menú
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