"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Package as PackageIcon, Plus, X, Check, Edit2,
  Trash2, Users, ChevronDown, RefreshCw, AlertTriangle,
} from "lucide-react";
import api from "@/lib/api";
import ChipiWidget from "@/components/chipi/ChipiWidget";
import { SUBJECTS, LANGUAGES } from "@/lib/teacherOptions";
import { getSuggestedTheme, ICON_PICKER_OPTIONS, DEFAULT_PACKAGE_THEME } from "@/lib/packageThemes";
import { THEME_PRESETS } from "@/lib/color";

interface Package {
  id: number;
  name: string;
  subject: string;
  description: string | null;
  description_type: "paragraph" | "list";
  description_items: string[] | null;
  icon: string;
  color: string;
  classes_count: number | null;
  price: number;
  duration_minutes: number;
  is_active: boolean;
}

interface EnrollmentCompliance {
  id: number;
  student_id: number;
  student_username: string;
  student_name: string;
  package_id: number;
  package_name: string;
  classes_used: number;
  classes_total: number | null;
  status: string;
  completed_count: number;
  no_show_count: number;
  cancelled_late_count: number;
  renewal_requested_package_name: string | null;
  change_requested_package_name: string | null;
  created_at: string;
}

const DURATIONS = [30, 60];

const emptyForm = {
  name: "", subject: "", description: "",
  description_type: "paragraph" as "paragraph" | "list",
  description_items: [] as string[],
  icon: DEFAULT_PACKAGE_THEME.icon,
  color: DEFAULT_PACKAGE_THEME.color,
  classes_count: "4", price: "10", duration_minutes: 60,
};

const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  completed: "bg-slate-100 text-slate-500",
  pending_renewal: "bg-amber-100 text-amber-700",
  pending_package_change: "bg-blue-100 text-blue-700",
  cancelled: "bg-red-100 text-red-600",
};
const STATUS_LABEL: Record<string, string> = {
  active: "Activo",
  completed: "Agotado",
  pending_renewal: "Renovación pendiente",
  pending_package_change: "Cambio de paquete pendiente",
  cancelled: "Cancelado",
};

