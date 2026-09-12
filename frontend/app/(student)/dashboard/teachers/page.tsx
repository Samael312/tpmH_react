"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { GraduationCap, Users, Sparkles, Snowflake } from "lucide-react";
import { useTeacherDirectory, usePlatformConfig, useMyTeachers, MyTeacherInfo } from "@/hooks/useStudentData";
import TeacherCard from "@/components/student/TeacherCard";
import ChipiWidget from "@/components/chipi/ChipiWidget";
import Skeleton from "@/components/ui/Skeleton";
import RefreshButton from "@/components/ui/RefreshButton";
import DesktopOnly from "@/components/ui/DesktopOnly";
import FullScreenModal from "@/components/ui/FullScreenModal";
import Button from "@/components/ui/Button";
import RefundDestinationFields, { emptyRefundDestinationForm, refundFormToPayload } from "@/components/payments/RefundDestinationFields";
import { usePageTopBar } from "@/lib/mobileTopBar";
import { useToast } from "@/hooks/useToast";
import { getErrorMessage } from "@/lib/errorMessage";
import api from "@/lib/api";

const STAGE_LABEL: Record<string, string> = {
  needs_trial: "Prueba pendiente",
  trial_in_progress: "Prueba agendada",
  needs_package: "Elige tu paquete",
  package_pending_payment: "Pago pendiente de confirmación",
  needs_payment: "Pago pendiente de notificación",
  needs_renewal: "Paquete agotado",
  renew_required: "Paquete agotado",
  renewal_pending: "Renovación en revisión",
  needs_group_refund: "Grupo cancelado — reembolso pendiente",
  ready: "Activo",
};

const STAGE_BADGE: Record<string, string> = {
  needs_trial: "bg-purple-100 text-purple-700",
  trial_in_progress: "bg-amber-100 text-amber-700",
  needs_package: "bg-emerald-100 text-emerald-700",
  package_pending_payment: "bg-amber-100 text-amber-700",
  needs_payment: "bg-amber-100 text-amber-700",
  needs_renewal: "bg-rose-100 text-rose-700",
  renew_required: "bg-rose-100 text-rose-700",
  renewal_pending: "bg-amber-100 text-amber-700",
  needs_group_refund: "bg-slate-200 text-slate-700",
  ready: "bg-blue-100 text-blue-700",
};

