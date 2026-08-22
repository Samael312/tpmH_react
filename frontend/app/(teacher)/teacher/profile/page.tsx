"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  User, Briefcase, Globe, MapPin, Link2, MessageCircle, Plus,
  X, Check, Save, Upload, Award, BookOpen, ChevronDown, ExternalLink,
  AlertTriangle, Phone, Lock, Eye, EyeOff, Trash2, Edit2, RefreshCw,
  Calendar, Video, Palette, AtSign, Mail
} from "lucide-react";
import { THEME_PRESETS, DEFAULT_THEME_COLOR } from "@/lib/color";
import api from "@/lib/api";
import { useTeacherProfile, TeacherProfile } from "@/hooks/useTeacherData";
import { useAuthStore } from "@/store/authStore";
import ChipiWidget from "@/components/chipi/ChipiWidget";
import CalendarSync from "./CalendarSync";
import { COUNTRY_OPTIONS, DEFAULT_COUNTRY, parsePhoneNumber, CountryInfo, TIMEZONE_OPTIONS } from "@/lib/timezones";
import { NATIONALITIES, getFlagForNationality } from "@/lib/nationalities";
import { useSystemCatalogs } from "@/hooks/useSystemCatalogs";
import { SUBJECTS as FALLBACK_SUBJECTS, LANGUAGES as FALLBACK_LANGUAGES, SKILL_SUGGESTIONS as FALLBACK_SKILLS } from "@/lib/teacherOptions";

const MAX_VIDEO_SIZE_MB = 100;
const ALLOWED_VIDEO_MIME_TYPES = ["video/mp4", "video/quicktime"];

// ─── Helpers ──────────────────────────────────────────────────────────────
function formatErrorMessage(error: any, fallbackMessage: string): string {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    return detail.map((err: any) => err?.msg || JSON.stringify(err)).join(". ");
  }
  if (typeof detail === "object" && detail !== null) return detail.msg || JSON.stringify(detail);
  return fallbackMessage;
}

type TeacherProfileWithPhoto = TeacherProfile & { 
  photo_url?: string | null;
  video_url?: string | null;
  theme_color?: string | null;
  status?: string;
  nationality?: string | null;
};

const inputCls = (withIcon = true) =>
  `w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 placeholder:text-slate-400 ${
    withIcon ? "pl-11" : "px-4"
  } pr-4 py-3.5 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed`;

const inputDif = (withIcon = true) =>
  `w-full bg-slate-200 border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 placeholder:text-slate-400 ${
    withIcon ? "pl-11" : "px-4"
  } pr-4 py-3.5 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed`;

// ─── Iconos redes sociales ────────────────────────────────────────────────
const InstagramIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor" />
  </svg>
);
const YoutubeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
    <path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46a2.78 2.78 0 0 0-1.95 1.96A29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58A2.78 2.78 0 0 0 3.41 19.6C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-1.95A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z" />
    <polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02" fill="currentColor" stroke="none" />
  </svg>
);

