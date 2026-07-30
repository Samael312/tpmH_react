"use client";

import { useState, useEffect } from "react";
import {
  User, Globe, MapPin, Link2,
  MessageCircle, Award, BookOpen,
  Calendar, CheckCircle2, AlertTriangle, Loader2
} from "lucide-react";
import api from "@/lib/api";

const InstagramIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
    <circle cx="12" cy="12" r="4"/>
    <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor"/>
  </svg>
);

const YoutubeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
    <path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46a2.78 2.78 0 0 0-1.95 1.96A29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58A2.78 2.78 0 0 0 3.41 19.6C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-1.95A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z"/>
    <polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02" fill="currentColor" stroke="none"/>
  </svg>
);

interface CurrentTeacherProfile {
  full_name?: string;
  user_username?: string;
  photo_url?: string | null;
  avatar_url?: string | null;
  title?: string;
  bio?: string;
  timezone?: string;
  languages?: string[];
  subjects?: string[];
  skills?: string[];
  certificates?: { title: string; year: string }[];
  social_links?: {
    instagram?: string;
    youtube?: string;
    whatsapp?: string;
    website?: string;
  };
}

export default function TeacherPublicProfilePage() {
  const [teacher, setTeacher] = useState<CurrentTeacherProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Peticiones paralelas basadas en el usuario actual (get_current_user)
    Promise.all([
      api.get("/users/me").catch(() => null),
      api.get("/teachers/me").catch(() => null)
    ])
      .then(([userRes, teacherRes]) => {
        const userData = userRes?.data || {};
        const teacherData = teacherRes?.data || {};

        setTeacher({
          full_name: userData.full_name || userData.name,
          user_username: userData.username || userData.user_username,
          photo_url: teacherData.photo_url || userData.avatar_url || userData.photo_url,
          title: teacherData.title,
          bio: teacherData.bio,
          timezone: teacherData.timezone,
          languages: teacherData.languages || [],
          subjects: teacherData.subjects || [],
          skills: teacherData.skills || [],
          certificates: teacherData.certificates || [],
          social_links: teacherData.social_links || {},
        });
      })
      .catch((err) => {
        console.error(err);
        setError("No se pudo cargar la información del perfil.");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-pink-500 animate-spin" />
      </div>
    );
  }

  if (error || !teacher) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-xl p-8 max-w-md w-full text-center space-y-4">
          <div className="w-14 h-14 bg-rose-50 text-rose-500 rounded-2xl flex items-center justify-center mx-auto">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-black text-slate-800">Error de carga</h1>
          <p className="text-sm text-slate-500">{error || "No se encontraron datos de profesor para este usuario."}</p>
          <a
            href="/teachers/profile"
            className="inline-block px-6 py-3 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-bold transition-colors shadow-lg shadow-pink-200"
          >
            Volver a editar perfil
          </a>
        </div>
      </div>
    );
  }

  const avatarSrc = teacher.photo_url;

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden py-10 px-4 sm:px-6 lg:px-8">
      <div className="fixed top-[-100px] right-[-100px] w-[500px] h-[500px] bg-pink-300/15 rounded-full blur-[120px] pointer-events-none" />
      <div className="fixed bottom-[-80px] left-[-80px] w-[400px] h-[400px] bg-purple-300/15 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative max-w-4xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        
        {/* Cabecera del Perfil */}
        <div className="bg-white/90 backdrop-blur-xl rounded-[2rem] border border-white shadow-xl p-6 sm:p-8 flex flex-col sm:flex-row items-center sm:items-start gap-6 border-l-4 border-l-pink-400">
          <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-2xl overflow-hidden shadow-md bg-slate-100 border-2 border-slate-200 flex-shrink-0 flex items-center justify-center">
            {avatarSrc ? (
              <img src={avatarSrc} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              <User className="w-12 h-12 text-slate-300" />
            )}
          </div>

          <div className="flex-1 text-center sm:text-left space-y-2">
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
              <h1 className="text-2xl sm:text-3xl font-black text-slate-800 tracking-tight">
                {teacher.full_name || `@${teacher.user_username || "profesor"}`}
              </h1>
              <span className="inline-flex items-center gap-1 bg-pink-50 text-pink-600 border border-pink-100 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider">
                <CheckCircle2 className="w-3 h-3" /> Profesor Verificado
              </span>
            </div>

            {teacher.title && (
              <p className="text-sm sm:text-base font-bold text-slate-600">{teacher.title}</p>
            )}

            {teacher.timezone && (
              <div className="flex items-center justify-center sm:justify-start gap-1.5 text-xs text-slate-400 font-medium pt-1">
                <MapPin className="w-3.5 h-3.5 text-pink-400" />
                <span>Zona horaria: {teacher.timezone}</span>
              </div>
            )}
          </div>

          <div className="flex sm:flex-col gap-2 w-full sm:w-auto">
            <a
              href="#reservar"
              className="flex-1 sm:flex-none text-center px-6 py-3 bg-gradient-to-r from-pink-500 to-rose-400 hover:shadow-lg hover:shadow-pink-200 text-white rounded-xl text-xs font-bold transition-all"
            >
              Reservar Clase
            </a>
          </div>
        </div>

        {/* Grid de Contenido */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
          
          <div className="md:col-span-7 space-y-6">
            {/* Sobre mí */}
            <div className="bg-white/90 backdrop-blur-xl rounded-[2rem] border border-white shadow-lg p-6 sm:p-7 border-l-4 border-l-purple-400 space-y-3">
              <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-500 flex items-center justify-center">
                  <User className="w-5 h-5" />
                </div>
                <h2 className="text-base font-black text-slate-800">Sobre mí</h2>
              </div>
              <p className="text-sm text-slate-600 whitespace-pre-line leading-relaxed">
                {teacher.bio || "Este profesor aún no ha agregado una biografía."}
              </p>
            </div>

            {/* Especialidades e Idiomas */}
            <div className="bg-white/90 backdrop-blur-xl rounded-[2rem] border border-white shadow-lg p-6 sm:p-7 border-l-4 border-l-indigo-400 space-y-4">
              <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-500 flex items-center justify-center">
                  <BookOpen className="w-5 h-5" />
                </div>
                <h2 className="text-base font-black text-slate-800">Especialidades e Idiomas</h2>
              </div>

              {teacher.languages && teacher.languages.length > 0 && (
                <div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Idiomas</span>
                  <div className="flex flex-wrap gap-1.5">
                    {teacher.languages.map(lang => (
                      <span key={lang} className="px-3 py-1 bg-purple-50 text-purple-600 border border-purple-100 rounded-xl text-xs font-bold">
                        {lang}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {teacher.subjects && teacher.subjects.length > 0 && (
                <div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Materias</span>
                  <div className="flex flex-wrap gap-1.5">
                    {teacher.subjects.map(subj => (
                      <span key={subj} className="px-3 py-1 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-xl text-xs font-bold">
                        {subj}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {teacher.skills && teacher.skills.length > 0 && (
                <div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Habilidades</span>
                  <div className="flex flex-wrap gap-1.5">
                    {teacher.skills.map(skill => (
                      <span key={skill} className="px-3 py-1 bg-slate-100 text-slate-600 border border-slate-200/60 rounded-xl text-xs font-bold">
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Certificaciones */}
            {teacher.certificates && teacher.certificates.length > 0 && (
              <div className="bg-white/90 backdrop-blur-xl rounded-[2rem] border border-white shadow-lg p-6 sm:p-7 border-l-4 border-l-emerald-400 space-y-4">
                <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                  <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-500 flex items-center justify-center">
                    <Award className="w-5 h-5" />
                  </div>
                  <h2 className="text-base font-black text-slate-800">Certificaciones</h2>
                </div>
                <div className="space-y-2.5">
                  {teacher.certificates.map((cert, i) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200/60 text-xs">
                      <span className="font-bold text-slate-700">{cert.title}</span>
                      {cert.year && <span className="text-slate-400 font-bold">{cert.year}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="md:col-span-5 space-y-6">
            {/* Widget de Reserva */}
            <div id="reservar" className="bg-white/90 backdrop-blur-xl rounded-[2rem] border border-white shadow-lg p-6 sm:p-7 border-l-4 border-l-pink-500 space-y-4">
              <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                <div className="w-9 h-9 rounded-xl bg-pink-50 text-pink-500 flex items-center justify-center">
                  <Calendar className="w-5 h-5" />
                </div>
                <h2 className="text-base font-black text-slate-800">Reserva una clase</h2>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Elige una fecha y horario disponible en el calendario del profesor para comenzar tu aprendizaje.
              </p>
              <button
                type="button"
                onClick={() => alert("Funcionalidad de reserva conectada al sistema de clases.")}
                className="w-full py-3.5 bg-gradient-to-r from-pink-500 to-rose-400 text-white rounded-xl text-xs font-bold shadow-lg shadow-pink-200 hover:shadow-pink-300 transition-all text-center block"
              >
                Ver calendario de disponibilidad
              </button>
            </div>

            {/* Redes Sociales / Contacto */}
            {teacher.social_links && Object.values(teacher.social_links).some(Boolean) && (
              <div className="bg-white/90 backdrop-blur-xl rounded-[2rem] border border-white shadow-lg p-6 sm:p-7 border-l-4 border-l-amber-400 space-y-4">
                <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                  <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-500 flex items-center justify-center">
                    <Link2 className="w-5 h-5" />
                  </div>
                  <h2 className="text-base font-black text-slate-800">Redes y Enlaces</h2>
                </div>
                <div className="space-y-2.5">
                  {teacher.social_links.instagram && (
                    <a
                      href={`https://instagram.com/${teacher.social_links.instagram.replace("@", "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-3 bg-slate-50 hover:bg-amber-50 rounded-xl border border-slate-200/60 text-xs font-bold text-slate-700 transition-colors"
                    >
                      <InstagramIcon />
                      <span>Instagram ({teacher.social_links.instagram})</span>
                    </a>
                  )}
                  {teacher.social_links.youtube && (
                    <a
                      href={teacher.social_links.youtube}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-3 bg-slate-50 hover:bg-amber-50 rounded-xl border border-slate-200/60 text-xs font-bold text-slate-700 transition-colors"
                    >
                      <YoutubeIcon />
                      <span>YouTube Canal</span>
                    </a>
                  )}
                  {teacher.social_links.whatsapp && (
                    <a
                      href={`https://wa.me/${teacher.social_links.whatsapp.replace(/[^0-9]/g, "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-3 bg-slate-50 hover:bg-amber-50 rounded-xl border border-slate-200/60 text-xs font-bold text-slate-700 transition-colors"
                    >
                      <MessageCircle className="w-5 h-5 text-emerald-500" />
                      <span>WhatsApp Directo</span>
                    </a>
                  )}
                  {teacher.social_links.website && (
                    <a
                      href={teacher.social_links.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-3 bg-slate-50 hover:bg-amber-50 rounded-xl border border-slate-200/60 text-xs font-bold text-slate-700 transition-colors"
                    >
                      <Globe className="w-5 h-5 text-indigo-500" />
                      <span>Sitio web personal</span>
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>

        </div>

      </div>
    </div>
  );
}