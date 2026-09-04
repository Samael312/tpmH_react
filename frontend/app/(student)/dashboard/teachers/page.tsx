"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { GraduationCap, Users, Sparkles } from "lucide-react";
import { useTeacherDirectory, usePlatformConfig, useMyTeachers } from "@/hooks/useStudentData";
import TeacherCard from "@/components/student/TeacherCard";
import ChipiWidget from "@/components/chipi/ChipiWidget";
import Skeleton from "@/components/ui/Skeleton";
import RefreshButton from "@/components/ui/RefreshButton";
import DesktopOnly from "@/components/ui/DesktopOnly";
import { usePageTopBar } from "@/lib/mobileTopBar";

const STAGE_LABEL: Record<string, string> = {
  needs_trial: "Prueba pendiente",
  trial_in_progress: "Prueba agendada",
  needs_package: "Elige tu paquete",
  needs_renewal: "Paquete agotado",
  renewal_pending: "Renovación en revisión",
  ready: "Activo",
};

const STAGE_BADGE: Record<string, string> = {
  needs_trial: "bg-purple-100 text-purple-700",
  trial_in_progress: "bg-amber-100 text-amber-700",
  needs_package: "bg-emerald-100 text-emerald-700",
  needs_renewal: "bg-rose-100 text-rose-700",
  renewal_pending: "bg-amber-100 text-amber-700",
  ready: "bg-blue-100 text-blue-700",
};

export default function ChooseTeacherPage() {
  const router = useRouter();
  const { config, loading: configLoading } = usePlatformConfig();
  const { teachers: directory, loading: directoryLoading, isFetching: directoryFetching, refetch: refetchDirectory } = useTeacherDirectory();
  const { teachers: myTeachers, loading: myLoading, isFetching: myFetching, refetch: refetchMine } = useMyTeachers();

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
              {myTeachers.map(t => (
                <a
                  key={t.teacher_username}
                  href={`/dashboard/teachers/${t.teacher_username}`}
                  className="bg-white rounded-[2rem] border border-slate-100 shadow-lg shadow-slate-200/50
                             hover:shadow-2xl hover:-translate-y-1 transition-all duration-300 p-5 flex gap-4 items-center"
                >
                  <div className="relative w-16 h-16 rounded-2xl overflow-hidden bg-gradient-to-br from-pink-400 to-rose-400 flex items-center justify-center flex-shrink-0">
                    {t.profile_photo_url ? (
                      <Image src={t.profile_photo_url} alt={t.name ?? ""} fill sizes="64px" className="object-cover" />
                    ) : (
                      <span className="text-white text-xl font-black">{t.name?.[0]?.toUpperCase() ?? "P"}</span>
                    )}
                  </div>
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
              ))}
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
    </>
  );
}