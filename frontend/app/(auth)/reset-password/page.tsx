"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Lock, Eye, EyeOff, Check, ArrowLeft, AlertTriangle } from "lucide-react";
import api from "@/lib/api";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const valid = password.length >= 8 && password === confirmPw;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || !token) return;

    setLoading(true);
    setError("");
    try {
      await api.post("/auth/reset-password", {
        token,
        new_password: password,
      });
      setSuccess(true);
      setTimeout(() => router.push("/login"), 2500);
    } catch (e: any) {
      const detail = e.response?.data?.detail || "Error al restablecer la contraseña";
      if (detail.toLowerCase().includes("expirado") || detail.toLowerCase().includes("inválido")) {
        setError("El enlace ha expirado o ya fue usado. Solicita uno nuevo.");
      } else {
        setError(detail);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="flex flex-col items-center py-8 text-center">
        <div className="w-16 h-16 bg-rose-100 rounded-full flex items-center justify-center mb-4">
          <AlertTriangle className="w-8 h-8 text-rose-500" />
        </div>
        <h2 className="text-lg font-black text-slate-800 mb-2">Enlace inválido</h2>
        <p className="text-sm text-slate-500 mb-6">
          Este enlace no es válido. Solicita uno nuevo desde la página de recuperación.
        </p>
        <Link href="/forgot-password" className="text-sm font-bold text-pink-600 hover:text-pink-700">
          Solicitar nuevo enlace →
        </Link>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex flex-col items-center py-8 text-center">
        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
          <Check className="w-8 h-8 text-emerald-600" />
        </div>
        <h2 className="text-lg font-black text-slate-800 mb-2">
          ¡Contraseña actualizada!
        </h2>
        <p className="text-sm text-slate-500">
          Redirigiendo al inicio de sesión...
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="group">
        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
          Nueva contraseña
        </label>
        <div className="relative">
          <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-pink-500 transition-colors pointer-events-none" />
          <input
            type={showPw ? "text" : "password"}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Mínimo 8 caracteres"
            className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 placeholder:text-slate-400 pl-11 pr-11 py-3.5 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all duration-300"
          />
          <button
            type="button"
            onClick={() => setShowPw(!showPw)}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {password && password.length < 8 && (
          <p className="text-[11px] text-red-500 font-bold mt-1 px-1">Mínimo 8 caracteres</p>
        )}
      </div>

      <div className="group">
        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
          Confirmar contraseña
        </label>
        <div className="relative">
          <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-pink-500 transition-colors pointer-events-none" />
          <input
            type={showPw ? "text" : "password"}
            value={confirmPw}
            onChange={e => setConfirmPw(e.target.value)}
            placeholder="Repite la nueva contraseña"
            className={`w-full bg-slate-50 border-2 rounded-xl text-sm font-bold text-slate-800 placeholder:text-slate-400 pl-11 pr-4 py-3.5 focus:outline-none focus:bg-white transition-all duration-300 ${confirmPw && confirmPw !== password
              ? "border-red-300 focus:border-red-500 focus:ring-4 focus:ring-red-50"
              : "border-transparent focus:border-pink-500 focus:ring-4 focus:ring-pink-50"
              }`}
          />
        </div>
        {confirmPw && confirmPw !== password && (
          <p className="text-[11px] text-red-500 font-bold mt-1 px-1 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> Las contraseñas no coinciden
          </p>
        )}
        {confirmPw && confirmPw === password && password.length >= 8 && (
          <p className="text-[11px] text-emerald-600 font-bold mt-1 px-1 flex items-center gap-1">
            <Check className="w-3 h-3" /> Las contraseñas coinciden
          </p>
        )}
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-600 px-4 py-3 rounded-xl text-sm font-bold flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      <button
        type="submit"
        disabled={!valid || loading}
        className="w-full py-3.5 text-sm font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 hover:from-pink-600 shadow-lg shadow-pink-200 active:scale-[0.98] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {loading
          ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
          : "Establecer nueva contraseña"
        }
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-[-100px] right-[-80px] w-[400px] h-[400px] bg-pink-300/20 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative w-full max-w-sm animate-in fade-in slide-in-from-bottom-6 duration-500">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-[1.25rem] overflow-hidden shadow-xl shadow-pink-200 mb-4">
            <Image src="/assets/logo.png" alt="TuProfeMaria" width={56} height={56} className="object-contain w-full h-full" />
          </div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight">Nueva contraseña</h1>
          <p className="text-slate-500 text-sm mt-1 text-center">Elige una contraseña segura</p>
        </div>

        <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-2xl shadow-slate-200/50 p-8">
          <Suspense fallback={<div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-pink-200 border-t-pink-500 rounded-full animate-spin" /></div>}>
            <ResetPasswordForm />
          </Suspense>
        </div>

        <Link href="/login" className="flex items-center justify-center gap-2 text-sm font-bold text-slate-500 hover:text-pink-600 transition-colors mt-6">
          <ArrowLeft className="w-4 h-4" />
          Volver al inicio de sesión
        </Link>
      </div>
    </div>
  );
}