export default function TeacherPackagesPage() {
  const [kind, setKind] = useState<"subject" | "language">("subject");
  const [unlimited, setUnlimited] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [packages, setPackages] = useState<Package[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentCompliance[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [descItemInput, setDescItemInput] = useState("");
  const [themeTouched, setThemeTouched] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const formRef = useRef<HTMLDivElement>(null);

  const scrollToForm = () => {
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [pkgRes, enrRes] = await Promise.all([
        api.get("/packages/my-packages"),
        api.get("/packages/teacher/enrollments"),
      ]);
      setPackages(pkgRes.data);
      setEnrollments(enrRes.data);
    } catch {
      /* silencioso */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
    scrollToForm();
  };

  const openEdit = (pkg: Package) => {
    setEditingId(pkg.id);
    setUnlimited(pkg.classes_count === null);
    setKind(LANGUAGES.includes(pkg.subject) ? "language" : "subject");
    setThemeTouched(true);
    setForm({
      name: pkg.name,
      subject: pkg.subject,
      description: pkg.description ?? "",
      description_type: pkg.description_type ?? "paragraph",
      description_items: pkg.description_items ?? [],
      icon: pkg.icon || DEFAULT_PACKAGE_THEME.icon,
      color: pkg.color || DEFAULT_PACKAGE_THEME.color,
      classes_count: String(pkg.classes_count),
      price: String(pkg.price),
      duration_minutes: pkg.duration_minutes,
    });
    setShowForm(true);
    scrollToForm();
  };

  const savePackage = async () => {
    if (!form.name.trim() || !form.subject.trim()) return;

    const classesCountNum = unlimited ? null : parseInt(form.classes_count, 10);
    const priceNum = parseFloat(form.price);

    if (!unlimited && (!Number.isFinite(classesCountNum) || classesCountNum! < 1)) {
      setError("Introduce un número de clases válido (mínimo 1), o marca 'Ilimitadas'");
      return;
    }
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      setError("Introduce un precio válido (mayor que 0)");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const payload = {
        name: form.name,
        subject: form.subject,
        description: form.description_type === "paragraph" ? form.description : null,
        description_type: form.description_type,
        description_items: form.description_type === "list" ? form.description_items : null,
        icon: form.icon,
        color: form.color,
        classes_count: classesCountNum,
        price: priceNum,
        duration_minutes: form.duration_minutes,
      };
      if (editingId) {
        await api.patch(`/packages/${editingId}`, payload);
      } else {
        await api.post("/packages/", payload);
      }
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm);
      setUnlimited(false);
      await fetchAll();
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 3000);
    } catch (e: any) {
      setError(e.response?.data?.detail || "Error guardando el paquete");
    } finally {
      setSaving(false);
    }
  };

  const deactivatePackage = async (id: number) => {
    if (!confirm("¿Desactivar este paquete? Los estudiantes con enrollments activos no se ven afectados.")) return;
    try {
      await api.delete(`/packages/${id}`);
      fetchAll();
    } catch (e: any) {
      alert(e.response?.data?.detail || "Error desactivando el paquete");
    }
  };

  const approveRenewal = async (enrollmentId: number) => {
    setApprovingId(enrollmentId);
    try {
      await api.post(`/packages/${enrollmentId}/activate-renewal`);
      fetchAll();
    } catch (e: any) {
      alert(e.response?.data?.detail || "Error activando la renovación");
    } finally {
      setApprovingId(null);
    }
  };

  const approvePackageChange = async (enrollmentId: number) => {
  setApprovingId(enrollmentId);
  try {
    await api.post(`/packages/${enrollmentId}/approve-package-change`);
    fetchAll();
  } catch (e: any) {
    alert(e.response?.data?.detail || "Error aprobando el cambio de paquete");
  } finally {
    setApprovingId(null);
  }
};

  const pendingRenewals = enrollments.filter(e => e.status === "pending_renewal");

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">
      <div className="fixed top-[-100px] right-[-100px] w-[500px] h-[500px] bg-pink-300/20 rounded-full blur-[100px] pointer-events-none" />
      <div className="fixed bottom-[-100px] left-[-100px] w-[400px] h-[400px] bg-purple-300/15 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-slate-800 tracking-tight">Mis Paquetes</h1>
            <p className="text-slate-500 mt-1">
              Crea tus paquetes de clases y da seguimiento al cumplimiento de tus estudiantes
            </p>
          </div>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-pink-500 to-rose-400
                       text-white text-sm font-bold rounded-xl shadow-lg shadow-pink-200
                       hover:shadow-pink-300 active:scale-[0.98] transition-all duration-200"
          >
            <Plus className="w-4 h-4" /> Nuevo paquete
          </button>
        </div>

        {/* Alerta de renovaciones pendientes */}
        {pendingRenewals.length > 0 && (
          <div className="bg-amber-50 border border-amber-100 rounded-2xl px-5 py-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
            <p className="text-sm font-bold text-amber-700">
              Tienes {pendingRenewals.length} solicitud{pendingRenewals.length !== 1 ? "es" : ""} de renovación
              esperando tu aprobación (revisa la tabla de abajo).
            </p>
          </div>
        )}

        {/* Form crear/editar */}
        {showForm && (
          <div ref={formRef} className="bg-white/85 backdrop-blur-xl rounded-[2rem] border border-white
                          shadow-2xl shadow-slate-200/50 p-6 sm:p-8 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-black text-slate-800">
                {editingId ? "Editar paquete" : "Nuevo paquete"}
              </h2>
              <button
                onClick={() => setShowForm(false)}
                className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>

            {error && (
              <div className="bg-rose-50 border border-rose-100 text-rose-600 px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-2">
                <X className="w-4 h-4 flex-shrink-0" /> {error}
              </div>
            )}
            {savedOk && (
              <div className="bg-emerald-50 border border-emerald-100 text-emerald-600 px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-2">
                <Check className="w-4 h-4 flex-shrink-0" /> Paquete guardado correctamente
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                  Nombre del paquete
                </label>
                <input
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="Ej: Paquete Intensivo B1"
                  className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold
                             text-slate-800 placeholder:text-slate-400 px-4 py-3 focus:outline-none
                             focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                  ¿Qué vas a enseñar?
                </label>
                <div className="flex gap-2 mb-2.5">
                  {[
                    { key: "subject", label: "Una materia" },
                    { key: "language", label: "Un idioma" },
                  ].map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => { setKind(opt.key as any); setForm({ ...form, subject: "" }); }}
                      className={`px-4 py-2 rounded-xl text-xs font-bold border-2 transition-all
                        ${kind === opt.key ? "border-pink-400 bg-pink-50 text-pink-600" : "border-slate-100 bg-slate-50 text-slate-500"}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <select
                    value={form.subject}
                    onChange={e => {
                      const subject = e.target.value;
                      setForm(prev => {
                        const next = { ...prev, subject };
                        if (!editingId && !themeTouched) {
                          const suggested = getSuggestedTheme(subject);
                          next.icon = suggested.icon;
                          next.color = suggested.color;
                        }
                        return next;
                      });
                    }}
                    className="w-full appearance-none bg-slate-50 border-2 border-transparent rounded-xl
                              text-sm font-bold text-slate-800 px-4 py-3 focus:outline-none focus:bg-white
                              focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all cursor-pointer"
                  >
                    <option value="">{kind === "subject" ? "Selecciona una materia..." : "Selecciona un idioma..."}</option>
                    {(kind === "subject" ? SUBJECTS : LANGUAGES).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    Número de clases
                  </label>
                  <button
                    type="button"
                    onClick={() => setUnlimited(p => !p)}
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-colors
                      ${unlimited ? "bg-pink-500 text-white" : "bg-slate-100 text-slate-500"}`}
                  >
                    {unlimited ? "✓ Ilimitadas" : "Marcar ilimitadas"}
                  </button>
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  disabled={unlimited}
                  value={unlimited ? "" : form.classes_count}
                  onChange={e => {
                    const v = e.target.value;
                    if (v === "" || /^[0-9]*$/.test(v)) setForm({ ...form, classes_count: v });
                  }}
                  placeholder={unlimited ? "Ilimitadas" : "Ej: 8"}
                  className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold
                            text-slate-800 placeholder:text-slate-400 px-4 py-3 focus:outline-none focus:bg-white
                            focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all disabled:opacity-50"
                />
              </div>

              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                  Precio total ($)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.price}
                  onChange={e => {
                    const v = e.target.value;
                    if (v === "" || /^[0-9]*\.?[0-9]*$/.test(v)) {
                      setForm({ ...form, price: v });
                    }
                  }}
                  placeholder="Ej: 50.00"
                  className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold
                             text-slate-800 placeholder:text-slate-400 px-4 py-3 focus:outline-none focus:bg-white
                             focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all"
                />
              </div>

              {/* ─── Tipo de descripción ─── */}
              <div className="sm:col-span-2 space-y-3">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">
                  Formato de la descripción
                </label>
                <div className="flex gap-2">
                  {[
                    { key: "paragraph", label: "Párrafo" },
                    { key: "list", label: "Lista de puntos" },
                  ].map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setForm({ ...form, description_type: opt.key as "paragraph" | "list" })}
                      className={`px-4 py-2 rounded-xl text-xs font-bold border-2 transition-all
                        ${form.description_type === opt.key ? "border-pink-400 bg-pink-50 text-pink-600" : "border-slate-100 bg-slate-50 text-slate-500"}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {form.description_type === "paragraph" ? (
                  <textarea
                    value={form.description}
                    onChange={e => setForm({ ...form, description: e.target.value })}
                    rows={3}
                    placeholder="Qué incluye este paquete..."
                    className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-medium
                               text-slate-800 placeholder:text-slate-400 px-4 py-3 focus:outline-none
                               focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50
                               transition-all resize-none"
                  />
                ) : (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input
                        value={descItemInput}
                        onChange={e => setDescItemInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const v = descItemInput.trim();
                            if (v) {
                              setForm({ ...form, description_items: [...form.description_items, v] });
                              setDescItemInput("");
                            }
                          }
                        }}
                        placeholder="Ej: Material incluido — presiona Enter"
                        className="flex-1 bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold
                                   text-slate-800 placeholder:text-slate-400 px-4 py-2.5 focus:outline-none
                                   focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const v = descItemInput.trim();
                          if (v) {
                            setForm({ ...form, description_items: [...form.description_items, v] });
                            setDescItemInput("");
                          }
                        }}
                        className="px-4 bg-pink-50 text-pink-600 hover:bg-pink-100 font-bold rounded-xl transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                    {form.description_items.length > 0 && (
                      <ul className="space-y-1.5">
                        {form.description_items.map((item, idx) => (
                          <li key={idx} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
                            <span className="text-xs font-bold text-slate-700 flex items-center gap-2">
                              <Check className="w-3.5 h-3.5 text-emerald-500" /> {item}
                            </span>
                            <button
                              type="button"
                              onClick={() => setForm({ ...form, description_items: form.description_items.filter((_, i) => i !== idx) })}
                              className="text-slate-300 hover:text-rose-400"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              {/* ─── Personalización visual ─── */}
              <div className="sm:col-span-2 space-y-4 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    Personalización visual
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const suggested = getSuggestedTheme(form.subject);
                      setForm({ ...form, icon: suggested.icon, color: suggested.color });
                      setThemeTouched(false);
                    }}
                    className="text-[10px] font-bold text-pink-500 hover:text-pink-600"
                  >
                    Sugerir según materia
                  </button>
                </div>

                {/* Icono */}
                <div>
                  <p className="text-xs font-bold text-slate-500 mb-2">Icono</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ICON_PICKER_OPTIONS.map(ic => (
                      <button
                        key={ic}
                        type="button"
                        onClick={() => { setForm({ ...form, icon: ic }); setThemeTouched(true); }}
                        className={`w-9 h-9 rounded-xl text-base flex items-center justify-center border-2 transition-all
                          ${form.icon === ic ? "border-pink-400 bg-pink-50 scale-110" : "border-transparent bg-slate-50 hover:bg-slate-100"}`}
                      >
                        {ic}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Color */}
                <div>
                  <p className="text-xs font-bold text-slate-500 mb-2">Color</p>
                  <div className="flex flex-wrap gap-2">
                    {THEME_PRESETS.map(p => (
                      <button
                        key={p.value}
                        type="button"
                        title={p.label}
                        onClick={() => { setForm({ ...form, color: p.value }); setThemeTouched(true); }}
                        className={`w-8 h-8 rounded-xl border-2 transition-all
                          ${form.color === p.value ? "border-slate-800 scale-110" : "border-white shadow-sm hover:scale-105"}`}
                        style={{ backgroundColor: p.value }}
                      />
                    ))}
                    <input
                      type="color"
                      value={form.color}
                      onChange={e => { setForm({ ...form, color: e.target.value }); setThemeTouched(true); }}
                      className="w-8 h-8 rounded-xl border-2 border-slate-200 cursor-pointer bg-transparent"
                    />
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={savePackage}
              disabled={saving || !form.name.trim() || !form.subject.trim()}
              className="w-full py-3.5 text-sm font-bold text-white rounded-xl
                         bg-gradient-to-r from-pink-500 to-rose-400 hover:from-pink-600 hover:to-rose-500
                         shadow-lg shadow-pink-200 active:scale-[0.98] transition-all duration-300
                         disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? (
                <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <><Check className="w-4 h-4" /> {editingId ? "Guardar cambios" : "Crear paquete"}</>
              )}
            </button>
          </div>
        )}

        {/* Lista de paquetes */}
        <div className="space-y-4">
          <h2 className="text-lg font-black text-slate-800">Paquetes ({packages.length})</h2>
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => <div key={i} className="h-40 bg-white rounded-2xl animate-pulse" />)}
            </div>
          ) : packages.length === 0 ? (
            <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-lg py-16 text-center">
              <PackageIcon className="w-10 h-10 text-slate-200 mx-auto mb-3" />
              <p className="text-slate-500 font-bold">Aún no has creado ningún paquete</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
  {packages.map(pkg => {
    const accent = pkg.color || "#ec4899";
    const priceSuffix =
      pkg.classes_count === 1 ? "/clase" :
      pkg.classes_count === null ? "/ilimitado" :
      "/clase";
    const priceDisplay = Number.isInteger(pkg.price) ? pkg.price : pkg.price.toFixed(2);
    const bullets: string[] =
      pkg.description_type === "list" && pkg.description_items?.length
        ? pkg.description_items
        : [
            pkg.classes_count == null ? "Clases ilimitadas" : `${pkg.classes_count} clases`,
            `${pkg.duration_minutes} min por clase`,
            "Modalidad 100% online",
            ...(pkg.description ? [pkg.description] : []),
          ];

    return (
      <div
        key={pkg.id}
        className={`relative bg-white rounded-[2rem] border border-slate-100
                    shadow-lg shadow-slate-100 p-6 flex flex-col transition-all duration-300
                    hover:-translate-y-0.5 hover:shadow-xl
                    ${!pkg.is_active ? "opacity-50" : ""}`}
      >
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-lg">{pkg.icon || "📦"}</span>
            <h3 className="text-base font-black" style={{ color: accent }}>
              {pkg.name}
            </h3>
          </div>
          <p className="text-[11px] text-slate-400 font-bold mb-2">{pkg.subject}</p>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-black text-slate-800">${priceDisplay}</span>
            <span className="text-slate-500 text-xs font-medium">{priceSuffix}</span>
          </div>
        </div>

        <div className="flex-1 space-y-2 mb-5">
          {bullets.slice(0, 4).map((item, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <Check className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: accent }} />
              <span className="text-xs text-slate-600 font-medium">{item}</span>
            </div>
          ))}
        </div>

        <div className="flex gap-2 pt-4 border-t border-slate-100">
          <button
            onClick={() => openEdit(pkg)}
            className="flex-1 flex items-center justify-center gap-1.5 bg-slate-50
                       hover:bg-slate-100 text-slate-700 text-xs font-bold py-2.5 rounded-xl transition-colors
                       border border-slate-200"
          >
            <Edit2 className="w-3.5 h-3.5" /> Editar
          </button>
          {pkg.is_active && (
            <button
              onClick={() => deactivatePackage(pkg.id)}
              className="w-10 flex items-center justify-center bg-slate-50 text-red-400
                         hover:bg-red-50 hover:text-red-500 rounded-xl transition-colors flex-shrink-0
                         border border-slate-200"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  })}
</div>
          )}
        </div>

        {/* Seguimiento de cumplimiento */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-slate-400" />
            <h2 className="text-lg font-black text-slate-800">
              Seguimiento de estudiantes ({enrollments.length})
            </h2>
            <button onClick={fetchAll} className="ml-auto text-slate-400 hover:text-pink-500 transition-colors">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2].map(i => <div key={i} className="h-20 bg-white rounded-2xl animate-pulse" />)}
            </div>
          ) : enrollments.length === 0 ? (
            <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-lg py-12 text-center">
              <p className="text-slate-500 font-bold">Aún no tienes estudiantes con paquetes asignados</p>
            </div>
          ) : (
            <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-lg overflow-hidden">
              <div className="divide-y divide-slate-50">
                {enrollments.map(e => {
                  const progressPct = e.classes_total 
                    ? Math.min((e.classes_used / e.classes_total) * 100, 100)
                    : 0;
                  return (
                    <div key={e.id} className="p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <p className="text-sm font-bold text-slate-800">{e.student_name}</p>
                          <span className="text-xs text-slate-400">@{e.student_username}</span>
                          <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full
                                            ${STATUS_BADGE[e.status] ?? "bg-slate-100 text-slate-500"}`}>
                            {STATUS_LABEL[e.status] ?? e.status}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mb-2">{e.package_name}</p>

                        <div className="w-full max-w-xs h-2 bg-slate-100 rounded-full overflow-hidden mb-2">
                          <div
                            className="h-full bg-gradient-to-r from-pink-500 to-rose-400 rounded-full transition-all"
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>

                        <div className="flex items-center gap-3 flex-wrap text-[10px] font-bold text-slate-400">
                          <span>{e.classes_used}/{e.classes_total ?? "∞"} usadas</span>
                          <span className="text-emerald-600">{e.completed_count} completadas</span>
                          <span className="text-red-500">{e.no_show_count} no-show</span>
                          <span className="text-amber-600">{e.cancelled_late_count} canceladas tarde</span>
                        </div>
                      </div>

                      {e.status === "pending_renewal" && (
                        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                          {e.renewal_requested_package_name && (
                            <span className="text-[10px] text-slate-400 font-bold">
                              Pidió: {e.renewal_requested_package_name}
                            </span>
                          )}
                          <button
                            onClick={() => approveRenewal(e.id)}
                            disabled={approvingId === e.id}
                            className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-emerald-500
                                       to-teal-400 text-white text-xs font-bold rounded-xl shadow-sm
                                       hover:shadow-md active:scale-[0.98] transition-all disabled:opacity-50"
                          >
                            {approvingId === e.id ? (
                              <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                            ) : (
                              <><Check className="w-3.5 h-3.5" /> Aprobar renovación</>
                            )}
                          </button>
                        </div>
                      )}
                      {e.status === "pending_package_change" && (
  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
    {e.change_requested_package_name && (
      <span className="text-[10px] text-slate-400 font-bold">
        Quiere cambiar a: {e.change_requested_package_name}
      </span>
    )}
    <button
      onClick={() => approvePackageChange(e.id)}
      disabled={approvingId === e.id}
      className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-blue-500
                 to-indigo-400 text-white text-xs font-bold rounded-xl shadow-sm
                 hover:shadow-md active:scale-[0.98] transition-all disabled:opacity-50"
    >
      {approvingId === e.id ? (
        <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
      ) : (
        <><Check className="w-3.5 h-3.5" /> Aprobar cambio de paquete</>
      )}
    </button>
  </div>
)}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

      </div>
      <ChipiWidget screenName="teacher_packages" />
    </div>
  );
}