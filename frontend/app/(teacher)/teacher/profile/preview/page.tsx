"use client";

import { useState, useEffect } from "react";
import { AlertCircle, Loader2, BookOpen } from "lucide-react";
import api from "@/lib/api";
import ChipiWidget from "@/components/chipi/ChipiWidget";
import PublicProfileView, { PublicProfileTeacher, PublicProfileReview } from "@/components/teacher/PublicProfileView";
import { getFlagForNationality } from "@/lib/nationalities";

export default function TeacherProfilePreviewPage() {
  const [teacher, setTeacher] = useState<PublicProfileTeacher | null>(null);
  const [reviews, setReviews] = useState<PublicProfileReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const teacherRes = await api.get("/teachers/me/profile");
        const teacherData: PublicProfileTeacher = teacherRes.data;
        setTeacher(teacherData);

        try {
          const reviewsRes = await api.get(`/reviews/${teacherData.user_username}`);
          setReviews(Array.isArray(reviewsRes.data) ? reviewsRes.data : []);
        } catch {
          setReviews([]);
        }
      } catch (err) {
        console.error("Error al cargar perfil:", err);
        setError("No se pudo cargar la información del perfil.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-pink-500 animate-spin" />
      </div>
    );
  }

  if (error || !teacher) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-3xl p-8 shadow-xl text-center max-w-md w-full border border-slate-100 space-y-4">
          <div className="w-12 h-12 bg-pink-50 text-pink-500 rounded-2xl flex items-center justify-center mx-auto">
            <BookOpen className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-black text-slate-800">Perfil no disponible</h2>
          <p className="text-sm text-slate-500">{error || "No se pudo encontrar el perfil."}</p>
        </div>
      </div>
    );
  }

  const isApproved = teacher.status === "approved";

  return (
    <>
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