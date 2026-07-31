"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  User, Mail, Lock, Eye, EyeOff,
  ArrowRight, Check, BookOpen, GraduationCap
} from "lucide-react";
import api from "@/lib/api";
import ChipiWidget from "@/components/chipi/ChipiWidget";

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-4">
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className="flex items-center gap-2">
          {i > 0 && (
            <div className={`h-px w-6 transition-colors duration-300
              ${i < current ? "bg-pink-400" : "bg-slate-200"}`} />
          )}
          <div className={`
            w-6 h-6 rounded-full flex items-center justify-center
            text-[11px] font-black transition-all duration-300
            ${i + 1 < current
              ? "bg-emerald-500 text-white shadow-md"
              : i + 1 === current
                ? "bg-gradient-to-br from-pink-500 to-rose-400 text-white shadow-md shadow-pink-200"
                : "bg-slate-100 text-slate-400"
            }
          `}>
            {i + 1 < current ? <Check className="w-3 h-3" /> : i + 1}
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
  const [role, setRole] = useState("student");
  const [name, setName] = useState("");
  const [surname, setSurname] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");

  // Step 2
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false); // Estado independiente para confirmar contraseña

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Touched state
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const markTouched = (field: string) =>
    setTouched(prev => ({ ...prev, [field]: true }));

  const fieldError = (field: string, value: string) => {
    if (!touched[field]) return false;
    if (field === "email") return !value.includes("@");
    return !value.trim();
  };

  const step1Valid = name.trim() && surname.trim() &&
    username.trim() && email.includes("@") && role;

  const step2Valid = password.length >= 8 && password === confirmPw;

  const handleNext = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ name: true, surname: true, username: true, email: true });
    if (!step1Valid) return;
    setError("");
    setStep(2);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(prev => ({ ...prev, phoneNumber: true }));
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
      });
      setSuccess(true);
      setTimeout(() => {
        router.push("/login?registered=1");
      }, 2000);
    } catch (e: any) {
      const detail = e.response?.data?.detail || "Error creando la cuenta";
      setError(detail);
      if (e.response?.status === 400 &&
        (detail.toLowerCase().includes("email") || detail.toLowerCase().includes("usuario"))) {
        setStep(1);
      }
    } finally {
      setLoading(false);
    }
  };

  const inputCls = (hasError: boolean) =>
    `w-full bg-slate-50 border-2 rounded-xl text-sm font-bold text-slate-800
     placeholder:text-slate-400 pl-8 pr-3 py-2 focus:outline-none
     focus:bg-white transition-all duration-300
     ${hasError
      ? "border-red-400 focus:border-red-500 focus:ring-4 focus:ring-red-50"
      : "border-transparent focus:border-pink-500 focus:ring-4 focus:ring-pink-50"
    }`;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col relative overflow-hidden font-sans">
      <header className="fixed top-0 w-full z-50 h-14 px-6 bg-white/70 backdrop-blur-md border-b border-white/50 flex items-center shadow-sm">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="p-1.5 bg-pink-50 rounded-lg group-hover:bg-pink-100 transition-colors">
            <GraduationCap className="w-4 h-4 text-pink-600" />
          </div>
          <span className="text-base font-black tracking-tight text-slate-800 group-hover:text-pink-600 transition-colors">
            TuProfeMaria
          </span>
        </Link>
      </header>

      <div className="absolute top-[-100px] right-[-100px] w-[500px] h-[500px] bg-pink-300/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-100px] left-[-100px] w-[400px] h-[400px] bg-rose-300/15 rounded-full blur-[100px] pointer-events-none" />

      <main className="flex-1 flex justify-center pt-8 p-4 relative z-10">
        <div className="w-full max-w-[24rem] mt-8 animate-in fade-in slide-in-from-bottom-6 duration-500">

          <div className="flex flex-col items-center mb-8 mt-3">
            <div className="w-16 h-16 rounded-[1.25rem] overflow-hidden shadow-xl shadow-pink-200 mb-4 bg-white p-2 hover:scale-110 transition-transform duration-300">
              <Image
                src="/assets/logo.png"
                alt="Logo"
                width={64}
                height={64}
                className="object-contain w-full h-full"
                priority
              />
            </div>
            <h1 className="text-lg font-black text-slate-800 tracking-tight text-center">Crea tu cuenta</h1>
            <p className="text-slate-500 text-[11px] mt-0.5">Únete a nuestra comunidad educativa</p>
          </div>

          <div className="bg-white/90 backdrop-blur-xl rounded-[1.5rem] border border-white shadow-2xl shadow-slate-200/60 p-4">
            <StepIndicator current={step} total={2} />

            {success && (
              <div className="mb-3 bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
                <Check className="w-4 h-4" />
                ¡Cuenta creada! Redirigiendo...
              </div>
            )}

            {step === 1 ? (
              <form onSubmit={handleNext} className="space-y-2 animate-in fade-in slide-in-from-right-4 duration-300">
                {/* ROLE SELECTOR */}
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block px-1">Soy...</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: "student", label: "Estudiante", icon: BookOpen },
                      { id: "teacher", label: "Profesor", icon: GraduationCap }
                    ].map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setRole(r.id)}
                        className={`flex flex-col items-center gap-1 p-2 rounded-xl border-2 transition-all duration-300 ${role === r.id
                          ? "border-pink-500 bg-pink-50 text-pink-600 shadow-sm"
                          : "border-slate-100 bg-slate-50 text-slate-400 hover:border-pink-200"
                          }`}
                      >
                        <r.icon className="w-4 h-4" />
                        <span className="text-[10px] font-bold">{r.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-0.5">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block px-1">Nombre</label>
                    <div className="relative group">
                      <User className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 group-focus-within:text-pink-500 transition-colors" />
                      <input
                        value={name}
                        onChange={e => setName(e.target.value)}
                        onBlur={() => markTouched("name")}
                        placeholder="Ej. Maria"
                        className={inputCls(fieldError("name", name))}
                      />
                    </div>
                    {fieldError("name", name) && (
                      <p className="text-[9px] text-red-500 font-bold px-1">Requerido</p>
                    )}
                  </div>
                  <div className="space-y-0.5">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block px-1">Apellido</label>
                    <div className="relative group">
                      <User className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 group-focus-within:text-pink-500 transition-colors" />
                      <input
                        value={surname}
                        onChange={e => setSurname(e.target.value)}
                        onBlur={() => markTouched("surname")}
                        placeholder="Ej. Farias"
                        className={inputCls(fieldError("surname", surname))}
                      />
                    </div>
                    {fieldError("surname", surname) && (
                      <p className="text-[9px] text-red-500 font-bold px-1">Requerido</p>
                    )}
                  </div>
                </div>

                <div className="space-y-0.5">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block px-1">Usuario</label>
                  <div className="relative group">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm group-focus-within:text-pink-500">@</span>
                    <input
                      value={username}
                      onChange={e => setUsername(e.target.value.toLowerCase().replace(/\s/g, ""))}
                      onBlur={() => markTouched("username")}
                      placeholder="tu_usuario"
                      className={inputCls(fieldError("username", username))}
                    />
                  </div>
                  {fieldError("username", username) && (
                    <p className="text-[9px] text-red-500 font-bold px-1">Requerido</p>
                  )}
                </div>

                <div className="space-y-0.5">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block px-1">Email</label>
                  <div className="relative group">
                    <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 group-focus-within:text-pink-500 transition-colors" />
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      onBlur={() => markTouched("email")}
                      placeholder="correo@ejemplo.com"
                      className={inputCls(fieldError("email", email))}
                    />
                  </div>
                  {fieldError("email", email) && (
                    <p className="text-[9px] text-red-500 font-bold px-1">
                      {!email.trim() ? "Requerido" : "Email inválido"}
                    </p>
                  )}
                </div>

                {error && (
                  <div className="bg-rose-50 border border-rose-100 text-rose-600 px-2 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1.5 mt-1">
                    <span>✕</span>{error}
                  </div>
                )}

                <button
                  type="submit"
                  className="w-full py-2.5 text-xs font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 hover:from-pink-600 shadow-md shadow-pink-500 active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 mt-3"
                >
                  Siguiente <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </form>
            ) : (
              <form onSubmit={handleRegister} className="space-y-2 animate-in fade-in slide-in-from-right-4 duration-300">

                <div className="space-y-0.5">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block px-1">Contraseña</label>
                  <div className="relative group">
                    <Lock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                    <input
                      type={showPw ? "text" : "password"}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Mínimo 8 caracteres"
                      className={`w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 pl-8 pr-9 py-2 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all [&::-ms-reveal]:hidden [&::-ms-clear]:hidden`}
                    />
                    <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-pink-500 transition-colors">
                      {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  {password && password.length < 8 && (
                    <p className="text-[9px] text-red-500 font-bold px-1">Mínimo 8 caracteres</p>
                  )}
                </div>

                <div className="space-y-0.5">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block px-1">Confirmar Contraseña</label>
                  <div className="relative group">
                    <Lock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                    <input
                      type={showConfirmPw ? "text" : "password"}
                      value={confirmPw}
                      onChange={e => setConfirmPw(e.target.value)}
                      placeholder="Repetir contraseña"
                      className={`w-full bg-slate-50 border-2 rounded-xl text-sm font-bold text-slate-800 pl-8 pr-9 py-2 focus:outline-none transition-all [&::-ms-reveal]:hidden [&::-ms-clear]:hidden ${confirmPw && confirmPw !== password
                        ? "border-red-400 focus:border-red-500 focus:ring-4 focus:ring-red-50"
                        : "border-transparent focus:border-pink-500 focus:ring-4 focus:ring-pink-50"
                        }`}
                    />
                    <button type="button" onClick={() => setShowConfirmPw(!showConfirmPw)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-pink-500 transition-colors">
                      {showConfirmPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  {confirmPw && confirmPw !== password && (
                    <p className="text-[9px] text-red-500 font-bold px-1">Las contraseñas no coinciden</p>
                  )}
                  {confirmPw && confirmPw === password && password.length >= 8 && (
                    <p className="text-[9px] text-emerald-600 font-bold px-1 flex items-center gap-1">
                      <Check className="w-2.5 h-2.5" /> Coinciden
                    </p>
                  )}
                </div>

                {error && (
                  <div className="bg-rose-50 border border-rose-100 text-rose-600 px-2 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1.5 mt-1">
                    <span>✕</span>{error}
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <button type="button" onClick={() => setStep(1)} className="flex-1 py-2.5 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors">
                    Volver
                  </button>
                  <button
                    type="submit"
                    disabled={!step2Valid || loading || success}
                    className="flex-[2] py-2.5 text-xs font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 hover:from-pink-600 shadow-md shadow-pink-500 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {loading ? (
                      <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    ) : success ? (
                      <><Check className="w-3.5 h-3.5" /> ¡Cuenta creada!</>
                    ) : (
                      <>Crear cuenta<ArrowRight className="w-3.5 h-3.5" /></>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>

          <p className="text-center text-sm text-slate-500 mt-4">
            ¿Ya tienes cuenta? <Link href="/login" className="font-black text-pink-600 hover:text-pink-700 transition-colors">Inicia sesión</Link>
          </p>
        </div>
      </main>

      <ChipiWidget screenName="signup" />
    </div>
  );
}