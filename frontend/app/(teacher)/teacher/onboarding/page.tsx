"use client";

import React, { useState, useEffect, useMemo } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  ChevronRight, ChevronLeft, Check, Globe,
  Briefcase, BookOpen, Award, MessageCircle,
  Sparkles, Upload, Plus, X, Rocket,
  Languages, GraduationCap, Clock, Star,
  ChevronDown, AlertCircle,
} from "lucide-react";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { NATIONALITIES } from "@/lib/nationalities";
import ChipiWidget from "@/components/chipi/ChipiWidget";

// ─── Constantes ─────────────────────────────────────────────────────────────
import {
  TIMEZONE_OPTIONS,
  TIMEZONE_TO_COUNTRY,
  DEFAULT_COUNTRY,
} from "@/lib/timezones";

import { useSystemCatalogs } from "@/hooks/useSystemCatalogs";
import { SUBJECTS as FALLBACK_SUBJECTS, LANGUAGES as FALLBACK_LANGUAGES, SKILL_SUGGESTIONS as FALLBACK_SKILLS } from "@/lib/teacherOptions";



const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const AVAILABLE_HOURS = Array.from({ length: 16 }, (_, i) =>
  `${(i + 7).toString().padStart(2, "0")}:00`
);

interface ScheduleBlock {
  day_of_week: number;
  start_time_local: string;
  end_time_local: string;
  is_available: boolean;
}

interface CountryInfo {
  flag: string;
  dialCode: string;
}

// ─── Función Auxiliar para Convertir Errores de API (FastAPI / Pydantic) ────
function parseApiError(detail: unknown): string {
  if (typeof detail === "string") return detail;

  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === "object" && item !== null && "msg" in item) {
          const { msg, loc } = item as { msg: string; loc?: unknown[] };
          const field = Array.isArray(loc) ? loc[loc.length - 1] : "";
          return field ? `${field}: ${msg}` : msg;
        }
        return JSON.stringify(item);
      })
      .join(" | ");
  }

  if (detail && typeof detail === "object") {
    const { msg } = detail as { msg?: string };
    return msg || JSON.stringify(detail);
  }

  return "Error guardando el perfil. Inténtalo de nuevo.";
}

