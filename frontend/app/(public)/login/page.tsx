"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { User, Lock, Eye, EyeOff, ArrowRight } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import ChipiWidget from "@/components/chipi/ChipiWidget";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuthStore();

  const [form, setForm] = useState({ login: "", password: "" });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.login.trim() || !form.password.trim()) {
      setError("Por favor, completa todos los campos.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await api.post("/auth/login", form);
      const { access_token, role, name, username } = res.data;

      login(access_token, { username, name, role });

      if (role === "superadmin") {
        router.push("/admin/dashboard");
      } else if (["teacher", "professor_admin"].includes(role)) {
        router.push("/teacher/dashboard");
      } else {
        router.push("/dashboard");
      }
    } catch (e: any) {
      setError(e.response?.data?.detail || "Usuario o contraseña incorrectos");
    } finally {
      setLoading(false);
    }
  };

  return (
    // CAMBIO: Eliminamos items-center/justify-center del padre para que el header respire
    <div className="min-h-screen bg-slate-50 flex flex-col relative overflow-hidden font-sans">
      
      {/* ─── HEADER (Corregido: z-index y posición) ─── */}
      <header className="relative z-20 h-16 px-6 bg-white/70 backdrop-blur-md border-b border-white/50 flex items-center shadow-sm">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="p-1.5 bg-pink-50 rounded-lg group-hover:bg-pink-100 transition-colors">
            <svg className="w-6 h-6 text-pink-600" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 3L1 9L4 10.636V17C4 18.104 7.582 19 12 19C16.418 19 20 18.104 20 17V10.636L23 9L12 3ZM12 17C8.686 17 6 16.328 6 15.5C6 14.672 8.686 14 12 14C15.314 14 18 14.672 18 15.5C18 16.328 15.314 17 12 17ZM20 13V17H22V13H20Z" />
            </svg>
          </div>
          <span className="text-xl font-black tracking-tight text-slate-800 group-hover:text-pink-600 transition-colors">
            TuProfeMaria
          </span>
        </Link>
      </header>

      {/* ─── FONDOS DECORATIVOS ─── */}
      <div className="absolute top-[-100px] right-[-100px] w-[500px] h-[500px] bg-pink-300/25 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-100px] left-[-100px] w-[400px] h-[400px] bg-rose-300/20 rounded-full blur-[100px] pointer-events-none" />

      {/* ─── MAIN CONTENT (Aquí centramos la card) ─── */}
      <main className="flex-1 flex items-center justify-center p-4 relative z-10">
        <div className="w-full max-w-md animate-in fade-in slide-in-from-bottom-6 duration-500">
          
          {/* Logo y Encabezado */}
          <div className="flex flex-col items-center mb-8">
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
            <h1 className="text-2xl font-black text-slate-800 tracking-tight">¡Hola de nuevo!</h1>
            <p className="text-slate-500 text-sm mt-1">Ingresa a tu cuenta para continuar</p>
          </div>

          {/* Formulario */}
          <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-2xl shadow-slate-200/50 p-8">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="group">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Usuario o email</label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-pink-500 transition-colors pointer-events-none" />
                  <input
                    type="text"
                    value={form.login}
                    onChange={(e) => setForm({ ...form, login: e.target.value })}
                    placeholder="Tu usuario"
                    className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 placeholder:text-slate-400 pl-11 pr-4 py-3.5 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all duration-300"
                  />
                </div>
              </div>

              <div className="group">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Contraseña</label>
                  <Link href="/forgot-password" className="text-xs font-bold text-pink-500 hover:text-pink-600">¿La olvidaste?</Link>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-pink-500 transition-colors pointer-events-none" />
                  <input
                    type={showPw ? "text" : "password"}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder="••••••••"
                    className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 pl-11 pr-11 py-3.5 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all duration-300"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(!showPw)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="bg-rose-50 border border-rose-100 text-rose-600 px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-2 animate-in fade-in slide-in-from-top-1">
                  <span>✕</span> {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !form.login || !form.password}
                className="w-full py-3.5 text-sm font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 hover:from-pink-600 hover:to-rose-500 shadow-lg shadow-pink-200 active:scale-[0.98] transition-all duration-300 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <>Iniciar sesión <ArrowRight className="w-4 h-4" /></>}
              </button>
            </form>

            <div className="flex items-center gap-3 my-6">
              <div className="flex-1 h-px bg-slate-100" />
              <span className="text-[10px] font-black text-slate-400 uppercase">O</span>
              <div className="flex-1 h-px bg-slate-100" />
            </div>

            <button
              onClick={() => window.location.href = `${process.env.NEXT_PUBLIC_API_URL}/auth/google`}
              className="w-full flex items-center justify-center gap-3 bg-white border-2 border-slate-100 hover:border-slate-200 text-slate-700 text-sm font-bold py-3.5 rounded-xl transition-all hover:shadow-md"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continuar con Google
            </button>
          </div>

          <p className="text-center text-sm text-slate-500 mt-8">
            ¿No tienes cuenta? <Link href="/register" className="font-black text-pink-600 hover:text-pink-700">Regístrate gratis</Link>
          </p>
        </div>
      </main>
      <ChipiWidget screenName="login" />
    </div>
  );
}