export default function ChooseTeacherPage() {
  const router = useRouter();
  const toast = useToast();
  const { config, loading: configLoading } = usePlatformConfig();
  const { teachers: directory, loading: directoryLoading, isFetching: directoryFetching, refetch: refetchDirectory } = useTeacherDirectory();
  const { teachers: myTeachers, loading: myLoading, isFetching: myFetching, refetch: refetchMine } = useMyTeachers();
  const [refundTarget, setRefundTarget] = useState<MyTeacherInfo | null>(null);
  const [submittingRefund, setSubmittingRefund] = useState(false);
  const [refundForm, setRefundForm] = useState(emptyRefundDestinationForm);

  const submitRefund = async () => {
    if (!refundTarget?.active_enrollment) return;
    setSubmittingRefund(true);
    try {
      await api.post("/payments/request-refund-teacher-suspended", {
        enrollment_id: refundTarget.active_enrollment.id,
        payment_info: refundFormToPayload(refundForm),
      });
      toast.success("Reembolso solicitado. El staff lo revisará en breve.");
      setRefundTarget(null);
      setRefundForm(emptyRefundDestinationForm);
      refetchMine();
    } catch (e) {
      toast.error(getErrorMessage(e, "No se pudo solicitar el reembolso"));
    } finally {
      setSubmittingRefund(false);
    }
  };

  const refetchAll = () => {
    refetchDirectory();
    refetchMine();
  };
  const isFetching = directoryFetching || myFetching;

  usePageTopBar({
    title: "Profesores",
    onRefresh: refetchAll,
    isFetching,
  });

  // Modo single-tenant: no hay nada que elegir, vamos directo al perfil completo
  useEffect(() => {
    if (!configLoading && config?.is_single_tenant && config.featured_teacher?.username) {
      router.replace(`/dashboard/teachers/${config.featured_teacher.username}`);
    }
  }, [configLoading, config, router]);

  if (configLoading || config?.is_single_tenant) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-pink-200 border-t-pink-500 rounded-full animate-spin" />
      </div>
    );
  }

  const myUsernames = new Set(myTeachers.map(t => t.teacher_username));
  const marketplaceTeachers = directory.filter(t => !myUsernames.has(t.user_username));
  const loading = directoryLoading || myLoading;

  return (
    <>
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">
      <div className="fixed top-[-100px] right-[-100px] w-[500px] h-[500px] bg-pink-300/20 rounded-full blur-[100px] pointer-events-none" />
      <div className="fixed bottom-[-100px] left-[-100px] w-[400px] h-[400px] bg-purple-300/15 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-slate-800 tracking-tight">Profesores</h1>
            <p className="text-slate-500 mt-1">
              Gestiona tus profesores actuales o explora el resto de la plataforma. Puedes tener
              varios profesores al mismo tiempo, aunque enseñen lo mismo.
            </p>
          </div>
          <DesktopOnly>
            <RefreshButton onRefresh={refetchAll} isFetching={isFetching} />
          </DesktopOnly>
        </div>

        {/* ─── Tus profesores ─── */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-pink-500" />
            <h2 className="text-xl font-black text-slate-800">Tus profesores</h2>
            {myTeachers.length > 0 && (
              <span className="bg-pink-100 text-pink-600 text-xs font-black px-2.5 py-0.5 rounded-full">
                {myTeachers.length}
              </span>
            )}
          </div>

          {myLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2].map(i => <Skeleton key={i} className="h-40 rounded-[2rem]" />)}
            </div>
          ) : myTeachers.length === 0 ? (
            <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-lg py-10 text-center">
              <Sparkles className="w-8 h-8 text-slate-200 mx-auto mb-2" />
              <p className="text-slate-500 font-bold text-sm">
                Aún no has elegido ningún profesor. Explora el marketplace abajo.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {myTeachers.map(t => {
                const avatar = (
                  <div className="relative w-16 h-16 rounded-2xl overflow-hidden bg-gradient-to-br from-pink-400 to-rose-400 flex items-center justify-center flex-shrink-0">
                    {t.profile_photo_url ? (
                      <Image src={t.profile_photo_url} alt={t.name ?? ""} fill sizes="64px" className="object-cover" />
                    ) : (
                      <span className="text-white text-xl font-black">{t.name?.[0]?.toUpperCase() ?? "P"}</span>
                    )}
                  </div>
                );

                if (t.is_frozen) {
                  return (
                    <div
                      key={t.teacher_username}
                      className="bg-slate-50 rounded-[2rem] border border-slate-200 shadow-lg shadow-slate-200/50 p-5 flex gap-4 items-start opacity-90"
                    >
                      <div className="grayscale">{avatar}</div>
                      <div className="min-w-0 flex-1">
                        <p className="font-black text-slate-600 truncate">{t.name} {t.surname}</p>
                        <span className="inline-flex items-center gap-1 mt-2 text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-slate-200 text-slate-500">
                          <Snowflake className="w-3 h-3" /> Suspendido
                        </span>
                        <p className="text-[11px] text-slate-400 font-bold mt-1.5 leading-relaxed">
                          Este profesor no está disponible ahora mismo. Tus créditos
                          {t.active_enrollment && ` (${t.active_enrollment.classes_total !== null ? t.active_enrollment.classes_total - t.active_enrollment.classes_used : "∞"})`}
                          {" "}quedaron congelados.
                        </p>
                        {t.refund_pending ? (
                          <p className="text-[11px] text-amber-600 font-black mt-2">Reembolso en revisión</p>
                        ) : (
                          <button
                            onClick={() => setRefundTarget(t)}
                            className="mt-2 text-[11px] font-black text-pink-600 hover:text-pink-700 underline underline-offset-2 disabled:opacity-50"
                          >
                            Solicitar reembolso
                          </button>
                        )}
                      </div>
                    </div>
                  );
                }

                return (
                  <a
                    key={t.teacher_username}
                    href={`/dashboard/teachers/${t.teacher_username}`}
                    className="bg-white rounded-[2rem] border border-slate-100 shadow-lg shadow-slate-200/50
                               hover:shadow-2xl hover:-translate-y-1 transition-all duration-300 p-5 flex gap-4 items-center"
                  >
                    {avatar}
                    <div className="min-w-0 flex-1">
                      <p className="font-black text-slate-800 truncate">{t.name} {t.surname}</p>
                      {t.title && <p className="text-xs text-slate-500 truncate">{t.title}</p>}
                      <span className={`inline-block mt-2 text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full ${STAGE_BADGE[t.stage] ?? "bg-slate-100 text-slate-500"}`}>
                        {STAGE_LABEL[t.stage] ?? t.stage}
                      </span>
                      {t.active_enrollment && (
                        <p className="text-[11px] text-slate-400 font-bold mt-1">
                          {t.active_enrollment.package_name} · {t.active_enrollment.classes_used}/
                          {t.active_enrollment.classes_total ?? "∞"}
                        </p>
                      )}
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </div>

        {/* ─── Marketplace ─── */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-purple-500" />
            <h2 className="text-xl font-black text-slate-800">Explorar más profesores</h2>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-[420px] rounded-[2rem]" />)}
            </div>
          ) : marketplaceTeachers.length === 0 ? (
            <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-lg py-16 text-center">
              <Users className="w-10 h-10 text-slate-200 mx-auto mb-3" />
              <p className="text-slate-500 font-bold">No hay más profesores disponibles por ahora</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {marketplaceTeachers.map(t => (
                <TeacherCard key={t.user_username} teacher={t} isMine={false} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
    <ChipiWidget screenName="choose_teacher" />

    <FullScreenModal
      open={!!refundTarget}
      onClose={() => setRefundTarget(null)}
      title="Solicitar reembolso"
      footer={
        <Button className="w-full" onClick={submitRefund} loading={submittingRefund}>
          Enviar solicitud
        </Button>
      }
    >
      <div className="space-y-5">
        <p className="text-sm text-slate-500">
          Indícanos a dónde quieres que te devolvamos el saldo restante de tu paquete con{" "}
          <span className="font-bold text-slate-700">{refundTarget?.name}</span>. Todos los campos son
          opcionales: completa el o los medios que tengas, o dejanos una nota si no tenés ninguno de
          los que mostramos abajo.
        </p>
        <RefundDestinationFields value={refundForm} onChange={setRefundForm} />
      </div>
    </FullScreenModal>
    </>
  );
}