// ─── Panel lateral de progreso ─────────────────────────────────────────────
function SidebarProgress({ step, name }: { step: number; name: string }) {
  const steps = [
    { num: 1, title: "Bienvenida",     desc: "Empecemos" },
    { num: 2, title: "Tu perfil",      desc: "Foto, bio y WhatsApp" },
    { num: 3, title: "Especialidades", desc: "Qué enseñas" },
    { num: 4, title: "Disponibilidad", desc: "Tus horarios" },
    { num: 5, title: "Redes sociales", desc: "Contacto" },
    { num: 6, title: "Video", desc: "Opcional" },
  ];

  return (
    <div className="hidden lg:flex w-80 bg-slate-900 p-10 flex-col justify-between relative overflow-hidden flex-shrink-0">
      <div className="absolute top-[-10%] left-[-10%] w-64 h-64 bg-pink-500/20 blur-[80px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-64 h-64 bg-rose-500/20 blur-[80px] rounded-full pointer-events-none" />

      <div className="relative z-10">
        <div className="w-14 h-14 rounded-2xl overflow-hidden shadow-xl border-2 border-slate-700/50 mb-10 bg-white p-1">
          <Image src="/assets/logo.png" alt="Logo" width={56} height={56} className="object-contain w-full h-full" />
        </div>
        <h2 className="text-2xl font-black text-white mb-1">¡Hola, {name}!</h2>
        <p className="text-slate-400 mb-10 text-sm">Configura tu perfil de profesor</p>

        <div className="space-y-7">
          {steps.map((s, i) => {
            const isCompleted = step > s.num;
            const isActive    = step === s.num;
            return (
              <div key={i} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-300 ${
                    isCompleted ? "bg-emerald-500 text-white" :
                    isActive    ? "bg-pink-500 text-white ring-4 ring-pink-500/20" :
                                  "bg-slate-800 text-slate-500"
                  }`}>
                    {isCompleted ? <Check className="w-4 h-4" /> : s.num}
                  </div>
                  {i !== steps.length - 1 && (
                    <div className={`w-0.5 h-10 mt-1.5 rounded-full ${isCompleted ? "bg-emerald-500/50" : "bg-slate-800"}`} />
                  )}
                </div>
                <div className="pt-1.5">
                  <p className={`font-bold text-sm ${isActive || isCompleted ? "text-white" : "text-slate-500"}`}>{s.title}</p>
                  <p className="text-xs text-slate-500">{s.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="relative z-10">
        <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700/50">
          <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">TPM Platform</p>
          <p className="text-slate-300 text-xs">Tu perfil es tu carta de presentación para los estudiantes.</p>
        </div>
      </div>
    </div>
  );
}

// ─── Paso 1: Bienvenida ───────────────────────────────────────────────────────
function StepWelcome({ name, onNext }: { name: string; onNext: () => void }) {
  const benefits = [
    { icon: <Star className="w-5 h-5 text-amber-500" />, title: "Perfil público", desc: "Los estudiantes te encontrarán fácilmente" },
    { icon: <Clock className="w-5 h-5 text-pink-500" />, title: "Gestión de horarios", desc: "Define cuándo estás disponible" },
    { icon: <Globe className="w-5 h-5 text-blue-500" />, title: "Alcance global", desc: "Llega a estudiantes de todo el mundo" },
    { icon: <Award className="w-5 h-5 text-emerald-500" />, title: "Certificaciones", desc: "Muestra tus credenciales y logros" },
  ];

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-2xl mx-auto w-full">
      <div className="inline-flex items-center gap-2 bg-pink-50 border border-pink-100 rounded-full px-4 py-1.5 mb-6">
        <Sparkles className="w-4 h-4 text-pink-500" />
        <span className="text-xs font-black text-pink-600 uppercase tracking-widest">¡Bienvenido al equipo!</span>
      </div>

      <h1 className="text-5xl font-black text-slate-800 tracking-tight mb-4">
        Hola, {name} 👋
      </h1>
      <p className="text-slate-500 text-lg leading-relaxed mb-10 max-w-xl">
        Antes de empezar a recibir alumnos, configura tu perfil público.
        Solo te tomará <span className="font-black text-pink-600">3 minutos</span> y podrás editarlo en cualquier momento.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
        {benefits.map((b, i) => (
          <div key={i} className="flex items-start gap-4 p-5 bg-white border border-slate-100 rounded-2xl shadow-sm hover:shadow-md transition-shadow">
            <div className="w-11 h-11 bg-slate-50 rounded-xl flex items-center justify-center flex-shrink-0">{b.icon}</div>
            <div>
              <p className="font-bold text-slate-800">{b.title}</p>
              <p className="text-sm text-slate-500 mt-0.5">{b.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <button onClick={onNext} className="py-4 px-8 text-base font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 shadow-xl shadow-pink-200 hover:shadow-pink-300 active:scale-[0.98] transition-all duration-300 flex items-center justify-center gap-2 w-full md:w-auto">
        Configurar mi perfil <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  );
}

// ─── Paso 2: Foto, bio, título, nacionalidad y WhatsApp ─────────────────────
interface StepProfileProps {
  photoPreview: string | null;
  setPhotoPreview: (v: string | null) => void;
  setPhotoFile: (v: File | null) => void;
  title_: string;
  setTitle_: (v: string) => void;
  bio: string;
  setBio: (v: string) => void;
  timezone: string;
  setTimezone: (v: string) => void;
  nationality: string;
  setNationality: (v: string) => void;
  country: CountryInfo;
  setCountry: (v: CountryInfo) => void;
  phone: string;
  setPhone: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
}

function StepProfile({
  photoPreview, setPhotoPreview, setPhotoFile,
  title_, setTitle_, bio, setBio, timezone, setTimezone,
  country, setCountry, phone, setPhone, nationality, setNationality,
  onNext, onBack,
}: StepProfileProps) {
  
  const [valError, setValError] = useState("");

  const COUNTRY_OPTIONS = useMemo(() => {
    const map = new Map<string, CountryInfo>();
    Object.values(TIMEZONE_TO_COUNTRY).forEach((c) => {
      if (c?.dialCode) map.set(c.dialCode, c);
    });
    if (DEFAULT_COUNTRY?.dialCode) {
      map.set(DEFAULT_COUNTRY.dialCode, DEFAULT_COUNTRY);
    }
    return Array.from(map.values());
  }, []);

  const handleTimezoneChange = (newTz: string) => {
    setTimezone(newTz);
    const detected = TIMEZONE_TO_COUNTRY[newTz] ?? DEFAULT_COUNTRY;
    setCountry(detected);
  };

  const removePhoto = () => {
    setPhotoFile(null);
    setPhotoPreview(null);
  };

  const handleContinue = () => {
    const missing: string[] = [];
    if (!title_.trim()) missing.push("Título profesional");
    if (!bio.trim()) missing.push("Sobre mí");
    if (!nationality) missing.push("Nacionalidad");
    if (!timezone) missing.push("Zona horaria");
    if (!phone.trim()) missing.push("Número de WhatsApp");

    if (missing.length > 0) {
      setValError(`Por favor completa los siguientes campos obligatorios: ${missing.join(", ")}.`);
      return;
    }

    setValError("");
    onNext();
  };

  // Mismos campos que valida handleContinue, para deshabilitar el botón
  // en vez de dejar que el usuario dispare el mensaje de error a ciegas.
  const stepValid = Boolean(title_.trim() && bio.trim() && nationality && timezone && phone.trim());

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300 w-full max-w-3xl mx-auto space-y-7">
      <div>
        <h2 className="text-4xl font-black text-slate-800 tracking-tight">Tu presentación</h2>
        <p className="text-slate-500 text-lg mt-2">Lo primero que verán los estudiantes de ti.</p>
      </div>

      {valError && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 p-4 rounded-2xl text-sm font-bold flex items-center gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p>{valError}</p>
        </div>
      )}

      {/* Foto */}
      <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
        <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Foto de perfil</p>
        <div className="flex items-center gap-6">
          <div className="relative flex-shrink-0">
            <label className="cursor-pointer group">
              <div className="relative w-24 h-24 rounded-2xl overflow-hidden border-2 border-dashed border-slate-200 group-hover:border-pink-400 transition-colors bg-slate-50 flex items-center justify-center">
                {photoPreview ? (
                  <Image src={photoPreview} alt="Preview" fill unoptimized className="object-cover" />
                ) : (
                  <div className="flex flex-col items-center gap-1">
                    <Upload className="w-6 h-6 text-slate-300" />
                    <span className="text-[10px] text-slate-400 font-bold text-center">Subir foto</span>
                  </div>
                )}
                <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Upload className="w-5 h-5 text-white" />
                </div>
              </div>
              <input type="file" accept="image/*" className="hidden" onChange={e => {
                const f = e.target.files?.[0];
                if (f) { setPhotoFile(f); setPhotoPreview(URL.createObjectURL(f)); }
              }} />
            </label>
          </div>
          <div className="text-sm text-slate-500">
            <p className="font-bold text-slate-700 mb-1">Sube una foto profesional</p>
            <p className="text-xs">JPG, PNG. Max 5MB. <br/>Un buen retrato aumenta la confianza de los estudiantes.</p>
            {photoPreview && (
              <button
                type="button"
                onClick={removePhoto}
                className="mt-2 text-xs font-bold text-rose-500 hover:text-rose-600 transition-colors"
              >
                Quitar foto
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Título, bio, nacionalidad, zona horaria, WhatsApp */}
      <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 space-y-4">
        <div>
          <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">Título profesional *</label>
          <div className="relative group">
            <Briefcase className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-pink-500 transition-colors" />
            <input
              value={title_}
              onChange={e => setTitle_(e.target.value)}
              placeholder="Ej: Profesora certificada de inglés · CELTA · 8 años de experiencia"
              className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 placeholder:text-slate-400 pl-12 pr-4 py-4 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all duration-300"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">Sobre mí *</label>
          <textarea
            value={bio}
            onChange={e => setBio(e.target.value)}
            rows={4}
            placeholder="Cuéntales a los estudiantes quién eres, tu experiencia, metodología y por qué les encantará aprender contigo..."
            className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-medium text-slate-800 placeholder:text-slate-400 px-4 py-3.5 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all duration-300 resize-none"
          />
          <p className="text-xs text-slate-400 text-right mt-1">{bio.length} caracteres</p>
        </div>

        <div>
          <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">Nacionalidad *</label>
          <div className="relative">
            <Globe className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
            <select
              value={nationality}
              onChange={e => setNationality(e.target.value)}
              className="w-full appearance-none bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 pl-12 pr-10 py-4 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all cursor-pointer"
            >
              <option value="">Seleccionar nacionalidad...</option>
                {NATIONALITIES.map((n) => (
              <option key={n.code} value={n.name}>{n.flag} {n.name}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          </div>
        </div>

        <div>
          <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">Zona horaria *</label>
          <div className="relative">
            <Globe className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
            <select
              value={timezone}
              onChange={e => handleTimezoneChange(e.target.value)}
              className="w-full appearance-none bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 pl-12 pr-10 py-4 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all cursor-pointer"
            >
              <option value="">Seleccionar zona horaria...</option>
              {TIMEZONE_OPTIONS.map(tz => (
                <option key={tz.value} value={tz.value}>
                  {tz.flag} {tz.label} — {tz.value}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-2">
            <MessageCircle className="w-4 h-4 text-emerald-500" />
            <label className="text-xs font-black text-slate-400 uppercase tracking-widest">
              Número de WhatsApp *
            </label>
          </div>
          <div className="flex gap-2">
            <div className="relative w-32 flex-shrink-0">
              <div className="w-full h-full bg-slate-50 border-2 border-transparent rounded-xl px-3 py-4 flex items-center justify-between pointer-events-none font-bold text-slate-800">
                <span className="text-xl leading-none">{country.flag}</span>
                <span className="text-sm font-black text-slate-600">{country.dialCode}</span>
                <ChevronDown className="w-4 h-4 text-slate-400" />
              </div>
              <select
                value={country.dialCode}
                onChange={(e) => {
                  const selected = COUNTRY_OPTIONS.find((c) => c.dialCode === e.target.value);
                  if (selected) setCountry(selected);
                }}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                title="Seleccionar código de país"
              >
                {COUNTRY_OPTIONS.map((c, idx) => (
                  <option key={idx} value={c.dialCode}>
                    {c.flag} {c.dialCode}
                  </option>
                ))}
              </select>
            </div>

            <input
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="412 000 0000"
              className="flex-1 bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 placeholder:text-slate-400 px-4 py-4 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all duration-300"
            />
          </div>
          <p className="text-[11px] text-slate-400 font-medium pl-1 mt-1.5">
            Este número se utilizará para que tus alumnos se comuniquen contigo por WhatsApp.
          </p>
        </div>
      </div>

      <div className="flex gap-4 pt-4">
        <button onClick={onBack} className="px-8 py-4 text-base font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors flex items-center gap-2">
          <ChevronLeft className="w-5 h-5" /> Volver
        </button>
        <button onClick={handleContinue} disabled={!stepValid} className="flex-1 py-4 text-base font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 shadow-lg shadow-pink-200 active:scale-[0.98] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
          Continuar <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

// ─── Paso 3: Especialidades ───────────────────────────────────────────────────
function StepSpecialties({
  languages, setLanguages, subjects, setSubjects,
  skills, setSkills, certificates, setCertificates,
  onNext, onBack,
}: {
  languages: string[]; setLanguages: React.Dispatch<React.SetStateAction<string[]>>;
  subjects: string[]; setSubjects: React.Dispatch<React.SetStateAction<string[]>>;
  skills: string[]; setSkills: React.Dispatch<React.SetStateAction<string[]>>;
  certificates: { title: string; year: string }[];
  setCertificates: React.Dispatch<React.SetStateAction<{ title: string; year: string }[]>>;
  onNext: () => void; onBack: () => void;
}) {
  const { catalogs } = useSystemCatalogs();
  const SUBJECTS = catalogs.subjects.length ? catalogs.subjects : FALLBACK_SUBJECTS;
  const LANGUAGES = catalogs.languages.length ? catalogs.languages : FALLBACK_LANGUAGES;
  const SKILL_SUGGESTIONS = catalogs.skill_suggestions.length ? catalogs.skill_suggestions : FALLBACK_SKILLS;
  const [skillInput, setSkillInput] = useState("");
  const [valError, setValError] = useState("");

  const toggleLang = (l: string) =>
    setLanguages((p: string[]) => p.includes(l) ? p.filter(x => x !== l) : [...p, l]);
  const toggleSubj = (s: string) =>
    setSubjects((p: string[]) => p.includes(s) ? p.filter(x => x !== s) : [...p, s]);

  const addSkill = (text?: string) => {
    const w = (text ?? skillInput).trim();
    if (!w || skills.includes(w)) return;
    setSkills([...skills, w]);
    setSkillInput("");
  };

  const addCert = () => setCertificates([...certificates, { title: "", year: "" }]);
  const updateCert = (idx: number, field: "title" | "year", val: string) =>
    setCertificates(certificates.map((c, i) => i === idx ? { ...c, [field]: val } : c));
  const removeCert = (idx: number) =>
    setCertificates(certificates.filter((_, i) => i !== idx));

  // Validación: Se requiere al menos un idioma O una materia (no ambos obligatoriamente)
  const handleContinue = () => {
    if (languages.length === 0 && subjects.length === 0) {
      setValError("Debes seleccionar al menos un idioma o una materia para continuar.");
      return;
    }

    setValError("");
    onNext();
  };

  const stepValid = languages.length > 0 || subjects.length > 0;

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300 w-full max-w-3xl mx-auto space-y-7">
      <div>
        <h2 className="text-4xl font-black text-slate-800 tracking-tight">Tus especialidades</h2>
        <p className="text-slate-500 text-lg mt-2">¿Qué enseñas y cuáles son tus puntos fuertes?</p>
      </div>

      {valError && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 p-4 rounded-2xl text-sm font-bold flex items-center gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p>{valError}</p>
        </div>
      )}

      {/* Idiomas */}
      <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
        <div className="flex items-center gap-2 mb-4">
          <Languages className="w-5 h-5 text-pink-500" />
          <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Idiomas que enseñas</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {LANGUAGES.map(l => (
            <button key={l} onClick={() => toggleLang(l)}
              className={`px-4 py-2 rounded-xl text-sm font-bold border-2 transition-all duration-200
                ${languages.includes(l) ? "border-pink-400 bg-pink-50 text-pink-700" : "border-slate-100 bg-slate-50 text-slate-500 hover:border-pink-200"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Materias */}
      <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
        <div className="flex items-center gap-2 mb-4">
          <BookOpen className="w-5 h-5 text-purple-500" />
          <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Materias / Áreas</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {SUBJECTS.map(s => (
            <button key={s} onClick={() => toggleSubj(s)}
              className={`px-4 py-2 rounded-xl text-sm font-bold border-2 transition-all duration-200
                ${subjects.includes(s) ? "border-purple-400 bg-purple-50 text-purple-700" : "border-slate-100 bg-slate-50 text-slate-500 hover:border-purple-200"}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Skills */}
      <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
        <div className="flex items-center gap-2 mb-4">
          <Star className="w-5 h-5 text-amber-500" />
          <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Habilidades específicas</p>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {SKILL_SUGGESTIONS.filter(s => !skills.includes(s)).map(s => (
            <button key={s} onClick={() => addSkill(s)}
              className="px-3 py-1 rounded-xl text-xs font-bold bg-slate-100 text-slate-500 hover:bg-pink-50 hover:text-pink-600 transition-colors border-2 border-transparent hover:border-pink-200">
              + {s}
            </button>
          ))}
        </div>
        <div className="flex gap-2 mb-3">
          <input value={skillInput} onChange={e => setSkillInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addSkill()}
            placeholder="Añadir habilidad personalizada..."
            className="flex-1 bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 placeholder:text-slate-400 px-4 py-3 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all" />
          <button onClick={() => addSkill()} className="px-4 bg-pink-50 text-pink-600 hover:bg-pink-100 font-bold rounded-xl transition-colors">
            <Plus className="w-4 h-4" />
          </button>
        </div>
        {skills.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {skills.map((w: string) => (
              <span key={w} className="inline-flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 text-sm font-bold px-3 py-1.5 rounded-xl shadow-sm">
                {w}
                <button onClick={() => setSkills(skills.filter((x: string) => x !== w))} className="text-slate-300 hover:text-rose-400 transition-colors">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Certificados */}
      <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
        <div className="flex items-center gap-2 mb-4">
          <Award className="w-5 h-5 text-emerald-500" />
          <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Certificaciones (opcional)</p>
        </div>
        <div className="space-y-3 mb-3">
          {certificates.map((cert, idx) => (
            <div key={idx} className="flex gap-3 items-center bg-slate-50 rounded-2xl p-3">
              <div className="flex-1 grid grid-cols-2 gap-2">
                <input value={cert.title} onChange={e => updateCert(idx, "title", e.target.value)}
                  placeholder="Nombre del certificado"
                  className="bg-white border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 px-3 py-2.5 focus:outline-none focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all" />
                <input value={cert.year} onChange={e => updateCert(idx, "year", e.target.value)}
                  placeholder="Año (ej: 2022)"
                  className="bg-white border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 px-3 py-2.5 focus:outline-none focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all" />
              </div>
              <button onClick={() => removeCert(idx)} className="w-9 h-9 rounded-xl bg-red-50 text-red-400 hover:bg-red-100 flex items-center justify-center transition-colors flex-shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
        <button onClick={addCert} className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-pink-50 text-slate-500 hover:text-pink-600 rounded-xl text-sm font-bold transition-colors">
          <Plus className="w-4 h-4" /> Añadir certificación
        </button>
      </div>

      <div className="flex gap-4 pt-4">
        <button onClick={onBack} className="px-8 py-4 text-base font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors flex items-center gap-2">
          <ChevronLeft className="w-5 h-5" /> Volver
        </button>
        <button onClick={handleContinue} disabled={!stepValid} className="flex-1 py-4 text-base font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 shadow-lg shadow-pink-200 active:scale-[0.98] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
          Continuar <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

// ─── Paso 4: Disponibilidad ───────────────────────────────────────────────────
function StepAvailability({ blocks, setBlocks, onNext, onBack }: {
  blocks: ScheduleBlock[];
  setBlocks: React.Dispatch<React.SetStateAction<ScheduleBlock[]>>;
  onNext: () => void; onBack: () => void;
}) {
  const [selectedDay, setSelectedDay] = useState(0);
  const [selectedSlots, setSelectedSlots] = useState<Record<number, string[]>>(
    { 0:[], 1:[], 2:[], 3:[], 4:[], 5:[], 6:[] }
  );

  useEffect(() => {
    const newBlocks: ScheduleBlock[] = [];
    Object.entries(selectedSlots).forEach(([dayStr, hours]) => {
      if (hours.length === 0) return;
      const day = parseInt(dayStr);
      const sorted = [...hours].sort();
      let start = sorted[0];
      let prevH = parseInt(start);
      for (let i = 1; i < sorted.length; i++) {
        const curr = parseInt(sorted[i]);
        if (curr !== prevH + 1) {
          newBlocks.push({ day_of_week: day, start_time_local: start, end_time_local: `${(prevH+1).toString().padStart(2,"0")}:00`, is_available: true });
          start = sorted[i];
        }
        prevH = curr;
      }
      newBlocks.push({ day_of_week: day, start_time_local: start, end_time_local: `${(prevH+1).toString().padStart(2,"0")}:00`, is_available: true });
    });
    setBlocks(newBlocks);
  }, [selectedSlots, setBlocks]);

  const toggleHour = (h: string) =>
    setSelectedSlots(prev => {
      const curr = prev[selectedDay];
      return { ...prev, [selectedDay]: curr.includes(h) ? curr.filter(x => x !== h) : [...curr, h] };
    });

  const clearDay = () => setSelectedSlots(prev => ({ ...prev, [selectedDay]: [] }));

  const removeBlock = (day: number, start: string, end: string) => {
    const sh = parseInt(start), eh = parseInt(end);
    const toRemove = Array.from({ length: eh - sh }, (_, i) => `${(sh+i).toString().padStart(2,"0")}:00`);
    setSelectedSlots(prev => ({ ...prev, [day]: prev[day].filter(h => !toRemove.includes(h)) }));
  };

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300 w-full max-w-4xl mx-auto space-y-7">
      <div>
        <h2 className="text-4xl font-black text-slate-800 tracking-tight">Tu disponibilidad</h2>
        <p className="text-slate-500 text-lg mt-2">¿Cuándo puedes dar clases? Los alumnos verán estos horarios.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Selector */}
        <div className="lg:col-span-3 bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex flex-col">
          <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Día de la semana</p>
          <div className="flex overflow-x-auto pb-2 mb-5 gap-2">
            {DAYS.map((day, i) => (
              <button key={i} onClick={() => setSelectedDay(i)}
                className={`px-4 py-2.5 rounded-xl text-sm font-black transition-all min-w-[70px] flex flex-col items-center gap-1
                  ${selectedDay === i ? "bg-slate-800 text-white shadow-md" : "bg-slate-50 text-slate-500 hover:bg-slate-100 border border-slate-100"}`}>
                <span>{day}</span>
                {selectedSlots[i]?.length > 0 && <div className={`w-1.5 h-1.5 rounded-full ${selectedDay === i ? "bg-pink-400" : "bg-pink-400"}`} />}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-bold text-slate-600">Horas para el <span className="text-pink-600">{DAYS[selectedDay]}</span></p>
            <button onClick={clearDay} className="text-xs font-bold text-slate-400 hover:text-red-500 transition-colors">Limpiar</button>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-52 overflow-y-auto pr-1">
            {AVAILABLE_HOURS.map(h => {
              const sel = selectedSlots[selectedDay]?.includes(h);
              return (
                <button key={h} onClick={() => toggleHour(h)}
                  className={`py-2.5 rounded-xl text-sm font-bold transition-all border-2
                    ${sel ? "border-pink-500 bg-pink-50 text-pink-700 shadow-sm" : "border-slate-100 bg-white text-slate-600 hover:border-pink-200 hover:bg-pink-50/50"}`}>
                  {h}
                </button>
              );
            })}
          </div>
        </div>

        {/* Vista previa */}
        <div className="lg:col-span-2 bg-slate-50 rounded-3xl p-6 border border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Vista previa</p>
            <span className="bg-pink-100 text-pink-600 text-xs font-bold px-2.5 py-1 rounded-full">{blocks.length} rango{blocks.length !== 1 ? "s" : ""}</span>
          </div>
          {blocks.length > 0 ? (
            <div className="space-y-2 overflow-y-auto max-h-64 pr-1">
              {blocks.map((b: ScheduleBlock, idx: number) => (
                <div key={idx} className="flex items-center justify-between bg-white border border-slate-100 rounded-xl px-3 py-2.5 shadow-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black text-white bg-slate-800 px-2 py-0.5 rounded-lg">{DAYS[b.day_of_week]}</span>
                    <span className="text-xs font-bold text-slate-700">{b.start_time_local} – {b.end_time_local}</span>
                  </div>
                  <button onClick={() => removeBlock(b.day_of_week, b.start_time_local, b.end_time_local)} className="text-slate-300 hover:text-red-400 p-1 rounded-lg hover:bg-red-50 transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 opacity-50">
              <Clock className="w-10 h-10 text-slate-300 mb-2" />
              <p className="text-xs text-slate-400 font-bold">Sin horarios seleccionados</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-4 pt-4">
        <button onClick={onBack} className="px-8 py-4 text-base font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors flex items-center gap-2">
          <ChevronLeft className="w-5 h-5" /> Volver
        </button>
        <button onClick={onNext} className="flex-1 py-4 text-base font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 shadow-lg shadow-pink-200 active:scale-[0.98] transition-all duration-300 flex items-center justify-center gap-2">
          {blocks.length === 0 ? "Saltar por ahora" : "Continuar"} <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

// ─── Íconos redes sociales (mismos que teacher/profile, para consistencia visual) ───
const LinkedinIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
    <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z" />
  </svg>
);
const TiktokIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
    <path d="M16.6 5.82c-.9-.9-1.4-2.13-1.4-3.5h-3.15v13.86a2.58 2.58 0 1 1-1.83-2.47V10.6a5.75 5.75 0 1 0 4.98 5.71V9.4a7.35 7.35 0 0 0 4.4 1.45V7.7a4.85 4.85 0 0 1-3-1.88z" />
  </svg>
);

// ─── Paso 5: Redes sociales y finalizar ──────────────────────────────────────
function StepSocial({ socialLinks, setSocialLinks, onNext, onBack, saving }: {
  socialLinks: { instagram: string; website: string; linkedin: string; tiktok: string };
  setSocialLinks: React.Dispatch<React.SetStateAction<{ instagram: string; website: string; linkedin: string; tiktok: string }>>;
  onNext: () => void; onBack: () => void; saving: boolean;
}) {
  const fields: { key: "instagram" | "website" | "linkedin" | "tiktok"; label: string; placeholder: string; icon: React.ReactNode }[] = [
    { key: "instagram", label: "Instagram", placeholder: "https://www.instagram.com/tu_usuario/", icon: <GraduationCap className="w-5 h-5" /> },
    { key: "website", label: "Sitio web", placeholder: "https://tuweb.com", icon: <Globe className="w-5 h-5" /> },
    { key: "linkedin", label: "LinkedIn", placeholder: "https://linkedin.com/in/tuperfil", icon: <LinkedinIcon /> },
    { key: "tiktok", label: "TikTok", placeholder: "@tuprofe", icon: <TiktokIcon /> },
  ];

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300 w-full max-w-2xl mx-auto space-y-7">
      <div>
        <h2 className="text-4xl font-black text-slate-800 tracking-tight">Otras redes y sitio web</h2>
        <p className="text-slate-500 text-lg mt-2">¿Tienes alguna red social adicional o web? (Todo opcional)</p>
      </div>

      <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 space-y-4">
        {fields.map(f => (
          <div key={f.key} className="group">
            <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">{f.label}</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-pink-500 transition-colors">{f.icon}</span>
              <input
                value={socialLinks[f.key] ?? ""}
                onChange={e => setSocialLinks({ ...socialLinks, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 placeholder:text-slate-400 pl-12 pr-4 py-3.5 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all duration-300"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-2xl p-5 flex gap-3 items-start">
        <Sparkles className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
        <p className="text-sm font-bold text-blue-700">Un paso más y terminamos. Una vez completado el onboarding, podrás editar tu perfil en cualquier momento desde la sección <strong>Mi Perfil</strong>.</p>
      </div>

      <div className="flex gap-4 pt-4">
        <button onClick={onBack} disabled={saving} className="px-8 py-4 text-base font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors flex items-center gap-2 disabled:opacity-50">
          <ChevronLeft className="w-5 h-5" /> Volver
        </button>
        <button onClick={onNext} disabled={saving} className="flex-1 py-4 text-base font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 shadow-lg shadow-pink-200 active:scale-[0.98] transition-all duration-300 disabled:opacity-70 flex items-center justify-center gap-2">
          Continuar <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

// ─── Paso 6: Video de presentación (opcional) ──────────────────────────────
function StepVideo({ videoFile, setVideoFile, videoPreview, setVideoPreview, onFinish, onBack, saving, savingStage }: {
  videoFile: File | null;
  setVideoFile: React.Dispatch<React.SetStateAction<File | null>>;
  videoPreview: string | null;
  setVideoPreview: React.Dispatch<React.SetStateAction<string | null>>;
  onFinish: () => void; onBack: () => void; saving: boolean; savingStage: string;
}) {
  const handleFile = (f: File | null) => {
    setVideoFile(f);
    if (videoPreview) URL.revokeObjectURL(videoPreview);
    setVideoPreview(f ? URL.createObjectURL(f) : null);
  };

  const removeVideo = () => handleFile(null);

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300 w-full max-w-2xl mx-auto space-y-7">
      <div>
        <h2 className="text-4xl font-black text-slate-800 tracking-tight">Video de presentación</h2>
        <p className="text-slate-500 text-lg mt-2">Contales a tus futuros alumnos quién sos (opcional por ahora).</p>
      </div>

      <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
        {videoPreview ? (
          <div className="space-y-4">
            <div className="relative rounded-2xl overflow-hidden bg-black">
              <video src={videoPreview} controls preload="metadata" className="w-full max-h-80 block" />
              {/* Badge de confirmación */}
              <div className="absolute top-3 left-3 flex items-center gap-2 bg-emerald-500/95 text-white text-xs font-black px-3 py-1.5 rounded-full shadow-lg pointer-events-none">
                <Check className="w-3.5 h-3.5" /> Video seleccionado
              </div>
            </div>
            {/* Opción para eliminar/cambiar el video */}
            <div className="flex justify-end">
              <button onClick={removeVideo} className="text-sm font-bold text-red-500 hover:text-red-600 flex items-center gap-1.5">
                <X className="w-4 h-4" /> Quitar video
              </button>
            </div>
          </div>
        ) : (
          <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-slate-200 rounded-2xl py-12 cursor-pointer hover:border-pink-300 hover:bg-pink-50/30 transition-colors">
            <Upload className="w-8 h-8 text-slate-300" />
            <span className="text-sm font-bold text-slate-500">Click para subir tu video de presentación</span>
            <span className="text-xs text-slate-400">MP4</span>
            <input type="file" accept="video/mp4" className="hidden" onChange={e => handleFile(e.target.files?.[0] ?? null)} />
          </label>
        )}
      </div>

      <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5 flex gap-3 items-start">
        <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
        <p className="text-sm font-bold text-amber-800">
          Este paso es opcional para terminar el onboarding, pero <strong>tu perfil no será aprobado hasta que subas un video de presentación</strong>. Si preferís hacerlo más adelante, podés subirlo cuando quieras desde <strong>Mi Perfil</strong>.
        </p>
      </div>

      <div className="flex gap-4 pt-4">
        <button onClick={onBack} disabled={saving} className="px-8 py-4 text-base font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors flex items-center gap-2 disabled:opacity-50">
          <ChevronLeft className="w-5 h-5" /> Volver
        </button>
        <button onClick={onFinish} disabled={saving} className="flex-1 py-4 text-base font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 shadow-lg shadow-pink-200 active:scale-[0.98] transition-all duration-300 disabled:opacity-70 flex items-center justify-center gap-2">
          {saving ? (
            <>
              <div className="w-5 h-5 border-4 border-white/40 border-t-white rounded-full animate-spin flex-shrink-0" />
              <span>{savingStage || "Guardando..."}</span>
            </>
          ) : (
            <><Rocket className="w-5 h-5" /> {videoFile ? "Finalizar y acceder" : "Saltar y finalizar"}</>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Paso 7: Éxito ────────────────────────────────────────────────────────────
function StepSuccess({ name }: { name: string }) {
  return (
    <div className="flex flex-col items-center text-center py-10 animate-in fade-in zoom-in-95 duration-500 max-w-xl mx-auto">
      <div className="w-24 h-24 bg-emerald-100 rounded-full flex items-center justify-center mb-8 shadow-2xl shadow-emerald-100">
        <Check className="w-12 h-12 text-emerald-600" />
      </div>
      <h2 className="text-5xl font-black text-slate-800 tracking-tight mb-4">¡Perfil listo, {name}!</h2>
      <p className="text-slate-500 text-lg leading-relaxed mb-10">
        Tu perfil ha sido creado. Ahora puedes empezar a gestionar tus clases y recibir estudiantes.
      </p>
      <div className="grid grid-cols-2 gap-4 w-full text-left">
        {[
          { icon: <Clock className="w-6 h-6 text-pink-500" />, label: "Configura horarios", sub: "Define tu disponibilidad semanal" },
          { icon: <BookOpen className="w-6 h-6 text-purple-500" />, label: "Sube materiales", sub: "Comparte recursos con tus alumnos" },
        ].map((item, i) => (
          <div key={i} className="flex items-center gap-4 bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
            <div className="w-12 h-12 bg-slate-50 rounded-xl flex items-center justify-center flex-shrink-0">{item.icon}</div>
            <div>
              <p className="text-sm font-bold text-slate-800">{item.label}</p>
              <p className="text-xs text-slate-500 mt-0.5">{item.sub}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function TeacherOnboardingPage() {
  const router   = useRouter();
  const { user, setUser, logout } = useAuthStore();
  const [nationality, setNationality] = useState("");
  const [step, setStep] = useState(1);
  const TOTAL_STEPS = 7;

  // Step 2
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile]       = useState<File | null>(null);
  
  useEffect(() => {
    api.get("/users/me")
      .then(res => {
        if (res.data?.avatar) setPhotoPreview(res.data.avatar);
      })
      .catch(() => {});
  }, []);
  
  const [title_, setTitle_]             = useState("");
  const [bio, setBio]                   = useState("");
  const [timezone, setTimezone]         = useState(
    typeof window !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC"
  );
  const [country, setCountry] = useState<CountryInfo>(
    () => TIMEZONE_TO_COUNTRY[timezone] ?? DEFAULT_COUNTRY
  );
  const [phone, setPhone]                 = useState("");

  // Step 3
  const [languages, setLanguages]       = useState<string[]>([]);
  const [subjects, setSubjects]         = useState<string[]>([]);
  const [skills, setSkills]             = useState<string[]>([]);
  const [certificates, setCertificates] = useState<{ title: string; year: string }[]>([]);
  // Step 4
  const [blocks, setBlocks]             = useState<ScheduleBlock[]>([]);
  // Step 5
  const [socialLinks, setSocialLinks]   = useState({ instagram: "", website: "", linkedin: "", tiktok: "" });
  // Step 6
  const [videoFile, setVideoFile]       = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [savingStage, setSavingStage] = useState("");
  const [error, setError]   = useState("");

  const name = user?.name ?? "Profesor";

  const next = () => setStep(p => Math.min(p + 1, TOTAL_STEPS));
  const back = () => setStep(p => Math.max(p - 1, 1));

  const finish = async () => {
    setSaving(true);
    setError("");
    try {
      // 1. Subir foto si hay
      setSavingStage("Guardando tu perfil...");
      let photoUrl: string | null = null;
      if (photoFile) {
        const form = new FormData();
        form.append("file", photoFile);
        const res = await api.post("/users/me/photo", form, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        photoUrl = res.data.url;
      }

      const dialCode = country.dialCode || DEFAULT_COUNTRY.dialCode;
      const fullPhone = `${dialCode} ${phone.trim()}`.trim();

      await api.patch("/users/me", { phone_number: fullPhone, nationality });

      // 2. Guardar perfil del profesor
      await api.patch("/teachers/me/profile", {
        bio,
        title: title_,
        timezone,
        languages,
        subjects,
        skills,
        certificates: certificates.filter(c => c.title.trim()),
        social_links: {
          ...socialLinks,
          whatsapp: fullPhone,
        },
        ...(photoUrl ? { photo_url: photoUrl } : {}),
      });

      // 3. Guardar disponibilidad si hay bloques
      if (blocks.length > 0) {
        setSavingStage("Guardando tu disponibilidad...");
        await api.put("/availability/me/weekly", {
          timezone,
          slots: blocks,
        });
      }

      // 3b. Subir video de presentación si lo cargó (opcional acá; sin él
      // el perfil queda pendiente de aprobación, se puede subir después
      // desde Mi Perfil). Es la llamada más pesada de toda la cadena (puede
      // pesar varios MB), así que le damos su propio mensaje de progreso
      // en vez de dejar el spinner genérico sin contexto.
      if (videoFile) {
        setSavingStage("Subiendo tu video, puede tardar unos segundos...");
        const vform = new FormData();
        vform.append("file", videoFile);
        await api.post("/teachers/me/video", vform, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        setSavingStage("Video subido correctamente ✓");
      }

      // 4. Marcar onboarding completado
      await api.patch("/users/me", { onboarding_completed: true });

      // 5. Actualizar store
      if (user) {
        setUser({ ...user, onboarding_completed: true, phone_number: fullPhone });
      }

      // 6. Ir a paso de éxito
      next();

      // 7. Redirigir tras 3s
      setTimeout(() => router.push("/teacher/dashboard"), 3000);

    } catch (e) {
      const errorDetail = axios.isAxiosError(e) ? e.response?.data?.detail : undefined;
      setError(parseApiError(errorDetail));
    } finally {
      setSavingStage("");
      setSaving(false);
    }
  };

  return (
    <>
    <div className="flex min-h-screen bg-slate-50 font-sans">
      <SidebarProgress step={step} name={name} />

      <div className="flex-1 flex flex-col justify-center px-6 py-12 md:px-12 overflow-y-auto relative">
        {/* Salida de emergencia: si el usuario llegó acá por error (ej. volvió
            con el botón "atrás" del navegador y volvió a entrar con otra
            cuenta), tiene que poder volver al login sin quedar atrapado,
            ya que el onboarding no tiene ningún otro link de navegación. */}
        <button
          onClick={() => { logout(); router.push("/login"); }}
          className="absolute top-6 left-6 text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors z-50"
        >
          ¿Quieres hacerlo después, {name}? Cerrar sesión
        </button>

        {/* Error global de la API */}
        {error && (
          <div className="absolute top-6 right-6 left-6 md:left-auto max-w-sm bg-rose-50 border border-rose-200 text-rose-700 px-5 py-4 rounded-2xl text-sm font-bold flex items-start gap-3 shadow-lg z-50 animate-in slide-in-from-top-5">
            <X className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <p className="flex-1">{error}</p>
            <button onClick={() => setError("")}><X className="w-4 h-4" /></button>
          </div>
        )}

        <div className="w-full flex justify-center">
          {step === 1 && <StepWelcome name={name} onNext={next} />}
          {step === 2 && (
            <StepProfile
              photoPreview={photoPreview} setPhotoPreview={setPhotoPreview} setPhotoFile={setPhotoFile}
              title_={title_} setTitle_={setTitle_} bio={bio} setBio={setBio}
              timezone={timezone} setTimezone={setTimezone}
              country={country} setCountry={setCountry}
              phone={phone} setPhone={setPhone}
              onNext={next} onBack={back} nationality={nationality} setNationality={setNationality}
            />
          )}
          {step === 3 && (
            <StepSpecialties
              languages={languages} setLanguages={setLanguages}
              subjects={subjects} setSubjects={setSubjects}
              skills={skills} setSkills={setSkills}
              certificates={certificates} setCertificates={setCertificates}
              onNext={next} onBack={back}
            />
          )}
          {step === 4 && <StepAvailability blocks={blocks} setBlocks={setBlocks} onNext={next} onBack={back} />}
          {step === 5 && (
            <StepSocial
              socialLinks={socialLinks} setSocialLinks={setSocialLinks}
              onNext={next} onBack={back} saving={saving}
            />
          )}
          {step === 6 && (
            <StepVideo
              videoFile={videoFile} setVideoFile={setVideoFile}
              videoPreview={videoPreview} setVideoPreview={setVideoPreview}
              onFinish={finish} onBack={back} saving={saving} savingStage={savingStage}
            />
          )}
          {step === 7 && (
            <div className="w-full">
              <StepSuccess name={name} />
              <div className="max-w-md mx-auto mt-8">
                <button onClick={() => router.push("/teacher/dashboard")}
                  className="w-full py-4 text-base font-bold text-white rounded-xl bg-slate-800 hover:bg-slate-900 shadow-xl transition-all flex items-center justify-center gap-2">
                  Ir a mi dashboard <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Indicador mobile */}
        {step < 7 && (
          <div className="lg:hidden mt-10 text-center">
            <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Paso {step} de 6</p>
            <div className="flex justify-center gap-2 mt-3">
              {[1,2,3,4,5,6].map(s => (
                <div key={s} className={`h-1.5 rounded-full transition-all duration-300 ${step >= s ? "w-8 bg-pink-500" : "w-4 bg-slate-200"}`} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
    <ChipiWidget screenName="onboarding_teacher" />
    </>
  );
}