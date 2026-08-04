"use client";

import { Star, MessageCircle, Globe, Award, BookOpen, PlayCircle } from "lucide-react";
import { shadeColor, DEFAULT_THEME_COLOR } from "@/lib/color";

export interface PublicProfileTeacher {
  user_username: string;
  name?: string | null;
  surname?: string | null;
  title?: string | null;
  bio?: string | null;
  profile_photo_url?: string | null;
  video_url?: string | null;
  languages?: string[] | null;
  subjects?: string[] | null;
  skills?: string[] | null;
  certificates?: { title: string; year: string }[] | null;
  social_links?: Record<string, string> | null;
  status?: string;
  theme_color?: string | null;
}

export interface PublicProfileReview {
  id: number;
  student_name: string;
  rating: number;
  comment: string;
  created_at: string;
}

export function displayTeacherName(t: PublicProfileTeacher): string {
  const full = `${t.name ?? ""} ${t.surname ?? ""}`.trim();
  return full || t.user_username?.replace(/[_.]/g, " ") || "Profesor";
}

function StarRating({ value, size = "w-4 h-4" }: { value: number; size?: string }) {
  return (
    <div className="flex">
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          className={`${size} ${i <= Math.round(value) ? "text-amber-400 fill-amber-400" : "text-slate-300"}`}
        />
      ))}
    </div>
  );
}

interface PublicProfileViewProps {
  teacher: PublicProfileTeacher;
  reviews: PublicProfileReview[];
  /** Botones de acción en el hero (elegir profesor, agendar, whatsapp, etc.) */
  heroActions?: React.ReactNode;
  /** Banner opcional arriba de todo (ej. "Perfil en revisión") */
  notice?: React.ReactNode;
  /** Formulario de reseña, si aplica (solo estudiantes) */
  reviewForm?: React.ReactNode;
}

