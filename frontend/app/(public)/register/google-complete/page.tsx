"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { User, ArrowRight, BookOpen, GraduationCap, Mail } from "lucide-react";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

export default function GoogleCompleteSignupPage() {
  const router = useRouter();
  const { login } = useAuthStore();

  const [idToken, setIdToken] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<{ name?: string; surname?: string; email?: string; avatar?: string }>({});
  const [role, setRole] = useState("student");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    const token = sessionStorage.getItem("google_id_token");
    const raw = sessionStorage.getItem("google_prefill");
    if (!token) {
      router.replace("/register");
      return;
    }
    setIdToken(token);
    if (raw) {
      try {
        setPrefill(JSON.parse(raw));
      } catch {}
    }
    setCheckingSession(false);
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!idToken || !username.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await api.post("/auth/google/register", {
        id_token: idToken,
        username: username.trim().toLowerCase(),
        role,
      });
      const { access_token, role: userRole, name, username: uname, email, surname } = res.data;

      sessionStorage.removeItem("google_id_token");
      sessionStorage.removeItem("google_prefill");

      login(access_token, { username: uname, name, role: userRole, email, surname });

      try {
        const meRes = await api.get("/users/me", {
          headers: { Authorization: `Bearer ${access_token}` },
        });
        const userData = meRes.data;
        login(access_token, {
          username: uname,
          name,
          role: userRole,
          email: userData.email || email,
          surname: userData.surname || surname,
          onboarding_completed: userData.onboarding_completed ?? false,
        });

        if (userRole === "teacher") {
          router.push(userData.onboarding_completed ? "/teacher/dashboard" : "/teacher/onboarding");
        } else {
          router.push(userData.onboarding_completed ? "/dashboard" : "/dashboard/onboarding");
        }
      } catch {
        router.push(userRole === "teacher" ? "/teacher/dashboard" : "/dashboard");
      }
    } catch (e: any) {
      setError(e.response?.data?.detail || "Error completando el registro");
    } finally {
      setLoading(false);
    }
  };

  if (checkingSession) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-pink-200 border-t-pink-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col relative overflow-hidden font-sans">
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

      <main className="flex-1 flex justify-center pt-12 p-4 relative z-10">
        <div className="w-full max-w-sm animate-in fade-in slide-in-from-bottom-6 duration-500">
          <div className="flex flex-col items-center mb-8">
            {prefill.avatar && !imgError ? (
              <img
                src={prefill.avatar}
                alt={prefill.name || "Usuario"}
                referrerPolicy="no-referrer"
                onError={() => setImgError(true)}
                className="w-16 h-16 rounded-2xl shadow-xl shadow-pink-200 mb-4 object-cover"
              />
            ) : (
              <div className="w-16 h-16 rounded-2xl bg-pink-100 flex items-center justify-center shadow-xl shadow-pink-200 mb-4">
                <User className="w-7 h-7 text-pink-500" />
              </div>
            )}
            <h1 className="text-xl font-black text-slate-800 tracking-tight text-center">
              ¡Hola{prefill.name ? `, ${prefill.name}` : ""}!
            </h1>
            <p className="text-slate-500 text-sm mt-1 text-center">
              Necesitamos los siguientes datos para seguir tu registro
            </p>
          </div>

          <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-2xl shadow-slate-200/50 p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              {prefill.email && (
                <div className="bg-slate-50 rounded-xl px-4 py-3 flex items-center gap-2 text-xs font-bold text-slate-500">
                  <Mail className="w-4 h-4 text-slate-400" />
                  {prefill.email}
                </div>
              )}

              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                  Soy...
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: "student", label: "Estudiante", icon: BookOpen },
                    { id: "teacher", label: "Profesor", icon: GraduationCap },
                  ].map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setRole(r.id)}
                      className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all duration-300 ${
                        role === r.id
                          ? "border-pink-500 bg-pink-50 text-pink-600 shadow-sm"
                          : "border-slate-100 bg-slate-50 text-slate-400 hover:border-pink-200"
                      }`}
                    >
                      <r.icon className="w-4 h-4" />
                      <span className="text-[11px] font-bold">{r.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                  Elige tu usuario
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">
                    @
                  </span>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ""))}
                    placeholder="tu_usuario"
                    className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 placeholder:text-slate-400 pl-8 pr-4 py-3 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all duration-300"
                  />
                </div>
              </div>

              {error && (
                <div className="bg-rose-50 border border-rose-100 text-rose-600 px-4 py-3 rounded-xl text-xs font-bold">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !username.trim()}
                className="w-full py-3 text-sm font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 hover:from-pink-600 hover:to-rose-500 shadow-lg shadow-pink-200 active:scale-[0.98] transition-all duration-300 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    Crear cuenta <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}