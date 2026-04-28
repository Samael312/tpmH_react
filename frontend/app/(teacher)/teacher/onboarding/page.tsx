"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  ChevronRight, ChevronLeft, Check, Globe,
  Briefcase, BookOpen, Award, MessageCircle,
  Sparkles, Upload, Plus, X, Rocket,
  Languages, GraduationCap, Clock, Star
} from "lucide-react";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

// ─── Constantes ───────────────────────────────────────────────────────────────
const TIMEZONES = [
  "America/Caracas", "America/Bogota", "America/Lima",
  "America/Mexico_City", "America/New_York", "America/Los_Angeles",
  "America/Santiago", "America/Buenos_Aires",
  "America/Sao_Paulo", "America/Chicago",
  "Europe/Madrid", "Europe/London", "Europe/Paris",
  "Asia/Tokyo", "Asia/Dubai", "UTC",
];

const LANGUAGES = ["Español", "English", "Français", "Italiano", "Português", "Deutsch"];
const SUBJECTS  = ["Inglés", "Español", "Francés", "Italiano", "Alemán", "Matemáticas", "Ciencias"];
const SKILL_SUGGESTIONS = [
  "Gramática", "Conversación", "Pronunciación", "Vocabulario",
  "Business English", "IELTS", "TOEFL", "Niños", "Viajes", "Redacción",
];
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

