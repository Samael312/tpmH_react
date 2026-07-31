"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Star, MessageCircle, Award, BookOpen,
  Check, Loader2, AlertCircle, Calendar, UserCheck,
} from "lucide-react";
import api from "@/lib/api";
import ChipiWidget from "@/components/chipi/ChipiWidget";

function displayName(t: any) {
  return t?.name || t?.user_username?.replace(/[_.]/g, " ") || "Profesor";
}

export default function TeacherBrowsePage() {
  const params = useParams();
  const router = useRouter();
  const username = params?.username as string;

  const [teacher, setTeacher] = useState<any>(null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [myTeacherUsername, setMyTeacherUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [chooseError, setChooseError] = useState("");
  const [chosen, setChosen] = useState(false);

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
      })
      .catch(() => setError("No se pudo cargar el perfil de este profesor."))
      .finally(() => setLoading(false));
  }, [username]);

  const isMine = myTeacherUsername === username;

  const chooseTeacher = async () => {
    setChoosing(true);
    setChooseError("");
    try {
      if (myTeacherUsername) {
        await api.put("/users/me/choose-teacher", { teacher_username: username });
      } else {
        await api.post("/users/me/choose-teacher", { teacher_username: username });
      }
      setMyTeacherUsername(username);
      setChosen(true);
      setTimeout(() => setChosen(false), 3000);
    } catch (e: any) {
      setChooseError(e.response?.data?.detail || "Error seleccionando profesor");
    } finally {
      setChoosing(false);
    }
  };

  const openLink = (url: string) => {
    if (!url) return;
    window.open(url.startsWith("http") ? url : `https://${url}`, "_blank", "noopener,noreferrer");
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
          <p className="text-sm text-slate-500">{error || "No se pudo encontrar este profesor."}</p>
        </div>
      </div>
    );
  }

  const safeReviews = Array.isArray(reviews) ? reviews : [];
  const avgRating = safeReviews.length > 0
    ? safeReviews.reduce((s, r) => s + r.rating, 0) / safeReviews.length
    : 0;

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden py-10 px-4 sm:px-6 lg:px-8">
      <div className="fixed top-[-80px] right-[-80px] w-[500px] h-[500px] bg-pink-300/20 rounded-full blur-[100px] pointer-events-none" />
      <div className="fixed bottom-[-80px] left-[-80px] w-[400px] h-[400px] bg-rose-300/15 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative max-w-6xl mx-auto space-y-8">

        <div className="bg-gradient-to-br from-pink-500 via-rose-500 to-pink-600 rounded-[2.5rem] p-8 sm:p-10 text-white relative overflow-hidden shadow-2xl shadow-pink-200">
          <div className="absolute top-[-40px] right-[-40px] w-48 h-48 bg-white/10 rounded-full blur-2xl pointer-events-none" />

          <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
              <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-[2rem] overflow-hidden border-4 border-white/30 shadow-2xl flex-shrink-0 bg-pink-400 flex items-center justify-center">
                {teacher.profile_photo_url ? (
                  <img src={teacher.profile_photo_url} alt={displayName(teacher)} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-pink-400 to-rose-600">
                    <span className="text-4xl font-black text-white">
                      {displayName(teacher)[0]?.toUpperCase() || "T"}
                    </span>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                {isMine && (
                  <span className="inline-block text-[10px] font-black uppercase tracking-widest text-white/70 bg-white/10 px-3 py-1 rounded-full backdrop-blur-sm">
                    Tu profesor actual
                  </span>
                )}
                <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white">
                  {displayName(teacher)}
                </h1>
                {teacher.title && <p className="text-white/90 text-sm font-semibold">{teacher.title}</p>}

                <div className="flex items-center gap-3 flex-wrap pt-2">
                  <div className="flex items-center gap-2 bg-white/15 backdrop-blur-md px-3.5 py-1.5 rounded-full shadow-inner">
                    <Star className="w-4 h-4 text-amber-300 fill-amber-300" />
                    <span className="text-sm font-black text-white">{avgRating.toFixed(1)}</span>
                    <span className="text-white/70 text-xs">({safeReviews.length} reseñas)</span>
                  </div>
                  {teacher.languages?.slice(0, 3).map((l: string) => (
                    <span key={l} className="bg-white/15 backdrop-blur-md px-3.5 py-1.5 rounded-full text-xs font-bold text-white shadow-inner">
                      {l}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 w-full md:w-auto">
              {!isMine ? (
                <button
                  onClick={chooseTeacher}
                  disabled={choosing}
                  className="flex items-center justify-center gap-2 bg-white text-pink-600 hover:bg-pink-50
                             px-5 py-3 rounded-2xl text-sm font-bold transition-all duration-200 shadow-lg
                             disabled:opacity-60"
                >
                  {choosing ? <Loader2 className="w-4 h-4 animate-spin" /> : chosen ? (
                    <><Check className="w-4 h-4" /> ¡Profesor elegido!</>
                  ) : (
                    <><UserCheck className="w-4 h-4" /> {myTeacherUsername ? "Cambiar a este profesor" : "Elegir este profesor"}</>
                  )}
                </button>
              ) : (
                <span className="flex items-center justify-center gap-2 bg-white/20 text-white px-5 py-3 rounded-2xl text-sm font-bold">
                  <Check className="w-4 h-4" /> Ya es tu profesor
                </span>
              )}

              <button
                onClick={() => router.push("/dashboard/schedule")}
                className="flex items-center justify-center gap-2 bg-white/20 hover:bg-white/30 backdrop-blur-md
                           px-5 py-3 rounded-2xl text-sm font-bold transition-all duration-200 shadow-lg"
              >
                <Calendar className="w-4 h-4" /> Agendar clase de prueba
              </button>

              {teacher.social_links?.whatsapp && (
                <button
                  onClick={() => openLink(`https://wa.me/${teacher.social_links.whatsapp.replace(/\D/g, "")}`)}
                  className="flex items-center justify-center gap-2 bg-white/20 hover:bg-white/30 backdrop-blur-md
                             px-5 py-3 rounded-2xl text-sm font-bold transition-all duration-200 shadow-lg"
                >
                  <MessageCircle className="w-4 h-4 text-emerald-300" /> WhatsApp
                </button>
              )}
            </div>
          </div>

          {chooseError && (
            <div className="relative mt-4 bg-white/90 text-rose-600 px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {chooseError}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="space-y-6">
            <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-xl shadow-slate-200/50 p-6 sm:p-8">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-pink-50 rounded-2xl flex items-center justify-center shadow-sm">
                  <BookOpen className="w-5 h-5 text-pink-500" />
                </div>
                <h2 className="text-lg font-black text-slate-800">Sobre mí</h2>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                {teacher.bio ?? "Sin descripción disponible por el momento."}
              </p>
            </div>

            {teacher.subjects?.length > 0 && (
              <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-xl shadow-slate-200/50 p-6 sm:p-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-purple-50 rounded-2xl flex items-center justify-center shadow-sm">
                    <BookOpen className="w-5 h-5 text-purple-500" />
                  </div>
                  <h2 className="text-lg font-black text-slate-800">Qué enseña</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  {teacher.subjects.map((s: string) => (
                    <span key={s} className="px-3.5 py-2 bg-purple-50 text-purple-700 text-xs font-bold rounded-xl border border-purple-100 shadow-sm">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {teacher.skills?.length > 0 && (
              <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-xl shadow-slate-200/50 p-6 sm:p-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-pink-50 rounded-2xl flex items-center justify-center shadow-sm">
                    <Star className="w-5 h-5 text-pink-500" />
                  </div>
                  <h2 className="text-lg font-black text-slate-800">Habilidades</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  {teacher.skills.map((s: string) => (
                    <span key={s} className="inline-flex items-center gap-1 px-3 py-1.5 bg-pink-50 border border-pink-100 text-pink-700 text-xs font-bold rounded-xl shadow-sm">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {teacher.certificates?.length > 0 && (
              <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-xl shadow-slate-200/50 p-6 sm:p-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-amber-50 rounded-2xl flex items-center justify-center shadow-sm">
                    <Award className="w-5 h-5 text-amber-500" />
                  </div>
                  <h2 className="text-lg font-black text-slate-800">Certificaciones</h2>
                </div>
                <div className="space-y-3">
                  {teacher.certificates.map((cert: any, i: number) => (
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

          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between px-2">
              <h2 className="text-xl font-black text-slate-800">
                Reseñas de estudiantes ({safeReviews.length})
              </h2>
            </div>

            {safeReviews.length === 0 ? (
              <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-xl py-16 text-center space-y-3">
                <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto text-slate-300">
                  <Star className="w-6 h-6" />
                </div>
                <p className="text-slate-500 font-bold text-sm">Este profesor aún no tiene reseñas</p>
              </div>
            ) : (
              <div className="space-y-4">
                {safeReviews.map((r: any) => (
                  <div key={r.id} className="bg-white/95 backdrop-blur-xl rounded-2xl border border-slate-100 shadow-lg p-5">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-pink-400 to-rose-400 flex items-center justify-center flex-shrink-0 shadow-md shadow-pink-200">
                          <span className="text-white text-xs font-black">
                            {r.student_name?.[0]?.toUpperCase() ?? "?"}
                          </span>
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-800">{r.student_name || "Estudiante"}</p>
                          <p className="text-[10px] text-slate-400 font-bold">
                            {r.created_at ? new Date(r.created_at).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" }) : ""}
                          </p>
                        </div>
                      </div>
                      <div className="flex">
                        {[1, 2, 3, 4, 5].map(i => (
                          <Star key={i} className={`w-4 h-4 ${i <= r.rating ? "text-amber-400 fill-amber-400" : "text-slate-300"}`} />
                        ))}
                      </div>
                    </div>
                    <p className="text-sm text-slate-600 leading-relaxed italic">&ldquo;{r.comment}&rdquo;</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <ChipiWidget screenName="teacher_browse" />
    </div>
  );
}