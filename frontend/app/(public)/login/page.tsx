"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuthStore();
  const [form, setForm] = useState({ login: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false); // Nuevo estado

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (!form.login.trim() || !form.password.trim()) {
      setError("Por favor, completa todos los campos.");
      setLoading(false);
      return;
    }

    try {
      const response = await api.post("/auth/login", form);
      const { access_token, role, name, username } = response.data;

      login(access_token, { username, name, role });

      if (role === "student") router.push("/dashboard");
      else if (role === "teacher") router.push("/teacher/dashboard");
      else if (role === "superadmin") router.push("/admin/dashboard");

    } catch (err: any) {
      setError(err.response?.data?.detail || "Usuario o contraseña incorrectos");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-slate-50 flex flex-col font-sans text-slate-800 overflow-hidden">
      
      {/* ─── FONDOS DECORATIVOS (Blobs) ─── */}
      <div className="absolute top-[-10%] left-[-5%] w-96 h-96 bg-pink-300/20 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-5%] w-96 h-96 bg-rose-300/20 rounded-full blur-[100px] pointer-events-none" />

      {/* ─── HEADER ─── */}
      <header className="relative z-10 h-16 px-6 bg-white/80 backdrop-blur-md border-b border-white/50 flex items-center justify-between shadow-sm">
        <Link href="/" className="flex items-center gap-2 cursor-pointer group">
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

      {/* ─── CONTENEDOR CENTRAL ─── */}
      <main className="relative z-10 flex-1 flex items-center justify-center p-4">
        
        <div className="w-full max-w-sm p-8 shadow-2xl shadow-slate-200/50 rounded-3xl bg-white/90 backdrop-blur-xl border border-white animate-fade-in-up">
          
          {/* Encabezado */}
          <div className="w-full flex flex-col items-center mb-8 gap-2 text-center">
            <div className="bg-gradient-to-br from-pink-100 to-rose-50 p-4 rounded-2xl mb-2 shadow-inner border border-pink-100/50">
              <svg className="w-6 h-6 text-pink-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h2 className="text-2xl font-black text-slate-800 tracking-tight">¡Hola de nuevo!</h2>
            <p className="text-sm font-medium text-slate-500">Ingresa a tu cuenta para continuar</p>
          </div>

          {/* Formulario */}
          <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4">
            
            {/* Input Usuario */}
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <svg className="w-5 h-5 text-slate-400 group-focus-within:text-pink-500 transition-colors duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <input
                type="text"
                placeholder="Tu usuario"
                value={form.login}
                onChange={(e) => setForm({ ...form, login: e.target.value })}
                className="w-full pl-11 pr-4 py-3 bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 placeholder:text-slate-400 placeholder:font-medium focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all duration-300"
              />
            </div>

            {/* Input Contraseña */}
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <svg className="w-5 h-5 text-slate-400 group-focus-within:text-pink-500 transition-colors duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
              </div>
              <input
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full pl-11 pr-12 py-3 bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 placeholder:text-slate-400 placeholder:font-medium focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all duration-300"
              />
              {/* Botón ver contraseña */}
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-400 hover:text-pink-600 transition-colors focus:outline-none"
              >
                {showPassword ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>

            {error && (
              <div className="bg-rose-50 border border-rose-100 text-rose-600 px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-2 animate-in fade-in slide-in-from-top-1">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className={`mt-2 w-full py-3.5 text-sm font-bold text-white rounded-xl transition-all duration-300 flex items-center justify-center gap-2
                ${loading 
                  ? 'bg-pink-300 cursor-not-allowed' 
                  : 'bg-gradient-to-r from-pink-500 to-rose-400 hover:from-pink-600 hover:to-rose-500 shadow-lg shadow-pink-200 hover:shadow-pink-300 active:scale-[0.98]'}
              `}
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Iniciando...</span>
                </>
              ) : (
                'Iniciar Sesión'
              )}
            </button>
          </form>

          {/* Separador */}
          <div className="w-full flex items-center justify-center my-6 gap-4">
            <div className="flex-1 h-px bg-slate-100" />
            <span className="text-[10px] text-slate-400 font-black tracking-widest uppercase">O continuar con</span>
            <div className="flex-1 h-px bg-slate-100" />
          </div>

          {/* Botones Secundarios */}
          <div className="w-full flex flex-col items-center gap-4">
            <Link 
              href="/register" 
              className="w-full text-center py-3 text-sm font-bold text-pink-600 bg-pink-50 hover:bg-pink-100 rounded-xl transition-colors"
            >
              Crear cuenta nueva
            </Link>
            
            <Link 
              href="/resetpass" 
              className="text-xs font-bold text-slate-400 hover:text-pink-600 transition-colors"
            >
              ¿Olvidaste tu contraseña?
            </Link>
          </div>

        </div>
      </main>
    </div>
  );
}