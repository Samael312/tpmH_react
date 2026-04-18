"use client";

import { useState, useRef, useEffect } from "react";
import {
  User, Mail, Globe, Target, CreditCard,
  Lock, Trash2, Eye, EyeOff, Check,
  AlertTriangle, Camera, ChevronDown,
} from "lucide-react";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

// ─── Constantes ───────────────────────────────────────────────────────────────
const TIMEZONES = [
  "America/Caracas", "America/Bogota", "America/Lima",
  "America/Mexico_City", "America/New_York", "America/Los_Angeles",
  "America/Santiago", "America/Buenos_Aires",
  "America/Sao_Paulo", "America/Chicago",
  "Europe/Madrid", "Europe/London", "Europe/Paris",
  "Asia/Tokyo", "Asia/Dubai", "UTC",
];

const GOALS = [
  "Mantener conversaciones básicas sobre temas cotidianos",
  "Mejorar la pronunciación y la fluidez al hablar",
  "Ampliar el vocabulario para situaciones reales",
  "Comprender mejor audios y vídeos en inglés",
  "Prepararse para exámenes oficiales (A1, A2, B1…)",
  "Ganar confianza al participar en conversaciones",
  "Poder viajar al extranjero usando solo inglés",
];

const PAYMENT_METHODS = [
  { value: "Paypal",  label: "PayPal",        icon: "💳" },
  { value: "Binance", label: "Binance (USDT)", icon: "🔶" },
  { value: "Zelle",   label: "Zelle",          icon: "💜" },
];

// ─── Componente de sección ────────────────────────────────────────────────────
function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border
                    border-white shadow-lg shadow-slate-100 p-7">
      <div className="mb-6">
        <h2 className="text-lg font-black text-slate-800 tracking-tight">
          {title}
        </h2>
        {subtitle && (
          <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  );
}

