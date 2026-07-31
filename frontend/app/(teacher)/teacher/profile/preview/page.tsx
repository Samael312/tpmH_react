"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import {
  Star,
  MessageCircle,
  Globe,
  Award,
  BookOpen,
  Send,
  X,
  Check,
  Loader2,
  AlertCircle
} from "lucide-react";
import api from "@/lib/api";
import ChipiWidget from "@/components/chipi/ChipiWidget";

// ─── Componente de Estrellas ───────────────────────────────────────────────
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
          className={`transition-transform duration-100 ${
            !readonly ? "hover:scale-110 cursor-pointer" : "cursor-default"
          }`}
        >
          <Star
            className={`w-5 h-5 transition-colors ${
              (hover || value) >= star
                ? "text-amber-400 fill-amber-400"
                : "text-slate-300"
            }`}
          />
        </button>
      ))}
    </div>
  );
}

// ─── Componente Badge de Habilidad ────────────────────────────────────────
function SkillBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-3 py-1.5 bg-pink-50 border border-pink-100 text-pink-700 text-xs font-bold rounded-xl shadow-sm">
      {label}
    </span>
  );
}

// ─── Componente Card de Reseña ────────────────────────────────────────────
function ReviewCard({ review }: { review: any }) {
  return (
    <div className="bg-white/95 backdrop-blur-xl rounded-2xl border border-slate-100 shadow-lg p-5 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-pink-400 to-rose-400 flex items-center justify-center flex-shrink-0 shadow-md shadow-pink-200">
            <span className="text-white text-xs font-black">
              {review.student_name?.[0]?.toUpperCase() ?? "?"}
            </span>
          </div>
          <div>
            <p className="text-sm font-bold text-slate-800">
              {review.student_name || "Estudiante Anónimo"}
            </p>
            <p className="text-[10px] text-slate-400 font-bold">
              {review.created_at
                ? new Date(review.created_at).toLocaleDateString("es", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })
                : "Fecha reciente"}
            </p>
          </div>
        </div>
        <StarRating value={review.rating} readonly />
      </div>
      <p className="text-sm text-slate-600 leading-relaxed italic">
        &ldquo;{review.comment}&rdquo;
      </p>
    </div>
  );
}

