"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  User, Mail, Globe, CreditCard, Lock, Trash2, Eye, EyeOff,
  Check, AlertTriangle, Camera, ChevronDown, Phone, Edit2, X, AtSign, RefreshCw
} from "lucide-react";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { COUNTRY_OPTIONS, DEFAULT_COUNTRY, parsePhoneNumber, CountryInfo } from "@/lib/timezones";
import { NATIONALITIES, getFlagForNationality } from "@/lib/nationalities";
import ChipiWidget from "@/components/chipi/ChipiWidget";
import { useSystemCatalogs } from "@/hooks/useSystemCatalogs";
import { 
  GOALS as FALLBACK_GOALS, 
  GOAL_CATEGORIES,
  PAYMENT_METHODS as FALLBACK_METHODS,
  normalizeGoalsCatalog,
  flattenGoals,
} from "@/lib/teacherOptions";
import { useStudentProfileData } from "@/hooks/useStudentData";
import RefreshButton from "@/components/ui/RefreshButton";
import DesktopOnly from "@/components/ui/DesktopOnly";
import { usePageTopBar } from "@/lib/mobileTopBar";
import { useToast } from "@/hooks/useToast";
import { getErrorMessage } from "@/lib/errorMessage";

// ─── Helpers & Formateadores de Errores ──────────────────────────────────────
function formatErrorMessage(error: any, fallbackMessage: string): string {
  const detail = error?.response?.data?.detail;

  if (typeof detail === "string") return detail;

  if (Array.isArray(detail) && detail.length > 0) {
    return detail.map((err: any) => err?.msg || JSON.stringify(err)).join(". ");
  }

  if (typeof detail === "object" && detail !== null) {
    return detail.msg || JSON.stringify(detail);
  }

  return fallbackMessage;
}

// ─── Constantes ───────────────────────────────────────────────────────────────
const DEFAULT_TIMEZONES = [
  "America/Caracas", "America/Bogota", "America/Lima",
  "America/Mexico_City", "America/New_York", "America/Los_Angeles",
  "America/Santiago", "America/Buenos_Aires",
  "America/Sao_Paulo", "America/Chicago",
  "Europe/Madrid", "Europe/London", "Europe/Paris",
  "Asia/Tokyo", "Asia/Dubai", "UTC",
];

const inputCls = (withIcon = true) =>
  `w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 placeholder:text-slate-400 ${
    withIcon ? "pl-11" : "px-4"
  } pr-4 py-3.5 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed`;

