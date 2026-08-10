"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useAuthStore } from "@/store/authStore";
import { useStudentClasses, useEnrollments } from "@/hooks/useStudentData";
import api from "@/lib/api";
import ClassCard from "@/components/classes/ClassCard";
import {
  Calendar,
  BookOpen,
  ClipboardList,
  ChevronRight,
  Sparkles,
  Hourglass,
  Package as PackageIcon,
  Award,
  UserCheck,
} from "lucide-react";
import ChipiWidget from "@/components/chipi/ChipiWidget";
import { useMyTeachers } from "@/hooks/useStudentData";
import { useState as useStateReact } from "react";

type BookingStage = "loading" | "needs_trial" | "trial_in_progress" | "needs_package" | "ready";

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-slate-200/80 rounded-2xl ${className}`} />;
}

function ChangePackageModal({
  enrollment,
  teacherUsername,
  onClose,
  onDone,
}: {
  enrollment: any;
  teacherUsername: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [packages, setPackages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get(`/packages/teacher/${teacherUsername}`)
      .then(res => setPackages((res.data || []).filter((p: any) => p.id !== enrollment.package?.id)))
      .catch(() => setPackages([]))
      .finally(() => setLoading(false));
  }, [teacherUsername]);

  const request = async (packageId: number) => {
    setRequesting(packageId);
    setError("");
    try {
      await api.post("/packages/request-package-change", {
        current_enrollment_id: enrollment.id,
        new_package_id: packageId,
      });
      onDone();
      onClose();
    } catch (e: any) {
      setError(e.response?.data?.detail || "Error solicitando el cambio de paquete");
    } finally {
      setRequesting(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-[2rem] shadow-2xl p-6 space-y-4 max-h-[80vh] overflow-y-auto">
        <h2 className="text-lg font-black text-slate-800">Cambiar de paquete</h2>
        <p className="text-xs text-slate-500">
          Tu profesor(a) deberá aprobar el cambio. Solo se permite cambiar a paquetes con
          cupo suficiente para tus clases ya usadas o agendadas.
        </p>
        {error && <div className="bg-rose-50 text-rose-600 text-xs font-bold px-4 py-3 rounded-xl">{error}</div>}
        {loading ? (
          <div className="h-24 bg-slate-50 rounded-xl animate-pulse" />
        ) : packages.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">No hay otros paquetes disponibles de este profesor</p>
        ) : (
          <div className="space-y-2">
            {packages.map(p => (
              <div key={p.id} className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3">
                <div>
                  <p className="text-sm font-bold text-slate-800">{p.name}</p>
                  <p className="text-xs text-slate-400">
                    {p.classes_count == null ? "Ilimitadas" : `${p.classes_count} clases`} · ${p.price}
                  </p>
                </div>
                <button
                  onClick={() => request(p.id)}
                  disabled={requesting !== null}
                  className="px-4 py-2 bg-pink-500 text-white text-xs font-bold rounded-xl disabled:opacity-50"
                >
                  {requesting === p.id ? "..." : "Solicitar"}
                </button>
              </div>
            ))}
          </div>
        )}
        <button onClick={onClose} className="w-full py-2.5 text-sm font-bold text-slate-500 bg-slate-100 rounded-xl">
          Cerrar
        </button>
      </div>
    </div>
  );
}


function DashboardSkeleton() {
  return (
    <div className="relative space-y-8 p-6 md:p-8">
      <div className="space-y-2">
        <Skeleton className="h-9 w-64 rounded-xl" />
        <Skeleton className="h-5 w-48 rounded-lg" />
      </div>
      <Skeleton className="h-52 w-full rounded-[2rem]" />
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-7 w-40 rounded-lg" />
          <Skeleton className="h-5 w-20 rounded-lg" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-28 w-full rounded-2xl" />
        </div>
      </div>
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
    pink:    { icon: "bg-pink-100 text-pink-600",    border: "border-t-pink-500",    btn: "text-pink-600 hover:bg-pink-100" },
    purple:  { icon: "bg-purple-100 text-purple-600", border: "border-t-purple-500", btn: "text-purple-600 hover:bg-purple-100" },
    blue:    { icon: "bg-blue-100 text-blue-600",    border: "border-t-blue-500",    btn: "text-blue-600 hover:bg-blue-100" },
    emerald: { icon: "bg-emerald-100 text-emerald-600", border: "border-t-emerald-500", btn: "text-emerald-600 hover:bg-emerald-100" },
  };
  const c = colors[color];

  const content = (
    <>
      <div className={`w-14 h-14 rounded-2xl ${c.icon} flex items-center justify-center mb-4 ${!disabled && "group-hover:scale-110"} transition-transform duration-300`}>
        {icon}
      </div>
      <h3 className="font-black text-slate-800 text-base mb-1">{label}</h3>
      <p className="text-xs text-slate-500 leading-relaxed mb-4">{description}</p>
      <span className={`inline-flex items-center gap-1 text-xs font-bold bg-transparent ${c.btn} px-4 py-2 rounded-full border-2 border-current transition-colors ${disabled && "opacity-50"}`}>
        {disabled ? "Bloqueado" : "Ir"}
        {!disabled && <ChevronRight className="w-3 h-3" />}
      </span>
    </>
  );

  if (disabled) {
    return (
      <div className={`group bg-white/50 backdrop-blur-md rounded-2xl border border-white/60 shadow-sm border-t-4 ${c.border} p-6 flex flex-col items-center text-center opacity-70 cursor-not-allowed`}>
        {content}
      </div>
    );
  }

  return (
    <Link href={href} className={`group bg-white/60 backdrop-blur-md rounded-2xl border border-white/60 shadow-md border-t-4 ${c.border} p-6 flex flex-col items-center text-center hover:shadow-lg hover:bg-white/80 hover:-translate-y-1 transition-all duration-300`}>
      {content}
    </Link>
  );
}

export default function StudentDashboard() {
  const { user } = useAuthStore();
  const { classes: classesData, loading: classesLoading } = useStudentClasses();
  const { enrollments, loading: enrollmentsLoading, refetch: refetchEnrollments } = useEnrollments();
  const [changePackageTarget, setChangePackageTarget] = useState<any | null>(null);

  const activeOrChangingEnrollments = enrollments.filter(
    e => e.status === "active" || e.status === "pending_package_change"
  );
  const [stage, setStage] = useState<BookingStage>("loading");

  useEffect(() => {
    api.get("/payments/booking-status")
      .then(res => setStage(res.data.stage))
      .catch(() => setStage("ready"));
  }, []);

  const classList: any[] = Array.isArray(classesData) ? classesData : [];
  const hasTrial = classList.some(c => c.class_type === "trial");

  const upcoming = classList
    .filter(c => !["completed", "cancelled", "no_show", "finalized"].includes(c.status))
    .sort((a, b) => new Date(a.start_time_utc).getTime() - new Date(b.start_time_utc).getTime());

  const activeEnrollment = enrollments?.find(e => e.status === "active");
  const assignedTeacher = activeEnrollment?.teacher_name || upcoming[0]?.teacher_name || null;
  const activeSubject = activeEnrollment?.package?.subject || "General";

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
      <div className="fixed top-[-80px] right-[-100px] w-[500px] h-[500px] bg-pink-300/20 rounded-full blur-[100px] pointer-events-none" />
      <div className="fixed bottom-[-80px] left-[-80px] w-[400px] h-[400px] bg-purple-300/15 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative space-y-8 p-6 md:p-8">
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">
            ¡Hola, {user?.name}! 👋
          </h1>
          <p className="text-slate-500 mt-1 font-medium">
            Bienvenido a tu espacio de aprendizaje
          </p>
        </div>

        {stage === "needs_trial" && !hasTrial && (
          <div className="bg-gradient-to-r from-purple-500 to-pink-500 rounded-[2rem] p-6 sm:p-8 text-white relative overflow-hidden shadow-xl shadow-purple-200 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="absolute top-[-40px] right-[-40px] w-48 h-48 bg-white/10 rounded-full blur-2xl" />
            <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-white/70 mb-1">¡Bienvenido!</p>
                  <h2 className="text-xl font-black">Tu primera clase es gratis</h2>
                  <p className="text-white/80 text-sm mt-1">Reserva tu clase de prueba de 30 minutos sin compromiso</p>
                </div>
              </div>
              <Link href="/dashboard/schedule" className="flex-shrink-0 inline-flex items-center gap-2 px-5 py-3 bg-white text-purple-600 text-sm font-bold rounded-xl shadow-md hover:shadow-lg active:scale-[0.98] transition-all duration-200">
                <Calendar className="w-4 h-4" /> Reservar prueba
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
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-500 mb-1">Clase de prueba pendiente</p>
                <h2 className="text-lg font-black text-amber-800">Tu prueba está reservada</h2>
                <p className="text-amber-700 text-sm mt-1">Una vez completada podrás elegir tu paquete y seguir agendando.</p>
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
                  <PackageIcon className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-white/70 mb-1">¡Prueba completada!</p>
                  <h2 className="text-xl font-black">Elige tu paquete de clases</h2>
                  <p className="text-white/80 text-sm mt-1">Selecciona el plan que mejor se adapte a tu ritmo</p>
                </div>
              </div>
              <Link href="/dashboard/schedule" className="flex-shrink-0 inline-flex items-center gap-2 px-5 py-3 bg-white text-emerald-600 text-sm font-bold rounded-xl shadow-md hover:shadow-lg active:scale-[0.98] transition-all duration-200">
                <PackageIcon className="w-4 h-4" /> Elegir paquete
              </Link>
            </div>
          </div>
        )}

        {stage === "ready" && activeOrChangingEnrollments.length > 0 && (
  <div className={`grid gap-4 ${activeOrChangingEnrollments.length > 1 ? "sm:grid-cols-2" : ""}`}>
    {activeOrChangingEnrollments.map((enr) => (
      <div key={enr.id}
        className="bg-gradient-to-br from-indigo-900 via-purple-900 to-slate-900 rounded-[2rem] p-6 text-white relative overflow-hidden shadow-2xl shadow-indigo-950/20 border border-white/10 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="absolute -top-12 -right-12 w-56 h-56 bg-pink-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-pink-500/20 text-pink-300 border border-pink-500/30">
              <Award className="w-3 h-3" /> {enr.status === "pending_package_change" ? "Cambio pendiente" : "Plan Activo"}
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold bg-white/10 text-slate-200 border border-white/10">
              <BookOpen className="w-3 h-3 text-purple-300" /> {enr.package?.subject}
            </span>
          </div>
          <h2 className="text-xl font-black text-white tracking-tight">{enr.package?.name}</h2>
          <p className="text-slate-300 text-xs font-bold">Con {enr.teacher_name || "tu profesor"}</p>

          <div className="bg-white/10 rounded-2xl p-4 space-y-2">
            <div className="flex items-end justify-between">
              <p className="text-2xl font-black text-white leading-none">
                {enr.classes_used}<span className="text-sm text-slate-400 font-bold">/{enr.classes_total ?? "∞"}</span>
              </p>
              {enr.classes_total && (
                <span className="text-[10px] font-bold text-pink-300 bg-pink-500/20 px-2 py-1 rounded-lg">
                  {Math.round((enr.classes_used / enr.classes_total) * 100)}%
                </span>
              )}
            </div>
            <div className="w-full h-2 bg-slate-800/80 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-pink-500 to-purple-400 rounded-full transition-all duration-700"
                style={{ width: enr.classes_total ? `${Math.min((enr.classes_used / enr.classes_total) * 100, 100)}%` : "100%" }} />
            </div>
          </div>

          {enr.status === "pending_package_change" ? (
            <p className="text-xs font-bold text-amber-300">
              Solicitud de cambio de paquete en revisión por tu profesor(a).
            </p>
          ) : (
            <button
              onClick={() => setChangePackageTarget(enr)}
              className="text-xs font-bold text-pink-300 hover:text-pink-200 underline underline-offset-4"
            >
              Cambiar de paquete
            </button>
          )}
        </div>
      </div>
    ))}
  </div>
)}

{changePackageTarget && (
  <ChangePackageModal
    enrollment={changePackageTarget}
    teacherUsername={changePackageTarget.teacher_username}
    onClose={() => setChangePackageTarget(null)}
    onDone={refetchEnrollments}
  />
)}

        {/* ─── Próximas clases: SOLO INFORMATIVO (readOnly) ─── */}
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-150">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-slate-800">Próximas clases</h2>
              {upcoming.length > 0 && (
                <span className="bg-pink-100 text-pink-600 text-xs font-black px-2.5 py-0.5 rounded-full">
                  {upcoming.length}
                </span>
              )}
            </div>
            <Link href="/dashboard/classes" className="text-sm font-bold text-pink-600 hover:text-pink-700 flex items-center gap-1 transition-colors">
              Ver todas <ChevronRight className="w-4 h-4" />
            </Link>
          </div>

          {upcoming.length === 0 ? (
            <div className="bg-white/60 backdrop-blur-md rounded-2xl border border-white/60 shadow-md p-8 text-center">
              <Calendar className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 font-bold mb-4">
                {stage === "trial_in_progress" || hasTrial ? "Tu clase de prueba aparecerá aquí" : "No tienes clases próximas"}
              </p>
              {((stage === "needs_trial" && !hasTrial) || stage === "ready") && (
                <Link href="/dashboard/schedule" className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-pink-500 to-rose-400 text-white text-sm font-bold rounded-xl shadow-md shadow-pink-100 hover:shadow-pink-200 hover:-translate-y-0.5 transition-all duration-200">
                  <Calendar className="w-4 h-4" />
                  {stage === "needs_trial" && !hasTrial ? "Agendar clase de prueba" : "Agendar primera clase"}
                </Link>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {upcoming.slice(0, 3).map((cls) => (
                <ClassCard key={cls.id} class_={cls} role="student" readOnly />
              ))}
            </div>
          )}
        </div>

        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-200">
          <h2 className="text-xl font-black text-slate-800 mb-4">¿Qué quieres hacer?</h2>
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
            <QuickAction href="/dashboard/materials" color="purple" label="Materiales" description="Accede a tus recursos de estudio" icon={<BookOpen className="w-7 h-7" />} />
            <QuickAction href="/dashboard/homework" color="blue" label="Tareas" description="Revisa y entrega tus actividades" icon={<ClipboardList className="w-7 h-7" />} />
            <QuickAction href="/dashboard/teachers" color="emerald" label="Mi Profesor" description="Contacta y conoce a tu profesor o profesora" icon={<UserCheck className="w-7 h-7" />} />
          </div>
        </div>
      </div>
      <ChipiWidget screenName="student_home" />
    </div>
  );
}