export default function PublicProfileView({
  teacher,
  reviews,
  heroActions,
  notice,
  reviewForm,
}: PublicProfileViewProps) {
  const accent = teacher.theme_color || DEFAULT_THEME_COLOR;
  const accentLight = shadeColor(accent, 22);
  const accentDark = shadeColor(accent, -15);

  const safeReviews = Array.isArray(reviews) ? reviews : [];
  const avgRating =
    safeReviews.length > 0
      ? safeReviews.reduce((s, r) => s + r.rating, 0) / safeReviews.length
      : 0;

  const isApproved = teacher.status === "approved";
  const name = displayTeacherName(teacher);

  const openLink = (url: string) => {
    if (!url) return;
    window.open(url.startsWith("http") ? url : `https://${url}`, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden py-10 px-4 sm:px-6 lg:px-8">
      <div
        className="fixed top-[-80px] right-[-80px] w-[500px] h-[500px] rounded-full blur-[100px] pointer-events-none opacity-20"
        style={{ backgroundColor: accent }}
      />
      <div
        className="fixed bottom-[-80px] left-[-80px] w-[400px] h-[400px] rounded-full blur-[100px] pointer-events-none opacity-15"
        style={{ backgroundColor: accentDark }}
      />

      <div className="relative max-w-6xl mx-auto space-y-8">
        {notice}

        {/* ─── Hero ─── */}
        <div
          className="rounded-[2.5rem] p-8 sm:p-10 text-white relative overflow-hidden shadow-2xl"
          style={{
            background: `linear-gradient(135deg, ${accent}, ${accentDark})`,
            boxShadow: `0 25px 50px -12px ${accent}55`,
          }}
        >
          <div className="absolute top-[-40px] right-[-40px] w-48 h-48 bg-white/10 rounded-full blur-2xl pointer-events-none" />
          <div className="absolute bottom-[-60px] left-[-20px] w-64 h-64 bg-white/5 rounded-full blur-3xl pointer-events-none" />

          <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
              <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-[2rem] overflow-hidden border-4 border-white/30 shadow-2xl flex-shrink-0 bg-white/20 flex items-center justify-center">
                {teacher.profile_photo_url ? (
                  <img src={teacher.profile_photo_url} alt={name} className="w-full h-full object-cover" />
                ) : (
                  <div
                    className="w-full h-full flex items-center justify-center"
                    style={{ background: `linear-gradient(135deg, ${accentLight}, ${accentDark})` }}
                  >
                    <span className="text-4xl font-black text-white">{name[0]?.toUpperCase() || "T"}</span>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <span className="inline-block text-[10px] font-black uppercase tracking-widest text-white/70 bg-white/10 px-3 py-1 rounded-full backdrop-blur-sm">
                  {isApproved ? "Perfil Verificado" : "Pendiente de Aprobación"}
                </span>

                {/* Nombre grande, título mediano, usuario pequeño */}
                <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white leading-tight">
                  {name}
                </h1>
                {teacher.title && (
                  <p className="text-white/90 text-base font-semibold">{teacher.title}</p>
                )}
                <p className="text-white/60 text-xs font-bold">@{teacher.user_username}</p>

                <div className="flex items-center gap-3 flex-wrap pt-2">
                  <div className="flex items-center gap-2 bg-white/15 backdrop-blur-md px-3.5 py-1.5 rounded-full shadow-inner">
                    <Star className="w-4 h-4 text-amber-300 fill-amber-300" />
                    <span className="text-sm font-black text-white">{avgRating.toFixed(1)}</span>
                    <span className="text-white/70 text-xs">({safeReviews.length} reseñas)</span>
                  </div>

                  {teacher.languages?.slice(0, 3).map((l) => (
                    <span key={l} className="bg-white/15 backdrop-blur-md px-3.5 py-1.5 rounded-full text-xs font-bold text-white shadow-inner">
                      {l}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {heroActions && (
              <div className="flex flex-col gap-3 w-full md:w-auto">
                {heroActions}
              </div>
            )}
          </div>
        </div>

        {/* ─── Video de presentación ─── */}
        {teacher.video_url && (
          <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-xl shadow-slate-200/50 p-6 sm:p-8">
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-sm"
                style={{ backgroundColor: `${accent}1a`, color: accent }}
              >
                <PlayCircle className="w-5 h-5" />
              </div>
              <h2 className="text-lg font-black text-slate-800">Video de presentación</h2>
            </div>
            <div className="rounded-2xl overflow-hidden bg-slate-900 aspect-video max-w-2xl">
              <video
                src={teacher.video_url}
                controls
                className="w-full h-full object-contain"
                poster={teacher.profile_photo_url || undefined}
              />
            </div>
          </div>
        )}

        {/* ─── Contenido principal ─── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="space-y-6">
            <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-xl shadow-slate-200/50 p-6 sm:p-8">
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-sm"
                  style={{ backgroundColor: `${accent}1a`, color: accent }}
                >
                  <BookOpen className="w-5 h-5" />
                </div>
                <h2 className="text-lg font-black text-slate-800">Sobre mí</h2>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                {teacher.bio ?? "Sin descripción disponible por el momento."}
              </p>
            </div>

            {teacher.subjects && teacher.subjects.length > 0 && (
              <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-xl shadow-slate-200/50 p-6 sm:p-8">
                <div className="flex items-center gap-3 mb-4">
                  <div
                    className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-sm"
                    style={{ backgroundColor: `${accent}1a`, color: accent }}
                  >
                    <BookOpen className="w-5 h-5" />
                  </div>
                  <h2 className="text-lg font-black text-slate-800">Qué enseña</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  {teacher.subjects.map((s) => (
                    <span
                      key={s}
                      className="px-3.5 py-2 text-xs font-bold rounded-xl border shadow-sm"
                      style={{ backgroundColor: `${accent}0d`, color: accentDark, borderColor: `${accent}33` }}
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {teacher.skills && teacher.skills.length > 0 && (
              <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-xl shadow-slate-200/50 p-6 sm:p-8">
                <div className="flex items-center gap-3 mb-4">
                  <div
                    className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-sm"
                    style={{ backgroundColor: `${accent}1a`, color: accent }}
                  >
                    <Star className="w-5 h-5" />
                  </div>
                  <h2 className="text-lg font-black text-slate-800">Habilidades</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  {teacher.skills.map((s) => (
                    <span
                      key={s}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-xl shadow-sm border"
                      style={{ backgroundColor: `${accent}0d`, color: accentDark, borderColor: `${accent}33` }}
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {teacher.certificates && teacher.certificates.length > 0 && (
              <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-xl shadow-slate-200/50 p-6 sm:p-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-amber-50 rounded-2xl flex items-center justify-center shadow-sm">
                    <Award className="w-5 h-5 text-amber-500" />
                  </div>
                  <h2 className="text-lg font-black text-slate-800">Certificaciones</h2>
                </div>
                <div className="space-y-3">
                  {teacher.certificates.map((cert, i) => (
                    <div key={i} className="flex items-center justify-between bg-slate-50/80 border border-slate-100 rounded-2xl px-4 py-3 shadow-sm">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
                          <Award className="w-4 h-4 text-amber-600" />
                        </div>
                        <p className="text-sm font-bold text-slate-700">{cert.title}</p>
                      </div>
                      <span className="text-xs font-black text-slate-400 bg-white px-2.5 py-1 rounded-lg border border-slate-100">
                        {cert.year}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {teacher.social_links?.website && (
              <button
                type="button"
                onClick={() => openLink(teacher.social_links!.website)}
                className="w-full flex items-center justify-center gap-2 bg-white/80 backdrop-blur-xl border border-white shadow-lg rounded-2xl px-5 py-3.5 text-sm font-bold text-slate-600 hover:-translate-y-0.5 transition-all"
              >
                <Globe className="w-4 h-4" style={{ color: accent }} />
                Sitio web
              </button>
            )}
          </div>

          {/* ─── Reseñas ─── */}
          <div className="lg:col-span-2 space-y-4">
            {reviewForm}

            <div className="flex items-center justify-between px-2">
              <h2 className="text-xl font-black text-slate-800">
                Reseñas de estudiantes ({safeReviews.length})
              </h2>
              {avgRating > 0 && (
                <div className="flex items-center gap-2.5 bg-white px-4 py-2 rounded-2xl shadow-sm border border-slate-100">
                  <StarRating value={avgRating} />
                  <span className="text-sm font-black text-slate-700">{avgRating.toFixed(1)}</span>
                </div>
              )}
            </div>

            {safeReviews.length === 0 ? (
              <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-xl py-16 text-center space-y-3">
                <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto text-slate-300">
                  <Star className="w-6 h-6" />
                </div>
                <p className="text-slate-500 font-bold text-sm">Aún no hay reseñas.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {safeReviews.map((r) => (
                  <div key={r.id} className="bg-white/95 backdrop-blur-xl rounded-2xl border border-slate-100 shadow-lg p-5 hover:-translate-y-0.5 transition-transform duration-200">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 shadow-md"
                          style={{ background: `linear-gradient(135deg, ${accent}, ${accentDark})` }}
                        >
                          <span className="text-white text-xs font-black">
                            {r.student_name?.[0]?.toUpperCase() ?? "?"}
                          </span>
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-800">{r.student_name || "Estudiante"}</p>
                          <p className="text-[10px] text-slate-400 font-bold">
                            {r.created_at
                              ? new Date(r.created_at).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" })
                              : ""}
                          </p>
                        </div>
                      </div>
                      <StarRating value={r.rating} />
                    </div>
                    <p className="text-sm text-slate-600 leading-relaxed italic">&ldquo;{r.comment}&rdquo;</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}