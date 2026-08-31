"use client";

import { useState, useCallback, useRef } from "react";
import Link from "next/link";
import {
  Package as PackageIcon, Plus, X, Check, Edit2,
  Trash2, Users, ChevronDown, RefreshCw, AlertTriangle, ChevronRight,
} from "lucide-react";
import api from "@/lib/api";
import ChipiWidget from "@/components/chipi/ChipiWidget";
import { getSuggestedTheme, ICON_PICKER_OPTIONS as DEFAULT_ICON_OPTIONS, DEFAULT_PACKAGE_THEME, priceLabelSuffix } from "@/lib/packageThemes";
import { THEME_PRESETS as DEFAULT_THEME_PRESETS } from "@/lib/color";
import { useAuthStore } from "@/store/authStore";
// in teacher onboarding StepSpecialties, teacher/profile, teacher/packages, etc.
import { useSystemCatalogs } from "@/hooks/useSystemCatalogs";
import { SUBJECTS as FALLBACK_SUBJECTS, LANGUAGES as FALLBACK_LANGUAGES, SKILL_SUGGESTIONS as FALLBACK_SKILLS } from "@/lib/teacherOptions";
import {
  useTeacherPackages,
  useTeacherEnrollments,
  type TeacherPackage as Package,
  type TeacherEnrollmentCompliance as EnrollmentCompliance,
} from "@/hooks/useTeacherData";
import Skeleton from "@/components/ui/Skeleton";
import RefreshButton from "@/components/ui/RefreshButton";
import DesktopOnly from "@/components/ui/DesktopOnly";
import { usePageTopBar } from "@/lib/mobileTopBar";
import { useBusinessRules } from "@/hooks/useBusinessRules";
import { useToast } from "@/hooks/useToast";
import { getErrorMessage } from "@/lib/errorMessage";

const emptyForm = {
  name: "", subject: "", description: "",
  description_type: "paragraph" as "paragraph" | "list",
  description_items: [] as string[],
  icon: DEFAULT_PACKAGE_THEME.icon,
  color: DEFAULT_PACKAGE_THEME.color,
  classes_count: "4", price: "10", duration_minutes: 50,
  allow_installments: false,
  installment_count: "3",
  is_group: false,
  min_students: "3",
  max_students: "6",
};

const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  completed: "bg-slate-100 text-slate-500",
  pending_renewal: "bg-amber-100 text-amber-700",
  pending_package_change: "bg-blue-100 text-blue-700",
  cancelled: "bg-red-100 text-red-600",
  package_pending_payment: "bg-amber-100 text-amber-700",
  unpaid: "bg-amber-100 text-amber-700",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Activo",
  completed: "Agotado",
  pending_renewal: "Renovación pendiente",
  pending_package_change: "Cambio de paquete pendiente",
  cancelled: "Cancelado",
  package_pending_payment: "Pago pendiente",
  unpaid: "Sin pagar",
};