// ─── UI base ──────────────────────────────────────────────────────────────
function Toast({ msg, type }: { msg: React.ReactNode; type: "success" | "error" }) {
  const displayMsg = typeof msg === "string" ? msg : msg ? String(msg) : "";
  return (
    <div
      className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-bold animate-in fade-in slide-in-from-top-2 duration-300 ${
        type === "success"
          ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
          : "bg-rose-50 text-rose-600 border border-rose-100"
      }`}
    >
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
            <div className="h-5 w-48 bg-slate-200 rounded-lg animate-pulse" />
            <div className="h-3 w-32 bg-slate-100 rounded-lg animate-pulse" />
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 bg-white/80 rounded-[2rem] border border-white shadow-lg p-7 h-[500px] animate-pulse" />
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-white/80 rounded-[2rem] border border-white shadow-lg p-7 h-[250px] animate-pulse" />
            <div className="bg-white/80 rounded-[2rem] border border-white shadow-lg p-7 h-[180px] animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({
  title, subtitle, icon, action, children,
}: { title: string; subtitle?: string; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white/85 backdrop-blur-xl rounded-[2rem] border border-white shadow-lg shadow-slate-100 p-6 sm:p-7">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-pink-50 flex items-center justify-center flex-shrink-0 text-pink-500">
            {icon}
          </div>
          <div>
            <h2 className="text-lg font-black text-slate-800 tracking-tight">{title}</h2>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
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

function ChipSelector({
  options, selected, onChange, color = "pink", disabled = false,
}: {
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  color?: "pink" | "purple" | "blue";
  disabled?: boolean;
}) {
  const toggle = (v: string) => {
    if (disabled) return;
    onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
  };
  const cls: Record<string, string> = {
    pink: "border-pink-400 bg-pink-50 text-pink-600",
    purple: "border-purple-400 bg-purple-50 text-purple-600",
    blue: "border-blue-400 bg-blue-50 text-blue-600",
  };
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(o => (
        <button
          key={o}
          type="button"
          disabled={disabled}
          onClick={() => toggle(o)}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed ${
            selected.includes(o) ? cls[color] : "border-transparent bg-slate-100 text-slate-500 hover:border-slate-200"
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function FreeChipInput({
  value, onChange, placeholder, suggestions = [], disabled = false,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  suggestions?: string[];
  disabled?: boolean;
}) {
  const [input, setInput] = useState("");
  const add = (text?: string) => {
    if (disabled) return;
    const w = (text ?? input).trim();
    if (!w || value.includes(w)) return;
    onChange([...value, w]);
    setInput("");
  };
  const remove = (w: string) => !disabled && onChange(value.filter(x => x !== w));

  return (
    <div className="space-y-2">
      {!disabled && suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.filter(s => !value.includes(s)).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="px-2.5 py-1 rounded-xl text-[11px] font-bold bg-slate-100 text-slate-500 hover:bg-pink-50 hover:text-pink-600 transition-colors border-2 border-transparent hover:border-pink-200"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
      {!disabled && (
        <div className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && (e.preventDefault(), add())}
            placeholder={placeholder}
            className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-xs font-bold text-slate-800 placeholder:text-slate-400 px-4 py-3 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all"
          />
          <button
            type="button"
            onClick={() => add()}
            className="px-4 bg-pink-50 text-pink-600 hover:bg-pink-100 font-bold rounded-xl transition-colors flex-shrink-0"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      )}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {value.map(w => (
            <span key={w} className="inline-flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 text-xs font-bold px-3 py-1.5 rounded-xl shadow-sm">
              {w}
              {!disabled && (
                <button type="button" onClick={() => remove(w)} className="text-slate-300 hover:text-rose-400 transition-colors">
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function VideoUploadSection({
  teacherStatus,
  videoUrl,
  onUploaded,
}: {
  teacherStatus?: string;
  videoUrl?: string | null;
  onUploaded: () => void;
}) {
  const videoRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFeedback(null);

    if (!ALLOWED_VIDEO_MIME_TYPES.includes(file.type)) {
      setFeedback({ msg: "Formato no permitido. Usa MP4 o MOV.", type: "error" });
      if (videoRef.current) videoRef.current.value = "";
      return;
    }

    if (file.size > MAX_VIDEO_SIZE_MB * 1024 * 1024) {
      setFeedback({
        msg: `El video supera el tamaño máximo permitido de ${MAX_VIDEO_SIZE_MB} MB.`,
        type: "error",
      });
      if (videoRef.current) videoRef.current.value = "";
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await api.post("/teachers/me/video", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setFeedback({ msg: res.data.message || "Video subido con éxito", type: "success" });
      onUploaded();
    } catch (e: any) {
      setFeedback({ msg: e.response?.data?.detail || "Error subiendo el video", type: "error" });
    } finally {
      setUploading(false);
      if (videoRef.current) videoRef.current.value = "";
    }
  };

  const removeVideo = async () => {
    if (!confirm("¿Eliminar tu video de presentación?")) return;
    try {
      await api.delete("/teachers/me/video");
      onUploaded();
    } catch (e: any) {
      setFeedback({ msg: e.response?.data?.detail || "Error eliminando el video", type: "error" });
    }
  };

  return (
    <Section
      title="Video de presentación"
      subtitle="Obligatorio para que tu perfil sea aprobado"
      icon={<Video className="w-5 h-5" />}
    >
      <div className="space-y-4">
        {!videoUrl && (
          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 flex gap-3 items-start">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs font-bold text-amber-700 leading-relaxed">
              Aún no has subido tu video de presentación. Es obligatorio para que el equipo
              pueda aprobar tu perfil y hacerlo visible a los estudiantes.
            </p>
          </div>
        )}

        {videoUrl && teacherStatus !== "approved" && (
          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex gap-3 items-start">
            <AlertTriangle className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs font-bold text-blue-700 leading-relaxed">
              Tu video fue recibido y tu perfil está siendo revisado por el equipo.
            </p>
          </div>
        )}

        {videoUrl && teacherStatus === "approved" && (
          <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 flex gap-3 items-start">
            <Check className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs font-bold text-emerald-700 leading-relaxed">
              Tu video fue aprobado — tu perfil ya es público y los estudiantes pueden encontrarte.
            </p>
          </div>
        )}

        {videoUrl && (
          <div className="rounded-2xl overflow-hidden bg-slate-900 aspect-video max-w-md">
            <video src={videoUrl} controls className="w-full h-full object-contain" />
          </div>
        )}

        {feedback && <Toast msg={feedback.msg} type={feedback.type} />}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => videoRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-4 py-2.5 bg-pink-50 hover:bg-pink-100 text-pink-600 rounded-xl font-bold text-xs border border-pink-100 transition-colors disabled:opacity-60"
          >
            {uploading ? (
              <div className="w-3.5 h-3.5 border-2 border-pink-300 border-t-pink-600 rounded-full animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5" />
            )}
            {videoUrl ? "Reemplazar video" : "Subir video"}
          </button>
          {videoUrl && (
            <button
              type="button"
              onClick={removeVideo}
              className="flex items-center gap-2 px-4 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-500 rounded-xl font-bold text-xs border border-rose-100 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" /> Eliminar
            </button>
          )}
          <input ref={videoRef} type="file" accept="video/mp4,video/quicktime" className="hidden" onChange={handleUpload} />
        </div>
        <p className="text-[11px] text-slate-400 font-bold">Formatos aceptados: MP4, MOV. Máximo 100MB.</p>
      </div>
    </Section>
  );
}

function ThemeColorSection({ initialColor, onSaved }: { initialColor?: string | null; onSaved: () => void }) {
  const [color, setColor] = useState(initialColor || DEFAULT_THEME_COLOR);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    if (initialColor) setColor(initialColor);
  }, [initialColor]);

  const save = async (newColor: string) => {
    setColor(newColor);
    setSaving(true);
    setFeedback(null);
    try {
      await api.patch("/teachers/me/profile", { theme_color: newColor });
      setFeedback({ msg: "Estilo actualizado", type: "success" });
      onSaved();
    } catch (e: any) {
      setFeedback({ msg: e.response?.data?.detail || "Error guardando el estilo", type: "error" });
    } finally {
      setSaving(false);
      setTimeout(() => setFeedback(null), 2500);
    }
  };

  return (
    <Section
      title="Estilo de perfil público"
      subtitle="El color que verán los estudiantes en tu perfil"
      icon={<Palette className="w-5 h-5" />}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3">
          {THEME_PRESETS.map(p => (
            <button
              key={p.value}
              type="button"
              onClick={() => save(p.value)}
              disabled={saving}
              title={p.label}
              className={`w-10 h-10 rounded-2xl border-2 transition-all ${color === p.value ? "border-slate-800 scale-110 shadow-md" : "border-white shadow-sm hover:scale-105"}`}
              style={{ backgroundColor: p.value }}
            />
          ))}
        </div>

        <div className="flex items-center gap-3">
          <input
            type="color"
            value={color}
            onChange={e => save(e.target.value)}
            disabled={saving}
            className="w-12 h-10 rounded-xl border-2 border-slate-200 cursor-pointer bg-transparent"
          />
          <span className="text-xs font-bold text-slate-500">Color personalizado: {color}</span>
        </div>

        {feedback && <Toast msg={feedback.msg} type={feedback.type} />}
      </div>
    </Section>
  );
}

// ─── Componente principal ──────────────────────────────────────────────────
export default function TeacherProfilePage() {
  // Hook llamado dentro del componente
  const { catalogs } = useSystemCatalogs();

  const SUBJECTS = useMemo(
    () => (catalogs.subjects.length ? catalogs.subjects : FALLBACK_SUBJECTS),
    [catalogs.subjects]
  );
  const LANGUAGES = useMemo(
    () => (catalogs.languages.length ? catalogs.languages : FALLBACK_LANGUAGES),
    [catalogs.languages]
  );
  const SKILL_SUGGESTIONS = useMemo(
    () => (catalogs.skill_suggestions.length ? catalogs.skill_suggestions : FALLBACK_SKILLS),
    [catalogs.skill_suggestions]
  );

  const { profile: rawProfile, loading, refetch } = useTeacherProfile();
  const profile = rawProfile as TeacherProfileWithPhoto | null;
  const { logout } = useAuthStore();
  const user = useAuthStore(state => state.user);
  const [nationality, setNationality] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [infoFeedback, setInfoFeedback] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const photoRef = useRef<HTMLInputElement>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Timezone
  const [savedTimezone, setSavedTimezone] = useState("");

  // Campos de formulario
  const [phoneCountry, setPhoneCountry] = useState<CountryInfo>(DEFAULT_COUNTRY);
  const [phoneRest, setPhoneRest] = useState("");
  const [bio, setBio] = useState("");
  const [title_, setTitle_] = useState("");
  const [timezone, setTimezone] = useState("");
  const [languages, setLanguages] = useState<string[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [certificates, setCertificates] = useState<{ title: string; year: string }[]>([]);
  const [socialLinks, setSocialLinks] = useState({ instagram: "", youtube: "", whatsapp: "", website: "" });
  const [initialized, setInitialized] = useState(false);

  // Seguridad
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [savingPw, setSavingPw] = useState(false);
  const [pwFeedback, setPwFeedback] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // Eliminar cuenta
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");
  const [deleting, setDeleting] = useState(false);

  const populateFields = useCallback((prof: TeacherProfileWithPhoto, phoneNum: string) => {
    const { country, rest } = parsePhoneNumber(phoneNum);
    setPhoneCountry(country);
    setPhoneRest(rest);
    setBio(prof.bio ?? "");
    setNationality(prof.nationality ?? "");
    setTitle_(prof.title ?? "");
    setTimezone(prof.timezone ?? "");
    setSavedTimezone(prof.timezone ?? "");
    setLanguages(prof.languages ?? []);
    setSubjects(prof.subjects ?? []);
    setSkills(prof.skills ?? []);
    setCertificates(Array.isArray(prof.certificates) ? prof.certificates : []);
    setSocialLinks({
      instagram: prof.social_links?.instagram ?? "",
      youtube: prof.social_links?.youtube ?? "",
      whatsapp: prof.social_links?.whatsapp ?? "",
      website: prof.social_links?.website ?? "",
    });
  }, []);

  const fetchAll = useCallback(async () => {
    try {
      const res = await api.get("/users/me");
      if (profile) populateFields(profile, res.data.phone_number ?? "");
      if (res.data.avatar) setPhotoUrl(res.data.avatar);
      if (res.data.nationality) setNationality(res.data.nationality);
      setUsername(res.data.username ?? "");  
      setEmail(res.data.email ?? "");           
    } catch {
      if (profile) populateFields(profile, "");
    } finally {
      setInitialized(true);
    }
  }, [profile, populateFields]);

  useEffect(() => {
    if (profile && !initialized) fetchAll();
  }, [profile, initialized, fetchAll]);

  const handleCancelEdit = () => {
    if (profile) fetchAll();
    setIsEditing(false);
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setPhotoPreview(URL.createObjectURL(f));
    setUploadingPhoto(true);
    try {
      const form = new FormData();
      form.append("file", f);

      const resPhoto = await api.post("/users/me/photo", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      if (resPhoto.data?.avatar_url || resPhoto.data?.url) {
        setPhotoUrl(resPhoto.data.avatar_url || resPhoto.data.url);
      }

      refetch();
      setInfoFeedback({ msg: "Foto de perfil actualizada", type: "success" });
    } catch (e: any) {
      setInfoFeedback({ msg: formatErrorMessage(e, "Error subiendo la foto"), type: "error" });
    } finally {
      setUploadingPhoto(false);
      setTimeout(() => setInfoFeedback(null), 3500);
    }
  };

  const addCert = () => setCertificates(p => [...p, { title: "", year: "" }]);
  const updateCert = (idx: number, field: "title" | "year", val: string) =>
    setCertificates(p => p.map((c, i) => (i === idx ? { ...c, [field]: val } : c)));
  const removeCert = (idx: number) => setCertificates(p => p.filter((_, i) => i !== idx));

  const saveInfo = async () => {
    setSaving(true);
    setInfoFeedback(null);
    try {
      const fullPhone = phoneRest.trim() ? `${phoneCountry.dialCode} ${phoneRest.trim()}` : "";
      await api.patch("/users/me", { username, email, phone_number: fullPhone });
      await api.patch("/teachers/me/profile", {
        bio, title: title_, timezone, languages, subjects, skills,
        certificates: certificates.filter(c => c.title.trim()),
        social_links: socialLinks,
        nationality: nationality || null,
      });
      await refetch();
      setSavedTimezone(timezone);
      setInfoFeedback({ msg: "Perfil actualizado correctamente", type: "success" });
      setIsEditing(false);
    } catch (e: any) {
      setInfoFeedback({ msg: formatErrorMessage(e, "Error guardando el perfil"), type: "error" });
    } finally {
      setSaving(false);
      setTimeout(() => setInfoFeedback(null), 4000);
    }
  };

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
      setOldPw(""); setNewPw(""); setConfirmPw("");
      setPwFeedback({ msg: "Contraseña actualizada exitosamente", type: "success" });
    } catch (e: any) {
      setPwFeedback({ msg: formatErrorMessage(e, "Contraseña actual incorrecta"), type: "error" });
    } finally {
      setSavingPw(false);
      setTimeout(() => setPwFeedback(null), 5000);
    }
  };

  const deleteAccount = async () => {
    if (deleteInput !== profile?.user_username) return;
    setDeleting(true);
    try {
      await api.delete("/users/me");
      logout();
      window.location.href = "/";
    } catch {
      setDeleting(false);
    }
  };

  const displayPhoto = photoPreview ?? photoUrl ?? profile?.photo_url ?? null;

  if (loading) return <ProfileSkeleton />;

  return (
    <>
      <div className="min-h-screen bg-slate-50 relative overflow-hidden py-8 px-4 sm:px-6 lg:px-8">
        <div className="fixed top-[-100px] right-[-100px] w-[500px] h-[500px] bg-pink-300/20 rounded-full blur-[120px] pointer-events-none" />
        <div className="fixed bottom-[-80px] left-[-80px] w-[400px] h-[400px] bg-purple-300/15 rounded-full blur-[100px] pointer-events-none" />

        <div className="relative max-w-5xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

          {/* ─── Cabecera ─── */}
          <div className="bg-white/85 backdrop-blur-xl rounded-[2rem] border border-white shadow-lg p-6 sm:p-7 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
            <div className="flex items-center gap-5">
              <div className="relative flex-shrink-0">
                <div
                  onClick={() => photoRef.current?.click()}
                  className="w-20 h-20 rounded-2xl overflow-hidden cursor-pointer group border-2 border-slate-200 hover:border-pink-400 transition-all shadow-md relative bg-gradient-to-br from-pink-400 to-rose-400 flex items-center justify-center"
                >
                  {displayPhoto ? (
                    <img src={displayPhoto} alt="avatar" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-white font-black text-2xl">
                      {profile?.user_username?.[0]?.toUpperCase() ?? "T"}
                    </span>
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    {uploadingPhoto ? (
                      <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Upload className="w-5 h-5 text-white" />
                    )}
                  </div>
                </div>
                <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
              </div>

              <div className="min-w-0">
                <h1 className="text-2xl font-black text-slate-800 tracking-tight truncate">
                  {`${user?.name ?? ""} ${user?.surname ?? ""}`.trim() || "Perfil de Profesor"}
                </h1>
                {title_ && <p className="text-slate-600 text-sm font-bold mt-0.5 truncate">{title_}</p>}
                <p className="text-slate-400 text-xs mt-0.5 truncate">@{profile?.user_username}</p>
                <span className="inline-block mt-2 text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full bg-pink-50 text-pink-600 border border-pink-100">
                  Profesor
                </span>
              </div>
            </div>

            {profile && (
              <a
                href="/teacher/profile/preview"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2.5 bg-white border-2 border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:border-pink-300 hover:text-pink-600 transition-all shadow-sm flex-shrink-0"
              >
                <ExternalLink className="w-4 h-4" />
                Ver perfil público
              </a>
            )}
          </div>

          {infoFeedback && <Toast msg={infoFeedback.msg} type={infoFeedback.type} />}

          {/* ─── Grid Principal ─── */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

            {/* Columna izquierda: Perfil profesional + Video + Estilo */}
            <div className="lg:col-span-7 space-y-6">
              <Section
                title="Perfil Profesional"
                subtitle="Cómo te ven los estudiantes en la plataforma"
                icon={<User className="w-5 h-5" />}
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
                      disabled={saving}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-slate-400 hover:text-slate-600 font-bold text-xs transition-colors disabled:opacity-50"
                    >
                      <X className="w-4 h-4" />
                      Cancelar
                    </button>
                  )
                }
              >
                {!isEditing ? (
                  // Vista de solo lectura
                  <div className="space-y-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <ReadField icon={<AtSign className="w-3.5 h-3.5 text-slate-400" />} label="Usuario" value={username} />
                      <ReadField icon={<Mail className="w-3.5 h-3.5 text-slate-400" />} label="Correo electrónico" value={email} />
                      <ReadField icon={<Briefcase className="w-3.5 h-3.5 text-slate-400" />} label="Título profesional" value={title_} />
                      <ReadField icon={<Phone className="w-3.5 h-3.5 text-slate-400" />} label="Teléfono" value={phoneRest ? `${phoneCountry.dialCode} ${phoneRest}` : ""} />
                      <div className="sm:col-span-2">
                        <ReadField label="Nacionalidad" value={nationality ? `${getFlagForNationality(nationality)} ${nationality}` : ""}/>
                      </div>
                      <div className="sm:col-span-2">
                        <ReadField icon={<Globe className="w-3.5 h-3.5 text-slate-400" />} label="Zona horaria" value={timezone} />
                      </div>
                    </div>

                    <div className="bg-slate-50/80 p-3.5 rounded-2xl border border-slate-100">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Sobre mí</span>
                      <p className="text-sm font-medium text-slate-700 leading-relaxed">{bio || "Sin biografía"}</p>
                    </div>

                    <div className="grid grid-cols-1 gap-3.5">
                      <div className="bg-slate-50/80 p-3.5 rounded-2xl border border-slate-100">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Idiomas</span>
                        <div className="flex flex-wrap gap-1.5">
                          {languages.length ? languages.map(l => (
                            <span key={l} className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700">{l}</span>
                          )) : <span className="text-xs text-slate-400 font-bold">Ninguno seleccionado</span>}
                        </div>
                      </div>
                      <div className="bg-slate-50/80 p-3.5 rounded-2xl border border-slate-100">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Materias</span>
                        <div className="flex flex-wrap gap-1.5">
                          {subjects.length ? subjects.map(s => (
                            <span key={s} className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700">{s}</span>
                          )) : <span className="text-xs text-slate-400 font-bold">Ninguna seleccionada</span>}
                        </div>
                      </div>
                      <div className="bg-slate-50/80 p-3.5 rounded-2xl border border-slate-100">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Habilidades</span>
                        <div className="flex flex-wrap gap-1.5">
                          {skills.length ? skills.map(s => (
                            <span key={s} className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700">{s}</span>
                          )) : <span className="text-xs text-slate-400 font-bold">Ninguna añadida</span>}
                        </div>
                      </div>
                    </div>

                    {certificates.length > 0 && (
                      <div className="bg-slate-50/80 p-3.5 rounded-2xl border border-slate-100">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Certificaciones</span>
                        <div className="space-y-2">
                          {certificates.map((c, i) => (
                            <div key={i} className="flex items-center justify-between bg-white rounded-xl px-3 py-2 border border-slate-100">
                              <span className="text-xs font-bold text-slate-700">{c.title}</span>
                              <span className="text-[10px] font-black text-slate-400">{c.year}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="bg-slate-50/80 p-3.5 rounded-2xl border border-slate-100">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Redes y contacto</span>
                      {Object.values(socialLinks).some(v => v) ? (
                        <div className="flex flex-wrap gap-2">
                          {socialLinks.instagram && <span className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700">IG: {socialLinks.instagram}</span>}
                          {socialLinks.whatsapp && <span className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700">WA: {socialLinks.whatsapp}</span>}
                          {socialLinks.youtube && <span className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700">YouTube</span>}
                          {socialLinks.website && <span className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700">Web</span>}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-400 font-bold">Sin enlaces configurados</p>
                      )}
                    </div>
                  </div>
                ) : (
                  // Vista de edición
                  <div className="space-y-5 animate-in fade-in duration-300">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Nombre de usuario</label>
                        <div className="relative group">
                          <AtSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-pink-500 transition-colors pointer-events-none" />
                          <input
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            disabled={saving}
                            placeholder="usuario123"
                            className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 placeholder:text-slate-400 pl-10 pr-4 py-3 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all disabled:opacity-60"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Correo electrónico</label>
                        <div className="relative group">
                          <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-pink-500 transition-colors pointer-events-none" />
                          <input
                            type="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            disabled={saving}
                            placeholder="correo@ejemplo.com"
                            className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 placeholder:text-slate-400 pl-10 pr-4 py-3 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all disabled:opacity-60"
                          />
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Título profesional</label>
                      <div className="relative group">
                        <Briefcase className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-pink-500 transition-colors pointer-events-none" />
                        <input
                          value={title_}
                          onChange={e => setTitle_(e.target.value)}
                          disabled={saving}
                          placeholder="Ej: Profesora de Inglés Certificada"
                          className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 placeholder:text-slate-400 pl-10 pr-4 py-3 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all disabled:opacity-60"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Sobre mí</label>
                      <textarea
                        value={bio}
                        onChange={e => setBio(e.target.value)}
                        disabled={saving}
                        rows={4}
                        placeholder="Cuéntales a los estudiantes quién eres y tu metodología..."
                        className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-medium text-slate-800 placeholder:text-slate-400 px-4 py-3 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all resize-none disabled:opacity-60"
                      />
                      <p className="text-[11px] text-slate-400 text-right mt-1 font-bold">{bio.length} caracteres</p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
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
                              disabled={saving}
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
                            disabled={saving}
                            placeholder="412 000 0000"
                            className={inputDif(false)}
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
                          disabled={saving}
                          className={`${inputCls(false)} appearance-none cursor-pointer`}
                        >
                          <option value="">Seleccionar...</option>
                          {NATIONALITIES.map(n => (
                            <option key={n.code} value={n.name}>{n.flag} {n.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Zona horaria</label>
                      <div className="relative group">
                        <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                        <select
                          value={timezone}
                          onChange={e => setTimezone(e.target.value)}
                          disabled={saving}
                          className="w-full appearance-none bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 pl-10 pr-10 py-3 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all cursor-pointer disabled:opacity-60"
                        >
                          <option value="">Seleccionar zona horaria...</option>
                          {TIMEZONE_OPTIONS.map(tz => (
                            <option key={tz.value} value={tz.value}>
                              {tz.flag} {tz.label} — {tz.value}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-100 space-y-4">
                      <div className="flex items-center gap-2">
                        <BookOpen className="w-4 h-4 text-purple-500" />
                        <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Qué enseñas</p>
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Idiomas</label>
                        <ChipSelector options={LANGUAGES} selected={languages} onChange={setLanguages} color="pink" disabled={saving} />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Materias / Áreas</label>
                        <ChipSelector options={SUBJECTS} selected={subjects} onChange={setSubjects} color="purple" disabled={saving} />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Habilidades específicas</label>
                        <FreeChipInput value={skills} onChange={setSkills} placeholder="Ej: Conversación fluida, TOEFL..." suggestions={SKILL_SUGGESTIONS} disabled={saving} />
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-100 space-y-3">
                      <div className="flex items-center gap-2">
                        <Award className="w-4 h-4 text-amber-500" />
                        <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Certificaciones</p>
                      </div>
                      {certificates.map((cert, idx) => (
                        <div key={idx} className="flex gap-2.5 items-center bg-slate-50/80 rounded-2xl p-3 border border-slate-100">
                          <div className="flex-1 grid grid-cols-2 gap-2">
                            <input
                              value={cert.title}
                              onChange={e => updateCert(idx, "title", e.target.value)}
                              disabled={saving}
                              placeholder="Nombre del certificado"
                              className="bg-white border-2 border-transparent rounded-xl text-xs font-bold text-slate-800 placeholder:text-slate-400 px-3 py-2.5 focus:outline-none focus:border-pink-500 transition-all disabled:opacity-60"
                            />
                            <input
                              value={cert.year}
                              onChange={e => updateCert(idx, "year", e.target.value)}
                              disabled={saving}
                              placeholder="Año (ej: 2023)"
                              className="bg-white border-2 border-transparent rounded-xl text-xs font-bold text-slate-800 placeholder:text-slate-400 px-3 py-2.5 focus:outline-none focus:border-pink-500 transition-all disabled:opacity-60"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => removeCert(idx)}
                            disabled={saving}
                            className="w-9 h-9 rounded-xl bg-rose-50 text-rose-500 hover:bg-rose-100 flex items-center justify-center transition-colors flex-shrink-0 disabled:opacity-60"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={addCert}
                        disabled={saving}
                        className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-pink-50 text-slate-600 hover:text-pink-600 rounded-xl text-xs font-bold transition-colors disabled:opacity-60"
                      >
                        <Plus className="w-4 h-4" />
                        Añadir certificación
                      </button>
                    </div>

                    <div className="pt-2 border-t border-slate-100 space-y-3.5">
                      <div className="flex items-center gap-2">
                        <Link2 className="w-4 h-4 text-blue-500" />
                        <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Redes y contacto</p>
                      </div>
                      {[
                        { key: "instagram" as const, label: "Instagram", placeholder: "@tuprofe", icon: <InstagramIcon /> },
                        { key: "youtube" as const, label: "YouTube", placeholder: "https://youtube.com/@canal", icon: <YoutubeIcon /> },
                        { key: "whatsapp" as const, label: "WhatsApp", placeholder: "+58 412 000 0000", icon: <MessageCircle className="w-4 h-4" /> },
                        { key: "website" as const, label: "Sitio web", placeholder: "https://tuweb.com", icon: <Globe className="w-4 h-4" /> },
                      ].map(field => (
                        <div key={field.key} className="group">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">{field.label}</label>
                          <div className="relative">
                            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-pink-500 transition-colors">
                              {field.icon}
                            </span>
                            <input
                              value={socialLinks[field.key]}
                              onChange={e => setSocialLinks(p => ({ ...p, [field.key]: e.target.value }))}
                              disabled={saving}
                              placeholder={field.placeholder}
                              className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-xs font-bold text-slate-800 placeholder:text-slate-400 pl-10 pr-4 py-2.5 focus:outline-none focus:bg-white focus:border-pink-500 transition-all disabled:opacity-60"
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex gap-3 pt-2">
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        disabled={saving}
                        className="w-1/3 py-3 text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={saveInfo}
                        disabled={saving}
                        className="w-2/3 py-3 text-sm font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 shadow-lg shadow-pink-200 hover:shadow-pink-300 active:scale-[0.98] transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {saving ? (
                          <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        ) : (
                          <><Check className="w-4 h-4" /> Guardar cambios</>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </Section>

              {/* Video de presentación */}
              <VideoUploadSection
                teacherStatus={profile?.status}
                videoUrl={profile?.video_url}
                onUploaded={refetch}
              />

              {/* Estilo del perfil público */}
              <ThemeColorSection
                initialColor={profile?.theme_color}
                onSaved={refetch}
              />
            </div>

            {/* Columna derecha: Seguridad + Sincronización + Zona de peligro */}
            <div className="lg:col-span-5 space-y-6">

              <Section title="Seguridad" subtitle="Actualiza tu contraseña de acceso" icon={<Lock className="w-5 h-5" />}>
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Contraseña actual</label>
                    <div className="relative group">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type={showOld ? "text" : "password"}
                        value={oldPw}
                        onChange={e => setOldPw(e.target.value)}
                        disabled={savingPw}
                        placeholder="••••••••"
                        className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 pl-10 pr-10 py-3 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all disabled:opacity-60"
                      />
                      <button type="button" onClick={() => setShowOld(p => !p)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-pink-500 transition-colors">
                        {showOld ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Nueva contraseña</label>
                    <div className="relative group">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type={showNew ? "text" : "password"}
                        value={newPw}
                        onChange={e => setNewPw(e.target.value)}
                        disabled={savingPw}
                        placeholder="Mínimo 8 caracteres"
                        className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 pl-10 pr-10 py-3 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all disabled:opacity-60"
                      />
                      <button type="button" onClick={() => setShowNew(p => !p)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-pink-500 transition-colors">
                        {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Confirmar nueva contraseña</label>
                    <input
                      type="password"
                      value={confirmPw}
                      onChange={e => setConfirmPw(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && savePw()}
                      disabled={savingPw}
                      placeholder="Repite la nueva contraseña"
                      className={`w-full bg-slate-50 border-2 rounded-xl text-sm font-bold text-slate-800 px-4 py-3 focus:outline-none transition-all disabled:opacity-60 ${
                        confirmPw && confirmPw !== newPw ? "border-rose-300 focus:border-rose-500 focus:ring-rose-50" : "border-transparent focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50"
                      }`}
                    />
                  </div>

                  {confirmPw.length > 0 && (
                    <p className={`text-xs font-bold flex items-center gap-1.5 ${confirmPw === newPw ? "text-emerald-600" : "text-rose-500"}`}>
                      {confirmPw === newPw ? (<><Check className="w-3.5 h-3.5" /> Las contraseñas coinciden</>) : (<><AlertTriangle className="w-3.5 h-3.5" /> No coinciden</>)}
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

              {/* Sincronización de calendario */}
              <Section title="Calendario" subtitle="Sincroniza tus clases y eventos" icon={<Calendar className="w-5 h-5" />}>
                <CalendarSync />
              </Section>

              {/* Zona de peligro */}
              <Section title="Zona de peligro" subtitle="Acciones irreversibles sobre tu cuenta" icon={<AlertTriangle className="w-5 h-5" />}>
                {!confirmDelete ? (
                  <div className="bg-rose-50/80 border-2 border-rose-100 rounded-2xl p-4 flex flex-col gap-3">
                    <div>
                      <p className="text-sm font-black text-rose-700">Eliminar mi cuenta</p>
                      <p className="text-xs text-rose-500 mt-0.5">
                        Se desactivará tu cuenta y perfil público de forma permanente.
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
                            Esta acción no se puede deshacer fácilmente. Tu perfil dejará de ser visible para estudiantes.
                          </p>
                        </div>
                      </div>
                      <p className="text-xs font-bold text-slate-600 mb-1.5">
                        Escribe <span className="font-black text-rose-600">{profile?.user_username}</span> para confirmar:
                      </p>
                      <input
                        value={deleteInput}
                        onChange={e => setDeleteInput(e.target.value)}
                        placeholder={profile?.user_username}
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
                        disabled={deleteInput !== profile?.user_username || deleting}
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
      <ChipiWidget screenName="teacher_profile" />
    </>
  );
}