// ─── Input genérico ───────────────────────────────────────────────────────────
function Field({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-[10px] font-black text-slate-400 uppercase
                        tracking-widest block mb-1.5">
        {label}
      </label>
      <div className="relative group">
        {icon && (
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2
                          text-slate-400 group-focus-within:text-pink-500
                          transition-colors pointer-events-none">
            {icon}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

const inputCls = (withIcon = true) =>
  `w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm
   font-bold text-slate-800 placeholder:text-slate-400
   ${withIcon ? "pl-11" : "px-4"} pr-4 py-3.5
   focus:outline-none focus:bg-white focus:border-pink-500
   focus:ring-4 focus:ring-pink-50 transition-all duration-300`;

// ─── Toast interno ────────────────────────────────────────────────────────────
function Toast({ msg, type }: { msg: string; type: "success" | "error" }) {
  return (
    <div className={`
      flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-bold
      animate-in fade-in slide-in-from-top-2 duration-300
      ${type === "success"
        ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
        : "bg-rose-50 text-rose-600 border border-rose-100"
      }
    `}>
      {type === "success"
        ? <Check className="w-4 h-4 flex-shrink-0" />
        : <AlertTriangle className="w-4 h-4 flex-shrink-0" />
      }
      {msg}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function StudentProfilePage() {
  // Auth store sólo tiene username, name, role — nada más
  const { user, token, login, logout } = useAuthStore();

  // Perfil completo traído del backend
  const [profile, setProfile] = useState<any>(null);

  // ── Datos personales (inicializados en useEffect) ──
  const [name, setName]       = useState("");
  const [surname, setSurname] = useState("");
  const [email, setEmail]     = useState("");
  const [timezone, setTz]     = useState("UTC");
  const [goal, setGoal]       = useState("");
  const [payMethods, setPay]  = useState<string[]>([]);

  const [savingInfo, setSavingInfo]     = useState(false);
  const [infoFeedback, setInfoFeedback] =
    useState<{ msg: string; type: "success" | "error" } | null>(null);

  // ── Contraseña ──
  const [oldPw, setOldPw]       = useState("");
  const [newPw, setNewPw]       = useState("");
  const [confirmPw, setConfirm] = useState("");
  const [showOld, setShowOld]   = useState(false);
  const [showNew, setShowNew]   = useState(false);
  const [savingPw, setSavingPw] = useState(false);
  const [pwFeedback, setPwFeedback] =
    useState<{ msg: string; type: "success" | "error" } | null>(null);

  // ── Eliminar cuenta ──
  const [deleteInput, setDeleteInput]     = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting]           = useState(false);

  // ── Avatar ──
  const fileRef                           = useRef<HTMLInputElement>(null);
  const [uploading, setUploading]         = useState(false);
  const [avatarUrl, setAvatarUrl]         = useState<string | null>(null);

  // ── Cargar perfil completo desde /users/me ──
  useEffect(() => {
    api.get("/users/me").then(res => {
      const d = res.data;
      setProfile(d);
      setName(d.name ?? "");
      setSurname(d.surname ?? "");
      setEmail(d.email ?? "");
      setTz(d.student_profile?.timezone ?? d.timezone ?? "UTC");
      setGoal(d.student_profile?.goal ?? d.goal ?? "");
      setPay(d.student_profile?.preferred_payment_methods ??
             d.preferred_payment_methods ?? []);
      setAvatarUrl(d.avatar ?? d.avatar_url ?? null);
    }).catch(() => {});
  }, []);

  const togglePay = (v: string) =>
    setPay(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  // ── Guardar info personal ──
  const saveInfo = async () => {
    setSavingInfo(true);
    setInfoFeedback(null);
    try {
      await api.patch("/users/me", { name, surname, email });
      await api.patch("/users/me/student-profile", {
        timezone,
        goal,
        preferred_payment_methods: payMethods,
      });

      // Actualizar nombre en el auth store (re-usando el token actual)
      if (token && user) {
        login(token, { ...user, name });
      }

      setInfoFeedback({ msg: "Perfil actualizado correctamente", type: "success" });
    } catch (e: any) {
      setInfoFeedback({
        msg: e.response?.data?.detail || "Error al guardar",
        type: "error",
      });
    } finally {
      setSavingInfo(false);
      setTimeout(() => setInfoFeedback(null), 4000);
    }
  };

  // ── Cambiar contraseña ──
  const savePw = async () => {
    if (newPw !== confirmPw) {
      setPwFeedback({ msg: "Las contraseñas no coinciden", type: "error" });
      return;
    }
    if (newPw.length < 8) {
      setPwFeedback({ msg: "La contraseña debe tener al menos 8 caracteres", type: "error" });
      return;
    }
    setSavingPw(true);
    setPwFeedback(null);
    try {
      await api.post("/users/me/change-password", {
        current_password: oldPw,
        new_password: newPw,
      });
      setOldPw(""); setNewPw(""); setConfirm("");
      setPwFeedback({ msg: "Contraseña actualizada", type: "success" });
    } catch (e: any) {
      setPwFeedback({
        msg: e.response?.data?.detail || "Contraseña actual incorrecta",
        type: "error",
      });
    } finally {
      setSavingPw(false);
      setTimeout(() => setPwFeedback(null), 5000);
    }
  };

  // ── Eliminar cuenta ──
  const deleteAccount = async () => {
    if (deleteInput !== user?.username) return;
    setDeleting(true);
    try {
      await api.delete("/users/me");
      logout();
      window.location.href = "/";
    } catch {
      setDeleting(false);
    }
  };

  // ── Subir avatar ──
  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("photo", file);
      const res = await api.patch("/users/me/avatar", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setAvatarUrl(res.data.avatar_url ?? res.data.avatar ?? null);
    } catch {
    } finally {
      setUploading(false);
    }
  };

  const displayName = `${name} ${surname}`.trim() || user?.name || "";
  const initials    = `${name[0] ?? ""}${surname[0] ?? ""}`.toUpperCase() ||
                      (user?.name?.[0] ?? "").toUpperCase();

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">
      {/* Blobs */}
      <div className="fixed top-[-100px] right-[-100px] w-[500px] h-[500px]
                      bg-pink-300/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="fixed bottom-[-80px] left-[-80px] w-[400px] h-[400px]
                      bg-purple-300/15 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative max-w-2xl mx-auto space-y-6
                      animate-in fade-in slide-in-from-bottom-4 duration-500">

        {/* ─── Cabecera de perfil ─── */}
        <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border
                        border-white shadow-lg p-7 flex items-center gap-5">
          {/* Avatar */}
          <div className="relative flex-shrink-0">
            <div className="w-16 h-16 rounded-2xl overflow-hidden bg-gradient-to-br
                            from-pink-400 to-rose-400 flex items-center justify-center
                            shadow-md shadow-pink-100">
              {avatarUrl ? (
                <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                <span className="text-white font-black text-xl">{initials}</span>
              )}
            </div>

            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="absolute -bottom-1 -right-1 w-7 h-7 bg-white
                         border-2 border-pink-200 rounded-xl flex items-center
                         justify-center shadow-sm hover:bg-pink-50 transition-colors"
            >
              {uploading ? (
                <div className="w-3 h-3 border-2 border-pink-200
                                border-t-pink-500 rounded-full animate-spin" />
              ) : (
                <Camera className="w-3 h-3 text-pink-500" />
              )}
            </button>

            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />
          </div>

          <div className="min-w-0">
            <h1 className="text-2xl font-black text-slate-800 tracking-tight">
              {displayName}
            </h1>
            <p className="text-slate-500 text-sm mt-0.5">@{user?.username}</p>
            <span className="inline-block mt-2 text-[10px] font-black uppercase
                             tracking-widest px-3 py-1 rounded-full
                             bg-pink-50 text-pink-600 border border-pink-100">
              Estudiante
            </span>
          </div>
        </div>

        {/* ─── Información personal ─── */}
        <Section
          title="Información personal"
          subtitle="Actualiza tus datos de contacto y preferencias"
        >
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Nombre" icon={<User className="w-5 h-5" />}>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className={inputCls()}
                  placeholder="Tu nombre"
                />
              </Field>
              <Field label="Apellido" icon={<User className="w-5 h-5" />}>
                <input
                  value={surname}
                  onChange={e => setSurname(e.target.value)}
                  className={inputCls()}
                  placeholder="Tu apellido"
                />
              </Field>
            </div>

            <Field label="Correo electrónico" icon={<Mail className="w-5 h-5" />}>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className={inputCls()}
                placeholder="correo@ejemplo.com"
              />
            </Field>

            <Field label="Zona horaria" icon={<Globe className="w-5 h-5" />}>
              <select
                value={timezone}
                onChange={e => setTz(e.target.value)}
                className={`${inputCls()} appearance-none cursor-pointer pr-10`}
              >
                {TIMEZONES.map(tz => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2
                                      w-4 h-4 text-slate-400 pointer-events-none" />
            </Field>

            {/* Objetivo */}
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase
                                tracking-widest block mb-2">
                Objetivo de aprendizaje
              </label>
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {GOALS.map(g => (
                  <button
                    key={g}
                    onClick={() => setGoal(g)}
                    className={`
                      w-full flex items-center gap-3 px-4 py-3 rounded-2xl
                      border-2 text-left transition-all duration-200
                      ${goal === g
                        ? "border-pink-400 bg-pink-50"
                        : "border-slate-100 bg-white hover:border-slate-200"
                      }
                    `}
                  >
                    <div className={`
                      w-4 h-4 rounded-full border-2 flex-shrink-0
                      flex items-center justify-center transition-all
                      ${goal === g ? "border-pink-500 bg-pink-500" : "border-slate-300"}
                    `}>
                      {goal === g && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                    </div>
                    <span className="text-sm font-bold text-slate-700 leading-snug">
                      {g}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Métodos de pago */}
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase
                                tracking-widest block mb-2">
                <CreditCard className="w-3.5 h-3.5 inline mr-1.5" />
                Métodos de pago preferidos
              </label>
              <div className="flex gap-3 flex-wrap">
                {PAYMENT_METHODS.map(pm => (
                  <button
                    key={pm.value}
                    onClick={() => togglePay(pm.value)}
                    className={`
                      flex items-center gap-2 px-4 py-2.5 rounded-xl
                      border-2 text-sm font-bold transition-all duration-200
                      ${payMethods.includes(pm.value)
                        ? "border-pink-400 bg-pink-50 text-pink-700"
                        : "border-slate-100 bg-white text-slate-600 hover:border-slate-200"
                      }
                    `}
                  >
                    <span>{pm.icon}</span>
                    {pm.label}
                    {payMethods.includes(pm.value) && <Check className="w-3.5 h-3.5" />}
                  </button>
                ))}
              </div>
            </div>

            {infoFeedback && <Toast msg={infoFeedback.msg} type={infoFeedback.type} />}

            <button
              onClick={saveInfo}
              disabled={savingInfo}
              className="w-full py-3.5 text-sm font-bold text-white rounded-xl
                         bg-gradient-to-r from-pink-500 to-rose-400
                         shadow-lg shadow-pink-200 hover:shadow-pink-300
                         active:scale-[0.98] transition-all duration-300
                         disabled:opacity-60 disabled:cursor-not-allowed
                         flex items-center justify-center gap-2"
            >
              {savingInfo ? (
                <div className="w-4 h-4 border-2 border-white/40
                                border-t-white rounded-full animate-spin" />
              ) : (
                <><Check className="w-4 h-4" /> Guardar cambios</>
              )}
            </button>
          </div>
        </Section>

        {/* ─── Cambiar contraseña ─── */}
        <Section title="Seguridad" subtitle="Cambia tu contraseña de acceso">
          <div className="space-y-4">
            <Field label="Contraseña actual" icon={<Lock className="w-5 h-5" />}>
              <input
                type={showOld ? "text" : "password"}
                value={oldPw}
                onChange={e => setOldPw(e.target.value)}
                className={inputCls()}
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowOld(p => !p)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2
                           text-slate-400 hover:text-pink-500 transition-colors"
              >
                {showOld ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </Field>

            <Field label="Nueva contraseña" icon={<Lock className="w-5 h-5" />}>
              <input
                type={showNew ? "text" : "password"}
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
                className={inputCls()}
                placeholder="Mínimo 8 caracteres"
              />
              <button
                type="button"
                onClick={() => setShowNew(p => !p)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2
                           text-slate-400 hover:text-pink-500 transition-colors"
              >
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </Field>

            <Field label="Confirmar nueva contraseña" icon={<Lock className="w-5 h-5" />}>
              <input
                type="password"
                value={confirmPw}
                onChange={e => setConfirm(e.target.value)}
                onKeyDown={e => e.key === "Enter" && savePw()}
                className={`${inputCls()} ${
                  confirmPw && confirmPw !== newPw
                    ? "border-rose-300 focus:border-rose-500 focus:ring-rose-50"
                    : ""
                }`}
                placeholder="Repite la nueva contraseña"
              />
            </Field>

            {confirmPw.length > 0 && (
              <p className={`text-xs font-bold flex items-center gap-1.5
                ${confirmPw === newPw ? "text-emerald-600" : "text-rose-500"}`}>
                {confirmPw === newPw
                  ? <><Check className="w-3.5 h-3.5" /> Las contraseñas coinciden</>
                  : <><AlertTriangle className="w-3.5 h-3.5" /> No coinciden</>
                }
              </p>
            )}

            {pwFeedback && <Toast msg={pwFeedback.msg} type={pwFeedback.type} />}

            <button
              onClick={savePw}
              disabled={savingPw || !oldPw || !newPw || newPw !== confirmPw || newPw.length < 8}
              className="w-full py-3.5 text-sm font-bold text-white rounded-xl
                         bg-gradient-to-r from-slate-700 to-slate-800
                         shadow-lg active:scale-[0.98] transition-all duration-300
                         disabled:opacity-50 disabled:cursor-not-allowed
                         flex items-center justify-center gap-2"
            >
              {savingPw ? (
                <div className="w-4 h-4 border-2 border-white/40
                                border-t-white rounded-full animate-spin" />
              ) : (
                <><Lock className="w-4 h-4" /> Actualizar contraseña</>
              )}
            </button>
          </div>
        </Section>

        {/* ─── Zona de peligro ─── */}
        <Section title="Zona de peligro" subtitle="Acciones irreversibles sobre tu cuenta">
          {!confirmDelete ? (
            <div className="bg-rose-50 border-2 border-rose-100 rounded-2xl p-5
                            flex flex-col sm:flex-row items-start sm:items-center
                            justify-between gap-4">
              <div>
                <p className="text-sm font-black text-rose-700">Eliminar mi cuenta</p>
                <p className="text-xs text-rose-500 mt-0.5">
                  Se borrarán todos tus datos, clases y progreso de forma permanente
                </p>
              </div>
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex-shrink-0 px-5 py-2.5 bg-rose-500 text-white
                           text-sm font-bold rounded-xl shadow-md shadow-rose-200
                           hover:bg-rose-600 active:scale-[0.97]
                           transition-all duration-200 flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Eliminar cuenta
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-rose-50 border-2 border-rose-200 rounded-2xl p-5">
                <div className="flex items-start gap-3 mb-4">
                  <AlertTriangle className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-black text-rose-700">
                      ¿Estás absolutamente seguro?
                    </p>
                    <p className="text-xs text-rose-500 mt-1 leading-relaxed">
                      Esta acción no se puede deshacer. Se eliminarán
                      permanentemente tu cuenta, historial de clases,
                      materiales y toda información asociada.
                    </p>
                  </div>
                </div>

                <p className="text-xs font-bold text-slate-600 mb-2">
                  Escribe{" "}
                  <span className="font-black text-rose-600">{user?.username}</span>{" "}
                  para confirmar:
                </p>
                <input
                  value={deleteInput}
                  onChange={e => setDeleteInput(e.target.value)}
                  placeholder={user?.username}
                  className="w-full bg-white border-2 border-rose-200
                             rounded-xl text-sm font-bold text-slate-800
                             placeholder:text-slate-300 px-4 py-3
                             focus:outline-none focus:border-rose-400
                             transition-all duration-200"
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => { setConfirmDelete(false); setDeleteInput(""); }}
                  className="flex-1 py-3 text-sm font-bold text-slate-600
                             bg-slate-100 hover:bg-slate-200 rounded-xl
                             transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={deleteAccount}
                  disabled={deleteInput !== user?.username || deleting}
                  className="flex-1 py-3 text-sm font-bold text-white
                             bg-rose-500 hover:bg-rose-600 rounded-xl
                             shadow-md shadow-rose-200 active:scale-[0.97]
                             transition-all duration-300
                             disabled:opacity-40 disabled:cursor-not-allowed
                             flex items-center justify-center gap-2"
                >
                  {deleting ? (
                    <div className="w-4 h-4 border-2 border-white/40
                                    border-t-white rounded-full animate-spin" />
                  ) : (
                    <><Trash2 className="w-4 h-4" /> Confirmar eliminación</>
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