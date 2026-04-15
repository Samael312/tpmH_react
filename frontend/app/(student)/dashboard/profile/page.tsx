"use client";

import { useState, useEffect } from "react";
import {
  User, Globe, Target, CreditCard,
  Lock, Trash2, Check, X, Eye,
  EyeOff, ChevronDown, AlertCircle, Save
} from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { useEnrollments } from "@/hooks/useStudentData";
import api from "@/lib/api";

const TIMEZONES = [
  "America/Caracas","America/Bogota","America/Lima",
  "America/Mexico_City","America/New_York","America/Los_Angeles",
  "America/Santiago","America/Buenos_Aires",
  "Europe/Madrid","Europe/London","Europe/Paris","UTC",
];

const GOALS = [
  "Mantener conversaciones básicas sobre temas cotidianos",
  "Mejorar la pronunciación y la fluidez al hablar",
  "Ampliar el vocabulario para situaciones reales",
  "Comprender mejor audios y vídeos en inglés",
  "Escribir mensajes y correos sin errores comunes",
  "Aprender y usar correctamente los tiempos verbales",
  "Prepararse para exámenes oficiales (A1, A2, B1…)",
  "Ganar confianza al participar en conversaciones",
  "Poder viajar al extranjero usando solo inglés",
];

const PAYMENT_METHODS = ["Paypal", "Binance", "Zelle"];

