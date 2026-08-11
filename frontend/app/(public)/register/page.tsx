"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  User,
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  Check,
  BookOpen,
  GraduationCap,
  AlertCircle,
} from "lucide-react";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import ChipiWidget from "@/components/chipi/ChipiWidget";
import GoogleSignInButton from "@/components/auth/GoogleSignInButton";

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-2">
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className="flex items-center gap-2">
          {i > 0 && (
            <div
              className={`h-px w-6 transition-colors duration-300 ${
                i < current ? "bg-pink-400" : "bg-slate-200"
              }`}
            />
          )}
          <div
            className={`
            w-5 h-5 rounded-full flex items-center justify-center
            text-[10px] font-black transition-all duration-300
            ${
              i + 1 < current
                ? "bg-emerald-500 text-white shadow-md"
                : i + 1 === current
                ? "bg-gradient-to-br from-pink-500 to-rose-400 text-white shadow-md shadow-pink-200"
                : "bg-slate-100 text-slate-400"
            }
          `}
          >
            {i + 1 < current ? <Check className="w-2.5 h-2.5" /> : i + 1}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function RegisterPage() {
  const router = useRouter();
  const login = useAuthStore((state) => state.login);
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
  const [showConfirmPw, setShowConfirmPw] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const markTouched = (field: string) =>
    setTouched((prev) => ({ ...prev, [field]: true }));

  const fieldError = (field: string, value: string) => {
    if (!touched[field]) return false;
    if (field === "email") return !value.trim() || !value.includes("@");
    if (field === "password") return value.length < 8;
    if (field === "confirmPw") return value !== password;
    return !value.trim();
  };

  const step1Valid = Boolean(
    name.trim() &&
      surname.trim() &&
      username.trim() &&
      email.includes("@") &&
      role
  );

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
    setTouched((prev) => ({ ...prev, password: true, confirmPw: true }));
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
    } catch (err: unknown) {
      const errorResponse = err as { response?: { data?: { detail?: string }; status?: number } };
      const detail = errorResponse.response?.data?.detail || "Error creando la cuenta";
      setError(detail);
      if (
        errorResponse.response?.status === 400 &&
        (detail.toLowerCase().includes("email") ||
          detail.toLowerCase().includes("usuario"))
      ) {
        setStep(1);
      }
    } finally {
      setLoading(false);
    }
  };

  const inputCls = (hasError: boolean, hasIconRight = false) =>
    `w-full bg-slate-50 border-2 rounded-xl text-xs font-bold text-slate-800
     placeholder:text-slate-400 pl-9 ${hasIconRight ? "pr-8" : "pr-2.5"} py-2 focus:outline-none
     focus:bg-white transition-all duration-300
     ${
       hasError
         ? "border-red-400 focus:border-red-500 focus:ring-4 focus:ring-red-50"
         : "border-transparent focus:border-pink-500 focus:ring-4 focus:ring-pink-50"
     }`;

  return (
    <>
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
        <div className="absolute bottom-[-100px] left-[-100px] w-[400px] h-[400px] bg-rose-300/20 rounded-full blur-[100px] pointer-events-none" />

        <main className="flex-1 flex justify-center items-center pt-3 p-3 relative z-10">
          <div className="w-full max-w-[23rem] my-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
            
            {/* Header del Formulario */}
            <div className="flex flex-col items-center mb-3">
              <div className="w-14 h-14 rounded-[1.25rem] overflow-hidden shadow-xl shadow-pink-200 mb-2 bg-white p-1.5 hover:scale-105 transition-transform duration-300 border border-slate-100">
                <Image
                  src="/assets/logo.png"
                  alt="Logo"
                  width={56}
                  height={56}
                  className="object-contain w-full h-full"
                  priority
                />
              </div>
              <h1 className="text-xl font-black text-slate-800 tracking-tight text-center">
                Crea tu cuenta
              </h1>
              <p className="text-slate-500 text-xs">
                Únete a nuestra comunidad educativa
              </p>
            </div>

            {/* Tarjeta principal */}
            <div className="bg-white/80 backdrop-blur-xl rounded-[1.5rem] border border-white shadow-2xl shadow-slate-200/50 p-4">
              
              <div className="mb-2">
                <GoogleSignInButton
                  text="signup_with"
                  onError={setError}
                  onCredential={async (idToken) => {
                    setError("");
                    try {
                      const res = await api.post("/auth/google", {
                        id_token: idToken,
                      });
                      if (res.data.needs_registration) {
                        sessionStorage.setItem("google_id_token", idToken);
                        sessionStorage.setItem(
                          "google_prefill",
                          JSON.stringify({
                            name: res.data.name,
                            surname: res.data.surname,
                            email: res.data.email,
                            avatar: res.data.avatar,
                          })
                        );
                        router.push("/register/google-complete");
                      } else {
                        const {
                          access_token,
                          role: userRole,
                          name: userName,
                          username: userUsername,
                          email: userEmail,
                          surname: userSurname,
                        } = res.data;
                        
                        login(access_token, {
                          username: userUsername,
                          name: userName,
                          role: userRole,
                          email: userEmail,
                          surname: userSurname,
                        });
                        
                        router.push(
                          userRole === "teacher"
                            ? "/teacher/dashboard"
                            : "/dashboard"
                        );
                      }
                    } catch (err: unknown) {
                      const errorResponse = err as { response?: { data?: { detail?: string } } };
                      setError(
                        errorResponse.response?.data?.detail || "Error con Google"
                      );
                    }
                  }}
                />
              </div>

              <div className="flex items-center gap-3 my-2.5">
                <div className="flex-1 h-px bg-slate-100" />
                <span className="text-[10px] font-black text-slate-400 uppercase">
                  O
                </span>
                <div className="flex-1 h-px bg-slate-100" />
              </div>

              <StepIndicator current={step} total={2} />

              {success && (
                <div className="mb-2 bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 animate-in fade-in">
                  <Check className="w-4 h-4 shrink-0" />
                  ¡Cuenta creada! Redirigiendo...
                </div>
              )}

              {error && (
                <div className="mb-2 bg-rose-50 border border-rose-200 text-rose-600 px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 animate-in fade-in">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {step === 1 ? (
                <form
                  onSubmit={handleNext}
                  className="space-y-2 animate-in fade-in duration-200"
                >
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 tracking-widest block px-0.5">
                      Soy...
                    </label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[
                        { id: "student", label: "Estudiante", icon: BookOpen },
                        {
                          id: "teacher",
                          label: "Profesor",
                          icon: GraduationCap,
                        },
                      ].map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setRole(r.id)}
                          className={`flex items-center justify-center gap-1.5 p-1.5 rounded-xl border-2 transition-all duration-300 ${
                            role === r.id
                              ? "border-pink-500 bg-pink-50 text-pink-600 shadow-sm"
                              : "border-slate-100 bg-slate-50 text-slate-400 hover:border-pink-200"
                          }`}
                        >
                          <r.icon className="w-3.5 h-3.5" />
                          <span className="text-[10px] font-bold">
                            {r.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="space-y-0.5">
                      <label htmlFor="name" className="text-[10px] font-black text-slate-400  tracking-widest block px-0.5">
                        Nombre
                      </label>
                      <div className="relative group">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-pink-500 transition-colors pointer-events-none" />
                        <input
                          id="name"
                          name="given-name"
                          autoComplete="given-name"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          onBlur={() => markTouched("name")}
                          placeholder="Maria"
                          className={inputCls(fieldError("name", name))}
                        />
                      </div>
                    </div>
                    <div className="space-y-0.5">
                      <label htmlFor="surname" className="text-[10px] font-black text-slate-400  tracking-widest block px-0.5">
                        Apellido
                      </label>
                      <div className="relative group">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-pink-500 transition-colors pointer-events-none" />
                        <input
                          id="surname"
                          name="family-name"
                          autoComplete="family-name"
                          value={surname}
                          onChange={(e) => setSurname(e.target.value)}
                          onBlur={() => markTouched("surname")}
                          placeholder="Farias"
                          className={inputCls(fieldError("surname", surname))}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-0.5">
                    <label htmlFor="username" className="text-[10px] font-black text-slate-400  tracking-widest block px-0.5">
                      Usuario
                    </label>
                    <div className="relative group">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs group-focus-within:text-pink-500 pointer-events-none">
                        @
                      </span>
                      <input
                        id="username"
                        name="username"
                        autoComplete="username"
                        value={username}
                        onChange={(e) =>
                          setUsername(
                            e.target.value.toLowerCase().replace(/\s/g, "")
                          )
                        }
                        onBlur={() => markTouched("username")}
                        placeholder="tu_usuario"
                        className={inputCls(fieldError("username", username))}
                      />
                    </div>
                  </div>

                  <div className="space-y-0.5">
                    <label htmlFor="email" className="text-[10px] font-black text-slate-400  tracking-widest block px-0.5">
                      Email
                    </label>
                    <div className="relative group">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-pink-500 transition-colors pointer-events-none" />
                      <input
                        id="email"
                        type="email"
                        name="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onBlur={() => markTouched("email")}
                        placeholder="correo@ejemplo.com"
                        className={inputCls(fieldError("email", email))}
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2.5 text-xs font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 hover:from-pink-600 shadow-lg shadow-pink-200 active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 mt-2"
                  >
                    Siguiente <ArrowRight className="w-4 h-4" />
                  </button>
                </form>
              ) : (
                <form
                  onSubmit={handleRegister}
                  className="space-y-2 animate-in fade-in duration-200"
                >
                  <div className="space-y-0.5">
                    <label htmlFor="password" className="text-[10px] font-black text-slate-400 uppercase tracking-widest block px-0.5">
                      Contraseña
                    </label>
                    <div className="relative group">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-pink-500 transition-colors pointer-events-none" />
                      <input
                        id="password"
                        name="new-password"
                        autoComplete="new-password"
                        type={showPw ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onBlur={() => markTouched("password")}
                        placeholder="Mínimo 8 caracteres"
                        className={inputCls(
                          fieldError("password", password),
                          true
                        )}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPw(!showPw)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        {showPw ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-0.5">
                    <label htmlFor="confirmPw" className="text-[10px] font-black text-slate-400 uppercase tracking-widest block px-0.5">
                      Confirmar Contraseña
                    </label>
                    <div className="relative group">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-pink-500 transition-colors pointer-events-none" />
                      <input
                        id="confirmPw"
                        name="confirm-password"
                        autoComplete="new-password"
                        type={showConfirmPw ? "text" : "password"}
                        value={confirmPw}
                        onChange={(e) => setConfirmPw(e.target.value)}
                        onBlur={() => markTouched("confirmPw")}
                        placeholder="Repetir contraseña"
                        className={inputCls(
                          fieldError("confirmPw", confirmPw),
                          true
                        )}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPw(!showConfirmPw)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        {showConfirmPw ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setError("");
                        setStep(1);
                      }}
                      className="flex-1 py-2.5 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                    >
                      Volver
                    </button>
                    <button
                      type="submit"
                      disabled={!step2Valid || loading || success}
                      className="flex-[2] py-2.5 text-xs font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 hover:from-pink-600 shadow-lg shadow-pink-200 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      {loading ? (
                        <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      ) : (
                        <>
                          Crear cuenta
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>

            <p className="text-center text-xs text-slate-500 mt-3">
              ¿Ya tienes cuenta?{" "}
              <Link
                href="/login"
                className="font-black text-pink-600 hover:text-pink-700 transition-colors"
              >
                Inicia sesión
              </Link>
            </p>
          </div>
        </main>
      </div>
      <ChipiWidget screenName="register" />
    </>
  );
}