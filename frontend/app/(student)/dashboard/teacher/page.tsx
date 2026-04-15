"use client";

import { useState } from "react";
import {
  Star, MessageCircle, Globe, Award,
  BookOpen, Send, X, Check, ChevronDown,
  ExternalLink
} from "lucide-react";
import { useFeaturedTeacher } from "@/hooks/useStudentData";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import ChipiWidget from "@/components/chipi/ChipiWidget";

// ─── Estrellas ─────────────────────────────────────────────────────────────
function StarRating({
  value,
  onChange,
  readonly = false,
}: {
  value: number;
  onChange?: (v: number) => void;
  readonly?: boolean;
}) {
  const [hover, setHover] = useState(0);

  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readonly}
          onClick={() => onChange?.(star)}
          onMouseEnter={() => !readonly && setHover(star)}
          onMouseLeave={() => !readonly && setHover(0)}
          className={`transition-transform duration-100
            ${!readonly ? "hover:scale-110 cursor-pointer" : "cursor-default"}`}
        >
          <Star
            className={`w-5 h-5 transition-colors
              ${(hover || value) >= star
                ? "text-amber-400 fill-amber-400"
                : "text-slate-300"
              }`}
          />
        </button>
      ))}
    </div>
  );
}

// ─── Badge skill ──────────────────────────────────────────────────────────
function SkillBadge({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-3 py-1.5 bg-pink-50
                    border border-pink-100 text-pink-700 text-xs font-bold
                    rounded-xl"
    >
      {label}
    </span>
  );
}

