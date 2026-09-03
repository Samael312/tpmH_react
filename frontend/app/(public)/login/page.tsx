"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { User, Lock, Eye, EyeOff, ArrowRight } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import ChipiWidget from "@/components/chipi/ChipiWidget";
import GoogleSignInButton from "@/components/auth/GoogleSignInButton";
import { getErrorMessage } from "@/lib/errorMessage";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuthStore();

  const [form, setForm] = useState({ login: "", password: "" });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Check for successful registration redirect
  const registered = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("registered") === "1"
    : false;

  const handleGoogleCredential = async (idToken: string) => {
    setError("");
    setLoading(true);
    try {
      const res = await api.post("/auth/google", { id_token: idToken });

      if (res.data.needs_registration) {
        sessionStorage.setItem("google_id_token", idToken);
        sessionStorage.setItem("google_prefill", JSON.stringify({
          name: res.data.name,
          surname: res.data.surname,
          email: res.data.email,
          avatar: res.data.avatar,
        }));
        router.push("/register/google-complete");
        return;
      }

      const { access_token, role, name, username, email, surname } = res.data;
      login(access_token, { username, name, role, email, surname });

      try {
        const meRes = await api.get("/users/me", {
          headers: { Authorization: `Bearer ${access_token}` },
        });
        const userData = meRes.data;

        let timezone: string | undefined;
        let goal: string | undefined;
        try {
          if (role === "student") {
            const spRes = await api.get("/users/me/student-profile", {
              headers: { Authorization: `Bearer ${access_token}` },
            });
            timezone = spRes.data?.timezone;
            goal = spRes.data?.goal;
          } else if (["teacher", "teacher_admin"].includes(role)) {
            const tpRes = await api.get("/teachers/me/profile", {
              headers: { Authorization: `Bearer ${access_token}` },
            });
            timezone = tpRes.data?.timezone;
          }
        } catch {}

        login(access_token, {
          username, name, role,
          email: userData.email || email,
          surname: userData.surname || surname,
          onboarding_completed: userData.onboarding_completed ?? false,
          timezone, goal,
        });

        if (role === "superadmin") router.push("/admin/dashboard");
        else if (["teacher", "teacher_admin"].includes(role)) router.push("/teacher/dashboard");
        else if (role === "student") router.push(userData.onboarding_completed ? "/dashboard" : "/dashboard/onboarding");
        else router.push("/dashboard");
      } catch {
        if (role === "superadmin") router.push("/admin/dashboard");
        else if (["teacher", "teacher_admin"].includes(role)) router.push("/teacher/dashboard");
        else router.push("/dashboard");
      }
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Error iniciando sesión con Google"));
    } finally {
      setLoading(false);
    }
  };

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
      const { access_token, role, name, username, email, surname } = res.data;

      // Fetch full user data to get onboarding_completed
      login(access_token, { username, name, role, email, surname });

      // Fetch user profile to get onboarding_completed status
      try {
        const meRes = await api.get("/users/me", {
          headers: { Authorization: `Bearer ${access_token}` }
        });
        const userData = meRes.data;

        let timezone: string | undefined;
        let goal: string | undefined;
        try {
          if (role === "student") {
            const spRes = await api.get("/users/me/student-profile", {
              headers: { Authorization: `Bearer ${access_token}` }
            });
            timezone = spRes.data?.timezone;
            goal = spRes.data?.goal;
          } else if (["teacher", "teacher_admin"].includes(role)) {
            const tpRes = await api.get("/teachers/me/profile", {
              headers: { Authorization: `Bearer ${access_token}` }
            });
            timezone = tpRes.data?.timezone;
          }
        } catch {
          // sin perfil todavía (onboarding pendiente) — se usa fallback del navegador
        }

        login(access_token, {
          username,
          name,
          role,
          email: userData.email || email,
          surname: userData.surname || surname,
          onboarding_completed: userData.onboarding_completed ?? false,
          timezone,
          goal,
        });

        if (role === "superadmin") {
          router.push("/admin/dashboard");
        } else if (["teacher", "teacher_admin"].includes(role)) {
          router.push("/teacher/dashboard");
        } else if (role === "student") {
          // Check onboarding
          if (!userData.onboarding_completed) {
            router.push("/dashboard/onboarding");
          } else {
            router.push("/dashboard");
          }
        } else {
          router.push("/dashboard");
        }
      } catch {
        // Fallback routing if /users/me fails
        if (role === "superadmin") {
          router.push("/admin/dashboard");
        } else if (["teacher", "teacher_admin"].includes(role)) {
          router.push("/teacher/dashboard");
        } else {
          router.push("/dashboard");
        }
      }
    } catch (e: unknown) {
      const detail = getErrorMessage(e, "Usuario o contraseña incorrectos");
      if (detail.toLowerCase().includes("desactivada")) {
        setError("Cuenta desactivada. Contacta con el administrador.");
      } else {
        setError("Usuario o contraseña incorrectos");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
    <div className="min-h-screen bg-slate-50 flex flex-col relative overflow-hidden font-sans">
      {/* HEADER */}
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

      <div className="absolute top-[-100px] right-[-100px] w-[500px] h-[500px] bg-pink-300/25 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-100px] left-[-100px] w-[400px] h-[400px] bg-rose-300/20 rounded-full blur-[100px] pointer-events-none" />

      <main className="flex-1 flex justify-center pt-8 p-4 sm:p-6 relative z-10">
        <div className="w-full max-w-md lg:max-w-lg animate-in fade-in slide-in-from-bottom-6 duration-500">

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

          {/* Banner de registro exitoso */}
          {registered && (
            <div className="mb-4 bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-2xl text-sm font-bold flex items-center gap-2 animate-in fade-in">
              <span>✅</span> ¡Cuenta creada correctamente! Inicia sesión.
            </div>
          )}

          {/* Formulario */}
          <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-2xl shadow-slate-200/50 p-6 sm:p-8">
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="group">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Usuario o email</label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-pink-500 transition-colors pointer-events-none" />
                  <input
                    type="text"
                    value={form.login}
                    maxLength={255}
                    onChange={(e) => setForm({ ...form, login: e.target.value.toLowerCase() })}
                    placeholder="Tu usuario"
                    className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 placeholder:text-slate-400 pl-11 pr-4 py-2.5 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all duration-300"
                  />
                </div>
              </div>

              <div className="group">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Contraseña</label>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-pink-500 transition-colors pointer-events-none" />
                  <input
                    type={showPw ? "text" : "password"}
                    value={form.password}
                    maxLength={128}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder="••••••••"
                    className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 pl-11 pr-11 py-2.5 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all duration-300"
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

              {/* Error - persiste hasta nuevo intento */}
              {error && (
                <div className="bg-rose-50 border border-rose-200 text-rose-600 px-4 py-3 rounded-xl text-sm font-bold flex items-center gap-2">
                  <span className="text-rose-500">⚠️</span> {error}
                </div>
              )}

              <div className="flex items-center justify-between mb-1.5">
                  <Link href="/forgot-password" className="text-xs font-bold text-pink-500 hover:text-pink-600">¿Olvidaste tu usuario o contraseña?</Link>
                </div>

              <button
                type="submit"
                disabled={loading || !form.login || !form.password}
                className="w-full py-2.5 text-sm font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 hover:from-pink-600 hover:to-rose-500 shadow-lg shadow-pink-200 active:scale-[0.98] transition-all duration-300 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading
                  ? <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  : <>Iniciar sesión <ArrowRight className="w-4 h-4" /></>
                }
              </button>
            </form>

            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 h-px bg-slate-100" />
              <span className="text-[10px] font-black text-slate-400 uppercase">O</span>
              <div className="flex-1 h-px bg-slate-100" />
            </div>

            <GoogleSignInButton onCredential={handleGoogleCredential} onError={setError} />
          </div>

          <p className="text-center text-sm text-slate-500 mt-4">
            ¿No tienes cuenta? <Link href="/register" className="font-black text-pink-600 hover:text-pink-700">Regístrate gratis</Link>
          </p>
        </div>
      </main>
    </div>
    <ChipiWidget screenName="login" />
    </>
  );
}