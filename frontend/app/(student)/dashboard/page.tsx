"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useAuthStore } from "@/store/authStore";
import { useStudentClasses, useEnrollments } from "@/hooks/useStudentData";
import api from "@/lib/api";
import {
  Calendar,
  BookOpen,
  ClipboardList,
  Clock,
  CheckCircle,
  ChevronRight,
  Sparkles,
  Hourglass,
  Package as PackageIcon,
  Award,
  UserCheck,
} from "lucide-react";
import ChipiWidget from "@/components/chipi/ChipiWidget";

type BookingStage = "loading" | "needs_trial" | "trial_in_progress" | "needs_package" | "ready";

const STATUS_CONFIG: Record<string, {
  label: string;
  badge: string;
  border: string;
}> = {
  pending:         { label: "Pendiente de pago",  badge: "bg-amber-100 text-amber-700",   border: "border-l-amber-400" },
  pending_trial:   { label: "Prueba pendiente",   badge: "bg-purple-100 text-purple-700", border: "border-l-purple-400" },
  pending_payment: { label: "Pago en revisión",   badge: "bg-blue-100 text-blue-700",     border: "border-l-blue-400" },
  confirmed:       { label: "Confirmada",         badge: "bg-emerald-100 text-emerald-700", border: "border-l-emerald-400" },
  completed:       { label: "Completada",         badge: "bg-slate-100 text-slate-500",   border: "border-l-slate-300" },
  cancelled:       { label: "Cancelada",          badge: "bg-red-100 text-red-600",       border: "border-l-red-400" },
};

// ─── Componentes de Esqueleto de Carga ───
function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-slate-200/80 rounded-2xl ${className}`} />;
}

function DashboardSkeleton() {
  return (
    <div className="relative space-y-8 p-6 md:p-8">
      {/* Header Skeleton */}
      <div className="space-y-2">
        <Skeleton className="h-9 w-64 rounded-xl" />
        <Skeleton className="h-5 w-48 rounded-lg" />
      </div>

      {/* Banner de Plan / Etapa Skeleton */}
      <Skeleton className="h-52 w-full rounded-[2rem]" />

      {/* Próximas Clases Skeleton */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-7 w-40 rounded-lg" />
          <Skeleton className="h-5 w-20 rounded-lg" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
        </div>
      </div>

      {/* Acciones Rápidas Skeleton */}
      <div className="space-y-4">
        <Skeleton className="h-7 w-48 rounded-lg" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-44 w-full rounded-2xl" />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Card de Próxima Clase ───
function UpcomingClassCard({ cls }: { cls: any }) {
  const cfg   = STATUS_CONFIG[cls.status] ?? STATUS_CONFIG.pending;
  const start = new Date(cls.start_time_utc);

  const dayOfWeek = cls.day_of_week || start.toLocaleDateString("es", { weekday: "short" });

  return (
    <div className={`group bg-white/60 backdrop-blur-md rounded-2xl border
                     border-white/60 shadow-md border-l-4
                     ${cfg.border} p-5 hover:shadow-lg hover:bg-white/80 hover:-translate-y-1
                     transition-all duration-300 relative overflow-hidden`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        
        {/* Contenido principal */}
        <div className="flex items-start gap-4 flex-1 min-w-0">
          
          {/* Bloque visual de fecha */}
          <div className="flex flex-col items-center justify-center bg-pink-50/80 text-pink-600 rounded-2xl px-3.5 py-2.5 min-w-[64px] border border-pink-100/60 flex-shrink-0">
            <span className="text-[10px] font-black uppercase tracking-wider text-pink-400">
              {dayOfWeek}
            </span>
            <span className="text-xl font-black tracking-tight text-slate-800">
              {start.getDate()}
            </span>
            <span className="text-[10px] font-bold text-pink-500 uppercase">
              {start.toLocaleDateString("es", { month: "short" }).replace(".", "")}
            </span>
          </div>

          {/* Detalles */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full ${cfg.badge}`}>
                {cfg.label}
              </span>
              {cls.class_type === "trial" && cls.status !== "pending_trial" && (
                <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-purple-100 text-purple-700">
                  Clase de prueba
                </span>
              )}
            </div>

            <h3 className="text-base font-black text-slate-800 truncate mb-1">
              {cls.subject ?? "Clase de Inglés General"}
            </h3>

            <div className="flex items-center gap-3 text-xs font-semibold text-slate-500 flex-wrap">
              <span className="flex items-center gap-1.5 bg-slate-100/80 px-2.5 py-1 rounded-lg text-slate-600">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                {start.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })} ({cls.duration_minutes || 60} min)
              </span>
              {cls.teacher_name && (
                <span className="text-slate-400 truncate">
                  Profesor: <strong className="text-slate-700">{cls.teacher_name}</strong>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Indicador de acción */}
        <div className="flex items-center self-end sm:self-center">
          <span className="w-9 h-9 rounded-xl bg-slate-50/80 group-hover:bg-pink-50 group-hover:text-pink-600 text-slate-400 flex items-center justify-center transition-colors">
            <ChevronRight className="w-4 h-4" />
          </span>
        </div>

      </div>
    </div>
  );
}