// ─── Card reseña ──────────────────────────────────────────────────────────
function ReviewCard({ review }: { review: any }) {
  return (
    <div
      className="bg-white/80 backdrop-blur-xl rounded-2xl border border-white
                    shadow-lg p-5 hover:shadow-xl hover:-translate-y-0.5
                    transition-all duration-300"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl bg-gradient-to-br from-pink-400
                          to-rose-400 flex items-center justify-center
                          flex-shrink-0"
          >
            <span className="text-white text-xs font-black">
              {review.student_name?.[0] ?? "?"}
            </span>
          </div>
          <div>
            <p className="text-sm font-bold text-slate-800">
              {review.student_name}
            </p>
            <p className="text-[10px] text-slate-400 font-bold">
              {new Date(review.created_at).toLocaleDateString("es", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
          </div>
        </div>
        <StarRating value={review.rating} readonly />
      </div>
      <p className="text-sm text-slate-600 leading-relaxed italic">
        "{review.comment}"
      </p>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────
export default function TeacherProfilePage() {
  const { teacher, reviews, loading } = useFeaturedTeacher();
  const { user } = useAuthStore();

  const [rating, setRating]   = useState(5);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent]       = useState(false);
  const [reviewError, setReviewError] = useState("");

  const submitReview = async () => {
    if (!comment.trim()) return;
    setSending(true);
    setReviewError("");
    try {
      await api.post(
        `/reviews/${process.env.NEXT_PUBLIC_FEATURED_TEACHER_USERNAME}`,
        { rating, comment }
      );
      setSent(true);
      setComment("");
      setRating(5);
      setTimeout(() => setSent(false), 3000);
    } catch (e: any) {
      setReviewError(
        e.response?.data?.detail || "Error enviando la reseña"
      );
    } finally {
      setSending(false);
    }
  };

  const openLink = (url: string) => {
    if (!url) return;
    const final = url.startsWith("http") ? url : `https://${url}`;
    window.open(final, "_blank", "noopener,noreferrer");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div
          className="w-10 h-10 border-4 border-pink-200 border-t-pink-500
                        rounded-full animate-spin"
        />
      </div>
    );
  }

  if (!teacher) return null;

  // Protegemos el fallback para evitar el crash de "reduce of empty array with no initial value" si reviews es undefined
  const safeReviews = Array.isArray(reviews) ? reviews : [];
  const avgRating =
    safeReviews.length > 0
      ? safeReviews.reduce((s, r) => s + r.rating, 0) / safeReviews.length
      : 0;

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">
      {/* Blobs */}
      <div
        className="fixed top-[-80px] right-[-80px] w-[500px] h-[500px]
                      bg-pink-300/20 rounded-full blur-[100px] pointer-events-none"
      />
      <div
        className="fixed bottom-[-80px] left-[-80px] w-[400px] h-[400px]
                      bg-rose-300/15 rounded-full blur-[100px] pointer-events-none"
      />

      <div className="relative space-y-8">

        {/* ─── Hero ─── */}
        <div
          className="bg-gradient-to-br from-pink-500 via-rose-500 to-pink-600
                        rounded-[2rem] p-8 text-white relative overflow-hidden
                        shadow-2xl shadow-pink-200
                        animate-in fade-in slide-in-from-bottom-4 duration-500"
        >
          {/* Blobs internos */}
          <div
            className="absolute top-[-40px] right-[-40px] w-48 h-48
                          bg-white/10 rounded-full blur-2xl"
          />
          <div
            className="absolute bottom-[-60px] left-[-20px] w-64 h-64
                          bg-white/5 rounded-full blur-3xl"
          />

          <div className="relative flex flex-col sm:flex-row items-start gap-6">
            {/* Foto */}
            <div
              className="w-24 h-24 sm:w-28 sm:h-28 rounded-[1.5rem] overflow-hidden
                            border-4 border-white/30 shadow-xl flex-shrink-0
                            bg-pink-400"
            >
              {teacher.photo_url ? (
                <img
                  src={teacher.photo_url}
                  alt={teacher.name || "Profesora"}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-4xl font-black text-white/70">
                    {/* SOLUCIÓN AL ERROR AQUÍ */}
                    {teacher.name?.[0]?.toUpperCase() || "T"}
                  </span>
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1">
              <p
                className="text-[10px] font-black uppercase tracking-widest
                              text-white/60 mb-1"
              >
                Tu profesora
              </p>
              <h1 className="text-3xl font-black tracking-tight mb-1">
                {teacher.name || "Profesora"}
              </h1>
              {teacher.title && (
                <p className="text-white/80 text-sm font-medium mb-3">
                  {teacher.title}
                </p>
              )}

              {/* Rating */}
              <div className="flex items-center gap-3 flex-wrap">
                <div
                  className="flex items-center gap-2 bg-white/15 backdrop-blur-sm
                                px-3 py-1.5 rounded-full"
                >
                  <Star className="w-4 h-4 text-amber-300 fill-amber-300" />
                  <span className="text-sm font-black">
                    {avgRating.toFixed(1)}
                  </span>
                  <span className="text-white/60 text-xs">
                    ({safeReviews.length} reseñas)
                  </span>
                </div>

                {/* Idiomas */}
                {teacher.languages?.slice(0, 3).map((l) => (
                  <span
                    key={l}
                    className="bg-white/15 px-3 py-1.5 rounded-full
                                 text-xs font-bold"
                  >
                    {l}
                  </span>
                ))}
              </div>
            </div>

            {/* Redes sociales */}
            <div className="flex flex-row sm:flex-col gap-2">
              {teacher.social_links?.whatsapp && (
                <button
                  onClick={() => {
                    const phone = teacher.social_links.whatsapp.replace(
                      /\D/g, ""
                    );
                    openLink(`https://wa.me/${phone}`);
                  }}
                  className="flex items-center gap-2 bg-white/20 hover:bg-white/30
                               backdrop-blur-sm px-4 py-2.5 rounded-xl text-sm
                               font-bold transition-all duration-200"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span className="hidden sm:inline">WhatsApp</span>
                </button>
              )}
              {teacher.social_links?.website && (
                <button
                  onClick={() => openLink(teacher.social_links.website)}
                  className="flex items-center gap-2 bg-white/20 hover:bg-white/30
                               backdrop-blur-sm px-4 py-2.5 rounded-xl text-sm
                               font-bold transition-all duration-200"
                >
                  <Globe className="w-4 h-4" />
                  <span className="hidden sm:inline">Web</span>
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ─── Columna izquierda ─── */}
          <div className="space-y-5">

            {/* Bio */}
            <div
              className="bg-white/80 backdrop-blur-xl rounded-[2rem]
                            border border-white shadow-xl shadow-slate-200/50 p-6
                            animate-in fade-in slide-in-from-bottom-4 duration-500
                            delay-100"
            >
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 bg-pink-50 rounded-xl flex items-center justify-center">
                  <BookOpen className="w-4 h-4 text-pink-500" />
                </div>
                <h2 className="text-base font-black text-slate-800">
                  Sobre mí
                </h2>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                {teacher.bio ?? "Sin descripción disponible."}
              </p>
            </div>

            {/* Materias */}
            {teacher.subjects?.length > 0 && (
              <div
                className="bg-white/80 backdrop-blur-xl rounded-[2rem]
                              border border-white shadow-xl shadow-slate-200/50 p-6
                              animate-in fade-in duration-500 delay-150"
              >
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 bg-purple-50 rounded-xl flex items-center justify-center">
                    <BookOpen className="w-4 h-4 text-purple-500" />
                  </div>
                  <h2 className="text-base font-black text-slate-800">
                    Qué enseña
                  </h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  {teacher.subjects.map((s) => (
                    <span
                      key={s}
                      className="px-3 py-1.5 bg-purple-50 text-purple-700
                                   text-xs font-bold rounded-xl border border-purple-100"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Habilidades */}
            {teacher.skills?.length > 0 && (
              <div
                className="bg-white/80 backdrop-blur-xl rounded-[2rem]
                              border border-white shadow-xl shadow-slate-200/50 p-6
                              animate-in fade-in duration-500 delay-200"
              >
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 bg-pink-50 rounded-xl flex items-center justify-center">
                    <Star className="w-4 h-4 text-pink-500" />
                  </div>
                  <h2 className="text-base font-black text-slate-800">
                    Habilidades
                  </h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  {teacher.skills.map((s) => (
                    <SkillBadge key={s} label={s} />
                  ))}
                </div>
              </div>
            )}

            {/* Certificaciones */}
            {teacher.certificates?.length > 0 && (
              <div
                className="bg-white/80 backdrop-blur-xl rounded-[2rem]
                              border border-white shadow-xl shadow-slate-200/50 p-6
                              animate-in fade-in duration-500 delay-200"
              >
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 bg-amber-50 rounded-xl flex items-center justify-center">
                    <Award className="w-4 h-4 text-amber-500" />
                  </div>
                  <h2 className="text-base font-black text-slate-800">
                    Certificaciones
                  </h2>
                </div>
                <div className="space-y-3">
                  {teacher.certificates.map((cert, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between
                                   bg-slate-50 rounded-xl px-4 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-7 h-7 bg-amber-100 rounded-lg
                                        flex items-center justify-center flex-shrink-0"
                        >
                          <Award className="w-3.5 h-3.5 text-amber-600" />
                        </div>
                        <p className="text-sm font-bold text-slate-700">
                          {cert.title}
                        </p>
                      </div>
                      <span className="text-xs font-black text-slate-400">
                        {cert.year}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ─── Columna derecha: Reseñas ─── */}
          <div
            className="lg:col-span-2 space-y-5 animate-in fade-in
                          slide-in-from-bottom-4 duration-500 delay-200"
          >
            {/* Formulario nueva reseña */}
            <div
              className="bg-white/80 backdrop-blur-xl rounded-[2rem]
                            border border-white shadow-2xl shadow-slate-200/50 p-6"
            >
              <h2 className="text-lg font-black text-slate-800 mb-4">
                Dejar una reseña
              </h2>

              <div className="space-y-4">
                {/* Estrellas */}
                <div>
                  <label
                    className="text-[10px] font-black text-slate-400
                                  uppercase tracking-widest block mb-2"
                  >
                    Tu calificación
                  </label>
                  <StarRating value={rating} onChange={setRating} />
                </div>

                {/* Comentario */}
                <div className="group">
                  <label
                    className="text-[10px] font-black text-slate-400
                                  uppercase tracking-widest block mb-1.5"
                  >
                    Comentario
                  </label>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={3}
                    placeholder="Comparte tu experiencia con la profesora..."
                    className="w-full bg-slate-50 border-2 border-transparent
                                 rounded-xl text-sm font-medium text-slate-800
                                 placeholder:text-slate-400 px-4 py-3.5
                                 focus:outline-none focus:bg-white
                                 focus:border-pink-500 focus:ring-4 focus:ring-pink-50
                                 transition-all duration-300 resize-none"
                  />
                </div>

                {/* Error */}
                {reviewError && (
                  <div
                    className="bg-rose-50 border border-rose-100 text-rose-600
                                  px-4 py-3 rounded-xl text-xs font-bold
                                  flex items-center gap-2"
                  >
                    <X className="w-4 h-4 flex-shrink-0" />
                    {reviewError}
                  </div>
                )}

                <button
                  onClick={submitReview}
                  disabled={!comment.trim() || sending}
                  className={`
                    w-full py-3.5 text-sm font-bold text-white rounded-xl
                    shadow-lg active:scale-[0.98] transition-all duration-300
                    disabled:opacity-50 disabled:cursor-not-allowed
                    flex items-center justify-center gap-2
                    ${
                      sent
                        ? "bg-emerald-500 shadow-emerald-200"
                        : "bg-gradient-to-r from-pink-500 to-rose-400 shadow-pink-200 hover:shadow-pink-300"
                    }
                  `}
                >
                  {sending ? (
                    <div
                      className="w-4 h-4 border-2 border-white/40
                                    border-t-white rounded-full animate-spin"
                    />
                  ) : sent ? (
                    <>
                      <Check className="w-4 h-4" /> ¡Reseña publicada!
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" /> Publicar reseña
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Lista de reseñas */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-black text-slate-800">
                  Reseñas ({safeReviews.length})
                </h2>
                {avgRating > 0 && (
                  <div className="flex items-center gap-2">
                    <StarRating value={Math.round(avgRating)} readonly />
                    <span className="text-sm font-black text-slate-700">
                      {avgRating.toFixed(1)}
                    </span>
                  </div>
                )}
              </div>

              {safeReviews.length === 0 ? (
                <div
                  className="bg-white/80 backdrop-blur-xl rounded-2xl
                                border border-white shadow-lg py-12 text-center"
                >
                  <Star className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                  <p className="text-slate-500 font-bold">
                    Sé el primero en dejar una reseña
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {safeReviews.map((r) => (
                    <ReviewCard key={r.id} review={r} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <ChipiWidget screenName="teacher-view" />
    </div>
  );
}