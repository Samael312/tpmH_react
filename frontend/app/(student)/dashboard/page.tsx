"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useAuthStore } from "@/store/authStore";
import { useStudentClasses, useEnrollments } from "@/hooks/useStudentData";
import api from "@/lib/api";
import { Calendar, BookOpen, ClipboardList,
         Clock, CheckCircle, ChevronRight,
         Video, AlertCircle, Sparkles, Hourglass,
         Package as PackageIcon } from "lucide-react";
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

function UpcomingClassCard({ cls }: { cls: any }) {
  const cfg   = STATUS_CONFIG[cls.status] ?? STATUS_CONFIG.pending;
  const start = new Date(cls.start_time_utc);

  // Usar el día de la semana guardado en la BD (ej: "Vie", "Lun") o un respaldo formateado
  const dayOfWeek = cls.day_of_week || start.toLocaleDateString("es", { weekday: "short" });

  return (
    <div className={`group bg-white/60 backdrop-blur-md rounded-2xl border
                     border-white/60 shadow-md border-l-4
                     ${cfg.border} p-5 hover:shadow-lg hover:bg-white/80 hover:-translate-y-1
                     transition-all duration-300 relative overflow-hidden`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        
        {/* Contenido principal con fecha e info */}
        <div className="flex items-start gap-4 flex-1 min-w-0">
          
          {/* Bloque visual de fecha (Día y Número) */}
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

          {/* Detalles de la clase */}
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

        {/* Indicador visual de acción */}
        <div className="flex items-center self-end sm:self-center">
          <span className="w-9 h-9 rounded-xl bg-slate-50/80 group-hover:bg-pink-50 group-hover:text-pink-600 text-slate-400 flex items-center justify-center transition-colors">
            <ChevronRight className="w-4 h-4" />
          </span>
        </div>

      </div>
    </div>
  );
}

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

export default function StudentDashboard() {
  const { user }       = useAuthStore();
  const { classes: classesData, loading: classesLoading } = useStudentClasses();
  const { enrollments } = useEnrollments();

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

      <div className="relative space-y-8 p-6 md:p-8">

        {/* ─── Bienvenida ─── */}
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">
            ¡Hola, {user?.name}! 👋
          </h1>
          <p className="text-slate-500 mt-1">
            Bienvenido a tu espacio de aprendizaje
          </p>
        </div>

        {/* ─── Banner según etapa de reserva ─── */}
        {stage === "needs_trial" && !hasTrial && (
          <div className="bg-gradient-to-r from-purple-500 to-pink-500
                          rounded-[2rem] p-6 sm:p-8 text-white relative
                          overflow-hidden shadow-xl shadow-purple-200
                          animate-in fade-in slide-in-from-bottom-4
                          duration-500 delay-100">
            <div className="absolute top-[-40px] right-[-40px] w-48 h-48
                            bg-white/10 rounded-full blur-2xl" />
            <div className="relative flex flex-col sm:flex-row items-start
                            sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center
                                justify-center flex-shrink-0">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest
                                text-white/70 mb-1">
                    ¡Bienvenido!
                  </p>
                  <h2 className="text-xl font-black">
                    Tu primera clase es gratis
                  </h2>
                  <p className="text-white/80 text-sm mt-1">
                    Reserva tu clase de prueba de 30 minutos sin compromiso
                  </p>
                </div>
              </div>
              <Link
                href="/dashboard/schedule"
                className="flex-shrink-0 inline-flex items-center gap-2 px-5 py-3
                           bg-white text-purple-600 text-sm font-bold rounded-xl
                           shadow-md hover:shadow-lg active:scale-[0.98]
                           transition-all duration-200"
              >
                <Calendar className="w-4 h-4" />
                Reservar prueba
              </Link>
            </div>
          </div>
        )}

        {(stage === "trial_in_progress" || (stage === "needs_trial" && hasTrial)) && (
          <div className="bg-amber-50 border border-amber-100 rounded-[2rem] shadow-md
                          p-6 sm:p-8 relative overflow-hidden
                          animate-in fade-in slide-in-from-bottom-4
                          duration-500 delay-100">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center
                              justify-center flex-shrink-0">
                <Hourglass className="w-5 h-5 text-amber-500" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest
                              text-amber-500 mb-1">
                  Clase de prueba pendiente
                </p>
                <h2 className="text-lg font-black text-amber-800">
                  Tu prueba está reservada
                </h2>
                <p className="text-amber-700 text-sm mt-1">
                  Una vez completada podrás
                  elegir tu paquete y seguir agendando.
                </p>
              </div>
            </div>
          </div>
        )}

        {stage === "needs_package" && (
          <div className="bg-gradient-to-r from-emerald-500 to-teal-400
                          rounded-[2rem] p-6 sm:p-8 text-white relative
                          overflow-hidden shadow-xl shadow-emerald-200
                          animate-in fade-in slide-in-from-bottom-4
                          duration-500 delay-100">
            <div className="absolute top-[-40px] right-[-40px] w-48 h-48
                            bg-white/10 rounded-full blur-2xl" />
            <div className="relative flex flex-col sm:flex-row items-start
                            sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center
                                justify-center flex-shrink-0">
                  <CheckCircle className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest
                                text-white/70 mb-1">
                    ¡Prueba completada!
                  </p>
                  <h2 className="text-xl font-black">
                    Elige tu paquete de clases
                  </h2>
                  <p className="text-white/80 text-sm mt-1">
                    Selecciona el plan que mejor se adapte a tu ritmo
                  </p>
                </div>
              </div>
              <Link
                href="/dashboard/schedule"
                className="flex-shrink-0 inline-flex items-center gap-2 px-5 py-3
                           bg-white text-emerald-600 text-sm font-bold rounded-xl
                           shadow-md hover:shadow-lg active:scale-[0.98]
                           transition-all duration-200"
              >
                <PackageIcon className="w-4 h-4" />
                Elegir paquete
              </Link>
            </div>
          </div>
        )}

        {/* ─── Banner plan activo ─── */}
        {stage === "ready" && activeEnrollment && (
          <div className="bg-gradient-to-r from-pink-500 to-rose-400
                          rounded-[2rem] p-6 sm:p-8 text-white relative
                          overflow-hidden shadow-xl shadow-pink-200
                          animate-in fade-in slide-in-from-bottom-4
                          duration-500 delay-100">
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

              <div className="text-right">
                <p className="text-3xl font-black">
                  {activeEnrollment.classes_used}
                  <span className="text-xl text-white/60">/{activeEnrollment.classes_total ?? "∞"}</span>
                </p>
                <p className="text-white/70 text-xs font-bold">clases usadas</p>
                <div className="mt-2 w-40 h-2 bg-white/30 rounded-full overflow-hidden shadow-inner">
                  <div
                    className="h-full bg-white rounded-full transition-all duration-700"
                    style={{ width: activeEnrollment.classes_total
                      ? `${Math.min((activeEnrollment.classes_used / activeEnrollment.classes_total) * 100, 100)}%`
                      : "100%"
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

          {classesLoading ? (
            <div className="space-y-3">
              {[1, 2].map(i => (
                <div key={i}
                  className="h-24 bg-white/60 rounded-2xl animate-pulse shadow-md" />
              ))}
            </div>
          ) : upcoming.length === 0 ? (
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
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500
                        delay-200">
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