// ─── Sección con título ───────────────────────────────────────────────────────
function Section({
  title,
  icon,
  children,
  accentClass = "bg-pink-50 text-pink-500",
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  accentClass?: string;
}) {
  return (
    <div
      className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white
                    shadow-2xl shadow-slate-200/50 p-6 sm:p-8"
    >
      <div className="flex items-center gap-3 mb-6">
        <div
          className={`w-9 h-9 rounded-xl flex items-center justify-center
                          flex-shrink-0 ${accentClass}`}
        >
          {icon}
        </div>
        <h2 className="text-lg font-black text-slate-800 tracking-tight">
          {title}
        </h2>
      </div>
      {children}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function StudentProfilePage() {
  const { user, setUser } = useAuthStore();
  const { enrollments }   = useEnrollments();

  // ─ Datos personales ─
  const [name, setName]         = useState(user?.name ?? "");
  const [surname, setSurname]   = useState(user?.surname ?? "");
  const [email, setEmail]       = useState(user?.email ?? "");
  const [timezone, setTimezone] = useState(user?.timezone ?? "");
  const [goal, setGoal]         = useState(user?.goal ?? "");
  const [payMethods, setPayMethods] = useState<string[]>(
    user?.preferred_payment_methods ?? []
  );
  const [savingInfo, setSavingInfo] = useState(false);
  const [savedInfo, setSavedInfo]   = useState(false);
  const [infoError, setInfoError]   = useState("");

  // ─ Cambio de contraseña ─
  const [currentPw, setCurrentPw]   = useState("");
  const [newPw, setNewPw]           = useState("");
  const [confirmPw, setConfirmPw]   = useState("");
  const [showPw, setShowPw]         = useState(false);
  const [savingPw, setSavingPw]     = useState(false);
  const [savedPw, setSavedPw]       = useState(false);
  const [pwError, setPwError]       = useState("");

  // ─ Eliminar cuenta ─
  const [showDelete, setShowDelete]     = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting]         = useState(false);
  const [deleteError, setDeleteError]   = useState("");

  const activeEnrollment = enrollments.find((e) => e.status === "active");

  const togglePayMethod = (m: string) =>
    setPayMethods((p) =>
      p.includes(m) ? p.filter((x) => x !== m) : [...p, m]
    );

  // ─── Guardar info personal ───
  const saveInfo = async () => {
    setSavingInfo(true);
    setInfoError("");
    try {
      const res = await api.patch("/users/me/student-profile", {
        timezone,
        goal,
        preferred_payment_methods: payMethods,
      });
      // También actualizamos nombre si cambió
      if (name !== user?.name || surname !== user?.surname) {
        await api.patch("/users/me", { name, surname });
      }
      setSavedInfo(true);
      setTimeout(() => setSavedInfo(false), 2500);
    } catch (e: any) {
      setInfoError(e.response?.data?.detail || "Error guardando los cambios");
    } finally {
      setSavingInfo(false);
    }
  };

  // ─── Cambiar contraseña ───
  const changePassword = async () => {
    setPwError("");
    if (newPw !== confirmPw) {
      setPwError("Las contraseñas no coinciden");
      return;
    }
    if (newPw.length < 8) {
      setPwError("La contraseña debe tener al menos 8 caracteres");
      return;
    }
    setSavingPw(true);
    try {
      await api.post("/users/me/change-password", {
        current_password: currentPw,
        new_password:     newPw,
      });
      setSavedPw(true);
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
      setTimeout(() => setSavedPw(false), 2500);
    } catch (e: any) {
      setPwError(e.response?.data?.detail || "Error cambiando la contraseña");
    } finally {
      setSavingPw(false);
    }
  };

  // ─── Eliminar cuenta ───
  const deleteAccount = async () => {
    if (deleteConfirm !== user?.username) {
      setDeleteError("El usuario no coincide");
      return;
    }
    setDeleting(true);
    try {
      await api.delete("/users/me");
      useAuthStore.getState().logout();
      window.location.href = "/login";
    } catch (e: any) {
      setDeleteError(e.response?.data?.detail || "Error eliminando la cuenta");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">
      {/* Blobs */}
      <div
        className="fixed top-[-80px] right-[-80px] w-[500px] h-[500px]
                      bg-pink-300/20 rounded-full blur-[100px] pointer-events-none"
      />
      <div
        className="fixed bottom-[-80px] left-[-80px] w-[400px] h-[400px]
                      bg-purple-300/15 rounded-full blur-[100px] pointer-events-none"
      />

      <div className="relative max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">
            Mi Perfil
          </h1>
          <p className="text-slate-500 mt-1">
            Gestiona tu información y preferencias
          </p>
        </div>

        {/* ─── Banner plan activo ─── */}
        {activeEnrollment && (
          <div
            className="bg-gradient-to-r from-pink-500 to-rose-400 rounded-[2rem]
                          p-6 text-white relative overflow-hidden shadow-xl
                          shadow-pink-200 animate-in fade-in duration-500 delay-100"
          >
            <div
              className="absolute top-[-30px] right-[-30px] w-32 h-32
                            bg-white/10 rounded-full blur-xl"
            />
            <p className="text-[10px] font-black uppercase tracking-widest text-white/70 mb-1">
              Plan activo
            </p>
            <p className="text-2xl font-black">{activeEnrollment.package_name}</p>
            <div className="flex items-center justify-between mt-3">
              <p className="text-white/80 text-sm">
                {activeEnrollment.subject}
              </p>
              <p className="text-white font-black">
                {activeEnrollment.classes_used}
                <span className="text-white/60 font-bold text-sm">
                  /{activeEnrollment.classes_total} clases
                </span>
              </p>
            </div>
            <div className="mt-3 w-full h-1.5 bg-white/30 rounded-full overflow-hidden">
              <div
                className="h-full bg-white rounded-full"
                style={{
                  width: `${Math.min(
                    (activeEnrollment.classes_used /
                      activeEnrollment.classes_total) *
                      100,
                    100
                  )}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* ─── Info personal ─── */}
        <Section
          title="Información Personal"
          icon={<User className="w-5 h-5" />}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Nombre */}
              <div className="group">
                <label
                  className="text-[10px] font-black text-slate-400
                                uppercase tracking-widest block mb-1.5"
                >
                  Nombre
                </label>
                <div className="relative">
                  <User
                    className="absolute left-3.5 top-1/2 -translate-y-1/2
                                   w-5 h-5 text-slate-400
                                   group-focus-within:text-pink-500
                                   transition-colors"
                  />
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-slate-50 border-2 border-transparent
                                 rounded-xl text-sm font-bold text-slate-800
                                 placeholder:text-slate-400 pl-11 pr-4 py-3.5
                                 focus:outline-none focus:bg-white
                                 focus:border-pink-500 focus:ring-4 focus:ring-pink-50
                                 transition-all duration-300"
                  />
                </div>
              </div>

              {/* Apellido */}
              <div className="group">
                <label
                  className="text-[10px] font-black text-slate-400
                                uppercase tracking-widest block mb-1.5"
                >
                  Apellido
                </label>
                <div className="relative">
                  <User
                    className="absolute left-3.5 top-1/2 -translate-y-1/2
                                   w-5 h-5 text-slate-400
                                   group-focus-within:text-pink-500
                                   transition-colors"
                  />
                  <input
                    value={surname}
                    onChange={(e) => setSurname(e.target.value)}
                    className="w-full bg-slate-50 border-2 border-transparent
                                 rounded-xl text-sm font-bold text-slate-800
                                 placeholder:text-slate-400 pl-11 pr-4 py-3.5
                                 focus:outline-none focus:bg-white
                                 focus:border-pink-500 focus:ring-4 focus:ring-pink-50
                                 transition-all duration-300"
                  />
                </div>
              </div>
            </div>

            {/* Email (readonly) */}
            <div>
              <label
                className="text-[10px] font-black text-slate-400
                              uppercase tracking-widest block mb-1.5"
              >
                Email
              </label>
              <div className="relative">
                <input
                  value={email}
                  readOnly
                  className="w-full bg-slate-100 border-2 border-transparent
                               rounded-xl text-sm font-bold text-slate-400
                               px-4 py-3.5 cursor-not-allowed"
                />
                <span
                  className="absolute right-3 top-1/2 -translate-y-1/2
                                text-[10px] font-black text-slate-400 uppercase
                                tracking-widest bg-slate-200 px-2 py-1 rounded-lg"
                >
                  No editable
                </span>
              </div>
            </div>

            {/* Zona horaria */}
            <div>
              <label
                className="text-[10px] font-black text-slate-400
                              uppercase tracking-widest block mb-1.5"
              >
                Zona horaria
              </label>
              <div className="relative">
                <Globe
                  className="absolute left-3.5 top-1/2 -translate-y-1/2
                                 w-5 h-5 text-slate-400 pointer-events-none"
                />
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full appearance-none bg-slate-50 border-2
                               border-transparent rounded-xl text-sm font-bold
                               text-slate-800 pl-11 pr-10 py-3.5
                               focus:outline-none focus:bg-white
                               focus:border-pink-500 focus:ring-4 focus:ring-pink-50
                               transition-all duration-300 cursor-pointer"
                >
                  <option value="">Seleccionar...</option>
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="absolute right-3.5 top-1/2 -translate-y-1/2
                                  w-4 h-4 text-slate-400 pointer-events-none"
                />
              </div>
              <p className="text-xs text-slate-400 mt-1.5">
                Se usa para mostrarte los horarios en tu hora local
              </p>
            </div>

            {/* Objetivo */}
            <div>
              <label
                className="text-[10px] font-black text-slate-400
                              uppercase tracking-widest block mb-1.5"
              >
                Objetivo de aprendizaje
              </label>
              <div className="relative">
                <Target
                  className="absolute left-3.5 top-3.5 w-5 h-5 text-slate-400
                                 pointer-events-none"
                />
                <select
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  className="w-full appearance-none bg-slate-50 border-2
                               border-transparent rounded-xl text-sm font-bold
                               text-slate-800 pl-11 pr-10 py-3.5
                               focus:outline-none focus:bg-white
                               focus:border-pink-500 focus:ring-4 focus:ring-pink-50
                               transition-all duration-300 cursor-pointer"
                >
                  <option value="">Seleccionar objetivo...</option>
                  {GOALS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="absolute right-3.5 top-1/2 -translate-y-1/2
                                  w-4 h-4 text-slate-400 pointer-events-none"
                />
              </div>
            </div>

            {/* Métodos de pago */}
            <div>
              <label
                className="text-[10px] font-black text-slate-400
                              uppercase tracking-widest block mb-3"
              >
                Métodos de pago preferidos
              </label>
              <div className="flex gap-3 flex-wrap">
                {PAYMENT_METHODS.map((m) => (
                  <button
                    key={m}
                    onClick={() => togglePayMethod(m)}
                    className={`
                      flex items-center gap-2 px-4 py-2.5 rounded-xl
                      border-2 text-sm font-bold transition-all duration-200
                      ${
                        payMethods.includes(m)
                          ? "border-pink-400 bg-pink-50 text-pink-600"
                          : "border-slate-100 bg-white text-slate-500 hover:border-slate-200"
                      }
                    `}
                  >
                    <CreditCard className="w-4 h-4" />
                    {m}
                    {payMethods.includes(m) && (
                      <Check className="w-3.5 h-3.5" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Error */}
            {infoError && (
              <div
                className="bg-rose-50 border border-rose-100 text-rose-600
                              px-4 py-3 rounded-xl text-xs font-bold
                              flex items-center gap-2"
              >
                <X className="w-4 h-4 flex-shrink-0" />
                {infoError}
              </div>
            )}

            {/* Botón guardar */}
            <button
              onClick={saveInfo}
              disabled={savingInfo}
              className={`
                w-full py-3.5 text-sm font-bold text-white rounded-xl
                shadow-lg active:scale-[0.98] transition-all duration-300
                disabled:opacity-50 disabled:cursor-not-allowed
                flex items-center justify-center gap-2
                ${
                  savedInfo
                    ? "bg-emerald-500 shadow-emerald-200"
                    : "bg-gradient-to-r from-pink-500 to-rose-400 shadow-pink-200 hover:shadow-pink-300"
                }
              `}
            >
              {savingInfo ? (
                <div
                  className="w-4 h-4 border-2 border-white/40
                                border-t-white rounded-full animate-spin"
                />
              ) : savedInfo ? (
                <>
                  <Check className="w-4 h-4" /> ¡Guardado!
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" /> Guardar cambios
                </>
              )}
            </button>
          </div>
        </Section>

        {/* ─── Cambiar contraseña ─── */}
        <Section
          title="Cambiar Contraseña"
          icon={<Lock className="w-5 h-5" />}
          accentClass="bg-blue-50 text-blue-500"
        >
          <div className="space-y-4">
            {/* Contraseña actual */}
            <div className="group">
              <label
                className="text-[10px] font-black text-slate-400
                              uppercase tracking-widest block mb-1.5"
              >
                Contraseña actual
              </label>
              <div className="relative">
                <Lock
                  className="absolute left-3.5 top-1/2 -translate-y-1/2
                                 w-5 h-5 text-slate-400
                                 group-focus-within:text-pink-500 transition-colors"
                />
                <input
                  type={showPw ? "text" : "password"}
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-50 border-2 border-transparent
                               rounded-xl text-sm font-bold text-slate-800
                               placeholder:text-slate-400 pl-11 pr-11 py-3.5
                               focus:outline-none focus:bg-white
                               focus:border-pink-500 focus:ring-4 focus:ring-pink-50
                               transition-all duration-300"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((p) => !p)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2
                               text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showPw ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Nueva contraseña */}
            <div className="group">
              <label
                className="text-[10px] font-black text-slate-400
                              uppercase tracking-widest block mb-1.5"
              >
                Nueva contraseña
              </label>
              <div className="relative">
                <Lock
                  className="absolute left-3.5 top-1/2 -translate-y-1/2
                                 w-5 h-5 text-slate-400
                                 group-focus-within:text-pink-500 transition-colors"
                />
                <input
                  type={showPw ? "text" : "password"}
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                  className="w-full bg-slate-50 border-2 border-transparent
                               rounded-xl text-sm font-bold text-slate-800
                               placeholder:text-slate-400 pl-11 pr-4 py-3.5
                               focus:outline-none focus:bg-white
                               focus:border-pink-500 focus:ring-4 focus:ring-pink-50
                               transition-all duration-300"
                />
              </div>
            </div>

            {/* Confirmar */}
            <div className="group">
              <label
                className="text-[10px] font-black text-slate-400
                              uppercase tracking-widest block mb-1.5"
              >
                Confirmar nueva contraseña
              </label>
              <div className="relative">
                <Lock
                  className="absolute left-3.5 top-1/2 -translate-y-1/2
                                 w-5 h-5 text-slate-400
                                 group-focus-within:text-pink-500 transition-colors"
                />
                <input
                  type={showPw ? "text" : "password"}
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  placeholder="Repetir contraseña"
                  className={`w-full bg-slate-50 border-2 rounded-xl text-sm
                               font-bold text-slate-800 placeholder:text-slate-400
                               pl-11 pr-4 py-3.5 focus:outline-none focus:bg-white
                               focus:ring-4 transition-all duration-300
                               ${
                                 confirmPw && confirmPw !== newPw
                                   ? "border-red-300 focus:border-red-400 focus:ring-red-50"
                                   : "border-transparent focus:border-pink-500 focus:ring-pink-50"
                               }`}
                />
                {confirmPw && confirmPw === newPw && (
                  <Check
                    className="absolute right-3.5 top-1/2 -translate-y-1/2
                                   w-4 h-4 text-emerald-500"
                  />
                )}
              </div>
            </div>

            {/* Error contraseña */}
            {pwError && (
              <div
                className="bg-rose-50 border border-rose-100 text-rose-600
                              px-4 py-3 rounded-xl text-xs font-bold
                              flex items-center gap-2"
              >
                <X className="w-4 h-4 flex-shrink-0" />
                {pwError}
              </div>
            )}

            <button
              onClick={changePassword}
              disabled={savingPw || !currentPw || !newPw || !confirmPw}
              className={`
                w-full py-3.5 text-sm font-bold rounded-xl
                shadow-lg active:scale-[0.98] transition-all duration-300
                disabled:opacity-50 disabled:cursor-not-allowed
                flex items-center justify-center gap-2
                ${
                  savedPw
                    ? "bg-emerald-500 text-white shadow-emerald-200"
                    : "bg-blue-500 hover:bg-blue-600 text-white shadow-blue-200"
                }
              `}
            >
              {savingPw ? (
                <div
                  className="w-4 h-4 border-2 border-white/40
                                border-t-white rounded-full animate-spin"
                />
              ) : savedPw ? (
                <>
                  <Check className="w-4 h-4" /> ¡Contraseña actualizada!
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" /> Cambiar contraseña
                </>
              )}
            </button>
          </div>
        </Section>

        {/* ─── Zona de peligro ─── */}
        <Section
          title="Zona de Peligro"
          icon={<Trash2 className="w-5 h-5" />}
          accentClass="bg-red-50 text-red-500"
        >
          {!showDelete ? (
            <div className="flex items-start gap-4">
              <div className="flex-1">
                <p className="text-sm font-bold text-slate-700 mb-1">
                  Eliminar cuenta
                </p>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Se borrarán todos tus datos, clases, materiales y tareas.
                  Esta acción es permanente e irreversible.
                </p>
              </div>
              <button
                onClick={() => setShowDelete(true)}
                className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5
                             bg-red-50 text-red-500 hover:bg-red-100 border-2
                             border-red-200 text-sm font-bold rounded-xl
                             transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Eliminar
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div
                className="bg-red-50 border border-red-100 rounded-xl p-4
                              flex items-start gap-3"
              >
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-red-700 mb-1">
                    ¿Estás completamente seguro?
                  </p>
                  <p className="text-xs text-red-600">
                    Para confirmar, escribe tu nombre de usuario:{" "}
                    <span className="font-black">{user?.username}</span>
                  </p>
                </div>
              </div>

              <div className="group">
                <input
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  placeholder={user?.username ?? ""}
                  className="w-full bg-slate-50 border-2 border-red-200
                               rounded-xl text-sm font-bold text-slate-800
                               placeholder:text-slate-400 px-4 py-3.5
                               focus:outline-none focus:bg-white
                               focus:border-red-400 focus:ring-4 focus:ring-red-50
                               transition-all duration-300"
                />
              </div>

              {deleteError && (
                <div
                  className="bg-rose-50 border border-rose-100 text-rose-600
                                px-4 py-3 rounded-xl text-xs font-bold
                                flex items-center gap-2"
                >
                  <X className="w-4 h-4 flex-shrink-0" />
                  {deleteError}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowDelete(false);
                    setDeleteConfirm("");
                    setDeleteError("");
                  }}
                  className="flex-1 py-3 text-sm font-bold text-slate-600
                               bg-slate-100 hover:bg-slate-200 rounded-xl
                               transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={deleteAccount}
                  disabled={deleting || deleteConfirm !== user?.username}
                  className="flex-1 py-3 text-sm font-bold text-white
                               bg-red-500 hover:bg-red-600 rounded-xl
                               shadow-md shadow-red-100 active:scale-[0.98]
                               transition-all duration-200 disabled:opacity-50
                               disabled:cursor-not-allowed flex items-center
                               justify-center gap-2"
                >
                  {deleting ? (
                    <div
                      className="w-4 h-4 border-2 border-white/40
                                    border-t-white rounded-full animate-spin"
                    />
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4" /> Eliminar para siempre
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </Section>

      </div>
    </div>
  );
}