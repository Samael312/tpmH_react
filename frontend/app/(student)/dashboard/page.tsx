"use client";

import Link from "next/link";
import { useAuthStore } from "@/store/authStore";
import { useStudentClasses, useEnrollments } from "@/hooks/useStudentData";
import { Calendar, BookOpen, ClipboardList,
         Clock, CheckCircle, ChevronRight,
         Video, AlertCircle } from "lucide-react";

const STATUS_CONFIG: Record<string, {
  label: string;
  badge: string;
  border: string;
}> = {
  pending:         { label: "Pendiente de pago",  badge: "bg-amber-100 text-amber-700",   border: "border-l-amber-400" },
  pending_payment: { label: "Pago en revisión",   badge: "bg-blue-100 text-blue-700",     border: "border-l-blue-400" },
  confirmed:       { label: "Confirmada",         badge: "bg-emerald-100 text-emerald-700", border: "border-l-emerald-400" },
  completed:       { label: "Completada",         badge: "bg-slate-100 text-slate-500",   border: "border-l-slate-300" },
  cancelled:       { label: "Cancelada",          badge: "bg-red-100 text-red-600",       border: "border-l-red-400" },
};

function UpcomingClassCard({ cls }: { cls: any }) {
  const cfg   = STATUS_CONFIG[cls.status] ?? STATUS_CONFIG.pending;
  const start = new Date(cls.start_time_utc);

  return (
    <div className={`bg-white/80 backdrop-blur-xl rounded-2xl border
                     border-white shadow-lg shadow-slate-100 border-l-4
                     ${cfg.border} p-5 hover:shadow-xl hover:-translate-y-0.5
                     transition-all duration-300`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* Fecha/hora */}
          <div className="flex items-center gap-2 mb-2">
            <div className="flex items-center gap-1.5 text-xs font-black
                            text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
              <Clock className="w-3 h-3" />
              {start.toLocaleDateString("es", {
                weekday: "short", day: "numeric", month: "short",
              })}{" "}
              · {start.toLocaleTimeString("es", {
                hour: "2-digit", minute: "2-digit",
              })}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-black uppercase tracking-widest
                              px-2.5 py-1 rounded-full ${cfg.badge}`}>
              {cfg.label}
            </span>
            {cls.class_type === "trial" && (
              <span className="text-[10px] font-black uppercase tracking-widest
                               px-2.5 py-1 rounded-full bg-purple-100 text-purple-700">
                Clase de prueba
              </span>
            )}
            {cls.class_count && (
              <span className="text-[10px] font-black text-slate-400">
                {cls.class_count}
              </span>
            )}
          </div>

          <p className="text-sm text-slate-500 mt-2">
            {cls.duration_minutes} min ·{" "}
            {cls.subject ?? "Inglés General"}
          </p>
        </div>

        {/* Meet link */}
        {cls.meet_link && cls.status === "confirmed" && (
            <a
            href={cls.meet_link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5
                       bg-emerald-500 text-white text-xs font-bold rounded-xl
                       hover:bg-emerald-600 shadow-md shadow-emerald-100
                       transition-all duration-200"
          >
            <Video className="w-3.5 h-3.5" />
            Entrar
          </a>
        )}
      </div>
    </div>
  );
}

function QuickAction({
  href, icon, label, description, color,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  description: string;
  color: "pink" | "purple" | "blue" | "emerald";
}) {
  const colors = {
    pink:    { bg: "bg-pink-50",    icon: "bg-pink-100 text-pink-600",    border: "border-t-pink-500",    btn: "text-pink-600 hover:bg-pink-100" },
    purple:  { bg: "bg-purple-50",  icon: "bg-purple-100 text-purple-600", border: "border-t-purple-500", btn: "text-purple-600 hover:bg-purple-100" },
    blue:    { bg: "bg-blue-50",    icon: "bg-blue-100 text-blue-600",    border: "border-t-blue-500",    btn: "text-blue-600 hover:bg-blue-100" },
    emerald: { bg: "bg-emerald-50", icon: "bg-emerald-100 text-emerald-600", border: "border-t-emerald-500", btn: "text-emerald-600 hover:bg-emerald-100" },
  };
  const c = colors[color];

  return (
    <Link href={href}
      className={`group bg-white/80 backdrop-blur-xl rounded-2xl border
                  border-white shadow-lg border-t-4 ${c.border}
                  p-6 flex flex-col items-center text-center
                  hover:shadow-xl hover:-translate-y-1 transition-all duration-300`}>
      <div className={`w-14 h-14 rounded-2xl ${c.icon} flex items-center
                       justify-center mb-4 group-hover:scale-110
                       transition-transform duration-300`}>
        {icon}
      </div>
      <h3 className="font-black text-slate-800 text-base mb-1">{label}</h3>
      <p className="text-xs text-slate-500 leading-relaxed mb-4">
        {description}
      </p>
      <span className={`inline-flex items-center gap-1 text-xs font-bold
                        bg-transparent ${c.btn} px-4 py-2 rounded-full
                        border-2 border-current transition-colors`}>
        Ir
        <ChevronRight className="w-3 h-3" />
      </span>
    </Link>
  );
}

export default function StudentDashboard() {
  const { user }       = useAuthStore();
  const { classes: classesData, loading: classesLoading } = useStudentClasses();
  const { enrollments } = useEnrollments();

  // The hook may return the raw API response { classes: [], total, ... } or the array directly
  const classList: any[] = Array.isArray(classesData)
    ? classesData
    : (classesData as any)?.classes ?? [];

  const upcoming = classList
    .filter(c => !["completed","cancelled","no_show"].includes(c.status))
    .sort((a, b) =>
      new Date(a.start_time_utc).getTime() -
      new Date(b.start_time_utc).getTime()
    );

  const activeEnrollment = enrollments.find(e => e.status === "active");

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">

      {/* Blobs */}
      <div className="fixed top-[-80px] right-[-100px] w-[500px] h-[500px]
                      bg-pink-300/20 rounded-full blur-[100px]
                      pointer-events-none" />
      <div className="fixed bottom-[-80px] left-[-80px] w-[400px] h-[400px]
                      bg-purple-300/15 rounded-full blur-[100px]
                      pointer-events-none" />

      <div className="relative space-y-8">

        {/* ─── Bienvenida ─── */}
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">
            ¡Hola, {user?.name}! 👋
          </h1>
          <p className="text-slate-500 mt-1">
            Bienvenido a tu espacio de aprendizaje
          </p>
        </div>

        {/* ─── Banner plan activo ─── */}
        {activeEnrollment && (
          <div className="bg-gradient-to-r from-pink-500 to-rose-400
                          rounded-[2rem] p-6 sm:p-8 text-white relative
                          overflow-hidden shadow-xl shadow-pink-200
                          animate-in fade-in slide-in-from-bottom-4
                          duration-500 delay-100">
            {/* Blob interno */}
            <div className="absolute top-[-40px] right-[-40px] w-48 h-48
                            bg-white/10 rounded-full blur-2xl" />
            <div className="relative flex flex-col sm:flex-row items-start
                            sm:items-center justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest
                              text-white/70 mb-1">
                  Plan activo
                </p>
                <h2 className="text-2xl font-black">
                  {activeEnrollment.package_name}
                </h2>
                <p className="text-white/80 text-sm mt-1">
                  {activeEnrollment.subject}
                </p>
              </div>

              {/* Progress */}
              <div className="text-right">
                <p className="text-3xl font-black">
                  {activeEnrollment.classes_used}
                  <span className="text-xl text-white/60">
                    /{activeEnrollment.classes_total}
                  </span>
                </p>
                <p className="text-white/70 text-xs font-bold">clases usadas</p>
                <div className="mt-2 w-40 h-2 bg-white/30 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-white rounded-full transition-all duration-700"
                    style={{
                      width: `${Math.min(
                        (activeEnrollment.classes_used /
                          activeEnrollment.classes_total) * 100,
                        100
                      )}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── Próximas clases ─── */}
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500
                        delay-150">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-black text-slate-800">
              Próximas clases
            </h2>
            <Link href="/dashboard/classes"
              className="text-sm font-bold text-pink-600 hover:text-pink-700
                         flex items-center gap-1 transition-colors">
              Ver todas
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>

          {classesLoading ? (
            <div className="space-y-3">
              {[1, 2].map(i => (
                <div key={i}
                  className="h-24 bg-white rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : upcoming.length === 0 ? (
            <div className="bg-white/80 backdrop-blur-xl rounded-2xl
                            border border-white shadow-lg p-8 text-center">
              <Calendar className="w-10 h-10 text-slate-200 mx-auto mb-3" />
              <p className="text-slate-500 font-bold mb-4">
                No tienes clases próximas
              </p>
              <Link href="/dashboard/schedule"
                className="inline-flex items-center gap-2 px-5 py-2.5
                           bg-gradient-to-r from-pink-500 to-rose-400
                           text-white text-sm font-bold rounded-xl
                           shadow-md shadow-pink-100 hover:shadow-pink-200
                           transition-all duration-200">
                <Calendar className="w-4 h-4" />
                Agendar primera clase
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {upcoming.slice(0, 3).map(cls => (
                <UpcomingClassCard key={cls.id} cls={cls} />
              ))}
            </div>
          )}
        </div>

        {/* ─── Acciones rápidas ─── */}
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500
                        delay-200">
          <h2 className="text-xl font-black text-slate-800 mb-4">
            ¿Qué quieres hacer?
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <QuickAction
              href="/dashboard/schedule"
              color="pink"
              label="Agendar clase"
              description="Reserva tu próxima sesión"
              icon={<Calendar className="w-7 h-7" />}
            />
            <QuickAction
              href="/dashboard/materials"
              color="purple"
              label="Materiales"
              description="Accede a tus recursos de estudio"
              icon={<BookOpen className="w-7 h-7" />}
            />
            <QuickAction
              href="/dashboard/homework"
              color="blue"
              label="Tareas"
              description="Revisa y entrega tus actividades"
              icon={<ClipboardList className="w-7 h-7" />}
            />
            <QuickAction
              href="/dashboard/teacher"
              color="emerald"
              label="Mi Profesora"
              description="Contacta y conoce a tu profesora"
              icon={<CheckCircle className="w-7 h-7" />}
            />
          </div>
        </div>

      </div>
    </div>
  );
}