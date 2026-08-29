"use client";

import { AlertCircle, BookOpen, RefreshCw } from "lucide-react";
import ChipiWidget from "@/components/chipi/ChipiWidget";
import PublicProfileView, { PublicProfileTeacher } from "@/components/teacher/PublicProfileView";
import { useTeacherProfile, useTeacherOwnReviews } from "@/hooks/useTeacherData";
import Skeleton from "@/components/ui/Skeleton";
import RefreshButton from "@/components/ui/RefreshButton";
import DesktopOnly from "@/components/ui/DesktopOnly";
import { usePageTopBar } from "@/lib/mobileTopBar";

export default function TeacherProfilePreviewPage() {
  const { profile, loading, isFetching, isError, refetch } = useTeacherProfile();
  const { reviews } = useTeacherOwnReviews(profile?.user_username);

  usePageTopBar({
    title: "Vista previa",
    onRefresh: refetch,
    isFetching, // antes: isFetching: loading  ← bug
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-6 space-y-6 max-w-3xl mx-auto">
        <Skeleton className="h-40 w-full rounded-3xl" />
        <Skeleton className="h-64 w-full rounded-3xl" />
        <Skeleton className="h-48 w-full rounded-3xl" />
      </div>
    );
  }

  if (isError || !profile) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-3xl p-8 shadow-xl text-center max-w-md w-full border border-slate-100 space-y-4">
          <div className="w-12 h-12 bg-pink-50 text-pink-500 rounded-2xl flex items-center justify-center mx-auto">
            <BookOpen className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-black text-slate-800">Perfil no disponible</h2>
          <p className="text-sm text-slate-500">No se pudo cargar la información del perfil.</p>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 mx-auto px-5 py-2.5 bg-pink-500 hover:bg-pink-600 text-white text-sm font-bold rounded-xl shadow-sm transition-colors"
          >
            <RefreshCw className="w-4 h-4" /> Reintentar
          </button>
        </div>
      </div>
    );
  }

  const teacher = profile as unknown as PublicProfileTeacher;
  const isApproved = teacher.status === "approved";

  return (
    <>
      <DesktopOnly>
        <div className="max-w-3xl mx-auto pt-4 flex justify-end">
          <RefreshButton onRefresh={refetch} isFetching={isFetching} />
        </div>
      </DesktopOnly>
      <PublicProfileView
        teacher={teacher}
        reviews={reviews}
        notice={
          !isApproved ? (
            <div className="bg-amber-500 border-2 border-amber-400 rounded-3xl p-5 text-white shadow-xl shadow-amber-200/50 flex items-center gap-4 animate-in fade-in slide-in-from-top-4 duration-500">
              <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center flex-shrink-0 backdrop-blur-md">
                <AlertCircle className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="text-base font-black tracking-tight">
                  {teacher.video_url ? "Solicitud en revisión" : "Video de presentación pendiente"}
                </h3>
                <p className="text-xs sm:text-sm font-medium text-amber-50">
                  {teacher.video_url
                    ? "Tu perfil será público cuando el staff apruebe tu solicitud."
                    : "Sube tu video de presentación desde tu perfil para poder ser aprobado."}
                </p>
              </div>
            </div>
          ) : undefined
        }
      />
      <ChipiWidget screenName="teacher-view" />
    </>
  );
}