// ─── Botones de Acción Rápida ───
function QuickAction({
  href, icon, label, description, color, disabled = false,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  description: string;
  color: "pink" | "purple" | "blue" | "emerald";
  disabled?: boolean;
}) {
  const colors = {
    pink:    { bg: "bg-pink-50",    icon: "bg-pink-100 text-pink-600",    border: "border-t-pink-500",    btn: "text-pink-600 hover:bg-pink-100" },
    purple:  { bg: "bg-purple-50",  icon: "bg-purple-100 text-purple-600", border: "border-t-purple-500", btn: "text-purple-600 hover:bg-purple-100" },
    blue:    { bg: "bg-blue-50",    icon: "bg-blue-100 text-blue-600",    border: "border-t-blue-500",    btn: "text-blue-600 hover:bg-blue-100" },
    emerald: { bg: "bg-emerald-50", icon: "bg-emerald-100 text-emerald-600", border: "border-t-emerald-500", btn: "text-emerald-600 hover:bg-emerald-100" },
  };
  const c = colors[color];

  const content = (
    <>
      <div className={`w-14 h-14 rounded-2xl ${c.icon} flex items-center
                       justify-center mb-4 ${!disabled && "group-hover:scale-110"}
                       transition-transform duration-300`}>
        {icon}
      </div>
      <h3 className="font-black text-slate-800 text-base mb-1">{label}</h3>
      <p className="text-xs text-slate-500 leading-relaxed mb-4">
        {description}
      </p>
      <span className={`inline-flex items-center gap-1 text-xs font-bold
                         bg-transparent ${c.btn} px-4 py-2 rounded-full
                         border-2 border-current transition-colors
                         ${disabled && "opacity-50"}`}>
        {disabled ? "Bloqueado" : "Ir"}
        {!disabled && <ChevronRight className="w-3 h-3" />}
      </span>
    </>
  );

  if (disabled) {
    return (
      <div
        className={`group bg-white/50 backdrop-blur-md rounded-2xl border
                    border-white/60 shadow-sm border-t-4 ${c.border}
                    p-6 flex flex-col items-center text-center opacity-70
                    cursor-not-allowed`}
      >
        {content}
      </div>
    );
  }

  return (
    <Link href={href}
      className={`group bg-white/60 backdrop-blur-md rounded-2xl border
                  border-white/60 shadow-md border-t-4 ${c.border}
                  p-6 flex flex-col items-center text-center
                  hover:shadow-lg hover:bg-white/80 hover:-translate-y-1 transition-all duration-300`}>
      {content}
    </Link>
  );
}