// ─── Componentes Auxiliares ───────────────────────────────────────────────────
function Section({
  title, subtitle, action, children,
}: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white/85 backdrop-blur-xl rounded-[2rem] border border-white shadow-lg shadow-slate-100 p-6 sm:p-7">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h2 className="text-lg font-black text-slate-800 tracking-tight">{title}</h2>
          {subtitle && <p className="text-xs sm:text-sm text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Field({
  label, icon, children,
}: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
        {label}
      </label>
      <div className="relative group">
        {icon && (
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-pink-500 transition-colors pointer-events-none">
            {icon}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

function ReadField({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="bg-slate-50/80 p-3.5 rounded-2xl border border-slate-100">
      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">{label}</span>
      <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5 truncate">
        {icon}
        {value || "No especificado"}
      </p>
    </div>
  );
}

function Toast({ msg, type }: { msg: React.ReactNode; type: "success" | "error" }) {
  const displayMsg = typeof msg === "string" ? msg : (msg ? String(msg) : "");

  return (
    <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-bold animate-in fade-in slide-in-from-top-2 duration-300 ${
      type === "success"
        ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
        : "bg-rose-50 text-rose-600 border border-rose-100"
    }`}>
      {type === "success" ? <Check className="w-4 h-4 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
      {displayMsg}
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4 sm:px-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="bg-white/80 rounded-[2rem] border border-white shadow-lg p-7 flex items-center gap-5">
          <div className="w-20 h-20 rounded-2xl bg-slate-200 animate-pulse" />
          <div className="space-y-2 flex-1">
            <div className="h-5 w-40 bg-slate-200 rounded-lg animate-pulse" />
            <div className="h-3 w-24 bg-slate-100 rounded-lg animate-pulse" />
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 bg-white/80 rounded-[2rem] border border-white shadow-lg p-7 h-[450px] animate-pulse" />
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-white/80 rounded-[2rem] border border-white shadow-lg p-7 h-[250px] animate-pulse" />
            <div className="bg-white/80 rounded-[2rem] border border-white shadow-lg p-7 h-[180px] animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Componente Principal ─────────────────────────────────────────────────────
export default function StudentProfilePage() {
  const { catalogs } = useSystemCatalogs();
  const { user, setUser, logout } = useAuthStore();
  const toast = useToast();
  const [nationality, setNationality] = useState("");
  const [profile, setProfile] = useState<any>(null);
  const {
    data: profileQueryData,
    loading: loadingProfile,
    isFetching: fetchingProfile,
    isError: profileHasError,
    refetch: refetchProfile,
  } = useStudentProfileData();
  const loadError = profileHasError ? "No se pudo cargar la información del perfil." : null;
  const [isEditing, setIsEditing] = useState(false);
  const [timezonesList, setTimezonesList] = useState<string[]>(DEFAULT_TIMEZONES);

  // Timezone
  const [savedTimezone, setSavedTimezone] = useState("");

  // Campos de formulario
  const [username, setUsername] = useState("");
  const [name, setName]         = useState("");
  const [surname, setSurname]   = useState("");
  const [email, setEmail]       = useState("");
  const [phoneCountry, setPhoneCountry] = useState<CountryInfo>(DEFAULT_COUNTRY);
  const [phoneRest, setPhoneRest] = useState("");
  const [timezone, setTz]       = useState("UTC");
  const [goal, setGoal]         = useState("");
  const [useCustomGoal, setUseCustomGoal] = useState(false);
  const [payMethods, setPay]    = useState<string[]>([]);
  
  // Feedback e Interacción
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoFeedback, setInfoFeedback] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // Seguridad
  const [oldPw, setOldPw]       = useState("");
  const [newPw, setNewPw]       = useState("");
  const [confirmPw, setConfirm] = useState("");
  const [showOld, setShowOld]   = useState(false);
  const [showNew, setShowNew]   = useState(false);
  const [savingPw, setSavingPw] = useState(false);
  const [pwFeedback, setPwFeedback] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // Eliminar Cuenta
  const [deleteInput, setDeleteInput]     = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting]           = useState(false);

  // Avatar
  const fileRef                   = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // ─── Normalización de opciones ────────────────────────────────────────────────
  // Los objetivos están agrupados por categoría (idiomas vs. otras materias),
  // ya que la plataforma no es solo de idiomas.
  const goalsByCategory = useMemo(
    () => normalizeGoalsCatalog(catalogs.student_goals) ?? FALLBACK_GOALS,
    [catalogs.student_goals]
  );
  const allGoalsFlat = useMemo(() => flattenGoals(goalsByCategory), [goalsByCategory]);

  const [goalCategory, setGoalCategory] = useState<string>(GOAL_CATEGORIES[0].key);

  const normalizedGoals = useMemo(() => {
    const goals = goalsByCategory[goalCategory] ?? [];
    return goals.map(g => (typeof g === "string" ? { text: g, desc: "", icon: "🎯" } : g));
  }, [goalsByCategory, goalCategory]);

  const normalizedPaymentMethods = useMemo(() => {
    const methods = catalogs.student_payment_methods?.length ? catalogs.student_payment_methods : FALLBACK_METHODS;
    return methods.map(pm => typeof pm === "string" ? { value: pm, label: pm, icon: "💳" } : pm);
  }, [catalogs.student_payment_methods]);

  // Normalizador de datos (Maneja fallbacks de API)
  const populateFields = useCallback((userData: any, studentData: any) => {
    setProfile({ ...userData, studentProfile: studentData });
    setNationality(userData.nationality ?? "");
    setUsername(userData.username ?? studentData.user_username ?? user?.username ?? "");
    setName(userData.name ?? "");
    setSurname(userData.surname ?? "");
    setEmail(userData.email ?? "");

    const rawPhone = userData.phone_number ?? userData.phone ?? "";
    const { country, rest } = parsePhoneNumber(rawPhone);
    setPhoneCountry(country);
    setPhoneRest(rest);

    const detectedTz =
      studentData.timezone ||
      Intl.DateTimeFormat().resolvedOptions().timeZone ||
      "UTC";
    setTz(detectedTz);
    setTimezonesList(prev => (prev.includes(detectedTz) ? prev : [detectedTz, ...prev]));
    setSavedTimezone(studentData.timezone || "");

    const loadedGoal = studentData.goal ?? "";
    setGoal(loadedGoal);

    // Buscamos a qué categoría pertenece el goal ya guardado, para abrir
    // esa pestaña por defecto (si no coincide con ninguna, es personalizado).
    const matchedCategory = Object.entries(goalsByCategory).find(([, items]) =>
      items.some(g => (typeof g === "string" ? g : g.text) === loadedGoal)
    );
    setGoalCategory(matchedCategory?.[0] ?? GOAL_CATEGORIES[0].key);

    const isCustom = Boolean(loadedGoal) && !allGoalsFlat
      .some(g => (typeof g === "string" ? g : g.text) === loadedGoal);
      
    setUseCustomGoal(isCustom);
    setPay(studentData.preferred_payment_methods ?? []);

    const photo = userData.avatar_url ?? userData.avatar ?? studentData.profile_photo_url ?? null;
    setAvatarUrl(photo);
  }, [user?.username, goalsByCategory, allGoalsFlat]);

  // ─── Sincroniza el formulario cuando llegan (o se refrescan) los datos ──────
  useEffect(() => {
    if (profileQueryData) {
      populateFields(profileQueryData.user, profileQueryData.studentProfile);
    }
  }, [profileQueryData, populateFields]);

  usePageTopBar({
    title: "Mi Perfil",
    onRefresh: refetchProfile,
    isFetching: fetchingProfile,
  });

  // Handler para alternar métodos de pago
  const togglePay = useCallback((v: string) => {
    setPay(p => (p.includes(v) ? p.filter(x => x !== v) : [...p, v]));
  }, []);

  const handleCancelEdit = useCallback(() => {
    if (profile) {
      populateFields(profile, profile.studentProfile || {});
    }
    setIsEditing(false);
  }, [profile, populateFields]);

  // ─── PATCH: Actualizar Perfil y Student Profile ──────────────────────────────
  const saveInfo = useCallback(async () => {
    const fullPhone = phoneRest.trim() ? `${phoneCountry.dialCode} ${phoneRest.trim()}` : "";
    setSavingInfo(true);
    setInfoFeedback(null);
    try {
      const [userRes, studentRes] = await Promise.all([
        api.patch("/users/me", {
          username,
          name,
          surname,
          email,
          phone_number: fullPhone,
          nationality,
        }),
        api.patch("/users/me/student-profile", {
          timezone,
          goal,
          preferred_payment_methods: payMethods,
        }),
      ]);

      const updatedUserData = userRes.data || {};
      const updatedStudentData = studentRes.data || {};
      populateFields(updatedUserData, updatedStudentData);


      if (setUser && user) {
        setUser({
          ...user,
          username: updatedUserData.username ?? username,
          name: updatedUserData.name ?? name,
          surname: updatedUserData.surname ?? surname,
          email: updatedUserData.email ?? email,
          phone_number: updatedUserData.phone_number ?? fullPhone,
          nationality: updatedUserData.nationality ?? nationality,
          ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
        });
      }

      setInfoFeedback({ msg: "Perfil actualizado correctamente", type: "success" });
      setIsEditing(false);
      refetchProfile();
    } catch (e: any) {
      setInfoFeedback({
        msg: formatErrorMessage(e, "Error al guardar los cambios"),
        type: "error",
      });
    } finally {
      setSavingInfo(false);
      setTimeout(() => setInfoFeedback(null), 4000);
    }
  }, [timezone, username, name, surname, email, phoneCountry.dialCode, phoneRest, nationality, goal, payMethods, populateFields, user, setUser, avatarUrl, refetchProfile]);

  // ─── POST: Cambiar Contraseña ────────────────────────────────────────────────
  const savePw = useCallback(async () => {
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
      setPwFeedback({ msg: "Contraseña actualizada exitosamente", type: "success" });
    } catch (e: any) {
      setPwFeedback({
        msg: formatErrorMessage(e, "Contraseña actual incorrecta"),
        type: "error",
      });
    } finally {
      setSavingPw(false);
      setTimeout(() => setPwFeedback(null), 5000);
    }
  }, [oldPw, newPw, confirmPw]);

  // ─── DELETE: Eliminar cuenta ────────────────────────────────────────────────
  const deleteAccount = useCallback(async () => {
    const currentUsername = username || user?.username;
    if (deleteInput !== currentUsername) return;
    setDeleting(true);
    try {
      await api.delete("/users/me");
      logout();
      window.location.href = "/";
    } catch (e) {
      toast.error(getErrorMessage(e, "No se pudo eliminar la cuenta"));
      setDeleting(false);
    }
  }, [deleteInput, username, user?.username, logout]);

  // ─── PATCH: Subir Foto de Perfil ─────────────────────────────────────────────
  const handleAvatarChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);

      const res = await api.patch("/users/me/avatar", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const newAvatarUrl = res.data.avatar_url ?? res.data.avatar ?? null;
      setAvatarUrl(newAvatarUrl);

      if (setUser && user) {
        setUser({ ...user, avatar_url: newAvatarUrl });
      }
      refetchProfile();
      toast.success("Foto de perfil actualizada correctamente");
    } catch (e: any) {
      setInfoFeedback({
        msg: formatErrorMessage(e, "Error al subir la imagen"),
        type: "error"
      });
    } finally {
      setUploading(false);
    }
  }, [user, setUser, refetchProfile]);

  const displayName = useMemo(
    () => `${name} ${surname}`.trim() || user?.name || "Estudiante",
    [name, surname, user?.name]
  );
  const initials = useMemo(
    () => (`${name[0] ?? ""}${surname[0] ?? ""}`.toUpperCase() || (user?.name?.[0] ?? "E").toUpperCase()),
    [name, surname, user?.name]
  );

  if (loadingProfile) return <ProfileSkeleton />;

  if (loadError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-3xl shadow-lg text-center max-w-md border border-slate-100">
          <AlertTriangle className="w-12 h-12 text-rose-500 mx-auto mb-4" />
          <h2 className="text-xl font-black text-slate-800 mb-2">Error al cargar perfil</h2>
          <p className="text-slate-500 text-sm mb-6">{loadError}</p>
          <button
            onClick={() => refetchProfile()}
            className="inline-flex items-center gap-2 px-6 py-3 bg-pink-500 hover:bg-pink-600 text-white rounded-xl font-bold text-sm shadow-md transition-all active:scale-95"
          >
            <RefreshCw className="w-4 h-4" />
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="min-h-screen bg-slate-50 relative overflow-hidden py-8 px-4 sm:px-6 lg:px-8">

      <div className="fixed top-[-100px] right-[-100px] w-[500px] h-[500px] bg-pink-300/25 rounded-full blur-[120px] pointer-events-none" />
      <div className="fixed bottom-[-80px] left-[-80px] w-[400px] h-[400px] bg-purple-300/20 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative max-w-5xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

        {/* ─── Cabecera de Perfil ─── */}
        <div className="bg-white/85 backdrop-blur-xl rounded-[2rem] border border-white shadow-lg p-6 sm:p-7 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
          <div className="flex items-center gap-5">
            <div className="relative flex-shrink-0">
              <div className="w-20 h-20 rounded-2xl overflow-hidden bg-gradient-to-br from-pink-400 to-rose-400 flex items-center justify-center shadow-md shadow-pink-100">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" loading="lazy" />
                ) : (
                  <span className="text-white font-black text-2xl">{initials}</span>
                )}
              </div>

              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="absolute -bottom-1 -right-1 w-8 h-8 bg-white border-2 border-pink-200 rounded-xl flex items-center justify-center shadow-sm hover:bg-pink-50 active:scale-95 transition-all disabled:opacity-60"
                title="Cambiar foto de perfil"
              >
                {uploading ? (
                  <div className="w-3.5 h-3.5 border-2 border-pink-200 border-t-pink-500 rounded-full animate-spin" />
                ) : (
                  <Camera className="w-4 h-4 text-pink-500" />
                )}
              </button>

              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
            </div>

            <div className="min-w-0">
              <h1 className="text-2xl font-black text-slate-800 tracking-tight truncate">{displayName}</h1>
              <p className="text-slate-500 text-sm mt-0.5 truncate">@{username || user?.username}</p>
              <span className="inline-block mt-2 text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full bg-pink-50 text-pink-600 border border-pink-100">
                Estudiante
              </span>
            </div>
          </div>

          <DesktopOnly>
            <RefreshButton onRefresh={refetchProfile} isFetching={fetchingProfile} />
          </DesktopOnly>
        </div>

        {/* ─── Grid Principal (2 Columnas) ─── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* Columna Izquierda: Información Personal */}
          <div className="lg:col-span-7 space-y-6">
            <Section
              title="Información Personal"
              subtitle="Tus datos de cuenta, contacto y preferencias"
              action={
                !isEditing ? (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-pink-50 hover:bg-pink-100 text-pink-600 rounded-xl font-bold text-xs border border-pink-100 transition-colors active:scale-95"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    Editar perfil
                  </button>
                ) : (
                  <button
                    onClick={handleCancelEdit}
                    disabled={savingInfo}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-slate-400 hover:text-slate-600 font-bold text-xs transition-colors disabled:opacity-50"
                  >
                    <X className="w-4 h-4" />
                    Cancelar
                  </button>
                )
              }
            >
              {infoFeedback && <div className="mb-4"><Toast msg={infoFeedback.msg} type={infoFeedback.type} /></div>}

              {!isEditing ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <ReadField icon={<AtSign className="w-3.5 h-3.5 text-slate-400" />} label="Usuario" value={username} />
                    <ReadField label="Nombre completo" value={displayName} />
                    <ReadField icon={<Mail className="w-3.5 h-3.5 text-slate-400" />} label="Correo electrónico" value={email} />
                    <ReadField icon={<Phone className="w-3.5 h-3.5 text-slate-400" />} label="Teléfono" value={phoneRest ? `${phoneCountry.dialCode} ${phoneRest}` : ""} />
                    <div className="sm:col-span-2">
                      <ReadField label="Nacionalidad" value={nationality ? `${getFlagForNationality(nationality)} ${nationality}` : ""}/>
                    </div>
                    <div className="sm:col-span-2">
                      <ReadField icon={<Globe className="w-3.5 h-3.5 text-slate-400" />} label="Zona horaria" value={timezone} />
                    </div>
                  </div>

                  <div className="bg-slate-50/80 p-3.5 rounded-2xl border border-slate-100">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                      Objetivo de aprendizaje
                    </span>
                    <p className="text-sm font-bold text-slate-800">{goal || "Sin objetivo seleccionado"}</p>
                  </div>

                  <div className="bg-slate-50/80 p-3.5 rounded-2xl border border-slate-100">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">
                      Métodos de pago preferidos
                    </span>
                    {payMethods.length > 0 ? (
                      <div className="flex gap-2 flex-wrap">
                        {payMethods.map(pm => {
                          const item = normalizedPaymentMethods.find(p => p.value === pm);
                          return (
                            <span key={pm} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-xl border border-slate-200 text-xs font-bold text-slate-700 shadow-sm">
                              <span>{item?.icon || "💳"}</span>
                              {item?.label || pm}
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm font-bold text-slate-400">Ningún método preferido seleccionado</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-4 animate-in fade-in duration-300">
                  <Field label="Nombre de usuario" icon={<AtSign className="w-5 h-5" />}>
                    <input value={username} onChange={e => setUsername(e.target.value)} className={inputCls()} placeholder="usuario123" disabled={savingInfo} />
                  </Field>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <Field label="Nombre" icon={<User className="w-5 h-5" />}>
                      <input value={name} onChange={e => setName(e.target.value)} className={inputCls()} placeholder="Tu nombre" disabled={savingInfo} />
                    </Field>
                    <Field label="Apellido" icon={<User className="w-5 h-5" />}>
                      <input value={surname} onChange={e => setSurname(e.target.value)} className={inputCls()} placeholder="Tu apellido" disabled={savingInfo} />
                    </Field>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <Field label="Correo electrónico" icon={<Mail className="w-5 h-5" />}>
                      <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls()} placeholder="correo@ejemplo.com" disabled={savingInfo} />
                    </Field>
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                      Teléfono
                    </label>
                    <div className="flex gap-2">
                      <div className="relative w-28 flex-shrink-0">
                        <div className="w-full h-full bg-slate-50 border-2 border-transparent rounded-xl px-3 py-3.5 flex items-center justify-between pointer-events-none font-bold text-slate-800">
                          <span className="text-lg leading-none">{phoneCountry.flag}</span>
                          <span className="text-sm font-black text-slate-600">{phoneCountry.dialCode}</span>
                        </div>
                        <select
                          value={phoneCountry.dialCode}
                          onChange={e => {
                            const sel = COUNTRY_OPTIONS.find(c => c.dialCode === e.target.value);
                            if (sel) setPhoneCountry(sel);
                          }}
                          disabled={savingInfo}
                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                        >
                          {COUNTRY_OPTIONS.map((c, i) => (
                            <option key={i} value={c.dialCode}>{c.flag} {c.dialCode}</option>
                          ))}
                        </select>
                      </div>
                      <input
                        type="tel"
                        value={phoneRest}
                        onChange={e => setPhoneRest(e.target.value)}
                        disabled={savingInfo}
                        placeholder="412 000 0000"
                        className={inputCls(false)}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                      Nacionalidad
                    </label>
                    <select
                      value={nationality}
                      onChange={e => setNationality(e.target.value)}
                      disabled={savingInfo}
                      className={`${inputCls(false)} appearance-none cursor-pointer`}
                    >
                      <option value="">Seleccionar...</option>
                      {NATIONALITIES.map(n => (
                        <option key={n.code} value={n.name}>{n.flag} {n.name}</option>
                      ))}
                    </select>
                  </div>

                  <Field label="Zona horaria" icon={<Globe className="w-5 h-5" />}>
                    <select
                      value={timezone}
                      onChange={e => setTz(e.target.value)}
                      disabled={savingInfo}
                      className={`${inputCls()} appearance-none cursor-pointer pr-10`}
                    >
                      {timezonesList.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                    </select>
                    <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  </Field>

                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">
                      Objetivo de aprendizaje
                    </label>

                    {/* Selector de categoría: idiomas vs. otras materias */}
                    <div className="flex gap-1.5 mb-2">
                      {GOAL_CATEGORIES.map(cat => (
                        <button
                          key={cat.key}
                          type="button"
                          disabled={savingInfo}
                          onClick={() => setGoalCategory(cat.key)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold border-2 transition-all duration-200 disabled:opacity-60 ${
                            goalCategory === cat.key
                              ? "border-pink-400 bg-pink-50 text-pink-700"
                              : "border-slate-100 bg-white text-slate-500 hover:border-slate-200"
                          }`}
                        >
                          <span>{cat.icon}</span> {cat.label}
                        </button>
                      ))}
                    </div>

                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {normalizedGoals.map(g => (
                        <button
                          type="button"
                          key={g.text}
                          onClick={() => { setUseCustomGoal(false); setGoal(g.text); }}
                          disabled={savingInfo}
                          className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl border-2 text-left transition-all duration-200 disabled:opacity-60 ${
                            !useCustomGoal && goal === g.text ? "border-pink-400 bg-pink-50" : "border-slate-100 bg-white hover:border-slate-200"
                          }`}
                        >
                          <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all ${
                            !useCustomGoal && goal === g.text ? "border-pink-500 bg-pink-500" : "border-slate-300"
                          }`}>
                            {!useCustomGoal && goal === g.text && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                          </div>
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-slate-700 leading-snug">
                              {g.icon && <span className="mr-1.5">{g.icon}</span>}
                              {g.text}
                            </span>
                            {g.desc && <span className="text-[10px] text-slate-500 mt-0.5">{g.desc}</span>}
                          </div>
                        </button>
                      ))}

                      {/* Opción de objetivo personalizado */}
                      <button
                        type="button"
                        onClick={() => { setUseCustomGoal(true); if (normalizedGoals.some(g => g.text === goal)) setGoal(""); }}
                        disabled={savingInfo}
                        className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl border-2 text-left transition-all duration-200 disabled:opacity-60 ${
                          useCustomGoal ? "border-pink-400 bg-pink-50" : "border-slate-100 bg-white hover:border-slate-200"
                        }`}
                      >
                        <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all ${
                          useCustomGoal ? "border-pink-500 bg-pink-500" : "border-slate-300"
                        }`}>
                          {useCustomGoal && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                        </div>
                        <span className="text-xs font-bold text-slate-700 leading-snug">
                          ✍️ Otro objetivo (personalizado)
                        </span>
                      </button>
                    </div>

                    {useCustomGoal && (
                      <div className="mt-2.5 animate-in fade-in slide-in-from-top-2 duration-300">
                        <textarea
                          value={goal}
                          onChange={e => setGoal(e.target.value)}
                          disabled={savingInfo}
                          rows={3}
                          placeholder="Describe tu objetivo personalizado..."
                          className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-xs font-bold text-slate-800 placeholder:text-slate-400 px-4 py-3 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all duration-300 resize-none disabled:opacity-60"
                        />
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">
                      <CreditCard className="w-3.5 h-3.5 inline mr-1.5" />
                      Métodos de pago preferidos
                    </label>
                    <div className="flex gap-2.5 flex-wrap">
                      {normalizedPaymentMethods.map(pm => (
                        <button
                          type="button"
                          key={pm.value}
                          onClick={() => togglePay(pm.value)}
                          disabled={savingInfo}
                          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border-2 text-xs font-bold transition-all duration-200 disabled:opacity-60 ${
                            payMethods.includes(pm.value)
                              ? "border-pink-400 bg-pink-50 text-pink-700"
                              : "border-slate-100 bg-white text-slate-600 hover:border-slate-200"
                          }`}
                        >
                          <span>{pm.icon}</span>
                          {pm.label}
                          {payMethods.includes(pm.value) && <Check className="w-3.5 h-3.5" />}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={handleCancelEdit}
                      disabled={savingInfo}
                      className="w-1/3 py-3 text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={saveInfo}
                      disabled={savingInfo || !username.trim() || !name.trim()}
                      className="w-2/3 py-3 text-sm font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 shadow-lg shadow-pink-200 hover:shadow-pink-300 active:scale-[0.98] transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {savingInfo ? (
                        <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      ) : (
                        <><Check className="w-4 h-4" /> Guardar cambios</>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </Section>
          </div>

          {/* Columna Derecha: Seguridad y Zona de peligro */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* ─── Seguridad ─── */}
            <Section title="Seguridad" subtitle="Actualiza tu contraseña de acceso">
              <div className="space-y-4">
                <Field label="Contraseña actual" icon={<Lock className="w-5 h-5" />}>
                  <input type={showOld ? "text" : "password"} value={oldPw} onChange={e => setOldPw(e.target.value)} className={inputCls()} placeholder="••••••••" disabled={savingPw} />
                  <button type="button" onClick={() => setShowOld(p => !p)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-pink-500 transition-colors">
                    {showOld ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </Field>

                <Field label="Nueva contraseña" icon={<Lock className="w-5 h-5" />}>
                  <input type={showNew ? "text" : "password"} value={newPw} onChange={e => setNewPw(e.target.value)} className={inputCls()} placeholder="Mínimo 8 caracteres" disabled={savingPw} />
                  <button type="button" onClick={() => setShowNew(p => !p)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-pink-500 transition-colors">
                    {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </Field>

                <Field label="Confirmar nueva contraseña" icon={<Lock className="w-5 h-5" />}>
                  <input
                    type="password"
                    value={confirmPw}
                    onChange={e => setConfirm(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && savePw()}
                    disabled={savingPw}
                    className={`${inputCls()} ${confirmPw && confirmPw !== newPw ? "border-rose-300 focus:border-rose-500 focus:ring-rose-50" : ""}`}
                    placeholder="Repite la nueva contraseña"
                  />
                </Field>

                {confirmPw.length > 0 && (
                  <p className={`text-xs font-bold flex items-center gap-1.5 ${confirmPw === newPw ? "text-emerald-600" : "text-rose-500"}`}>
                    {confirmPw === newPw
                      ? <><Check className="w-3.5 h-3.5" /> Las contraseñas coinciden</>
                      : <><AlertTriangle className="w-3.5 h-3.5" /> No coinciden</>}
                  </p>
                )}

                {pwFeedback && <Toast msg={pwFeedback.msg} type={pwFeedback.type} />}

                <button
                  onClick={savePw}
                  disabled={savingPw || !oldPw || !newPw || newPw !== confirmPw || newPw.length < 8}
                  className="w-full py-3 text-sm font-bold text-white rounded-xl bg-gradient-to-r from-slate-700 to-slate-800 shadow-lg active:scale-[0.98] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {savingPw ? (
                    <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  ) : (
                    <><Lock className="w-4 h-4" /> Actualizar contraseña</>
                  )}
                </button>
              </div>
            </Section>

            {/* ─── Zona de peligro ─── */}
            <Section title="Zona de peligro" subtitle="Acciones irreversibles sobre tu cuenta">
              {!confirmDelete ? (
                <div className="bg-rose-50/80 border-2 border-rose-100 rounded-2xl p-4 flex flex-col gap-3">
                  <div>
                    <p className="text-sm font-black text-rose-700">Eliminar mi cuenta</p>
                    <p className="text-xs text-rose-500 mt-0.5">
                      Se borrarán todos tus datos, clases y progreso de forma permanente.
                    </p>
                  </div>
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="w-full py-2.5 bg-rose-500 text-white text-xs font-bold rounded-xl shadow-md shadow-rose-200 hover:bg-rose-600 active:scale-[0.97] transition-all duration-200 flex items-center justify-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Eliminar cuenta
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-rose-50 border-2 border-rose-200 rounded-2xl p-4">
                    <div className="flex items-start gap-2.5 mb-3">
                      <AlertTriangle className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-black text-rose-700">¿Estás absolutamente seguro?</p>
                        <p className="text-[11px] text-rose-500 mt-0.5 leading-relaxed">
                          Esta acción no se puede deshacer. Se eliminarán permanentemente tu cuenta, historial y clases.
                        </p>
                      </div>
                    </div>

                    <p className="text-xs font-bold text-slate-600 mb-1.5">
                      Escribe <span className="font-black text-rose-600">{username || user?.username}</span> para confirmar:
                    </p>
                    <input
                      value={deleteInput}
                      onChange={e => setDeleteInput(e.target.value)}
                      placeholder={username || user?.username}
                      className="w-full bg-white border-2 border-rose-200 rounded-xl text-xs font-bold text-slate-800 placeholder:text-slate-300 px-3.5 py-2.5 focus:outline-none focus:border-rose-400 transition-all duration-200"
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => { setConfirmDelete(false); setDeleteInput(""); }}
                      className="flex-1 py-2.5 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={deleteAccount}
                      disabled={deleteInput !== (username || user?.username) || deleting}
                      className="flex-1 py-2.5 text-xs font-bold text-white bg-rose-500 hover:bg-rose-600 rounded-xl shadow-md shadow-rose-200 active:scale-[0.97] transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {deleting ? (
                        <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      ) : (
                        <><Trash2 className="w-3.5 h-3.5" /> Confirmar</>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </Section>

          </div>

        </div>

      </div>
    </div>
    <ChipiWidget screenName="student_profile" />
    </>
  );
}