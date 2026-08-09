"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Check, Loader2, AlertCircle, Calendar, UserCheck, MessageCircle, Star } from "lucide-react";
import api from "@/lib/api";
import ChipiWidget from "@/components/chipi/ChipiWidget";
import { useMyTeachers } from "@/hooks/useStudentData";
import PublicProfileView, { PublicProfileTeacher, PublicProfileReview } from "@/components/teacher/PublicProfileView";

export default function TeacherBrowsePage() {
  const params = useParams();
  const router = useRouter();
  const username = params?.username as string;

  const { teachers: myTeachers, isSingleTenant, refetch: refetchMyTeachers } = useMyTeachers();
  const isMine = myTeachers.some(t => t.teacher_username === username);

  const [unlinking, setUnlinking] = useState(false);
  const [unlinkError, setUnlinkError] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [chooseError, setChooseError] = useState("");
  const [chosen, setChosen] = useState(false);

  const [teacher, setTeacher] = useState<PublicProfileTeacher | null>(null);
  const [reviews, setReviews] = useState<PublicProfileReview[]>([]);
  const [myTeacherUsername, setMyTeacherUsername] = useState<string | null>(null);
  const [isStudent, setIsStudent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showReviewForm, setShowReviewForm] = useState(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewComment, setReviewComment] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewError, setReviewError] = useState("");

  const linkTeacher = async () => {
    setChoosing(true);
    setChooseError("");
    try {
      await api.post(`/users/me/teachers/${username}`);
      setChosen(true);
      refetchMyTeachers();
      setTimeout(() => setChosen(false), 3000);
    } catch (e: any) {
      setChooseError(e.response?.data?.detail || "Error añadiendo profesor");
    } finally {
      setChoosing(false);
    }
  };

  const unlinkTeacher = async () => {
    setUnlinking(true);
    setUnlinkError("");
    try {
      await api.delete(`/users/me/teachers/${username}`);
      refetchMyTeachers();
    } catch (e: any) {
      setUnlinkError(e.response?.data?.detail || "No se pudo terminar la relación");
    } finally {
      setUnlinking(false);
    }
  };

  useEffect(() => {
    if (!username) return;
    setLoading(true);
    setError("");
    Promise.all([
      api.get(`/teachers/${username}`),
      api.get(`/reviews/${username}`).catch(() => ({ data: [] })),
      api.get("/users/me/student-profile").catch(() => ({ data: {} })),
    ])
      .then(([tRes, rRes, sRes]) => {
        setTeacher(tRes.data);
        setReviews(Array.isArray(rRes.data) ? rRes.data : []);
        setMyTeacherUsername(sRes.data?.teacher_username ?? null);
        setIsStudent(!!sRes.data && Object.keys(sRes.data).length > 0);
      })
      .catch(() => setError("No se pudo cargar el perfil de este profesor."))
      .finally(() => setLoading(false));
  }, [username]);

  const submitReview = async () => {
    if (reviewRating === 0) {
      setReviewError("Por favor selecciona una calificación en estrellas.");
      return;
    }
    if (!reviewComment.trim()) {
      setReviewError("Por favor escribe un comentario.");
      return;
    }
    setSubmittingReview(true);
    setReviewError("");
    try {
      await api.post(`/reviews/${username}`, { rating: reviewRating, comment: reviewComment });
      const rRes = await api.get(`/reviews/${username}`);
      setReviews(Array.isArray(rRes.data) ? rRes.data : []);
      setShowReviewForm(false);
      setReviewRating(0);
      setReviewComment("");
    } catch (e: any) {
      setReviewError(e.response?.data?.detail || "Error al enviar tu reseña.");
    } finally {
      setSubmittingReview(false);
    }
  };

  const openWhatsapp = () => {
    if (!teacher?.social_links?.whatsapp) return;
    const phone = teacher.social_links.whatsapp.replace(/\D/g, "");
    window.open(`https://wa.me/${phone}`, "_blank", "noopener,noreferrer");
  };

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
          <h2 className="text-xl font-black text-slate-800">Perfil no disponible</h2>
          <p className="text-sm text-slate-500">{error || "No se pudo encontrar este profesor."}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <PublicProfileView
        teacher={teacher}
        reviews={reviews}
        heroActions={
          <>
            {!isSingleTenant && (
              !isMine ? (
                <button
                  onClick={linkTeacher}
                  disabled={choosing}
                  className="flex items-center justify-center gap-2 bg-white text-pink-600 hover:bg-pink-50 px-5 py-3 rounded-2xl text-sm font-bold transition-all duration-200 shadow-lg disabled:opacity-60"
                >
                  {choosing ? <Loader2 className="w-4 h-4 animate-spin" /> : chosen ? (
                    <><Check className="w-4 h-4" /> ¡Profesor añadido!</>
                  ) : (
                    <><UserCheck className="w-4 h-4" /> Elegir este profesor</>
                  )}
                </button>
              ) : (
                <button
                  onClick={unlinkTeacher}
                  disabled={unlinking}
                  className="flex items-center justify-center gap-2 bg-white/20 text-white hover:bg-white/30 px-5 py-3 rounded-2xl text-sm font-bold transition-all duration-200 shadow-lg disabled:opacity-60"
                  title="Solo posible si no tienes paquete activo ni solicitudes pendientes con él"
                >
                  {unlinking ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Check className="w-4 h-4" /> Ya es tu profesor · Terminar relación</>}
                </button>
              )
            )}

            {(chooseError || unlinkError) && (
              <div className="bg-white/90 text-rose-600 px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" /> {chooseError || unlinkError}
              </div>
            )}

            <button
              onClick={() => router.push("/dashboard/schedule")}
              className="flex items-center justify-center gap-2 bg-white/20 hover:bg-white/30 backdrop-blur-md px-5 py-3 rounded-2xl text-sm font-bold transition-all duration-200 shadow-lg"
            >
              <Calendar className="w-4 h-4" /> Agendar clase de prueba
            </button>

            {teacher.social_links?.whatsapp && (
              <button
                onClick={openWhatsapp}
                className="flex items-center justify-center gap-2 bg-white/20 hover:bg-white/30 backdrop-blur-md px-5 py-3 rounded-2xl text-sm font-bold transition-all duration-200 shadow-lg"
              >
                <MessageCircle className="w-4 h-4 text-emerald-300" /> WhatsApp
              </button>
            )}
          </>
        }
        reviewForm={
          isStudent ? (
            !showReviewForm ? (
              <div className="flex justify-end px-2">
                <button
                  onClick={() => setShowReviewForm(true)}
                  className="text-sm font-bold text-pink-600 hover:text-pink-700 bg-pink-50 hover:bg-pink-100 px-4 py-2 rounded-xl transition-colors"
                >
                  Dejar una reseña
                </button>
              </div>
            ) : (
              <div className="bg-white/95 backdrop-blur-xl rounded-2xl border border-pink-200 shadow-lg p-6 space-y-4 animate-in fade-in slide-in-from-top-4 duration-300">
                <h3 className="text-md font-bold text-slate-800">Escribe tu reseña</h3>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map(star => (
                    <button
                      key={star}
                      onClick={() => setReviewRating(star)}
                      className="focus:outline-none transition-transform hover:scale-110 active:scale-95"
                    >
                      <Star className={`w-8 h-8 transition-colors ${star <= reviewRating ? "text-amber-400 fill-amber-400" : "text-slate-200"}`} />
                    </button>
                  ))}
                </div>
                <textarea
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  placeholder="¿Qué te parecieron las clases con este profesor?"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500 transition-all resize-none"
                  rows={3}
                />
                {reviewError && (
                  <p className="text-xs font-bold text-rose-500 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> {reviewError}
                  </p>
                )}
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    onClick={() => setShowReviewForm(false)}
                    className="px-5 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-100 rounded-xl transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={submitReview}
                    disabled={submittingReview}
                    className="flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 rounded-xl disabled:opacity-50 transition-all shadow-md active:scale-95 min-w-[140px]"
                  >
                    {submittingReview ? <Loader2 className="w-4 h-4 animate-spin" /> : "Enviar reseña"}
                  </button>
                </div>
              </div>
            )
          ) : undefined
        }
      />
      <ChipiWidget screenName="teacher_browse" />
    </>
  );
}