// ─── Pantalla Principal Dashboard ───
export default function StudentDashboard() {
  const { user } = useAuthStore();
  const { classes: classesData, loading: classesLoading } = useStudentClasses();
  const { enrollments, loading: enrollmentsLoading } = useEnrollments() as { enrollments: any[]; loading?: boolean };

  const [stage, setStage] = useState<BookingStage>("loading");

  useEffect(() => {
    api.get("/payments/booking-status")
      .then(res => setStage(res.data.stage))
      .catch(() => setStage("ready")); // fallback conservador
  }, []);

  const classList: any[] = Array.isArray(classesData)
    ? classesData
    : (classesData as any)?.classes ?? [];

  const hasTrial = classList.some(c => c.class_type === "trial");

  const upcoming = classList
    .filter(c => !["completed","cancelled","no_show", "finalized"].includes(c.status))
    .sort((a, b) =>
      new Date(a.start_time_utc).getTime() -
      new Date(b.start_time_utc).getTime()
    );

  const activeEnrollment = enrollments?.find(e => e.status === "active");

  // Obtención dinámica del nombre del profesor (del plan o de la próxima clase)
  const assignedTeacher = activeEnrollment?.teacher_name || activeEnrollment?.teacher?.name || upcoming[0]?.teacher_name || null;
  const activeSubject = activeEnrollment?.subject || "Inglés General";

  // Estado global de carga inicial
  const isGlobalLoading = stage === "loading" || classesLoading || enrollmentsLoading;

  if (isGlobalLoading) {
    return (
      <div className="min-h-screen bg-slate-50 relative overflow-hidden">
        <DashboardSkeleton />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">

      {/* Blobs de fondo */}
      <div className="fixed top-[-80px] right-[-100px] w-[500px] h-[500px]
                       bg-pink-300/20 rounded-full blur-[100px]
                       pointer-events-none" />
      <div className="fixed bottom-[-80px] left-[-80px] w-[400px] h-[400px]
                       bg-purple-300/15 rounded-full blur-[100px]
                       pointer-events-none" />

      <div className="relative space-y-8 p-6 md:p-8">

        {/* ─── Bienvenida ─── */}
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">
            ¡Hola, {user?.name}! 👋
          </h1>
          <p className="text-slate-500 mt-1 font-medium">
            Bienvenido a tu espacio de aprendizaje
          </p>
        </div>

        {/* ─── Banners según etapa de reserva ─── */}
        {stage === "needs_trial" && !hasTrial && (
          <div className="bg-gradient-to-r from-purple-500 to-pink-500
                          rounded-[2rem] p-6 sm:p-8 text-white relative
                          overflow-hidden shadow-xl shadow-purple-200
                          animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="absolute top-[-40px] right-[-40px] w-48 h-48 bg-white/10 rounded-full blur-2xl" />
            <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-white/70 mb-1">
                    ¡Bienvenido!
                  </p>
                  <h2 className="text-xl font-black">Tu primera clase es gratis</h2>
                  <p className="text-white/80 text-sm mt-1">
                    Reserva tu clase de prueba de 30 minutos sin compromiso
                  </p>
                </div>
              </div>
              <Link
                href="/dashboard/schedule"
                className="flex-shrink-0 inline-flex items-center gap-2 px-5 py-3 bg-white text-purple-600 text-sm font-bold rounded-xl shadow-md hover:shadow-lg active:scale-[0.98] transition-all duration-200"
              >
                <Calendar className="w-4 h-4" />
                Reservar prueba
              </Link>
            </div>
          </div>
        )}

        {(stage === "trial_in_progress" || (stage === "needs_trial" && hasTrial)) && (
          <div className="bg-amber-50 border border-amber-100 rounded-[2rem] shadow-md p-6 sm:p-8 relative overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <Hourglass className="w-5 h-5 text-amber-500" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-500 mb-1">
                  Clase de prueba pendiente
                </p>
                <h2 className="text-lg font-black text-amber-800">Tu prueba está reservada</h2>
                <p className="text-amber-700 text-sm mt-1">
                  Una vez completada podrás elegir tu paquete y seguir agendando.
                </p>
              </div>
            </div>
          </div>
        )}

        {stage === "needs_package" && (
          <div className="bg-gradient-to-r from-emerald-500 to-teal-400 rounded-[2rem] p-6 sm:p-8 text-white relative overflow-hidden shadow-xl shadow-emerald-200 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="absolute top-[-40px] right-[-40px] w-48 h-48 bg-white/10 rounded-full blur-2xl" />
            <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
                  <CheckCircle className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-white/70 mb-1">
                    ¡Prueba completada!
                  </p>
                  <h2 className="text-xl font-black">Elige tu paquete de clases</h2>
                  <p className="text-white/80 text-sm mt-1">
                    Selecciona el plan que mejor se adapte a tu ritmo
                  </p>
                </div>
              </div>
              <Link
                href="/dashboard/schedule"
                className="flex-shrink-0 inline-flex items-center gap-2 px-5 py-3 bg-white text-emerald-600 text-sm font-bold rounded-xl shadow-md hover:shadow-lg active:scale-[0.98] transition-all duration-200"
              >
                <PackageIcon className="w-4 h-4" />
                Elegir paquete
              </Link>
            </div>
          </div>
        )}

        {/* ─── BANNER PLAN ACTIVO (MEJORADO) ─── */}
        {stage === "ready" && activeEnrollment && (
          <div className="bg-gradient-to-br from-indigo-900 via-purple-900 to-slate-900
                          rounded-[2rem] p-6 sm:p-8 text-white relative
                          overflow-hidden shadow-2xl shadow-indigo-950/20 border border-white/10
                          animate-in fade-in slide-in-from-bottom-4 duration-500">
            
            {/* Efectos de fondo */}
            <div className="absolute -top-12 -right-12 w-64 h-64 bg-pink-500/20 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-12 -left-12 w-64 h-64 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />

            <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">

              {/* Información del Plan, Materia y Profesor */}
              <div className="space-y-4 flex-1">
                
                {/* Badges superiores */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-widest bg-pink-500/20 text-pink-300 border border-pink-500/30">
                    <Award className="w-3.5 h-3.5" /> Plan Activo
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-white/10 text-slate-200 border border-white/10 backdrop-blur-md">
                    <BookOpen className="w-3.5 h-3.5 text-purple-300" />
                    {activeSubject}
                  </span>
                </div>

                {/* Título del paquete */}
                <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                  {activeEnrollment.package_name}
                </h2>

                {/* Tarjeta del Profesor Asignado */}
                <div className="inline-flex items-center gap-3 bg-white/10 backdrop-blur-md px-4 py-2.5 rounded-2xl border border-white/10 text-xs shadow-inner">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-pink-500 to-purple-500 flex items-center justify-center font-black text-white shadow-md flex-shrink-0">
                    {assignedTeacher ? assignedTeacher.charAt(0).toUpperCase() : <UserCheck className="w-4 h-4" />}
                  </div>
                  <div>
                    <span className="text-slate-300 block text-[10px] uppercase font-black tracking-wider">
                      Profesor Asignado
                    </span>
                    <span className="font-bold text-white text-sm">
                      {assignedTeacher || "Por asignar"}
                    </span>
                  </div>
                </div>

              </div>

              {/* Métrica de Progreso de Clases */}
              <div className="bg-white/10 backdrop-blur-md rounded-2xl p-5 border border-white/10 min-w-[260px] space-y-3">
                <div className="flex items-end justify-between">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-300 block">
                      Progreso del Plan
                    </span>
                    <p className="text-3xl font-black text-white leading-none mt-1">
                      {activeEnrollment.classes_used}
                      <span className="text-lg text-slate-400 font-bold">
                        /{activeEnrollment.classes_total ?? "∞"}
                      </span>
                    </p>
                  </div>
                  <span className="text-xs font-bold text-pink-300 bg-pink-500/20 px-2.5 py-1 rounded-lg border border-pink-500/30">
                    {activeEnrollment.classes_total
                      ? `${Math.round((activeEnrollment.classes_used / activeEnrollment.classes_total) * 100)}%`
                      : "100%"}
                  </span>
                </div>

                {/* Barra de Progreso estilizada */}
                <div className="w-full h-2.5 bg-slate-800/80 rounded-full overflow-hidden p-0.5 border border-white/10">
                  <div
                    className="h-full bg-gradient-to-r from-pink-500 to-purple-400 rounded-full transition-all duration-700 shadow-sm"
                    style={{
                      width: activeEnrollment.classes_total
                        ? `${Math.min((activeEnrollment.classes_used / activeEnrollment.classes_total) * 100, 100)}%`
                        : "100%",
                    }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300 pt-1">
                  <span>Usadas: <strong className="text-white">{activeEnrollment.classes_used}</strong></span>
                  <span>Restantes: <strong className="text-white">{activeEnrollment.classes_total ? Math.max(0, activeEnrollment.classes_total - activeEnrollment.classes_used) : "Ilimitadas"}</strong></span>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* ─── Próximas clases ─── */}
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-150">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-slate-800">
                Próximas clases
              </h2>
              {upcoming.length > 0 && (
                <span className="bg-pink-100 text-pink-600 text-xs font-black px-2.5 py-0.5 rounded-full">
                  {upcoming.length}
                </span>
              )}
            </div>
            <Link href="/dashboard/classes"
              className="text-sm font-bold text-pink-600 hover:text-pink-700
                         flex items-center gap-1 transition-colors">
              Ver todas
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>

          {upcoming.length === 0 ? (
            <div className="bg-white/60 backdrop-blur-md rounded-2xl border
                            border-white/60 shadow-md p-8 text-center">
              <Calendar className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 font-bold mb-4">
                {stage === "trial_in_progress" || hasTrial
                  ? "Tu clase de prueba aparecerá aquí"
                  : "No tienes clases próximas"
                }
              </p>
              {((stage === "needs_trial" && !hasTrial) || stage === "ready") && (
                <Link href="/dashboard/schedule"
                  className="inline-flex items-center gap-2 px-5 py-2.5
                             bg-gradient-to-r from-pink-500 to-rose-400
                             text-white text-sm font-bold rounded-xl
                             shadow-md shadow-pink-100 hover:shadow-pink-200
                             hover:-translate-y-0.5 transition-all duration-200">
                  <Calendar className="w-4 h-4" />
                  {stage === "needs_trial" && !hasTrial ? "Agendar clase de prueba" : "Agendar primera clase"}
                </Link>
              )}
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
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-200">
          <h2 className="text-xl font-black text-slate-800 mb-4">
            ¿Qué quieres hacer?
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <QuickAction
              href="/dashboard/schedule"
              color="pink"
              label={stage === "needs_trial" && !hasTrial ? "Agendar prueba" : "Agendar clase"}
              description={
                stage === "needs_trial" && !hasTrial
                  ? "Reserva tu clase gratuita de 30 min"
                  : stage === "trial_in_progress" || hasTrial
                    ? "Completa tu prueba primero"
                    : stage === "needs_package"
                      ? "Elige tu paquete para continuar"
                      : "Reserva tu próxima sesión"
              }
              icon={<Calendar className="w-7 h-7" />}
              disabled={stage === "trial_in_progress" || hasTrial}
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
              href="/dashboard/teachers"
              color="emerald"
              label="Mi Profesor"
              description="Contacta y conoce a tu profesor o profesora"
              icon={<CheckCircle className="w-7 h-7" />}
            />
          </div>
        </div>

      </div>
      <ChipiWidget screenName="student_home"/>
    </div>
  );
}