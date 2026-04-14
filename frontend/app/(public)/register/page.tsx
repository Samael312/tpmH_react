"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  User, Mail, Lock, Eye, EyeOff,
  ArrowRight, Globe, Target, ChevronDown, Check,
  BookOpen, GraduationCap
} from "lucide-react";
import api from "@/lib/api";

const TIMEZONES = [
  "America/Caracas","America/Bogota","America/Lima",
  "America/Mexico_City","America/New_York","America/Los_Angeles",
  "America/Santiago","America/Buenos_Aires",
  "Europe/Madrid","Europe/London","UTC",
];

const GOALS = [
  "Mantener conversaciones básicas sobre temas cotidianos",
  "Mejorar la pronunciación y la fluidez al hablar",
  "Ampliar el vocabulario para situaciones reales",
  "Prepararse para exámenes oficiales (A1, A2, B1…)",
  "Ganar confianza al participar en conversaciones",
  "Poder viajar al extranjero usando solo inglés",
];

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className="flex items-center gap-2">
          {i > 0 && (
            <div className={`h-px flex-1 w-8 transition-colors duration-300
              ${i < current ? "bg-pink-400" : "bg-slate-200"}`} />
          )}
          <div className={`
            w-7 h-7 rounded-full flex items-center justify-center
            text-xs font-black transition-all duration-300
            ${i + 1 < current
              ? "bg-emerald-500 text-white shadow-md"
              : i + 1 === current
                ? "bg-gradient-to-br from-pink-500 to-rose-400 text-white shadow-md shadow-pink-200"
                : "bg-slate-100 text-slate-400"
            }
          `}>
            {i + 1 < current ? <Check className="w-3.5 h-3.5" /> : i + 1}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);

  // Step 1
  const [role, setRole] = useState("student"); // Nuevo estado para el rol
  const [name, setName] = useState("");
  const [surname, setSurname] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");

  // Step 2
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [timezone, setTimezone] = useState("");
  const [goal, setGoal] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const step1Valid = name.trim() && surname.trim() &&
                    username.trim() && email.includes("@") && role;

  const step2Valid = password.length >= 8 &&
                    password === confirmPw &&
                    timezone && (role === "teacher" || goal); // Si es profe, goal puede ser opcional o adaptado

  const handleNext = (e: React.FormEvent) => {
    e.preventDefault();
    if (!step1Valid) return;
    setError("");
    setStep(2);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!step2Valid) return;
    setLoading(true);
    setError("");
    try {
      await api.post("/auth/register", {
        name,
        surname,
        username,
        email,
        password,
        role,
        timezone,
        goal: role === "teacher" ? "Impartir clases" : goal,
      });
      router.push("/login?registered=1");
    } catch (e: any) {
      setError(e.response?.data?.detail || "Error creando la cuenta");
      if (e.response?.status === 409) setStep(1);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans">
      <div className="absolute top-[-100px] left-[-80px] w-[450px] h-[450px] bg-rose-300/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-80px] right-[-80px] w-[400px] h-[400px] bg-pink-300/20 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative w-full max-w-md animate-in fade-in slide-in-from-bottom-6 duration-500">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-[1.25rem] overflow-hidden shadow-xl shadow-pink-200 mb-4">
            <Image src="/assets/logo.png" alt="Logo" width={64} height={64} className="object-contain w-full h-full" />
          </div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight">Crea tu cuenta</h1>
          <p className="text-slate-500 text-sm mt-1">Únete a nuestra comunidad educativa</p>
        </div>

        <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-2xl shadow-slate-200/50 p-8">
          <StepIndicator current={step} total={2} />

          {step === 1 && (
            <form onSubmit={handleNext} className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
              
              {/* Selector de Rol */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Soy...</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setRole("student")}
                    className={`flex flex-col items-center gap-2 p-3 rounded-2xl border-2 transition-all duration-300 ${
                      role === "student" 
                      ? "border-pink-500 bg-pink-50 text-pink-600 shadow-sm shadow-pink-100" 
                      : "border-slate-100 bg-slate-50 text-slate-400 hover:border-pink-200"
                    }`}
                  >
                    <BookOpen className="w-5 h-5" />
                    <span className="text-xs font-bold">Estudiante</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRole("teacher")}
                    className={`flex flex-col items-center gap-2 p-3 rounded-2xl border-2 transition-all duration-300 ${
                      role === "teacher" 
                      ? "border-pink-500 bg-pink-50 text-pink-600 shadow-sm shadow-pink-100" 
                      : "border-slate-100 bg-slate-50 text-slate-400 hover:border-pink-200"
                    }`}
                  >
                    <GraduationCap className="w-5 h-5" />
                    <span className="text-xs font-bold">Profesor</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="group">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Nombre</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-pink-500 transition-colors" />
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="Nombre" className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 pl-9 pr-3 py-3 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all" />
                  </div>
                </div>
                <div className="group">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Apellido</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-pink-500 transition-colors" />
                    <input value={surname} onChange={e => setSurname(e.target.value)} placeholder="Apellido" className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 pl-9 pr-3 py-3 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all" />
                  </div>
                </div>
              </div>

              <div className="group">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Nombre de usuario</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm group-focus-within:text-pink-500">@</span>
                  <input value={username} onChange={e => setUsername(e.target.value.toLowerCase().replace(/\s/g,""))} placeholder="usuario" className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 pl-9 pr-4 py-3.5 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all" />
                </div>
              </div>

              <div className="group">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-pink-500 transition-colors" />
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@email.com" className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 pl-11 pr-4 py-3.5 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all" />
                </div>
              </div>

              <button type="submit" disabled={!step1Valid} className="w-full py-3.5 text-sm font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 hover:from-pink-600 shadow-lg shadow-pink-200 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2 mt-2">
                Siguiente <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          )}

          {step === 2 && (
            <form onSubmit={handleRegister} className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
              {/* Sección de Contraseñas (Igual que antes) */}
              <div className="group">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Contraseña</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input type={showPw ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="Mínimo 8 caracteres" className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 pl-11 pr-11 py-3.5 focus:outline-none focus:bg-white focus:border-pink-500 transition-all" />
                  <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400">{showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                </div>
              </div>

              <div className="group">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Confirmar</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input type={showPw ? "text" : "password"} value={confirmPw} onChange={e => setConfirmPw(e.target.value)} placeholder="Repetir contraseña" className={`w-full bg-slate-50 border-2 rounded-xl text-sm font-bold text-slate-800 pl-11 py-3.5 focus:outline-none transition-all ${confirmPw && confirmPw !== password ? "border-red-300" : "border-transparent focus:border-pink-500"}`} />
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Zona horaria</label>
                  <div className="relative">
                    <Globe className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <select value={timezone} onChange={e => setTimezone(e.target.value)} className="w-full appearance-none bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 pl-11 pr-10 py-3.5 focus:border-pink-500 transition-all cursor-pointer">
                      <option value="">Seleccionar...</option>
                      {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                    </select>
                    <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  </div>
                </div>

                {/* Solo mostrar objetivo si es estudiante */}
                {role === "student" && (
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">¿Cuál es tu objetivo?</label>
                    <div className="relative">
                      <Target className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                      <select value={goal} onChange={e => setGoal(e.target.value)} className="w-full appearance-none bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 pl-11 pr-10 py-3.5 focus:border-pink-500 transition-all cursor-pointer">
                        <option value="">Seleccionar...</option>
                        {GOALS.map(g => <option key={g} value={g}>{g}</option>)}
                      </select>
                      <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    </div>
                  </div>
                )}
              </div>

              {error && <div className="bg-rose-50 border border-rose-100 text-rose-600 px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-2"><span>✕</span>{error}</div>}

              <div className="flex gap-3 mt-2">
                <button type="button" onClick={() => setStep(1)} className="flex-1 py-3.5 text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors">Volver</button>
                <button type="submit" disabled={!step2Valid || loading} className="flex-2 py-3.5 text-sm font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 hover:from-pink-600 shadow-lg shadow-pink-200 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2 px-6">
                  {loading ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <>Crear cuenta<ArrowRight className="w-4 h-4" /></>}
                </button>
              </div>
            </form>
          )}
        </div>

        <p className="text-center text-sm text-slate-500 mt-6">
          ¿Ya tienes cuenta? <Link href="/login" className="font-black text-pink-600 hover:text-pink-700 transition-colors">Inicia sesión</Link>
        </p>
      </div>
    </div>
  );
}