// ─── Página Principal Dinámica de Perfil de Profesor ───────────────────────
export default function TeacherProfilePage() {
  const params = useParams();

  const [teacherUsername, setTeacherUsername] = useState<string | null>(null);
  const [teacher, setTeacher] = useState<any>(null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [reviewError, setReviewError] = useState("");

  // Cargar datos según el rol del usuario autenticado
  useEffect(() => {
    const resolveTeacherProfile = async () => {
      setLoading(true);
      setError("");
      try {
        // 1. Obtener usuario autenticado[cite: 5]
        const userRes = await api.get("/users/me");
        const currentUser = userRes.data;

        let teacherData: any = null;
        let resolvedName = "";

        if (currentUser.role === "teacher") {
          // Si es profesor, consultamos su propio perfil[cite: 4]
          const teacherRes = await api.get("/teachers/me/profile");
          teacherData = teacherRes.data;

          // Asignar el avatar usando la propiedad 'avatar' de /users/me
          if (currentUser.avatar) {
            teacherData.profile_photo_url = currentUser.avatar;
          }

          resolvedName = teacherData?.user_username || currentUser.username;
        
        } else if (currentUser.role === "student") {
          try {
            const cfgRes = await api.get("/admin/platform-config");
            const cfg = cfgRes.data;

            if (cfg.is_single_tenant && cfg.featured_teacher?.username) {
              resolvedName = cfg.featured_teacher.username;
            } else {
              const studentProfileRes = await api.get("/users/me/student-profile");
              resolvedName = studentProfileRes.data?.teacher_username;
            }
          } catch (profileErr) {
            console.error("No se pudo resolver el profesor del estudiante:", profileErr);
          }

          if (!resolvedName) {
            resolvedName = (params?.username as string) || process.env.NEXT_PUBLIC_FEATURED_TEACHER_USERNAME || "";
          }

          if (!resolvedName) {
            setError("Aún no has elegido un profesor. Ve a la sección Profesores para elegir el tuyo.");
            setLoading(false);
            return;
          }

          if (resolvedName) {
            const teacherRes = await api.get(`/teachers/${resolvedName}`);
            teacherData = teacherRes.data;
          }
        }

        if (!teacherData) {
          setError("No se pudo encontrar la información del profesor.");
          setLoading(false);
          return;
        }

        setTeacher(teacherData);
        setTeacherUsername(resolvedName || teacherData.user_username);

        // 2. Cargar reseñas del profesor de forma segura
        const targetUsername = resolvedName || teacherData.user_username;
        if (targetUsername) {
          try {
            const reviewsRes = await api.get(`/reviews/${targetUsername}`);
            setReviews(Array.isArray(reviewsRes.data) ? reviewsRes.data : []);
          } catch (revErr) {
            console.error("Error al cargar reseñas:", revErr);
            setReviews([]);
          }
        }

      } catch (err: any) {
        console.error("Error al cargar perfil:", err);
        setError("No se pudo cargar la información del perfil.");
      } finally {
        setLoading(false);
      }
    };

    resolveTeacherProfile();
  }, [params]);

  const submitReview = async () => {
    if (!comment.trim() || !teacherUsername) return;
    setSending(true);
    setReviewError("");
    try {
      const response = await api.post(`/reviews/${teacherUsername}`, {
        rating,
        comment,
      });

      setReviews([response.data, ...reviews]);
      setSent(true);
      setComment("");
      setRating(5);
      setTimeout(() => setSent(false), 3000);
    } catch (e: any) {
      setReviewError(
        e.response?.data?.detail || "Error enviando la reseña. Recuerda que debes completar una clase previa."
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
          <p className="text-sm text-slate-500">{error || "No se pudo encontrar el profesor solicitado."}</p>
        </div>
      </div>
    );
  }

  const isApproved = teacher.status === "approved";
  const safeReviews = Array.isArray(reviews) ? reviews : [];
  const avgRating =
    safeReviews.length > 0
      ? safeReviews.reduce((s, r) => s + r.rating, 0) / safeReviews.length
      : 0;

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden py-10 px-4 sm:px-6 lg:px-8">
      {/* Blobs de fondo decorativos */}
      <div className="fixed top-[-80px] right-[-80px] w-[500px] h-[500px] bg-pink-300/20 rounded-full blur-[100px] pointer-events-none" />
      <div className="fixed bottom-[-80px] left-[-80px] w-[400px] h-[400px] bg-rose-300/15 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative max-w-6xl mx-auto space-y-8">

        {/* ─── Notificación si NO está aprobado ─── */}
        {!isApproved && (
          <div className="bg-amber-500 border-2 border-amber-400 rounded-3xl p-5 text-white shadow-xl shadow-amber-200/50 flex items-center gap-4 animate-in fade-in slide-in-from-top-4 duration-500">
            <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center flex-shrink-0 backdrop-blur-md">
              <AlertCircle className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-base font-black tracking-tight">Solicitud en revisión</h3>
              <p className="text-xs sm:text-sm font-medium text-amber-50">
                Tu perfil será público cuando el staff apruebe tu solicitud.
              </p>
            </div>
          </div>
        )}

        {/* ─── Hero Section ─── */}
        <div className="bg-gradient-to-br from-pink-500 via-rose-500 to-pink-600 rounded-[2.5rem] p-8 sm:p-10 text-white relative overflow-hidden shadow-2xl shadow-pink-200">
          <div className="absolute top-[-40px] right-[-40px] w-48 h-48 bg-white/10 rounded-full blur-2xl pointer-events-none" />
          <div className="absolute bottom-[-60px] left-[-20px] w-64 h-64 bg-white/5 rounded-full blur-3xl pointer-events-none" />

          <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
              {/* Foto de perfil */}
              <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-[2rem] overflow-hidden border-4 border-white/30 shadow-2xl flex-shrink-0 bg-pink-400 flex items-center justify-center">
                {teacher.profile_photo_url ? (
                  <img
                    src={teacher.profile_photo_url}
                    alt={teacher.name || "Profesor"}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-pink-400 to-rose-600">
                    <span className="text-4xl font-black text-white">
                      {teacher.user_username?.[0]?.toUpperCase() || "T"}
                    </span>
                  </div>
                )}
              </div>

              {/* Información principal */}
              <div className="space-y-2">
                <span className="inline-block text-[10px] font-black uppercase tracking-widest text-white/70 bg-white/10 px-3 py-1 rounded-full backdrop-blur-sm">
                  {isApproved ? "Perfil Verificado" : "Pendiente de Aprobación"}
                </span>
                <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white">
                  {teacher.user_username || "Profesor"}
                </h1>
                {teacher.title && (
                  <p className="text-white/90 text-sm font-semibold">
                    {teacher.title}
                  </p>
                )}

                {/* Rating y Badges de Idiomas */}
                <div className="flex items-center gap-3 flex-wrap pt-2">
                  <div className="flex items-center gap-2 bg-white/15 backdrop-blur-md px-3.5 py-1.5 rounded-full shadow-inner">
                    <Star className="w-4 h-4 text-amber-300 fill-amber-300" />
                    <span className="text-sm font-black text-white">
                      {avgRating.toFixed(1)}
                    </span>
                    <span className="text-white/70 text-xs">
                      ({safeReviews.length} reseñas)
                    </span>
                  </div>

                  {teacher.languages?.slice(0, 3).map((l: string) => (
                    <span
                      key={l}
                      className="bg-white/15 backdrop-blur-md px-3.5 py-1.5 rounded-full text-xs font-bold text-white shadow-inner"
                    >
                      {l}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Redes Sociales y Enlaces Externos */}
            <div className="flex flex-row md:flex-col gap-3 w-full md:w-auto">
              {teacher.social_links?.whatsapp && (
                <button
                  type="button"
                  onClick={() => {
                    const phone = teacher.social_links.whatsapp.replace(/\D/g, "");
                    openLink(`https://wa.me/${phone}`);
                  }}
                  className="flex items-center justify-center gap-2 bg-white/20 hover:bg-white/30 backdrop-blur-md px-5 py-3 rounded-2xl text-sm font-bold transition-all duration-200 shadow-lg shadow-black/5 flex-1 md:flex-initial"
                >
                  <MessageCircle className="w-4 h-4 text-emerald-300" />
                  <span>WhatsApp</span>
                </button>
              )}
              {teacher.social_links?.website && (
                <button
                  type="button"
                  onClick={() => openLink(teacher.social_links.website)}
                  className="flex items-center justify-center gap-2 bg-white/20 hover:bg-white/30 backdrop-blur-md px-5 py-3 rounded-2xl text-sm font-bold transition-all duration-200 shadow-lg shadow-black/5 flex-1 md:flex-initial"
                >
                  <Globe className="w-4 h-4 text-cyan-300" />
                  <span>Sitio Web</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ─── Contenido Principal en Grid ─── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* ─── Columna Izquierda: Bio, Materias, Habilidades, Certificaciones ─── */}
          <div className="space-y-6">

            {/* Bloque: Biografía */}
            <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-xl shadow-slate-200/50 p-6 sm:p-8">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-pink-50 rounded-2xl flex items-center justify-center shadow-sm">
                  <BookOpen className="w-5 h-5 text-pink-500" />
                </div>
                <h2 className="text-lg font-black text-slate-800">
                  Sobre mí
                </h2>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                {teacher.bio ?? "Sin descripción disponible por el momento."}
              </p>
            </div>

            {/* Bloque: Materias */}
            {teacher.subjects?.length > 0 && (
              <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-xl shadow-slate-200/50 p-6 sm:p-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-purple-50 rounded-2xl flex items-center justify-center shadow-sm">
                    <BookOpen className="w-5 h-5 text-purple-500" />
                  </div>
                  <h2 className="text-lg font-black text-slate-800">
                    Qué enseña
                  </h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  {teacher.subjects.map((s: string) => (
                    <span
                      key={s}
                      className="px-3.5 py-2 bg-purple-50 text-purple-700 text-xs font-bold rounded-xl border border-purple-100 shadow-sm"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Bloque: Habilidades */}
            {teacher.skills?.length > 0 && (
              <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-xl shadow-slate-200/50 p-6 sm:p-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-pink-50 rounded-2xl flex items-center justify-center shadow-sm">
                    <Star className="w-5 h-5 text-pink-500" />
                  </div>
                  <h2 className="text-lg font-black text-slate-800">
                    Habilidades
                  </h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  {teacher.skills.map((s: string) => (
                    <SkillBadge key={s} label={s} />
                  ))}
                </div>
              </div>
            )}

            {/* Bloque: Certificaciones */}
            {teacher.certificates?.length > 0 && (
              <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-xl shadow-slate-200/50 p-6 sm:p-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-amber-50 rounded-2xl flex items-center justify-center shadow-sm">
                    <Award className="w-5 h-5 text-amber-500" />
                  </div>
                  <h2 className="text-lg font-black text-slate-800">
                    Certificaciones
                  </h2>
                </div>
                <div className="space-y-3">
                  {teacher.certificates.map((cert: any, i: number) => (
                    <div
                      key={i}
                      className="flex items-center justify-between bg-slate-50/80 border border-slate-100 rounded-2xl px-4 py-3 shadow-sm"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
                          <Award className="w-4 h-4 text-amber-600" />
                        </div>
                        <p className="text-sm font-bold text-slate-700">
                          {cert.title}
                        </p>
                      </div>
                      <span className="text-xs font-black text-slate-400 bg-white px-2.5 py-1 rounded-lg border border-slate-100">
                        {cert.year}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>

          {/* ─── Columna Derecha: Formulario de Reseñas y Listado ─── */}
          <div className="lg:col-span-2 space-y-6">

            {/* Formulario de Nueva Reseña */}
            <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-2xl shadow-slate-200/50 p-6 sm:p-8">
              <h2 className="text-xl font-black text-slate-800 mb-6 flex items-center gap-2">
                <span>Dejar una reseña</span>
              </h2>

              <div className="space-y-5">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">
                    Tu calificación general
                  </label>
                  <StarRating value={rating} onChange={setRating} />
                </div>

                <div className="group">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">
                    Comentario detallado
                  </label>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={4}
                    placeholder="Comparte tu experiencia con el profesor..."
                    className="w-full bg-slate-50/80 border-2 border-slate-100 rounded-2xl text-sm font-medium text-slate-800 placeholder:text-slate-400 px-4 py-3.5 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all duration-300 resize-none shadow-inner"
                  />
                </div>

                {reviewError && (
                  <div className="bg-rose-50 border border-rose-100 text-rose-600 px-4 py-3 rounded-2xl text-xs font-bold flex items-center gap-2">
                    <X className="w-4 h-4 flex-shrink-0" />
                    <span>{reviewError}</span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={submitReview}
                  disabled={!comment.trim() || sending}
                  className={`w-full py-4 text-sm font-bold text-white rounded-2xl shadow-xl active:scale-[0.98] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
                    sent
                      ? "bg-emerald-500 shadow-emerald-200"
                      : "bg-gradient-to-r from-pink-500 to-rose-400 shadow-pink-200 hover:shadow-pink-300"
                  }`}
                >
                  {sending ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : sent ? (
                    <>
                      <Check className="w-5 h-5" /> ¡Reseña publicada con éxito!
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" /> Publicar reseña
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Listado de Reseñas */}
            <div className="space-y-4">
              <div className="flex items-center justify-between px-2">
                <h2 className="text-xl font-black text-slate-800">
                  Reseñas de estudiantes ({safeReviews.length})
                </h2>
                {avgRating > 0 && (
                  <div className="flex items-center gap-2.5 bg-white px-4 py-2 rounded-2xl shadow-sm border border-slate-100">
                    <StarRating value={Math.round(avgRating)} readonly />
                    <span className="text-sm font-black text-slate-700">
                      {avgRating.toFixed(1)}
                    </span>
                  </div>
                )}
              </div>

              {safeReviews.length === 0 ? (
                <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-xl py-16 text-center space-y-3">
                  <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto text-slate-300">
                    <Star className="w-6 h-6" />
                  </div>
                  <p className="text-slate-500 font-bold text-sm">
                    Aún no hay reseñas. ¡Sé el primero en dejar una!
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {safeReviews.map((r: any) => (
                    <ReviewCard key={r.id || Math.random()} review={r} />
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