// ─── Panel lateral de progreso ─────────────────────────────────────────────
function SidebarProgress({ step, name }: { step: number; name: string }) {
  const steps = [
    { num: 1, title: "Bienvenida",     desc: "Empecemos" },
    { num: 2, title: "Tu perfil",      desc: "Foto y bio" },
    { num: 3, title: "Especialidades", desc: "Qué enseñas" },
    { num: 4, title: "Disponibilidad", desc: "Tus horarios" },
    { num: 5, title: "Redes sociales", desc: "Contacto" },
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
          <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">TPMH Platform</p>
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

// ─── Paso 2: Foto, bio y título ───────────────────────────────────────────────
function StepProfile({
  photoPreview, setPhotoPreview, setPhotoFile,
  title_, setTitle_, bio, setBio, timezone, setTimezone,
  onNext, onBack,
}: any) {
  const valid = title_.trim() && bio.trim() && timezone;

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300 w-full max-w-3xl mx-auto space-y-7">
      <div>
        <h2 className="text-4xl font-black text-slate-800 tracking-tight">Tu presentación</h2>
        <p className="text-slate-500 text-lg mt-2">Lo primero que verán los estudiantes de ti.</p>
      </div>

      {/* Foto */}
      <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
        <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Foto de perfil</p>
        <div className="flex items-center gap-6">
          <label className="cursor-pointer group">
            <div className="relative w-24 h-24 rounded-2xl overflow-hidden border-2 border-dashed border-slate-200 group-hover:border-pink-400 transition-colors bg-slate-50 flex items-center justify-center">
              {photoPreview ? (
                <img src={photoPreview} alt="Preview" className="w-full h-full object-cover" />
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
          <div className="text-sm text-slate-500">
            <p className="font-bold text-slate-700 mb-1">Sube una foto profesional</p>
            <p className="text-xs">JPG, PNG. Max 5MB. <br/>Un buen retrato aumenta la confianza de los estudiantes.</p>
          </div>
        </div>
      </div>

      {/* Título */}
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
          <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">Zona horaria *</label>
          <div className="relative">
            <Globe className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
            <select
              value={timezone}
              onChange={e => setTimezone(e.target.value)}
              className="w-full appearance-none bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 pl-12 pr-10 py-4 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all cursor-pointer"
            >
              <option value="">Seleccionar zona horaria...</option>
              {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="flex gap-4 pt-4">
        <button onClick={onBack} className="px-8 py-4 text-base font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors flex items-center gap-2">
          <ChevronLeft className="w-5 h-5" /> Volver
        </button>
        <button onClick={onNext} disabled={!valid} className="flex-1 py-4 text-base font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 shadow-lg shadow-pink-200 active:scale-[0.98] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
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
}: any) {
  const [skillInput, setSkillInput] = useState("");

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
    setCertificates(certificates.map((c: any, i: number) => i === idx ? { ...c, [field]: val } : c));
  const removeCert = (idx: number) =>
    setCertificates(certificates.filter((_: any, i: number) => i !== idx));

  const valid = languages.length > 0 && subjects.length > 0;

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300 w-full max-w-3xl mx-auto space-y-7">
      <div>
        <h2 className="text-4xl font-black text-slate-800 tracking-tight">Tus especialidades</h2>
        <p className="text-slate-500 text-lg mt-2">¿Qué enseñas y cuáles son tus puntos fuertes?</p>
      </div>

      {/* Idiomas */}
      <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
        <div className="flex items-center gap-2 mb-4">
          <Languages className="w-5 h-5 text-pink-500" />
          <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Idiomas que enseñas *</p>
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
          <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Materias / Áreas *</p>
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
          {certificates.map((cert: any, idx: number) => (
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
        <button onClick={onNext} disabled={!valid} className="flex-1 py-4 text-base font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 shadow-lg shadow-pink-200 active:scale-[0.98] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
          Continuar <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

// ─── Paso 4: Disponibilidad ───────────────────────────────────────────────────
function StepAvailability({ blocks, setBlocks, onNext, onBack }: any) {
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

// ─── Paso 5: Redes sociales y finalizar ──────────────────────────────────────
function StepSocial({ socialLinks, setSocialLinks, onFinish, onBack, saving }: any) {
  const fields = [
    { key: "whatsapp", label: "WhatsApp", placeholder: "+58 412 000 0000", icon: <MessageCircle className="w-5 h-5" /> },
    { key: "instagram", label: "Instagram", placeholder: "@tuprofemaria", icon: <GraduationCap className="w-5 h-5" /> },
    { key: "website", label: "Sitio web", placeholder: "https://tuweb.com", icon: <Globe className="w-5 h-5" /> },
  ];

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300 w-full max-w-2xl mx-auto space-y-7">
      <div>
        <h2 className="text-4xl font-black text-slate-800 tracking-tight">Contacto y redes</h2>
        <p className="text-slate-500 text-lg mt-2">¿Cómo pueden contactarte los estudiantes? (Todo opcional)</p>
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
        <p className="text-sm font-bold text-blue-700">¡Ya casi terminas! Una vez completado el onboarding, podrás editar tu perfil en cualquier momento desde la sección <strong>Mi Perfil</strong>.</p>
      </div>

      <div className="flex gap-4 pt-4">
        <button onClick={onBack} disabled={saving} className="px-8 py-4 text-base font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors flex items-center gap-2 disabled:opacity-50">
          <ChevronLeft className="w-5 h-5" /> Volver
        </button>
        <button onClick={onFinish} disabled={saving} className="flex-1 py-4 text-base font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 shadow-lg shadow-pink-200 active:scale-[0.98] transition-all duration-300 disabled:opacity-70 flex items-center justify-center gap-2">
          {saving ? (
            <div className="w-6 h-6 border-4 border-white/40 border-t-white rounded-full animate-spin" />
          ) : (
            <><Rocket className="w-5 h-5" /> Finalizar y acceder</>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Paso 6: Éxito ────────────────────────────────────────────────────────────
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
  const { user, setUser } = useAuthStore();

  const [step, setStep] = useState(1);
  const TOTAL_STEPS = 6;

  // Step 2
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile]       = useState<File | null>(null);
  const [title_, setTitle_]             = useState("");
  const [bio, setBio]                   = useState("");
  const [timezone, setTimezone]         = useState(
    typeof window !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC"
  );
  // Step 3
  const [languages, setLanguages]       = useState<string[]>([]);
  const [subjects, setSubjects]         = useState<string[]>([]);
  const [skills, setSkills]             = useState<string[]>([]);
  const [certificates, setCertificates] = useState<{ title: string; year: string }[]>([]);
  // Step 4
  const [blocks, setBlocks]             = useState<ScheduleBlock[]>([]);
  // Step 5
  const [socialLinks, setSocialLinks]   = useState({ whatsapp: "", instagram: "", website: "" });

  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");

  const name = user?.name ?? "Profesor";

  const next = () => setStep(p => Math.min(p + 1, TOTAL_STEPS));
  const back = () => setStep(p => Math.max(p - 1, 1));

  const finish = async () => {
    setSaving(true);
    setError("");
    try {
      // 1. Subir foto si hay
      let photoUrl: string | null = null;
      if (photoFile) {
        const form = new FormData();
        form.append("file", photoFile);
        const res = await api.post("/teachers/me/photo", form, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        photoUrl = res.data.url;
      }

      // 2. Guardar perfil del profesor
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

      // 3. Guardar disponibilidad si hay bloques
      if (blocks.length > 0) {
        await api.post("/availability/me/weekly", {
          timezone,
          slots: blocks,
        });
      }

      // 4. Marcar onboarding completado
      await api.patch("/users/me", { onboarding_completed: true });

      // 5. Actualizar store
      if (user) {
        setUser({ ...user, onboarding_completed: true });
      }

      // 6. Ir a paso de éxito
      next();

      // 7. Redirigir tras 3s
      setTimeout(() => router.push("/teacher/dashboard"), 3000);

    } catch (e: any) {
      setError(e.response?.data?.detail || "Error guardando el perfil. Inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-50 font-sans">
      <SidebarProgress step={step} name={name} />

      <div className="flex-1 flex flex-col justify-center px-6 py-12 md:px-12 overflow-y-auto relative">
        {/* Error global */}
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
              onNext={next} onBack={back}
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
              onFinish={finish} onBack={back} saving={saving}
            />
          )}
          {step === 6 && (
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
        {step < 6 && (
          <div className="lg:hidden mt-10 text-center">
            <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Paso {step} de 5</p>
            <div className="flex justify-center gap-2 mt-3">
              {[1,2,3,4,5].map(s => (
                <div key={s} className={`h-1.5 rounded-full transition-all duration-300 ${step >= s ? "w-8 bg-pink-500" : "w-4 bg-slate-200"}`} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}