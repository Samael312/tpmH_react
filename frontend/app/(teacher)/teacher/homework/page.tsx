"use client";

import { useState, useMemo, useEffect } from "react";
import Image from "next/image";
import axios from "axios";
import {
  ClipboardList, Plus, Send, Star, Clock,
  CheckCircle, AlertCircle, ChevronDown,
  X, Search, Calendar, Check, Users, Users2,
  BarChart3, FileText, Edit2, Trash2, AlertTriangle, RefreshCw,
} from "lucide-react";
import api from "@/lib/api";
import ChipiWidget from "@/components/chipi/ChipiWidget";
import Skeleton from "@/components/ui/Skeleton";
import RefreshButton from "@/components/ui/RefreshButton";
import DesktopOnly from "@/components/ui/DesktopOnly";
import { usePageTopBar } from "@/lib/mobileTopBar";
import { useToast } from "@/hooks/useToast";
import { getErrorMessage } from "@/lib/errorMessage";
import {
  useTeacherHomework,
  useHomeworkSubmissions,
  useTeacherStudentsBasic,
  type TeacherHomeworkItem as Homework,
  type HomeworkSubmission as Submission,
  type TeacherStudentBasic as Student,
} from "@/hooks/useTeacherData";

interface TeacherCohort {
  id: number;
  package_name: string | null;
  status: "filling" | "confirmed" | "in_progress" | "completed" | "cancelled";
  current_students: number;
}

function StudentAvatar({ s, className }: { s: Student; className?: string }) {
  if (s.avatar) {
    return (
      <span className={`relative ${className} block overflow-hidden`}>
        <Image src={s.avatar} alt={s.name} fill sizes="40px" className="object-cover" />
      </span>
    );
  }
  return (
    <div className={`${className} bg-gradient-to-br from-pink-400 to-rose-400
                      flex items-center justify-center text-white font-black`}>
      {s.name?.[0]?.toUpperCase()}{s.surname?.[0]?.toUpperCase()}
    </div>
  );
}

function SubmissionAvatar({ sub, className }: { sub: Submission; className?: string }) {
  if (sub.student_avatar) {
    return (
      <span className={`relative ${className} block overflow-hidden`}>
        <Image src={sub.student_avatar} alt={sub.student_name ?? ""} fill sizes="40px" className="object-cover" />
      </span>
    );
  }
  return (
    <div className={`${className} bg-slate-100 flex items-center justify-center
                      text-xs font-black text-slate-500`}>
      {sub.student_name?.[0]?.toUpperCase() ?? "?"}
    </div>
  );
}

