"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuthStore } from "@/store/authStore";
import { 
  useStudentClasses, 
  useEnrollments, 
  useBookingStage, 
  BookingStage,
} from "@/hooks/useStudentData";
import api from "@/lib/api";
import ClassCard from "@/components/classes/ClassCard";
import GroupWaitingPanel from "@/components/classes/GroupWaitingPanel";
import ChangePackageModal from "@/components/payments/ChangePackageModal";
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
  AlertCircle,
  CreditCard,
  RefreshCw,
  X,
  AlertTriangle,
} from "lucide-react";
import PackageCheckout from "@/components/payments/PackageCheckout";
import BuyCreditsModal from "@/components/payments/BuyCreditsModal";
import RejectedPaymentNotice from "@/components/payments/RejectedPaymentNotice";
import ChipiWidget from "@/components/chipi/ChipiWidget";
import RefreshButton from "@/components/ui/RefreshButton";
import DesktopOnly from "@/components/ui/DesktopOnly";
import { usePageTopBar } from "@/lib/mobileTopBar";

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-slate-200/80 rounded-2xl ${className}`} />;
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
  const { classes: classesData, loading: classesLoading, isFetching: classesFetching, isError: classesError, refetch: refetchClasses } = useStudentClasses();
  const { enrollments, loading: enrollmentsLoading, isFetching: enrollmentsFetching, isError: enrollmentsError, refetch: refetchEnrollments } = useEnrollments();
  const { stage, lastRejectedPayment, isFetching: stageFetching, refetch: refetchStage } = useBookingStage();

  const [changePackageTarget, setChangePackageTarget] = useState<any | null>(null);
  const [installmentTarget, setInstallmentTarget] = useState<any | null>(null);
  const [rechargeTarget, setRechargeTarget] = useState<any | null>(null);

  const activeOrChangingEnrollments = enrollments.filter(
    e => (e.status === "active" || e.status === "pending_package_change") && !e.cohort_id
  );
  const activeGroupEnrollments = enrollments.filter(
    e => !!e.cohort_id && e.status !== "cancelled"
  );

  const classList: any[] = Array.isArray(classesData) ? classesData : [];
  const hasTrial = classList.some(c => c.class_type === "trial");

  const upcoming = classList
    .filter(c => !["completed", "cancelled", "no_show", "finalized"].includes(c.status))
    .sort((a, b) => new Date(a.start_time_utc).getTime() - new Date(b.start_time_utc).getTime());

  const isGlobalLoading = stage === "loading" || classesLoading || enrollmentsLoading;
  const isFetching = classesFetching || enrollmentsFetching || stageFetching; 
  const isError = classesError || enrollmentsError;

  const handleRefresh = () => {
    refetchClasses();
    refetchEnrollments();
    refetchStage();
  };

  usePageTopBar({
    title: "Inicio",
    onRefresh: handleRefresh,
    isFetching,
  });

  if (isGlobalLoading) {
    return (
      <div className="min-h-screen bg-slate-50 relative overflow-hidden">
        <DashboardSkeleton />
      </div>
    );
  }

  if (isError) {
    return (
      <>
        <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4 text-center px-4">
          <div className="w-14 h-14 bg-rose-100 rounded-full flex items-center justify-center">
            <AlertTriangle className="w-7 h-7 text-rose-500" />
          </div>
          <div>
            <p className="text-lg font-black text-slate-800">No se pudo cargar tu panel</p>
            <p className="text-sm text-slate-500 mt-1">Revisa tu conexión e inténtalo de nuevo.</p>
          </div>
          <button
            onClick={handleRefresh}
            className="flex items-center gap-2 px-5 py-2.5 bg-pink-500 hover:bg-pink-600 text-white text-sm font-bold rounded-xl shadow-sm transition-colors"
          >
            <RefreshCw className="w-4 h-4" /> Reintentar
          </button>
        </div>
        <ChipiWidget screenName="student_home" />
      </>
    );
  }

  return (
    <>
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">
      <div className="fixed top-[-80px] right-[-100px] w-[500px] h-[500px] bg-pink-300/20 rounded-full blur-[100px] pointer-events-none" />
      <div className="fixed bottom-[-80px] left-[-80px] w-[400px] h-[400px] bg-purple-300/15 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative space-y-8 p-6 md:p-8">
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-slate-800 tracking-tight">
              ¡Hola, {user?.name}! 👋
            </h1>
            <p className="text-slate-500 mt-1 font-medium">
              Bienvenido a tu espacio de aprendizaje
            </p>
          </div>
          <DesktopOnly>
            <RefreshButton onRefresh={handleRefresh} isFetching={isFetching} />
          </DesktopOnly>
        </div>

        {lastRejectedPayment && (stage === "needs_package" || stage === "needs_renewal" || stage === "renew_required") && (
          <RejectedPaymentNotice payment={lastRejectedPayment} variant="compact" />
        )}

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

        {stage === "package_pending_payment" && (
          <div className="bg-gradient-to-r from-amber-500 to-orange-500 rounded-[2rem] p-6 sm:p-8 text-white relative overflow-hidden shadow-xl shadow-amber-200 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="absolute top-[-40px] right-[-40px] w-48 h-48 bg-white/10 rounded-full blur-2xl" />
            <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-white/70 mb-1">Pago pendiente de confirmación</p>
                  <h2 className="text-xl font-black">Tu pago está en proceso de validación</h2>
                  <p className="text-white/80 text-sm mt-1">Si no adjuntaste tu comprobante, puedes reabrirlo o enviarlo ahora para activar tu agenda.</p>
                </div>
              </div>
              <Link href="/dashboard/schedule" className="flex-shrink-0 inline-flex items-center gap-2 px-5 py-3 bg-white text-amber-600 text-sm font-bold rounded-xl shadow-md hover:shadow-lg active:scale-[0.98] transition-all duration-200">
                <CreditCard className="w-4 h-4" /> Notificar pago
              </Link>
            </div>
          </div>
        )}

        {stage === "needs_payment" && (
          <div className="bg-gradient-to-r from-amber-500 to-rose-500 rounded-[2rem] p-6 sm:p-8 text-white relative overflow-hidden shadow-xl shadow-rose-200 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="absolute top-[-40px] right-[-40px] w-48 h-48 bg-white/10 rounded-full blur-2xl" />
            <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-white/70 mb-1">Pago pendiente</p>
                  <h2 className="text-xl font-black">Tienes un pago o cuota pendiente</h2>
                  <p className="text-white/80 text-sm mt-1">Completa el pago para mantener tu paquete activo y seguir agendando clases.</p>
                </div>
              </div>
              <Link href="/dashboard/schedule" className="flex-shrink-0 inline-flex items-center gap-2 px-5 py-3 bg-white text-rose-600 text-sm font-bold rounded-xl shadow-md hover:shadow-lg active:scale-[0.98] transition-all duration-200">
                <CreditCard className="w-4 h-4" /> Realizar pago
              </Link>
            </div>
          </div>
        )}

        {(stage === "renew_required" || stage === "needs_renewal" || stage === "renewal_pending") && (
          <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-[2rem] p-6 sm:p-8 text-white relative overflow-hidden shadow-xl shadow-purple-200 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="absolute top-[-40px] right-[-40px] w-48 h-48 bg-white/10 rounded-full blur-2xl" />
            <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
                  <RefreshCw className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-white/70 mb-1">
                    {stage === "renewal_pending" ? "Renovación en proceso" : "Renovación requerida"}
                  </p>
                  <h2 className="text-xl font-black">
                    {stage === "renewal_pending" ? "Tu solicitud de renovación fue enviada" : "Tu paquete ha finalizado"}
                  </h2>
                  <p className="text-white/80 text-sm mt-1">
                    {stage === "renewal_pending"
                      ? "Tu profesor o administración revisará tu pago para desbloquear tus nuevas clases."
                      : "Renueva tu paquete o selecciona uno nuevo para continuar aprendiendo."}
                  </p>
                </div>
              </div>
              <Link href="/dashboard/schedule" className="flex-shrink-0 inline-flex items-center gap-2 px-5 py-3 bg-white text-purple-600 text-sm font-bold rounded-xl shadow-md hover:shadow-lg active:scale-[0.98] transition-all duration-200">
                <PackageIcon className="w-4 h-4" /> {stage === "renewal_pending" ? "Ver estado" : "Renovar paquete"}
              </Link>
            </div>
          </div>
        )}

        {stage === "ready" && activeGroupEnrollments.length > 0 && (
          <div className={`grid gap-4 ${activeGroupEnrollments.length > 1 ? "sm:grid-cols-2" : ""}`}>
            {activeGroupEnrollments.map((enr) => (
              <GroupWaitingPanel key={enr.id} enrollment={enr} onChanged={handleRefresh} />
            ))}
          </div>
        )}

        {stage === "ready" && activeOrChangingEnrollments.length > 0 && (
          <div className={`grid gap-4 ${activeOrChangingEnrollments.length > 1 ? "sm:grid-cols-2" : ""}`}>
            {activeOrChangingEnrollments.map((enr) => {
              const isUnlimited = enr.package?.classes_count == null;
              const remainingCredits = enr.available_credits ?? (isUnlimited
                ? (enr.prepaid_unlimited_credits ?? 0)
                : Math.max((enr.unlocked_credits ?? 0) - enr.classes_used, 0));
              const totalInstallments = enr.package?.installment_count ?? enr.total_installments;
              const hasMoreInstallments = !isUnlimited && !!totalInstallments && totalInstallments > 1 && (enr.installments_paid ?? 0) < totalInstallments;
              const needsNextInstallment = hasMoreInstallments && remainingCredits <= 0;

              return (
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
                      {enr.paid_via_installments && enr.installments_paid && enr.installments_paid > 0 && totalInstallments && totalInstallments > 1 && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          <CreditCard className="w-3 h-3" /> Cuota {enr.installments_paid}/{totalInstallments}
                        </span>
                      )}
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

                    <div className="flex items-center justify-between text-xs text-slate-300 border-t border-white/10 pt-3 mt-3">
                      <div>
                        <span className="text-slate-400 block text-[10px] font-semibold uppercase tracking-wider">
                          {enr.package?.classes_count === null ? "Créditos prepagados" : "Créditos disponibles"}
                        </span>
                        <span className="font-bold text-white text-sm">
                          {remainingCredits !== null ? `${remainingCredits} restantes` : "Ilimitados"}
                        </span>
                      </div>
                      {enr.paid_via_installments && enr.installments_paid && totalInstallments && totalInstallments > 1 && (
                        <div className="text-right">
                          <span className="text-slate-400 block text-[10px] font-semibold uppercase tracking-wider">Cuotas</span>
                          <span className="font-bold text-pink-300 text-sm">
                            Cuota {enr.installments_paid} de {totalInstallments}
                          </span>
                        </div>
                      )}
                    </div>

                    {enr.status !== "pending_package_change" && (
                      <div className="flex flex-col gap-2 pt-2">
                        {needsNextInstallment && (
                          <button
                            onClick={() => setInstallmentTarget(enr)}
                            className="w-full py-2.5 text-xs font-bold text-white rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 shadow-md shadow-amber-500/20 active:scale-[0.98] transition-all"
                          >
                            Pagar cuota {(enr.installments_paid ?? 0) + 1} de {totalInstallments}
                          </button>
                        )}
                        {isUnlimited && (
                          <button
                            onClick={() => setRechargeTarget(enr)}
                            className="w-full py-2.5 text-xs font-bold text-pink-300 hover:text-pink-200 border border-pink-400/30 hover:border-pink-400/60 rounded-xl transition-all"
                          >
                            Comprar más créditos ({remainingCredits} disponibles)
                          </button>
                        )}
                      </div>
                    )}

                    {enr.status === "pending_package_change" ? (
                      <p className="text-xs font-bold text-amber-300 pt-1">
                        Solicitud de cambio de paquete en revisión por tu profesor(a).
                      </p>
                    ) : enr.payment_status !== "paid" ? (
                      <p className="text-xs font-bold text-slate-400 pt-1">
                        Termina de pagar tu paquete actual para poder cambiarlo.
                      </p>
                    ) : (
                      <button
                        onClick={() => setChangePackageTarget(enr)}
                        className="text-xs font-bold text-pink-300 hover:text-pink-200 underline underline-offset-4 pt-1"
                      >
                        Cambiar de paquete
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
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

        {installmentTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setInstallmentTarget(null)} />
            <div className="relative w-full max-w-3xl bg-white rounded-[2rem] shadow-2xl max-h-[85vh] flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-6 sm:px-8 py-5 border-b border-slate-100 flex-shrink-0">
                <h2 className="text-lg font-black text-slate-800">Pagar siguiente cuota</h2>
                <button onClick={() => setInstallmentTarget(null)} className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center">
                  <X className="w-4 h-4 text-slate-500" />
                </button>
              </div>
              <div className="p-6 sm:p-8 overflow-y-auto">
                <PackageCheckout
                  pkg={installmentTarget.package}
                  mode="change"
                  enrollmentId={installmentTarget.id}
                  installmentsPaid={installmentTarget.installments_paid ?? 0}
                  currentCredits={installmentTarget.available_credits ?? installmentTarget.prepaid_unlimited_credits ?? 0}
                  onClose={() => setInstallmentTarget(null)}
                  onDone={refetchEnrollments}
                />
              </div>
            </div>
          </div>
        )}

        {rechargeTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setRechargeTarget(null)} />
            <div className="relative w-full max-w-3xl bg-white rounded-[2rem] shadow-2xl max-h-[85vh] flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-6 sm:px-8 py-5 border-b border-slate-100 flex-shrink-0">
                <h2 className="text-lg font-black text-slate-800">Comprar créditos</h2>
                <button onClick={() => setRechargeTarget(null)} className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center">
                  <X className="w-4 h-4 text-slate-500" />
                </button>
              </div>
              <div className="p-6 sm:p-8 overflow-y-auto">
                <BuyCreditsModal
                    enrollmentId={rechargeTarget.id}
                    pricePerClass={rechargeTarget.package.price}
                    currentCredits={rechargeTarget.available_credits ?? rechargeTarget.prepaid_unlimited_credits ?? 0}
                    onClose={() => setRechargeTarget(null)}
                    onDone={refetchEnrollments}
                  />
              </div>
            </div>
          </div>
        )}

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
    </div>
    <ChipiWidget screenName="student_home" />
    </>
  );
}