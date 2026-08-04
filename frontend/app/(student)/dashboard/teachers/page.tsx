"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GraduationCap, Users } from "lucide-react";
import api from "@/lib/api";
import TeacherCard from "@/components/student/TeacherCard";
import { useTeacherDirectory, usePlatformConfig } from "@/hooks/useStudentData";
import ChipiWidget from "@/components/chipi/ChipiWidget";



export default function ChooseTeacherPage() {
  const router = useRouter();
  const { config, loading: configLoading } = usePlatformConfig();
  const { teachers, loading: teachersLoading } = useTeacherDirectory();
  const [myTeacherUsername, setMyTeacherUsername] = useState<string | null>(null);
  const [loadingMine, setLoadingMine] = useState(true);

  /*console.log("🔍 ESTADO DE CONFIGURACIÓN:", { 
    loading: configLoading, 
    isSingleTenant: config?.is_single_tenant, 
    teacherData: config?.featured_teacher 
  });

  useEffect(() => {
    if (!configLoading) {
      console.log(
        "🛠️ PLATFORM CONFIG COMPLETA:\n", 
        JSON.stringify(config, null, 2)
      );
    }
  }, [config, configLoading]);
*/

  useEffect(() => {
    api.get("/users/me/student-profile")
      .then(res => setMyTeacherUsername(res.data?.teacher_username ?? null))
      .catch(() => setMyTeacherUsername(null))
      .finally(() => setLoadingMine(false));
  }, []);

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

  const loading = teachersLoading || loadingMine;

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">
      <div className="fixed top-[-100px] right-[-100px] w-[500px] h-[500px] bg-pink-300/20 rounded-full blur-[100px] pointer-events-none" />
      <div className="fixed bottom-[-100px] left-[-100px] w-[400px] h-[400px] bg-purple-300/15 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        <div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">
            {myTeacherUsername ? "Profesores" : "Elige tu profesor"}
          </h1>
          <p className="text-slate-500 mt-1">
            {myTeacherUsername
              ? "Consulta el perfil de tu profesor o descubre a otros profesores de la plataforma"
              : "Explora los perfiles y elige con quién quieres aprender"}
          </p>
        </div>

        {myTeacherUsername && (
          <div className="bg-gradient-to-r from-pink-500 to-rose-400 rounded-[2rem] p-6 text-white
                          flex items-center justify-between gap-4 shadow-xl shadow-pink-200 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-white/20 rounded-xl flex items-center justify-center">
                <GraduationCap className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-white/70">Tu profesor actual</p>
                <p className="text-lg font-black">@{myTeacherUsername}</p>
              </div>
            </div>
            <a href={`/dashboard/teachers/${myTeacherUsername}`}
               className="px-5 py-2.5 bg-white text-pink-600 text-sm font-bold rounded-xl shadow-md
                          hover:shadow-lg active:scale-[0.98] transition-all">
              Ver perfil
            </a>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map(i => <div key={i} className="h-[420px] bg-white rounded-[2rem] animate-pulse" />)}
          </div>
        ) : teachers.length === 0 ? (
          <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-lg py-16 text-center">
            <Users className="w-10 h-10 text-slate-200 mx-auto mb-3" />
            <p className="text-slate-500 font-bold">No hay profesores disponibles todavía</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {teachers.map(t => (
              <TeacherCard key={t.user_username} teacher={t} isMine={t.user_username === myTeacherUsername} />
            ))}
          </div>
        )}
      </div>
      <ChipiWidget screenName="choose_teacher" />
    </div>
  );
}