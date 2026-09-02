"use client";

import React from "react";
import Image from "next/image";
import { Star, MessageCircle, Globe, Award, BookOpen, PlayCircle } from "lucide-react";
import { shadeColor, DEFAULT_THEME_COLOR } from "@/lib/color";
import { getFlagForNationality } from "@/lib/nationalities";

// ─── Iconos redes sociales ────────────────────────────────────────────────
function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor" />
    </svg>
  );
}
function YoutubeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
      <path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46a2.78 2.78 0 0 0-1.95 1.96A29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58A2.78 2.78 0 0 0 3.41 19.6C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-1.95A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z" />
      <polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02" fill="currentColor" stroke="none" />
    </svg>
  );
}
function LinkedinIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z" />
    </svg>
  );
}
function TiktokIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <path d="M16.6 5.82c-.9-.9-1.4-2.13-1.4-3.5h-3.15v13.86a2.58 2.58 0 1 1-1.83-2.47V10.6a5.75 5.75 0 1 0 4.98 5.71V9.4a7.35 7.35 0 0 0 4.4 1.45V7.7a4.85 4.85 0 0 1-3-1.88z" />
    </svg>
  );
}

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
  nationality?: string | null;
  status?: string;
  theme_color?: string | null;
}

export interface PublicProfileReview {
  id: number;
  student_name: string;
  rating: number;
  comment: string;
  created_at: string;
  total_completed_classes?: number | null;
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
  heroActions?: React.ReactNode;
  notice?: React.ReactNode;
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

  /** Arma el href correcto para cada red social a partir de lo cargado por el profesor. */
  const getSocialHref = (key: "instagram" | "youtube" | "whatsapp" | "website" | "linkedin" | "tiktok", value: string): string | null => {
    if (!value) return null;
    if (key === "whatsapp") {
      const digits = value.replace(/\D/g, "");
      return digits ? `https://wa.me/${digits}` : null;
    }
    if (key === "instagram") {
      if (value.startsWith("http")) return value;
      const handle = value.replace(/^@/, "");
      return handle ? `https://instagram.com/${handle}` : null;
    }
    if (key === "tiktok") {
      if (value.startsWith("http")) return value;
      const handle = value.replace(/^@/, "");
      return handle ? `https://tiktok.com/@${handle}` : null;
    }
    return value.startsWith("http") ? value : `https://${value}`;
  };

  // Íconos simplificados sin forzar color, tomarán el color blanco del contenedor principal en el hero
  const socialButtons: { key: "instagram" | "youtube" | "whatsapp" | "website" | "linkedin" | "tiktok"; label: string; icon: React.ReactNode }[] = [
    { key: "instagram", label: "Instagram", icon: <InstagramIcon /> },
    { key: "youtube", label: "YouTube", icon: <YoutubeIcon /> },
    { key: "whatsapp", label: "WhatsApp", icon: <MessageCircle className="w-4 h-4" /> },
    { key: "website", label: "Sitio web", icon: <Globe className="w-4 h-4" /> },
    { key: "linkedin", label: "LinkedIn", icon: <LinkedinIcon /> },
    { key: "tiktok", label: "TikTok", icon: <TiktokIcon /> },
  ];

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
              <div className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-[2rem] overflow-hidden border-4 border-white/30 shadow-2xl flex-shrink-0 bg-white/20 flex items-center justify-center">
                {teacher.profile_photo_url ? (
                  <Image src={teacher.profile_photo_url} alt={name} fill sizes="128px" className="object-cover" />
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

                <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white leading-tight">
                  {name}
                </h1>
                {teacher.title && (
                  <p className="text-white/90 text-base font-semibold">{teacher.title}</p>
                )}
                <p className="text-white/60 text-xs font-bold">@{teacher.user_username}</p>
                {teacher.nationality && (
                  <p className="text-white/80 text-xs font-bold flex items-center gap-1.5">
                    {getFlagForNationality(teacher.nationality)} {teacher.nationality}
                  </p>
                )}
                
                {/* ─── Calificación, Idiomas y Redes Sociales ─── */}
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

                  {/* Redes sociales trasladadas al banner principal */}
                  {socialButtons.map((s) => {
                    const raw = teacher.social_links?.[s.key];
                    if (!raw) return null;
                    const href = getSocialHref(s.key, raw);
                    if (!href) return null;
                    return (
                      <a
                        key={s.key}
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={s.label}
                        className="flex items-center justify-center w-8 h-8 rounded-full bg-white/15 backdrop-blur-md text-white shadow-inner hover:bg-white/25 hover:-translate-y-0.5 transition-all"
                      >
                        {s.icon}
                      </a>
                    );
                  })}
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
          <div className="relative rounded-[2.5rem] overflow-hidden bg-slate-900 border border-slate-800 shadow-2xl p-6 sm:p-10">
            <div 
              className="absolute top-0 right-0 w-96 h-96 rounded-full blur-[120px] pointer-events-none opacity-20"
              style={{ backgroundColor: accent }}
            />
            
            <div className="relative z-10 flex flex-col lg:flex-row items-center gap-8">
              <div className="w-full lg:w-1/3 space-y-4 text-left">
                <div 
                  className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-black uppercase tracking-wider text-white shadow-sm"
                  style={{ backgroundColor: accent }}
                >
                  <PlayCircle className="w-4 h-4" />
                  Conóceme
                </div>
                
                <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight leading-tight">
                  Video de presentación
                </h2>
                
                <p className="text-slate-400 text-sm leading-relaxed">
                  Descubre mi metodología de enseñanza, cómo estructuro mis clases y mi enfoque para ayudarte a alcanzar tus objetivos.
                </p>

                <div className="pt-2 flex items-center gap-2 text-xs font-semibold text-slate-500">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  Disponible para reproducción inmediata
                </div>
              </div>

              <div className="w-full lg:w-2/3">
                <div className="relative rounded-[2rem] overflow-hidden bg-black aspect-video shadow-2xl border border-slate-800/80 group">
                  <video
                    src={teacher.video_url}
                    controls
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
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
                    {r.total_completed_classes != null && (
                      <div className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-100 rounded-full px-2.5 py-1 mb-3 text-[10px] font-black text-slate-500">
                        <BookOpen className="w-3 h-3" />
                        {r.total_completed_classes} {r.total_completed_classes === 1 ? "clase completada" : "clases completadas"} con este profesor
                      </div>
                    )}
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