// ─── Custom Date Picker ───────────────────────────────────────────────────────
function DatePicker({
  value,
  onChange,
  placeholder = "Seleccionar fecha",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const today = new Date();
  const [viewYear, setViewYear]   = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun",
                  "Jul","Ago","Sep","Oct","Nov","Dic"];
  const DAYS_HEAD = ["L","M","X","J","V","S","D"];

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const offset = (firstDay + 6) % 7;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells = Array.from({ length: offset + daysInMonth }, (_, i) =>
    i < offset ? null : i - offset + 1
  );

  const select = (day: number) => {
    const d = `${viewYear}-${String(viewMonth + 1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    onChange(d);
    setOpen(false);
  };

  const display = value
    ? new Date(value + "T00:00:00").toLocaleDateString("es", {
        day: "numeric", month: "long", year: "numeric",
      })
    : placeholder;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 bg-slate-50 border-2
                   border-transparent rounded-xl px-4 py-3.5 text-sm
                   font-bold text-left transition-all duration-300
                   hover:bg-white hover:border-slate-200 focus:outline-none
                   focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50"
      >
        <Calendar className="w-5 h-5 text-slate-400 flex-shrink-0" />
        <span className={value ? "text-slate-800" : "text-slate-400"}>
          {display}
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-400 ml-auto transition-transform
                                 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-50 bottom-full mb-2 w-72 max-w-[calc(100vw-2rem)] bg-white/95 backdrop-blur-xl
                  rounded-2xl shadow-2xl shadow-slate-200/60
                  border border-white p-4 animate-in fade-in zoom-in-95
                  duration-150">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => {
                if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
                else setViewMonth(m => m - 1);
              }}
              className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200
                         flex items-center justify-center transition-colors text-slate-600"
            >
              ‹
            </button>
            <span className="text-sm font-black text-slate-800">
              {MONTHS[viewMonth]} {viewYear}
            </span>
            <button
              onClick={() => {
                if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
                else setViewMonth(m => m + 1);
              }}
              className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200
                         flex items-center justify-center transition-colors text-slate-600"
            >
              ›
            </button>
          </div>

          <div className="grid grid-cols-7 mb-2">
            {DAYS_HEAD.map(d => (
              <div key={d} className="text-center text-[10px] font-black
                                       text-slate-400 uppercase tracking-widest py-1">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((day, i) => {
              if (!day) return <div key={i} />;
              const dateStr = `${viewYear}-${String(viewMonth+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
              const isSelected = dateStr === value;
              const isPast = new Date(dateStr) < new Date(today.toDateString());
              return (
                <button
                  key={i}
                  onClick={() => !isPast && select(day)}
                  disabled={isPast}
                  className={`
                    w-full aspect-square rounded-lg text-xs font-bold
                    transition-all duration-150
                    ${isSelected
                      ? "bg-gradient-to-br from-pink-500 to-rose-400 text-white shadow-md"
                      : isPast
                        ? "text-slate-300 cursor-not-allowed"
                        : "text-slate-700 hover:bg-pink-50 hover:text-pink-600"
                    }
                  `}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Modal Calificar ──────────────────────────────────────────────────────────
function GradeModal({
  submission,
  onClose,
  onSaved,
}: {
  submission: Submission;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [score, setScore]       = useState<number>(submission.score ?? 0);
  const [feedback, setFeedback] = useState(submission.feedback ?? "");
  const [saving, setSaving]     = useState(false);
  const [success, setSuccess]   = useState(false);
  const toast = useToast();

  const hasSubmission = Boolean(submission.submission);

  const save = async () => {
    if (!hasSubmission) return;
    setSaving(true);
    try {
      await api.patch(
        `/homework/${submission.homework_id}/submissions/${submission.id}/grade`,
        { score, feedback }
      );
      setSuccess(true);
      toast.success("Tarea calificada correctamente");
      setTimeout(() => { onSaved(); onClose(); }, 1000);
    } catch (e) {
      toast.error(getErrorMessage(e, "No se pudo calificar la tarea"));
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
           onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white/95 backdrop-blur-2xl
                      rounded-[2rem] sm:rounded-[2.5rem] shadow-2xl shadow-slate-200/60
                      border border-white p-6 sm:p-8 animate-in fade-in zoom-in-95
                      duration-200 max-h-[90vh] overflow-y-auto">

        <div className="absolute top-0 left-0 w-48 h-48 bg-amber-300/20
                        rounded-full blur-[80px] pointer-events-none" />

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <SubmissionAvatar sub={submission} className="w-10 h-10 rounded-xl flex-shrink-0" />
            <div>
              <h2 className="text-lg sm:text-xl font-black text-slate-800 tracking-tight">
                Calificar entrega
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                {submission.student_name ?? "Estudiante"}
              </p>
            </div>
          </div>
          <button onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200
                       flex items-center justify-center transition-colors">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        {success ? (
          <div className="flex flex-col items-center py-8 gap-3">
            <div className="w-14 h-14 rounded-full bg-emerald-100
                            flex items-center justify-center">
              <CheckCircle className="w-7 h-7 text-emerald-600" />
            </div>
            <p className="font-bold text-slate-700">¡Calificación guardada!</p>
          </div>
        ) : (
          <>
            {hasSubmission ? (
              <div className="bg-slate-50 rounded-2xl p-4 mb-5 max-h-40
                              overflow-y-auto">
                <p className="text-[10px] font-black text-slate-400
                               uppercase tracking-widest mb-2">
                  Respuesta del estudiante
                </p>
                <p className="text-sm text-slate-700 whitespace-pre-wrap">
                  {submission.submission}
                </p>
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-100 rounded-2xl
                              p-4 mb-5 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                <p className="text-xs font-bold text-amber-600">
                  El estudiante aún no ha enviado su respuesta. No es posible calificar.
                </p>
              </div>
            )}

            <div className="mb-4">
              <label className="text-[10px] font-black text-slate-400
                                uppercase tracking-widest block mb-3">
                Calificación (0 – 10)
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0} max={10} step={0.5}
                  value={score}
                  disabled={!hasSubmission}
                  onChange={e => setScore(parseFloat(e.target.value))}
                  className="flex-1 accent-pink-500 disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <div className="w-14 h-11 bg-slate-50 rounded-xl flex items-center
                                justify-center border-2 border-transparent
                                text-lg font-black text-slate-800">
                  {score}
                </div>
              </div>
              <div className="flex justify-between text-xs text-slate-300
                              font-bold mt-1 px-0.5">
                <span>0</span><span>5</span><span>10</span>
              </div>
            </div>

            <div className="mb-6">
              <label className="text-[10px] font-black text-slate-400
                                uppercase tracking-widest block mb-1.5">
                Retroalimentación
              </label>
              <textarea
                value={feedback}
                disabled={!hasSubmission}
                onChange={e => setFeedback(e.target.value)}
                rows={3}
                placeholder={hasSubmission ? "Escribe tu comentario al estudiante..." : "No disponible hasta que el estudiante entregue la tarea."}
                className="w-full bg-slate-50 border-2 border-transparent
                           rounded-xl text-sm text-slate-800 placeholder:text-slate-400
                           px-4 py-3 focus:outline-none focus:bg-white
                           focus:border-pink-500 focus:ring-4 focus:ring-pink-50
                           transition-all duration-300 resize-none font-medium
                           disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>

            <button onClick={save} disabled={saving || !hasSubmission}
              className="w-full py-3.5 text-sm font-bold text-white rounded-xl
                         bg-gradient-to-r from-pink-500 to-rose-400
                         hover:from-pink-600 hover:to-rose-500
                         shadow-lg shadow-pink-200 active:scale-[0.98]
                         transition-all duration-300 disabled:opacity-50
                         disabled:cursor-not-allowed
                         flex items-center justify-center gap-2">
              {saving ? (
                <div className="w-4 h-4 border-2 border-white/40
                                border-t-white rounded-full animate-spin" />
              ) : (
                <><Star className="w-4 h-4" /> Guardar calificación</>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Modal Editar tarea ───────────────────────────────────────────────────────
function EditHomeworkModal({
  hw, onClose, onSaved,
}: { hw: Homework; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(hw.title);
  const [content, setContent] = useState(hw.description);
  const [due, setDue] = useState(hw.due_date_utc.slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();

  const save = async () => {
    setSaving(true); setError("");
    try {
      await api.patch(`/homework/${hw.id}`, {
        title,
        description: content,
        due_date_utc: new Date(`${due}T23:59:59`).toISOString(),
      });
      toast.success("Tarea actualizada correctamente");
      onSaved();
      onClose();
    } catch (e) {
      setError(getErrorMessage(e, "Error actualizando la tarea"));
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white/95 backdrop-blur-2xl rounded-[2rem] sm:rounded-[2.5rem] shadow-2xl border border-white p-6 sm:p-8 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg sm:text-xl font-black text-slate-800 flex items-center gap-2">
            <Edit2 className="w-4 h-4 text-pink-500" /> Editar tarea
          </h2>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        <div>
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
            Título
          </label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold px-4 py-3 focus:outline-none focus:border-pink-500"
            placeholder="Título"
          />
        </div>

        <div>
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
            Instrucciones
          </label>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            rows={4}
            className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm px-4 py-3 focus:outline-none focus:border-pink-500 resize-none"
            placeholder="Instrucciones"
          />
        </div>

        <div>
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
            Fecha límite
          </label>
          <DatePicker value={due} onChange={setDue} />
        </div>

        {error && <div className="bg-rose-50 text-rose-600 text-xs font-bold px-4 py-3 rounded-xl">{error}</div>}

        <button
          onClick={save}
          disabled={saving || !title || !content || !due}
          className="w-full py-3.5 text-sm font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {saving ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : "Guardar cambios"}
        </button>
      </div>
    </div>
  );
}

// ─── Modal Confirmar eliminación de tarea ─────────────────────────────────────
function DeleteHomeworkModal({
  hw, onClose, onDeleted,
}: { hw: Homework; onClose: () => void; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();

  const confirmDelete = async () => {
    setDeleting(true);
    setError("");
    try {
      await api.delete(`/homework/${hw.id}`);
      toast.success("Tarea eliminada correctamente");
      onDeleted();
      onClose();
    } catch (e) {
      setError(getErrorMessage(e, "Error eliminando la tarea"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-white/95 backdrop-blur-2xl
                      rounded-[2rem] sm:rounded-[2.5rem] shadow-2xl shadow-slate-200/60
                      border border-white p-6 sm:p-8
                      animate-in fade-in zoom-in-95 duration-200">

        <div className="absolute top-0 right-0 w-40 h-40 bg-red-300/20
                        rounded-full blur-[60px] pointer-events-none" />

        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-14 h-14 bg-red-100 rounded-full flex items-center
                          justify-center mb-4">
            <AlertTriangle className="w-7 h-7 text-red-500" />
          </div>
          <h2 className="text-lg sm:text-xl font-black text-slate-800 tracking-tight mb-2">
            ¿Eliminar tarea?
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">
            <span className="font-bold text-slate-700">“{hw.title}”</span> se eliminará
            y ningún estudiante podrá seguir viéndola. Las entregas ya calificadas
            quedan guardadas en tu historial.
          </p>
        </div>

        {error && (
          <div className="mb-4 bg-rose-50 border border-rose-100 text-rose-600
                          px-4 py-3 rounded-xl text-xs font-bold
                          flex items-center gap-2">
            <X className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={deleting}
            className="flex-1 py-3 text-sm font-bold text-slate-600
                       bg-slate-100 hover:bg-slate-200 rounded-xl
                       transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={confirmDelete}
            disabled={deleting}
            className="flex-1 py-3 text-sm font-bold text-white bg-red-500
                       hover:bg-red-600 rounded-xl shadow-md shadow-red-100
                       active:scale-[0.98] transition-all duration-200
                       disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {deleting ? (
              <div className="w-4 h-4 border-2 border-white/40
                              border-t-white rounded-full animate-spin" />
            ) : (
              <><Trash2 className="w-4 h-4" /> Eliminar</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function HomeworkPage() {
  const { homeworks, loading, isFetching: hwFetching, isError: hwError, refetch: refetchHomework } = useTeacherHomework();
  const { students, isFetching: stuFetching, isError: stuError, refetch: refetchStudents } = useTeacherStudentsBasic();
  const toast = useToast();
  const [tab, setTab]                 = useState<"create" | "review">("review");
  const [activeHw, setActiveHw]       = useState<number | null>(null);
  const [gradeTarget, setGradeTarget] = useState<Submission | null>(null);
  const [search, setSearch]           = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [editTarget, setEditTarget]     = useState<Homework | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Homework | null>(null);
  const [justDeleted, setJustDeleted]   = useState(false);

  // Form nueva tarea
  const [hwTitle, setHwTitle]       = useState("");
  const [hwContent, setHwContent]   = useState("");
  const [hwDue, setHwDue]           = useState("");
  const [hwStudents, setHwStudents] = useState<number[]>([]);
  const [creating, setCreating]     = useState(false);
  const [createError, setCreateError] = useState("");

  // Asignar a un grupo (cohorte) completo, además de estudiantes individuales
  const [cohorts, setCohorts] = useState<TeacherCohort[]>([]);
  const [hwCohortId, setHwCohortId] = useState<number | null>(null);

  useEffect(() => {
    api.get<TeacherCohort[]>("/cohorts/teacher")
      .then(res => setCohorts(res.data.filter(c => c.status !== "cancelled" && c.status !== "completed")))
      .catch(() => { /* silencioso: la asignación grupal es opcional */ });
  }, []);

  const {
    submissions,
    loading: loadingSubs,
    refetch: refetchSubmissions,
  } = useHomeworkSubmissions(activeHw);

  const isFetching = hwFetching || stuFetching;
  const isError = hwError || stuError;

  const handleRefresh = () => {
    refetchHomework();
    refetchStudents();
    if (activeHw) refetchSubmissions();
  };

  usePageTopBar({
    title: 'Tareas',
    onRefresh: handleRefresh,
    isFetching,
  });

  const toggleHomework = (hwId: number) => {
    setActiveHw(prev => (prev === hwId ? null : hwId));
  };

  const createHomework = async () => {
    if (!hwTitle || !hwContent || !hwDue || (!hwStudents.length && !hwCohortId)) return;
    setCreating(true);
    setCreateError("");
    try {
      const dueDateUtc = new Date(`${hwDue}T23:59:59`).toISOString();
      await api.post("/homework/", {
        title: hwTitle,
        description: hwContent,
        due_date_utc: dueDateUtc,
        student_ids: hwStudents,
        cohort_id: hwCohortId,
      });
      setHwTitle(""); setHwContent(""); setHwDue("");
      setHwStudents([]);
      setHwCohortId(null);
      setStudentSearch("");
      refetchHomework();
      setTab("review");
      toast.success("Tarea creada correctamente");
    } catch (e) {
      const detail = axios.isAxiosError(e) ? e.response?.data?.detail : undefined;
      setCreateError(
        Array.isArray(detail)
          ? detail.map((d: unknown) => {
              if (d && typeof d === "object" && "msg" in d) {
                return (d as { msg?: string }).msg || JSON.stringify(d);
              }
              return JSON.stringify(d);
            }).join(", ")
          : detail || "Error creando tarea"
      );
    } finally { setCreating(false); }
  };

  const toggleStudent = (id: number) =>
    setHwStudents(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

  const filteredHw = homeworks.filter(h =>
    h.title.toLowerCase().includes(search.toLowerCase())
  );

  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return students;
    return students.filter(s =>
      `${s.name} ${s.surname} ${s.username}`.toLowerCase().includes(q)
    );
  }, [students, studentSearch]);

  const getStatusIcon = (status: string) => {
    if (status === "graded")    return <Star className="w-3.5 h-3.5 text-amber-500" />;
    if (status === "submitted") return <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />;
    return <Clock className="w-3.5 h-3.5 text-slate-400" />;
  };

  const getStatusLabel = (status: string) => {
    if (status === "graded")    return { text: "Calificada", cls: "bg-amber-100 text-amber-700" };
    if (status === "submitted") return { text: "Entregada",  cls: "bg-emerald-100 text-emerald-700" };
    return { text: "Pendiente", cls: "bg-slate-100 text-slate-500" };
  };

  const handleDeleted = () => {
    setActiveHw(null);
    refetchHomework();
    setJustDeleted(true);
    setTimeout(() => setJustDeleted(false), 3000);
  };

  // ─── Stats ───
  const activeCount = homeworks.filter(h => h.is_active).length;
  const dueThisWeek = homeworks.filter(h => {
    const diff = new Date(h.due_date_utc).getTime() - Date.now();
    return h.is_active && diff > 0 && diff <= 7 * 24 * 60 * 60 * 1000;
  }).length;

  return (
    <>
    <div className="min-h-screen bg-slate-50 relative overflow-x-hidden">

      <div className="fixed top-[-80px] right-[-80px] w-[450px] h-[450px]
                      bg-pink-300/20 rounded-full blur-[100px] pointer-events-none" />
      <div className="fixed bottom-0 left-[-100px] w-[400px] h-[400px]
                      bg-purple-300/15 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8">

        {/* Header Responsive */}
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500
                        flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-800 tracking-tight">
              Tareas
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              Crea actividades y califica las entregas de tus estudiantes
            </p>
          </div>
          <DesktopOnly>
            <RefreshButton onRefresh={handleRefresh} isFetching={isFetching} />
          </DesktopOnly>
        </div>

        {/* Error banner — nuevo, visible en cualquier tab sin bloquear la navegación */}
        {isError && (
          <div className="bg-rose-50 border border-rose-100 text-rose-600 rounded-2xl
                          px-4 py-3.5 flex items-center gap-3 flex-wrap
                          animate-in fade-in slide-in-from-top-2 duration-300">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span className="text-xs font-bold flex-1">
              No se pudieron cargar tus {hwError ? "tareas" : "estudiantes"} correctamente.
            </span>
            <button
              onClick={handleRefresh}
              className="flex items-center gap-1.5 text-xs font-bold text-rose-700
                         bg-rose-100 hover:bg-rose-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Reintentar
            </button>
          </div>
        )}

        {/* Confirmación de eliminado */}
        {justDeleted && (
          <div className="bg-emerald-50 border border-emerald-100 text-emerald-700
                          px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-2
                          animate-in fade-in slide-in-from-top-2 duration-300">
            <Check className="w-4 h-4 flex-shrink-0" />
            Tarea eliminada correctamente
          </div>
        )}

        {/* Stats con Esqueletos de Carga */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 animate-in fade-in slide-in-from-bottom-4
                        duration-500 delay-75">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-2xl" />
            ))
          ) : (
            [
              { label: "Total tareas", value: homeworks.length, icon: <ClipboardList className="w-5 h-5" />, bg: "bg-pink-50 text-pink-500" },
              { label: "Activas", value: activeCount, icon: <BarChart3 className="w-5 h-5" />, bg: "bg-emerald-50 text-emerald-500" },
              { label: "Vencen esta semana", value: dueThisWeek, icon: <Clock className="w-5 h-5" />, bg: "bg-amber-50 text-amber-500" },
            ].map(s => (
              <div key={s.label}
                className="bg-white/85 backdrop-blur-xl rounded-2xl border border-white
                          shadow-lg shadow-slate-100 p-4 sm:p-5 flex items-center gap-4">
                <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${s.bg}`}>
                  {s.icon}
                </div>
                <div>
                  <p className="text-xl sm:text-2xl font-black text-slate-800 leading-none">{s.value}</p>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">
                    {s.label}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Tabs Adaptativos */}
        <div className="flex gap-1 bg-white/80 backdrop-blur-xl
                        border border-white rounded-2xl p-1 w-full sm:w-fit shadow-lg
                        shadow-slate-100 animate-in fade-in duration-500 delay-100">
          {[
            { key: "review", label: "Revisar entregas", icon: <ClipboardList className="w-4 h-4" /> },
            { key: "create", label: "Nueva tarea",      icon: <Plus className="w-4 h-4" /> },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key as "review" | "create")}
              className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 sm:px-5 py-2.5 rounded-xl
                text-xs sm:text-sm font-bold transition-all duration-200
                ${tab === t.key
                  ? "bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-md"
                  : "text-slate-500 hover:text-slate-700"
                }`}
            >
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        {/* ─── Tab: Revisar ─── */}
        {tab === "review" && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4
                          duration-500">

            <div className="group relative max-w-sm">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2
                                  w-4 h-4 sm:w-5 sm:h-5 text-slate-400
                                  group-focus-within:text-pink-500
                                  transition-colors pointer-events-none" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar tarea..."
                className="w-full bg-white border-2 border-transparent rounded-xl
                           text-xs sm:text-sm font-bold text-slate-800 placeholder:text-slate-400
                           pl-10 sm:pl-11 pr-4 py-2.5 sm:py-3 focus:outline-none focus:border-pink-500
                           focus:ring-4 focus:ring-pink-50 transition-all duration-300
                           shadow-sm"
              />
            </div>

            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-20 w-full rounded-2xl" />
                ))}
              </div>
            ) : filteredHw.length === 0 ? (
              <div className="bg-white/80 backdrop-blur-xl rounded-[2rem]
                              border border-white shadow-lg py-12 sm:py-16 text-center">
                <ClipboardList className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                <p className="text-slate-500 font-bold text-xs sm:text-sm">
                  {homeworks.length === 0
                    ? "No hay tareas creadas todavía"
                    : "Ninguna tarea coincide con tu búsqueda"}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredHw.map(hw => (
                  <div key={hw.id}
                    className="bg-white/80 backdrop-blur-xl rounded-2xl
                               border border-white shadow-lg shadow-slate-100
                               overflow-hidden transition-all duration-200">

                    <div
                      onClick={() => toggleHomework(hw.id)}
                      className="w-full flex items-center gap-3 sm:gap-4 p-4 sm:p-5 text-left
                                 hover:bg-slate-50/50 transition-colors cursor-pointer"
                    >
                      <div className="w-9 h-9 sm:w-10 sm:h-10 bg-pink-50 rounded-xl
                                      flex items-center justify-center flex-shrink-0">
                        <ClipboardList className="w-5 h-5 text-pink-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs sm:text-sm font-bold text-slate-800 truncate">
                          {hw.title}
                        </p>
                        <div className="flex items-center gap-2 sm:gap-3 mt-0.5 flex-wrap">
                          <span className="text-[11px] sm:text-xs text-slate-400 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Vence: {new Date(hw.due_date_utc)
                              .toLocaleDateString("es", {
                                day: "numeric", month: "short"
                              })}
                          </span>
                          {!hw.is_active && (
                            <span className="text-[10px] font-black uppercase tracking-widest
                                            px-2 py-0.5 rounded-full bg-slate-100 text-slate-400">
                              Archivada
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditTarget(hw); }}
                        className="flex items-center gap-1 text-xs font-bold text-slate-400 hover:text-pink-500 px-2 sm:px-2.5 py-1.5 rounded-lg hover:bg-pink-50 transition-colors flex-shrink-0"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Editar</span>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(hw); }}
                        className="flex items-center gap-1 text-xs font-bold text-slate-400 hover:text-red-500 px-2 sm:px-2.5 py-1.5 rounded-lg hover:bg-red-50 transition-colors flex-shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Eliminar</span>
                      </button>
                      <ChevronDown className={`w-4 h-4 text-slate-400 flex-shrink-0
                        transition-transform duration-200
                        ${activeHw === hw.id ? "rotate-180" : ""}`} />
                    </div>

                    {activeHw === hw.id && (
                      <div className="border-t border-slate-100 p-4 sm:p-5 space-y-4">

                        {/* Vista previa: instrucciones completas + fecha límite */}
                        <div className="bg-slate-50 rounded-2xl p-3.5 sm:p-4 space-y-2">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                              Instrucciones completas
                            </p>
                            <span className="text-[10px] font-bold text-slate-500 flex items-center gap-1 bg-white px-2.5 py-1 rounded-lg border border-slate-100">
                              <Calendar className="w-3 h-3" />
                              Vence el {new Date(hw.due_date_utc).toLocaleDateString("es", {
                                day: "numeric", month: "long", year: "numeric",
                              })}
                            </span>
                          </div>
                          <p className="text-xs sm:text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                            {hw.description}
                          </p>
                        </div>

                        {loadingSubs ? (
                          <div className="space-y-2">
                            <Skeleton className="h-12 w-full rounded-xl" />
                            <Skeleton className="h-12 w-full rounded-xl" />
                          </div>
                        ) : submissions.length === 0 ? (
                          <p className="text-xs text-slate-400 py-3 text-center">
                            Sin entregas todavía
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {submissions.map((sub) => {
                              const st = getStatusLabel(sub.status);
                              const hasSubmission = Boolean(sub.submission) || sub.status === "submitted" || sub.status === "graded";

                              return (
                                <div key={sub.id} className="flex items-center gap-2.5 sm:gap-3 py-2.5 px-3 sm:px-4 bg-slate-50 rounded-xl">
                                  <SubmissionAvatar sub={sub} className="w-8 h-8 rounded-lg flex-shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-bold text-slate-700 truncate">
                                      {sub.student_name ?? "Estudiante"}
                                    </p>
                                    {sub.score !== null && sub.score !== undefined && (
                                      <p className="text-[10px] text-amber-600 font-black">
                                        Nota: {sub.score}/10
                                      </p>
                                    )}
                                  </div>
                                  <span className={`text-[9px] sm:text-[10px] font-black uppercase tracking-widest px-2 sm:px-2.5 py-1 rounded-full flex items-center gap-1 ${st.cls}`}>
                                    {getStatusIcon(sub.status)}
                                    <span className="hidden sm:inline">{st.text}</span>
                                  </span>
                                  <button
                                    onClick={() => setGradeTarget(sub)}
                                    disabled={!hasSubmission}
                                    className={`text-xs font-bold px-2.5 sm:px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 ${
                                      hasSubmission
                                        ? "text-pink-600 bg-pink-50 hover:bg-pink-100 cursor-pointer"
                                        : "text-slate-300 bg-slate-100 cursor-not-allowed opacity-60"
                                    }`}
                                  >
                                    {sub.status === "graded" ? "Editar" : "Calificar"}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─── Tab: Crear ─── */}
        {tab === "create" && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 animate-in fade-in
                          slide-in-from-bottom-4 duration-500">

            <div className="lg:col-span-2 bg-white/80 backdrop-blur-xl rounded-[2rem]
                border border-white shadow-2xl shadow-slate-200/50
                p-5 sm:p-8 space-y-5 relative h-fit">

              <div className="absolute inset-0 rounded-[2rem] overflow-hidden pointer-events-none">
                <div className="absolute top-0 right-0 w-48 h-48 bg-pink-300/10
                                rounded-full blur-[80px]" />
              </div>

              <div className="flex items-center gap-2 relative">
                <FileText className="w-4 h-4 text-pink-500" />
                <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">
                  Detalles de la tarea
                </h2>
              </div>

              <div className="group relative">
                <label className="text-[10px] font-black text-slate-400
                                  uppercase tracking-widest block mb-1.5">
                  Título de la tarea
                </label>
                <div className="relative">
                  <ClipboardList className="absolute left-3.5 top-1/2 -translate-y-1/2
                                             w-5 h-5 text-slate-400
                                             group-focus-within:text-pink-500
                                             transition-colors" />
                  <input
                    value={hwTitle}
                    onChange={e => setHwTitle(e.target.value)}
                    placeholder="Ej: Ejercicios de Present Perfect"
                    className="w-full bg-slate-50 border-2 border-transparent
                               rounded-xl text-sm font-bold text-slate-800
                               placeholder:text-slate-400 pl-11 pr-4 py-3.5
                               focus:outline-none focus:bg-white
                               focus:border-pink-500 focus:ring-4 focus:ring-pink-50
                               transition-all duration-300"
                  />
                </div>
              </div>

              <div className="relative">
                <label className="text-[10px] font-black text-slate-400
                                  uppercase tracking-widest block mb-1.5">
                  Instrucciones
                </label>
                <textarea
                  value={hwContent}
                  onChange={e => setHwContent(e.target.value)}
                  rows={5}
                  placeholder="Describe lo que debe hacer el estudiante..."
                  className="w-full bg-slate-50 border-2 border-transparent
                             rounded-xl text-sm font-medium text-slate-800
                             placeholder:text-slate-400 px-4 py-3.5
                             focus:outline-none focus:bg-white
                             focus:border-pink-500 focus:ring-4 focus:ring-pink-50
                             transition-all duration-300 resize-none"
                />
              </div>

              <div className="relative">
                <label className="text-[10px] font-black text-slate-400
                                  uppercase tracking-widest block mb-1.5">
                  Fecha límite
                </label>
                <DatePicker value={hwDue} onChange={setHwDue} />
              </div>

              {createError && (
                <div className="bg-rose-50 border border-rose-100 text-rose-600
                                px-4 py-3 rounded-xl text-xs font-bold
                                flex items-center gap-2">
                  <X className="w-4 h-4 flex-shrink-0" />
                  {createError}
                </div>
              )}

              <button
                onClick={createHomework}
                disabled={!hwTitle || !hwContent || !hwDue
                          || (!hwStudents.length && !hwCohortId) || creating}
                className="w-full py-3.5 text-sm font-bold text-white rounded-xl
                           bg-gradient-to-r from-pink-500 to-rose-400
                           hover:from-pink-600 hover:to-rose-500
                           shadow-lg shadow-pink-200 hover:shadow-pink-300
                           active:scale-[0.98] transition-all duration-300
                           disabled:opacity-50 disabled:cursor-not-allowed
                           flex items-center justify-center gap-2"
              >
                {creating ? (
                  <div className="w-4 h-4 border-2 border-white/40
                                  border-t-white rounded-full animate-spin" />
                ) : (
                  <><Send className="w-4 h-4" /> Crear y asignar tarea</>
                )}
              </button>
            </div>

            <div className="lg:col-span-3 bg-white/80 backdrop-blur-xl rounded-[2rem]
                            border border-white shadow-2xl shadow-slate-200/50
                            p-5 sm:p-8 space-y-4">

              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-purple-500" />
                  <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">
                    Asignar a estudiantes
                  </h2>
                </div>
                {hwStudents.length > 0 && (
                  <span className="text-xs font-bold text-pink-600 bg-pink-50
                                   px-3 py-1 rounded-full">
                    {hwStudents.length} seleccionado{hwStudents.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>

              {cohorts.length > 0 && (
                <div className="space-y-2 pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <Users2 className="w-4 h-4 text-indigo-500" />
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                      O asignar a un grupo completo
                    </label>
                  </div>
                  <div className="relative">
                    <select
                      value={hwCohortId ?? ""}
                      onChange={e => setHwCohortId(e.target.value ? Number(e.target.value) : null)}
                      className="w-full appearance-none bg-slate-50 border-2 border-transparent rounded-xl
                                text-sm font-bold text-slate-800 px-4 py-3 focus:outline-none focus:bg-white
                                focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50 transition-all cursor-pointer"
                    >
                      <option value="">Ninguno (solo estudiantes seleccionados abajo)</option>
                      {cohorts.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.package_name ?? "Cohorte"} — {c.current_students} alumno{c.current_students !== 1 ? "s" : ""} ({c.status === "filling" ? "llenándose" : c.status === "confirmed" ? "confirmada" : "en curso"})
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  </div>
                  {hwCohortId && (
                    <p className="text-[11px] text-indigo-600 font-bold">
                      Se asignará a todos los integrantes activos de este grupo, además de los estudiantes que marques abajo.
                    </p>
                  )}
                </div>
              )}

              <div className="group relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2
                                    w-4 h-4 text-slate-400
                                    group-focus-within:text-pink-500
                                    transition-colors pointer-events-none" />
                <input
                  value={studentSearch}
                  onChange={e => setStudentSearch(e.target.value)}
                  placeholder="Buscar por nombre o usuario..."
                  className="w-full bg-slate-50 border-2 border-transparent
                             rounded-xl text-sm font-bold text-slate-800
                             placeholder:text-slate-400 pl-10 pr-4 py-3
                             focus:outline-none focus:bg-white
                             focus:border-pink-500 focus:ring-4 focus:ring-pink-50
                             transition-all duration-300"
                />
              </div>

              {students.length === 0 ? (
                <div className="text-center py-10">
                  <Users className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                  <p className="text-sm text-slate-400 font-bold">
                    Aún no tienes estudiantes asignados
                  </p>
                </div>
              ) : filteredStudents.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">
                  Sin resultados para &ldquo;{studentSearch}&rdquo;
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[420px]
                                overflow-y-auto pr-1">
                  {filteredStudents.map(s => (
                    <button
                      key={s.id}
                      onClick={() => toggleStudent(s.id)}
                      className={`w-full flex items-center gap-3 px-4 py-3
                        rounded-2xl border-2 transition-all duration-200 text-left
                        ${hwStudents.includes(s.id)
                          ? "border-pink-400 bg-pink-50"
                          : "border-slate-100 bg-white hover:border-slate-200"
                        }`}
                    >
                      <StudentAvatar s={s} className="w-9 h-9 rounded-xl flex-shrink-0 text-xs" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">
                          {s.name} {s.surname}
                        </p>
                        <p className="text-xs text-slate-400">@{s.username}</p>
                      </div>
                      {hwStudents.includes(s.id) && (
                        <Check className="w-4 h-4 text-pink-500 ml-auto flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {gradeTarget && (
        <GradeModal
          submission={gradeTarget}
          onClose={() => setGradeTarget(null)}
          onSaved={refetchSubmissions}
        />
      )}
      {editTarget && (
        <EditHomeworkModal
          hw={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={refetchHomework}
        />
      )}
      {deleteTarget && (
        <DeleteHomeworkModal
          hw={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={handleDeleted}
        />
      )}
    </div>
    <ChipiWidget screenName="homework_teacher" />
    </>
  );
}