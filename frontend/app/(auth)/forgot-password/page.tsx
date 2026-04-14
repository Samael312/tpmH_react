"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Mail, ArrowLeft, Check } from "lucide-react";
import api from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail]   = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent]       = useState(false);
  const [error, setError]     = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    setError("");
    try {
      await api.post("/auth/forgot-password", { email });
      setSent(true);
    } catch {
      // Siempre mostramos éxito (anti-enumeración)
      setSent(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center
                    justify-center p-4 relative overflow-hidden">

      <div className="absolute top-[-100px] right-[-80px] w-[400px] h-[400px]
                      bg-pink-300/20 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative w-full max-w-sm
                      animate-in fade-in slide-in-from-bottom-6 duration-500">

        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-[1.25rem] overflow-hidden
                          shadow-xl shadow-pink-200 mb-4">
            <Image
              src="/assets/logo.png"
              alt="TuProfeMaria"
              width={56}
              height={56}
              className="object-contain w-full h-full"
            />
          </div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight">
            Recuperar acceso
          </h1>
          <p className="text-slate-500 text-sm mt-1 text-center">
            Te enviaremos un enlace para restablecer tu contraseña
          </p>
        </div>

        <div className="bg-white/80 backdrop-blur-xl rounded-[2rem]
                        border border-white shadow-2xl shadow-slate-200/50 p-8">

          {sent ? (
            <div className="flex flex-col items-center py-6 text-center">
              <div className="w-16 h-16 bg-emerald-100 rounded-full
                              flex items-center justify-center mb-4">
                <Check className="w-8 h-8 text-emerald-600" />
              </div>
              <h2 className="text-lg font-black text-slate-800 mb-2">
                ¡Revisa tu correo!
              </h2>
              <p className="text-sm text-slate-500 leading-relaxed">
                Si existe una cuenta con ese email, recibirás las
                instrucciones en breve.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="group">
                <label className="text-[10px] font-black text-slate-400
                                  uppercase tracking-widest block mb-1.5">
                  Correo electrónico
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2
                                    w-5 h-5 text-slate-400
                                    group-focus-within:text-pink-500
                                    transition-colors pointer-events-none" />
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="tu@email.com"
                    className="w-full bg-slate-50 border-2 border-transparent
                               rounded-xl text-sm font-bold text-slate-800
                               placeholder:text-slate-400 pl-11 pr-4 py-3.5
                               focus:outline-none focus:bg-white
                               focus:border-pink-500 focus:ring-4 focus:ring-pink-50
                               transition-all duration-300"
                  />
                </div>
              </div>

              {error && (
                <div className="bg-rose-50 border border-rose-100 text-rose-600
                                px-4 py-3 rounded-xl text-xs font-bold
                                flex items-center gap-2">
                  <span>✕</span>{error}
                </div>
              )}

              <button
                type="submit"
                disabled={!email || loading}
                className="w-full py-3.5 text-sm font-bold text-white rounded-xl
                           bg-gradient-to-r from-pink-500 to-rose-400
                           hover:from-pink-600 hover:to-rose-500
                           shadow-lg shadow-pink-200 active:scale-[0.98]
                           transition-all duration-300 disabled:opacity-50
                           disabled:cursor-not-allowed
                           flex items-center justify-center gap-2"
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white/40
                                  border-t-white rounded-full animate-spin" />
                ) : (
                  "Enviar enlace"
                )}
              </button>
            </form>
          )}
        </div>

        <Link href="/login"
          className="flex items-center justify-center gap-2 text-sm
                     font-bold text-slate-500 hover:text-pink-600
                     transition-colors mt-6">
          <ArrowLeft className="w-4 h-4" />
          Volver al inicio de sesión
        </Link>
      </div>
    </div>
  );
}