export default function TeacherPackagesPage() {
  const { catalogs } = useSystemCatalogs();
  const toast = useToast();
  
  // Catálogos dinámicos con fallbacks seguros
  const SUBJECTS = catalogs?.subjects?.length ? catalogs.subjects : FALLBACK_SUBJECTS;
  const LANGUAGES = catalogs?.languages?.length ? catalogs.languages : FALLBACK_LANGUAGES;
  const ICON_OPTIONS = catalogs?.package_icon_options?.length ? catalogs.package_icon_options : DEFAULT_ICON_OPTIONS;
  const THEME_PRESETS = catalogs?.theme_presets?.length ? catalogs.theme_presets : DEFAULT_THEME_PRESETS;
  
  const {
    packages,
    loading: loadingPackages,
    isFetching: fetchingPackages,
    refetch: refetchPackages,
  } = useTeacherPackages();
  const {
    enrollments,
    loading: loadingEnrollments,
    isFetching: fetchingEnrollments,
    refetch: refetchEnrollments,
  } = useTeacherEnrollments();

  const loading = loadingPackages || loadingEnrollments;
  const isFetching = fetchingPackages || fetchingEnrollments;

  const fetchAll = useCallback(async () => {
    await Promise.all([refetchPackages(), refetchEnrollments()]);
  }, [refetchPackages, refetchEnrollments]);

  usePageTopBar({
    title: "Paquetes",
    onRefresh: fetchAll,
    isFetching,
  });

  const [kind, setKind] = useState<"subject" | "language">("subject");
  const [unlimited, setUnlimited] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [descItemInput, setDescItemInput] = useState("");
  const [themeTouched, setThemeTouched] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const { rules } = useBusinessRules();
  const formRef = useRef<HTMLDivElement>(null);
  const role = useAuthStore(s => s.user?.role);
  const canManagePayments = role === "teacher_admin" || role === "superadmin";

  const scrollToForm = () => {
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

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
      allow_installments: pkg.allow_installments ?? false,
      installment_count: pkg.installment_count ? String(pkg.installment_count) : "3",
      is_group: pkg.is_group ?? false,
      min_students: pkg.min_students != null ? String(pkg.min_students) : "3",
      max_students: pkg.max_students != null ? String(pkg.max_students) : "6",
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

    let minStudentsNum: number | null = null;
    let maxStudentsNum: number | null = null;
    if (form.is_group) {
      minStudentsNum = parseInt(form.min_students, 10);
      maxStudentsNum = parseInt(form.max_students, 10);
      if (!Number.isFinite(minStudentsNum) || minStudentsNum < 1) {
        setError("Introduce un mínimo de alumnos válido (mínimo 1) para el paquete grupal");
        return;
      }
      if (!Number.isFinite(maxStudentsNum) || maxStudentsNum < minStudentsNum) {
        setError("El máximo de alumnos no puede ser menor que el mínimo");
        return;
      }
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
        allow_installments: form.is_group ? false : form.allow_installments,
        installment_count: (unlimited || form.is_group) ? null : (form.allow_installments ? parseInt(form.installment_count, 10) : null),
        is_group: form.is_group,
        min_students: form.is_group ? minStudentsNum : null,
        max_students: form.is_group ? maxStudentsNum : null,
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
      toast.success(editingId ? "Paquete actualizado correctamente" : "Paquete creado correctamente");
      setTimeout(() => setSavedOk(false), 3000);
    } catch (e) {
      setError(getErrorMessage(e, "Error guardando el paquete"));
    } finally {
      setSaving(false);
    }
  };

  const deactivatePackage = async (id: number) => {
    if (!confirm("¿Desactivar este paquete? Los estudiantes con enrollments activos no se ven afectados.")) return;
    try {
      await api.delete(`/packages/${id}`);
      fetchAll();
      toast.success("Paquete desactivado correctamente");
    } catch (e) {
      toast.error(getErrorMessage(e, "Error desactivando el paquete"));
    }
  };

  const grantManually = async (enrollmentId: number) => {
    if (!confirm("¿Otorgar este paquete sin registrar un cobro? Se usará para becas o pagos ya recibidos fuera de la plataforma.")) return;
    setApprovingId(enrollmentId);
    try {
      await api.post("/payments/manual-grant", { type: "package", enrollment_id: enrollmentId });
      fetchAll();
      toast.success("Acceso otorgado correctamente");
    } catch (e) {
      toast.error(getErrorMessage(e, "Error otorgando acceso"));
    } finally {
      setApprovingId(null);
    }
  };

  const pendingRenewals = enrollments.filter(e => e.status === "pending_renewal");

  return (
    <>
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
            <div className="flex items-center gap-4">
              {canManagePayments && (
                <Link href="/teacher/payments" className="text-sm font-bold text-pink-600 hover:text-pink-700 flex items-center gap-1.5">
                  Ver pagos pendientes <ChevronRight className="w-4 h-4" />
                </Link>
              )}
              <DesktopOnly>
                <RefreshButton onRefresh={fetchAll} isFetching={isFetching} />
              </DesktopOnly>
              <button 
                onClick={openCreate} 
                className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-pink-500 to-rose-400 hover:from-pink-600 hover:to-rose-500 text-white text-sm font-bold rounded-xl shadow-lg shadow-pink-200 hover:shadow-pink-300 hover:-translate-y-0.5 active:scale-95 transition-all duration-300"
              >
                <Plus className="w-4 h-4" /> 
                Nuevo paquete
              </button>
            </div>
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
                            const suggested = getSuggestedTheme(subject, catalogs.subject_theme_map);
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
                      onClick={() => {
                        setUnlimited(!unlimited);
                        if (!unlimited) {
                          setForm({ ...form, allow_installments: false });
                        }
                      }}
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

                <div className="sm:col-span-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                    Duración por clase
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {(rules.allowed_package_durations ?? [50, 80, 110]).map(d => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setForm({ ...form, duration_minutes: d })}
                        className={`px-4 py-2 rounded-xl text-sm font-bold border-2 transition-all
                          ${form.duration_minutes === d ? "border-pink-400 bg-pink-50 text-pink-600" : "border-slate-100 bg-slate-50 text-slate-500"}`}
                      >
                        {d} min
                      </button>
                    ))}
                  </div>
                </div>

                {/* ─── Paquete grupal ─── */}
                <div className="sm:col-span-2 space-y-3 pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      Paquete grupal (clases compartidas por cohorte)
                    </label>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, is_group: !form.is_group, allow_installments: false })}
                      className={`relative w-11 h-6 rounded-full transition-colors ${
                        form.is_group ? "bg-pink-500" : "bg-slate-300"
                      } cursor-pointer`}
                    >
                      <span className={`absolute top-[2px] left-[2px] w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${
                        form.is_group ? "translate-x-5" : "translate-x-0"
                      }`} />
                    </button>
                  </div>

                  {form.is_group && (
                    <div className="animate-in fade-in duration-300 space-y-3">
                      <p className="text-[11px] text-slate-500 font-medium">
                        Los alumnos se inscriben en cohortes con cupo mínimo/máximo; no admite pago en cuotas
                        (se cobra el total al inscribirse). Crea las cohortes desde la pestaña &quot;Grupos&quot;.
                      </p>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                            Mín. alumnos por cohorte
                          </label>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={form.min_students}
                            onChange={e => /^[0-9]*$/.test(e.target.value) && setForm({ ...form, min_students: e.target.value })}
                            className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold px-4 py-3 focus:outline-none focus:border-pink-500 focus:bg-white transition-all"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                            Máx. alumnos por cohorte
                          </label>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={form.max_students}
                            onChange={e => /^[0-9]*$/.test(e.target.value) && setForm({ ...form, max_students: e.target.value })}
                            className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold px-4 py-3 focus:outline-none focus:border-pink-500 focus:bg-white transition-all"
                          />
                        </div>
                      </div>
                    </div>
                  )}
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
                        const suggested = getSuggestedTheme(form.subject, catalogs.subject_theme_map);
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
                      {ICON_OPTIONS.map((ic: string) => (
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
                      {THEME_PRESETS.map((p: { value: string; label: string }) => (
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
                
                {/* Pago en cuotas */}
                <div className={`sm:col-span-2 space-y-3 pt-2 border-t border-slate-100 transition-opacity duration-300 ${(unlimited || form.is_group) ? 'opacity-50' : ''}`}>
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      Permitir pago en cuotas
                      {unlimited && <span className="text-red-400 normal-case">(No disponible para clases ilimitadas)</span>}
                      {!unlimited && form.is_group && <span className="text-red-400 normal-case">(No disponible para paquetes grupales)</span>}
                    </label>
                    <button
                      type="button"
                      disabled={unlimited || form.is_group}
                      onClick={() => setForm({ ...form, allow_installments: !form.allow_installments })}
                      className={`relative w-11 h-6 rounded-full transition-colors ${
                        form.allow_installments && !unlimited && !form.is_group ? "bg-pink-500" : "bg-slate-300"
                      } ${(unlimited || form.is_group) ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <span className={`absolute top-[2px] left-[2px] w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${
                        form.allow_installments && !unlimited && !form.is_group ? "translate-x-5" : "translate-x-0"
                      }`} />
                    </button>
                  </div>
                  
                  {form.allow_installments && !unlimited && !form.is_group && (
                    <div className="animate-in fade-in duration-300">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Número de cuotas</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={form.installment_count}
                        onChange={e => /^[0-9]*$/.test(e.target.value) && setForm({ ...form, installment_count: e.target.value })}
                        className="w-24 bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold px-4 py-3 focus:outline-none focus:border-pink-500 focus:bg-white transition-all"
                      />
                      {parseFloat(form.price) > 0 && parseInt(form.installment_count || "0") > 1 && (
                        <p className="text-[11px] text-slate-500 font-bold mt-2">
                          ${(parseFloat(form.price) / parseInt(form.installment_count)).toFixed(2)} por cuota
                        </p>
                      )}
                    </div>
                  )}
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
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-40 rounded-2xl" />)}
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
                  const priceSuffix = priceLabelSuffix(pkg.classes_count);
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
                        <p className="text-[11px] text-slate-400 font-bold mb-2 flex items-center gap-1.5">
                          {pkg.subject}
                          {pkg.is_group && (
                            <span className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest">
                              <Users className="w-2.5 h-2.5" /> Grupal
                            </span>
                          )}
                        </p>
                        <div className="flex items-baseline gap-1">
                          <span className="text-3xl font-black text-slate-800">${priceDisplay}</span>
                          <span className="text-slate-500 text-xs font-medium">{priceSuffix}</span>
                          {pkg.allow_installments && pkg.installment_count && (
                            <p className="text-[11px] font-bold text-slate-400 mt-1">
                              o en {pkg.installment_count} cuotas de $ {(pkg.price / pkg.installment_count).toFixed(2)}
                            </p>
                          )}
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
                {[1, 2].map(i => <Skeleton key={i} className="h-20 rounded-2xl" />)}
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
                            {e.available_credits !== null && (
                              <span className="text-indigo-600">{e.available_credits} créditos disponibles</span>
                            )}
                            <span className="text-emerald-600">{e.completed_count} completadas</span>
                            <span className="text-red-500">{e.no_show_count} no-show</span>
                            <span className="text-amber-600">{e.cancelled_late_count} canceladas tarde</span>
                          </div>
                        </div>

                        {(e.status === "package_pending_payment" || e.status === "unpaid") && (
                          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                            <span className="text-[10px] font-bold text-amber-600">
                              Esperando pago inicial
                            </span>
                            <button
                              onClick={() => grantManually(e.id)}
                              disabled={approvingId === e.id}
                              className="text-[10px] font-bold text-slate-400 hover:text-pink-600 underline underline-offset-2"
                            >
                              Otorgar manualmente (sin cobro)
                            </button>
                          </div>
                        )}
                        {e.status === "pending_renewal" && (
                          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                            {e.renewal_requested_package_name && (
                              <span className="text-[10px] text-slate-400 font-bold">
                                Pidió: {e.renewal_requested_package_name}
                              </span>
                            )}
                            <span className="text-[10px] font-bold text-amber-600">
                              Esperando que el estudiante notifique su pago
                            </span>
                            <button
                              onClick={() => grantManually(e.id)}
                              disabled={approvingId === e.id}
                              className="text-[10px] font-bold text-slate-400 hover:text-pink-600 underline underline-offset-2"
                            >
                              Otorgar manualmente (sin cobro)
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
                            <span className="text-[10px] font-bold text-amber-600">
                              Esperando que el estudiante notifique su pago
                            </span>
                            <button
                              onClick={() => grantManually(e.id)}
                              disabled={approvingId === e.id}
                              className="text-[10px] font-bold text-slate-400 hover:text-pink-600 underline underline-offset-2"
                            >
                              Otorgar manualmente (sin cobro)
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
      </div>
      <ChipiWidget screenName="teacher_packages" />
    </>
  );
}