"use client";

import { useState, useRef } from "react";
import {
  User, Briefcase, Globe, MapPin, Link2,
  MessageCircle, Plus,
  X, Check, Save, Upload, Award, BookOpen,
  ChevronDown, ExternalLink
} from "lucide-react";
import api from "@/lib/api";
import { useTeacherProfile, TeacherProfile } from "@/hooks/useTeacherData";

// ─── Inline icon replacements (not in this lucide-react version) ─────────────
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

// ─── Extended profile type (photo_url comes from API but isn't in TS type yet) ──
type TeacherProfileWithPhoto = TeacherProfile & { photo_url?: string | null };

const LANGUAGES  = ["Español","English","Français","Italiano","Português","Deutsch"];
const SUBJECTS   = ["Inglés","Español","Francés","Italiano","Alemán","Matemáticas","Ciencias"];
const TIMEZONES  = [
  "America/Caracas","America/Bogota","America/Lima","America/Mexico_City",
  "America/New_York","America/Los_Angeles","Europe/Madrid","Europe/London",
  "Europe/Paris","UTC",
];
const SKILL_SUGGESTIONS = [
  "Gramática","Conversación","Pronunciación","Vocabulario",
  "Business English","IELTS","TOEFL","Niños","Viajes","Redacción",
];

// ─── Chip seleccionable ───────────────────────────────────────────────────────
function ChipSelector({
  options,
  selected,
  onChange,
  color = "pink",
}: {
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  color?: "pink" | "purple" | "blue";
}) {
  const toggle = (v: string) =>
    onChange(selected.includes(v)
      ? selected.filter(x => x !== v)
      : [...selected, v]);

  const cls: Record<string, string> = {
    pink:   "border-pink-400 bg-pink-50 text-pink-600",
    purple: "border-purple-400 bg-purple-50 text-purple-600",
    blue:   "border-blue-400 bg-blue-50 text-blue-600",
  };

  return (
    <div className="flex flex-wrap gap-2">
      {options.map(o => (
        <button
          key={o}
          onClick={() => toggle(o)}
          className={`px-3.5 py-1.5 rounded-xl text-sm font-bold border-2
            transition-all duration-200
            ${selected.includes(o)
              ? cls[color]
              : "border-transparent bg-slate-100 text-slate-500 hover:border-slate-200"
            }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

// ─── Input chip con texto libre ───────────────────────────────────────────────
function FreeChipInput({
  value,
  onChange,
  placeholder,
  suggestions = [],
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  suggestions?: string[];
}) {
  const [input, setInput] = useState("");

  const add = (text?: string) => {
    const w = (text ?? input).trim();
    if (!w || value.includes(w)) return;
    onChange([...value, w]);
    setInput("");
  };

  const remove = (w: string) => onChange(value.filter(x => x !== w));

  return (
    <div className="space-y-2">
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions
            .filter(s => !value.includes(s))
            .map(s => (
              <button
                key={s}
                onClick={() => add(s)}
                className="px-3 py-1 rounded-xl text-xs font-bold
                           bg-slate-100 text-slate-500 hover:bg-pink-50
                           hover:text-pink-600 transition-colors border-2
                           border-transparent hover:border-pink-200"
              >
                + {s}
              </button>
            ))}
        </div>
      )}

      <div className="flex gap-2">
        <div className="group relative flex-1">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && add()}
            placeholder={placeholder}
            className="w-full bg-slate-50 border-2 border-transparent
                       rounded-xl text-sm font-bold text-slate-800
                       placeholder:text-slate-400 px-4 py-3
                       focus:outline-none focus:bg-white
                       focus:border-pink-500 focus:ring-4 focus:ring-pink-50
                       transition-all duration-300"
          />
        </div>
        <button
          onClick={() => add()}
          className="px-4 bg-pink-50 text-pink-600 hover:bg-pink-100
                     font-bold rounded-xl transition-colors flex-shrink-0"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map(w => (
            <span
              key={w}
              className="inline-flex items-center gap-1.5 bg-white border
                         border-slate-200 text-slate-700 text-sm font-bold
                         px-3 py-1.5 rounded-xl shadow-sm"
            >
              {w}
              <button
                onClick={() => remove(w)}
                className="text-slate-300 hover:text-rose-400 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sección con título ───────────────────────────────────────────────────────
function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white/80 backdrop-blur-xl rounded-[2rem]
                    border border-white shadow-2xl shadow-slate-200/50 p-6 sm:p-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-xl bg-pink-50 flex items-center
                        justify-center flex-shrink-0">
          <span className="text-pink-500">{icon}</span>
        </div>
        <h2 className="text-lg font-black text-slate-800 tracking-tight">
          {title}
        </h2>
      </div>
      {children}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function TeacherProfilePage() {
  const { profile: rawProfile, loading, refetch } = useTeacherProfile();
  const profile = rawProfile as TeacherProfileWithPhoto | null;

  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState("");
  const photoRef = useRef<HTMLInputElement>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile]       = useState<File | null>(null);

  const [bio, setBio]           = useState("");
  const [title_, setTitle_]     = useState("");
  const [timezone, setTimezone] = useState("");
  const [languages, setLanguages] = useState<string[]>([]);
  const [subjects, setSubjects]   = useState<string[]>([]);
  const [skills, setSkills]       = useState<string[]>([]);
  const [certificates, setCertificates] = useState<
    { title: string; year: string }[]
  >([]);
  const [socialLinks, setSocialLinks] = useState({
    instagram: "", youtube: "", whatsapp: "", website: "",
  });
  const [initialized, setInitialized] = useState(false);

  if (profile && !initialized) {
    setBio(profile.bio ?? "");
    setTitle_(profile.title ?? "");
    setTimezone(profile.timezone ?? "");
    setLanguages(profile.languages ?? []);
    setSubjects(profile.subjects ?? []);
    setSkills(profile.skills ?? []);
    setCertificates(
      Array.isArray(profile.certificates) ? profile.certificates : []
    );
    setSocialLinks({
      instagram: profile.social_links?.instagram ?? "",
      youtube:   profile.social_links?.youtube ?? "",
      whatsapp:  profile.social_links?.whatsapp ?? "",
      website:   profile.social_links?.website ?? "",
    });
    setInitialized(true);
  }

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setPhotoFile(f);
    setPhotoPreview(URL.createObjectURL(f));
  };

  const addCert = () =>
    setCertificates(p => [...p, { title: "", year: "" }]);

  const updateCert = (idx: number, field: "title" | "year", val: string) =>
    setCertificates(p =>
      p.map((c, i) => i === idx ? { ...c, [field]: val } : c)
    );

  const removeCert = (idx: number) =>
    setCertificates(p => p.filter((_, i) => i !== idx));

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      let photoUrl = profile?.photo_url ?? null;
      if (photoFile) {
        const form = new FormData();
        form.append("file", photoFile);
        const res = await api.post("/teachers/me/photo", form, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        photoUrl = res.data.url;
      }

      await api.patch("/teachers/me/profile", {
        bio,
        title: title_,
        timezone,
        languages,
        subjects,
        skills,
        certificates: certificates.filter(c => c.title.trim()),
        social_links: socialLinks,
        ...(photoUrl ? { photo_url: photoUrl } : {}),
      });

      setSaved(true);
      refetch();
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      setError(e.response?.data?.detail || "Error guardando el perfil");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-pink-200 border-t-pink-500
                        rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">
      <div className="fixed top-[-80px] right-[-80px] w-[500px] h-[500px]
                      bg-pink-300/20 rounded-full blur-[100px] pointer-events-none" />
      <div className="fixed bottom-[-100px] left-[-100px] w-[400px] h-[400px]
                      bg-purple-300/15 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between
                        animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div>
            <h1 className="text-3xl font-black text-slate-800 tracking-tight">
              Mi Perfil Público
            </h1>
            <p className="text-slate-500 mt-1">
              Así te ven los estudiantes en el marketplace
            </p>
          </div>

          {profile && (
            <a
              href={`/teachers/${profile.user_username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-2 px-4 py-2.5
                         bg-white border-2 border-slate-200 rounded-xl
                         text-sm font-bold text-slate-600
                         hover:border-pink-300 hover:text-pink-600
                         transition-all duration-200 shadow-sm"
            >
              <ExternalLink className="w-4 h-4" />
              Ver perfil
            </a>
          )}
        </div>

        {error && (
          <div className="bg-rose-50 border border-rose-100 text-rose-600
                          px-4 py-3 rounded-xl text-xs font-bold
                          flex items-center gap-2 animate-in fade-in slide-in-from-top-1">
            <X className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Foto y datos básicos */}
        <Section title="Presentación" icon={<User className="w-5 h-5" />}>
          <div className="flex flex-col sm:flex-row gap-6">
            <div className="flex flex-col items-center gap-3 flex-shrink-0">
              <div
                onClick={() => photoRef.current?.click()}
                className="relative w-28 h-28 rounded-[1.5rem] overflow-hidden
                           cursor-pointer group border-2 border-slate-200
                           hover:border-pink-400 transition-colors"
              >
                {photoPreview || profile?.photo_url ? (
                  <img
                    src={photoPreview ?? profile?.photo_url ?? ""}
                    alt="Foto"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-slate-100 flex items-center justify-center">
                    <User className="w-10 h-10 text-slate-300" />
                  </div>
                )}
                <div className="absolute inset-0 bg-black/40 opacity-0
                                group-hover:opacity-100 transition-opacity
                                flex items-center justify-center">
                  <Upload className="w-6 h-6 text-white" />
                </div>
              </div>
              <input
                ref={photoRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhoto}
              />
              <p className="text-[10px] text-slate-400 text-center font-bold uppercase tracking-widest">
                Clic para cambiar
              </p>
            </div>

            <div className="flex-1 space-y-4">
              <div className="group">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                  Título profesional
                </label>
                <div className="relative">
                  <Briefcase className="absolute left-3.5 top-1/2 -translate-y-1/2
                                        w-5 h-5 text-slate-400 group-focus-within:text-pink-500 transition-colors" />
                  <input
                    value={title_}
                    onChange={e => setTitle_(e.target.value)}
                    placeholder="Ej: Profesora de Inglés Certificada"
                    className="w-full bg-slate-50 border-2 border-transparent
                               rounded-xl text-sm font-bold text-slate-800
                               placeholder:text-slate-400 pl-11 pr-4 py-3.5
                               focus:outline-none focus:bg-white focus:border-pink-500
                               focus:ring-4 focus:ring-pink-50 transition-all duration-300"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                  Sobre mí
                </label>
                <textarea
                  value={bio}
                  onChange={e => setBio(e.target.value)}
                  rows={4}
                  placeholder="Cuéntales a los estudiantes quién eres, tu experiencia y método de enseñanza..."
                  className="w-full bg-slate-50 border-2 border-transparent
                             rounded-xl text-sm font-medium text-slate-800
                             placeholder:text-slate-400 px-4 py-3.5
                             focus:outline-none focus:bg-white focus:border-pink-500
                             focus:ring-4 focus:ring-pink-50 transition-all duration-300 resize-none"
                />
                <p className="text-xs text-slate-400 text-right mt-1">
                  {bio.length} caracteres
                </p>
              </div>
            </div>
          </div>
        </Section>

        {/* Zona horaria */}
        <Section title="Configuración" icon={<Globe className="w-5 h-5" />}>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
              Zona horaria
            </label>
            <div className="relative max-w-sm">
              <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2
                                 w-5 h-5 text-slate-400 pointer-events-none" />
              <select
                value={timezone}
                onChange={e => setTimezone(e.target.value)}
                className="w-full appearance-none bg-slate-50 border-2
                           border-transparent rounded-xl text-sm font-bold
                           text-slate-800 pl-11 pr-10 py-3.5
                           focus:outline-none focus:bg-white focus:border-pink-500
                           focus:ring-4 focus:ring-pink-50 transition-all duration-300 cursor-pointer"
              >
                <option value="">Seleccionar zona...</option>
                {TIMEZONES.map(tz => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2
                                      w-4 h-4 text-slate-400 pointer-events-none" />
            </div>
            <p className="text-xs text-slate-400 mt-2">
              Se usa para mostrar tu disponibilidad correctamente a cada estudiante
            </p>
          </div>
        </Section>

        {/* Idiomas y materias */}
        <Section title="Qué enseñas" icon={<BookOpen className="w-5 h-5" />}>
          <div className="space-y-6">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-3">
                Idiomas que enseñas
              </label>
              <ChipSelector options={LANGUAGES} selected={languages} onChange={setLanguages} color="pink" />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-3">
                Materias / Áreas
              </label>
              <ChipSelector options={SUBJECTS} selected={subjects} onChange={setSubjects} color="purple" />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-3">
                Habilidades específicas
              </label>
              <FreeChipInput
                value={skills}
                onChange={setSkills}
                placeholder="Ej: Present Perfect, IELTS Writing..."
                suggestions={SKILL_SUGGESTIONS}
              />
            </div>
          </div>
        </Section>

        {/* Certificaciones */}
        <Section title="Certificaciones" icon={<Award className="w-5 h-5" />}>
          <div className="space-y-3">
            {certificates.map((cert, idx) => (
              <div key={idx} className="flex gap-3 items-center bg-slate-50 rounded-2xl p-3">
                <div className="flex-1 min-w-0">
                  <input
                    value={cert.title}
                    onChange={e => updateCert(idx, "title", e.target.value)}
                    placeholder="Nombre del certificado"
                    className="w-full bg-white border-2 border-transparent
                               rounded-xl text-sm font-bold text-slate-800
                               placeholder:text-slate-400 px-3 py-2.5
                               focus:outline-none focus:border-pink-500
                               focus:ring-4 focus:ring-pink-50 transition-all duration-300 mb-2"
                  />
                  <input
                    value={cert.year}
                    onChange={e => updateCert(idx, "year", e.target.value)}
                    placeholder="Año (ej: 2022)"
                    className="w-32 bg-white border-2 border-transparent
                               rounded-xl text-sm font-bold text-slate-800
                               placeholder:text-slate-400 px-3 py-2.5
                               focus:outline-none focus:border-pink-500
                               focus:ring-4 focus:ring-pink-50 transition-all duration-300"
                  />
                </div>
                <button
                  onClick={() => removeCert(idx)}
                  className="w-9 h-9 rounded-xl bg-red-50 text-red-400
                             hover:bg-red-100 flex items-center justify-center
                             transition-colors flex-shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}

            <button
              onClick={addCert}
              className="flex items-center gap-2 px-4 py-2.5 bg-slate-100
                         hover:bg-pink-50 text-slate-500 hover:text-pink-600
                         rounded-xl text-sm font-bold transition-colors"
            >
              <Plus className="w-4 h-4" />
              Añadir certificación
            </button>
          </div>
        </Section>

        {/* Redes sociales */}
        <Section title="Contacto y Redes" icon={<Link2 className="w-5 h-5" />}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { key: "instagram" as const, label: "Instagram", placeholder: "@tuprofemaria",         icon: <InstagramIcon /> },
              { key: "youtube"   as const, label: "YouTube",   placeholder: "https://youtube.com/@canal", icon: <YoutubeIcon /> },
              { key: "whatsapp"  as const, label: "WhatsApp",  placeholder: "+58 412 000 0000",      icon: <MessageCircle className="w-5 h-5" /> },
              { key: "website"   as const, label: "Sitio web", placeholder: "https://tuweb.com",     icon: <Globe className="w-5 h-5" /> },
            ].map(field => (
              <div key={field.key} className="group">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                  {field.label}
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2
                                   text-slate-400 group-focus-within:text-pink-500 transition-colors">
                    {field.icon}
                  </span>
                  <input
                    value={socialLinks[field.key]}
                    onChange={e => setSocialLinks(p => ({ ...p, [field.key]: e.target.value }))}
                    placeholder={field.placeholder}
                    className="w-full bg-slate-50 border-2 border-transparent
                               rounded-xl text-sm font-bold text-slate-800
                               placeholder:text-slate-400 pl-11 pr-4 py-3.5
                               focus:outline-none focus:bg-white focus:border-pink-500
                               focus:ring-4 focus:ring-pink-50 transition-all duration-300"
                  />
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Botón guardar fijo */}
        <div className="sticky bottom-6 flex justify-center animate-in fade-in duration-500">
          <button
            onClick={save}
            disabled={saving}
            className={`
              flex items-center gap-3 px-8 py-4 rounded-2xl text-sm font-bold
              shadow-2xl active:scale-[0.98] transition-all duration-300
              disabled:opacity-70 disabled:cursor-not-allowed
              ${saved
                ? "bg-emerald-500 text-white shadow-emerald-200"
                : "bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-pink-200 hover:shadow-pink-300"
              }
            `}
          >
            {saving ? (
              <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            ) : saved ? (
              <><Check className="w-5 h-5" /> ¡Guardado correctamente!</>
            ) : (
              <><Save className="w-5 h-5" /> Guardar cambios</>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}