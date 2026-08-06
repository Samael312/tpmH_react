"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import {
  ClipboardList, Plus, Send, Star, Clock,
  CheckCircle, AlertCircle, ChevronDown,
  X, Search, Calendar, Check, Users,
  BarChart3, FileText, Edit2, Trash2, AlertTriangle,
} from "lucide-react";
import api from "@/lib/api";
import ChipiWidget from "@/components/chipi/ChipiWidget";

interface Homework {
  id: number;
  teacher_id: number;
  title: string;
  description: string;
  due_date_utc: string;
  is_active: boolean;
  created_at: string;
}

interface Submission {
  id: number;
  homework_id: number;
  student_id: number;
  status: string; // "pending" | "submitted" | "graded"
  submission: string | null;
  submitted_at: string | null;
  score: number | null;
  feedback: string | null;
  graded_at: string | null;
  assigned_at: string;
  student_name?: string;
  student_username?: string;
  student_avatar?: string | null;
}

interface Student {
  id: number;
  user_id: number;
  username: string;
  name: string;
  surname: string;
  avatar?: string | null;
}

function StudentAvatar({ s, className }: { s: Student; className?: string }) {
  if (s.avatar) {
    return <img src={s.avatar} alt={s.name} className={`${className} object-cover`} />;
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
    return <img src={sub.student_avatar} alt={sub.student_name ?? ""} className={`${className} object-cover`} />;
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
        <div className="absolute z-50 bottom-full mb-2 w-72 bg-white/95 backdrop-blur-xl
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
      setTimeout(() => { onSaved(); onClose(); }, 1000);
    } catch (e: any) {
      alert(e.response?.data?.detail || "Error calificando");
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
           onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white/95 backdrop-blur-2xl
                      rounded-[2.5rem] shadow-2xl shadow-slate-200/60
                      border border-white p-8 animate-in fade-in zoom-in-95
                      duration-200">

        <div className="absolute top-0 left-0 w-48 h-48 bg-amber-300/20
                        rounded-full blur-[80px] pointer-events-none" />

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <SubmissionAvatar sub={submission} className="w-10 h-10 rounded-xl flex-shrink-0" />
            <div>
              <h2 className="text-xl font-black text-slate-800 tracking-tight">
                Calificar entrega
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">
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

  const save = async () => {
    setSaving(true); setError("");
    try {
      await api.patch(`/homework/${hw.id}`, {
        title,
        description: content,
        due_date_utc: new Date(`${due}T23:59:59`).toISOString(),
      });
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.response?.data?.detail || "Error actualizando la tarea");
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white/95 backdrop-blur-2xl rounded-[2.5rem] shadow-2xl border border-white p-8 space-y-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
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

  const confirmDelete = async () => {
    setDeleting(true);
    setError("");
    try {
      await api.delete(`/homework/${hw.id}`);
      onDeleted();
      onClose();
    } catch (e: any) {
      setError(e.response?.data?.detail || "Error eliminando la tarea");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-white/95 backdrop-blur-2xl
                      rounded-[2.5rem] shadow-2xl shadow-slate-200/60
                      border border-white p-8
                      animate-in fade-in zoom-in-95 duration-200">

        <div className="absolute top-0 right-0 w-40 h-40 bg-red-300/20
                        rounded-full blur-[60px] pointer-events-none" />

        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-14 h-14 bg-red-100 rounded-full flex items-center
                          justify-center mb-4">
            <AlertTriangle className="w-7 h-7 text-red-500" />
          </div>
          <h2 className="text-xl font-black text-slate-800 tracking-tight mb-2">
            ¿Eliminar tarea?
          </h2>
          <p className="text-sm text-slate-500">
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
  const [homeworks, setHomeworks]     = useState<Homework[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [students, setStudents]       = useState<Student[]>([]);
  const [loading, setLoading]         = useState(true);
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

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [hwRes, stuRes] = await Promise.all([
        api.get("/homework/my-homework"),
        api.get("/teachers/me/students"),
      ]);
      setHomeworks(hwRes.data);
      setStudents(stuRes.data);
    } catch { }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const [loadingSubs, setLoadingSubs] = useState(false);

  const fetchSubmissions = async (hwId: number) => {
    if (activeHw === hwId) { setActiveHw(null); return; }
    setActiveHw(hwId);
    setSubmissions([]);
    setLoadingSubs(true);
    try {
      const res = await api.get(`/homework/${hwId}/submissions`);
      setSubmissions(res.data);
    } catch { }
    finally { setLoadingSubs(false); }
  };

  const createHomework = async () => {
    if (!hwTitle || !hwContent || !hwDue || !hwStudents.length) return;
    setCreating(true);
    setCreateError("");
    try {
      const dueDateUtc = new Date(`${hwDue}T23:59:59`).toISOString();
      await api.post("/homework/", {
        title: hwTitle,
        description: hwContent,
        due_date_utc: dueDateUtc,
        student_ids: hwStudents,
      });
      setHwTitle(""); setHwContent(""); setHwDue("");
      setHwStudents([]);
      setStudentSearch("");
      fetchAll();
      setTab("review");
    } catch (e: any) {
      const detail = e.response?.data?.detail;
      setCreateError(
        Array.isArray(detail)
          ? detail.map((d: any) => d.msg || JSON.stringify(d)).join(", ")
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
    fetchAll();
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
    <div className="min-h-screen bg-slate-50 relative overflow-x-hidden">

      <div className="fixed top-[-80px] right-[-80px] w-[450px] h-[450px]
                      bg-pink-300/20 rounded-full blur-[100px] pointer-events-none" />
      <div className="fixed bottom-0 left-[-100px] w-[400px] h-[400px]
                      bg-purple-300/15 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">

        {/* Header */}
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500
                        flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-slate-800 tracking-tight">
              Tareas
            </h1>
            <p className="text-slate-500 mt-1">
              Crea actividades y califica las entregas de tus estudiantes
            </p>
          </div>
        </div>

        {/* Confirmación de eliminado */}
        {justDeleted && (
          <div className="bg-emerald-50 border border-emerald-100 text-emerald-700
                          px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-2
                          animate-in fade-in slide-in-from-top-2 duration-300">
            <Check className="w-4 h-4 flex-shrink-0" />
            Tarea eliminada correctamente
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 animate-in fade-in slide-in-from-bottom-4
                        duration-500 delay-75">
          {[
            { label: "Total tareas", value: homeworks.length, icon: <ClipboardList className="w-5 h-5" />, bg: "bg-pink-50 text-pink-500" },
            { label: "Activas", value: activeCount, icon: <BarChart3 className="w-5 h-5" />, bg: "bg-emerald-50 text-emerald-500" },
            { label: "Vencen esta semana", value: dueThisWeek, icon: <Clock className="w-5 h-5" />, bg: "bg-amber-50 text-amber-500" },
          ].map(s => (
            <div key={s.label}
              className="bg-white/85 backdrop-blur-xl rounded-2xl border border-white
                        shadow-lg shadow-slate-100 p-5 flex items-center gap-4">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${s.bg}`}>
                {s.icon}
              </div>
              <div>
                <p className="text-2xl font-black text-slate-800 leading-none">{s.value}</p>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">
                  {s.label}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-white/80 backdrop-blur-xl
                        border border-white rounded-2xl p-1 w-fit shadow-lg
                        shadow-slate-100 animate-in fade-in duration-500 delay-100">
          {[
            { key: "review", label: "Revisar entregas", icon: <ClipboardList className="w-4 h-4" /> },
            { key: "create", label: "Nueva tarea",      icon: <Plus className="w-4 h-4" /> },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key as any)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl
                text-sm font-bold transition-all duration-200
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
                                  w-5 h-5 text-slate-400
                                  group-focus-within:text-pink-500
                                  transition-colors pointer-events-none" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar tarea..."
                className="w-full bg-white border-2 border-transparent rounded-xl
                           text-sm font-bold text-slate-800 placeholder:text-slate-400
                           pl-11 pr-4 py-3 focus:outline-none focus:border-pink-500
                           focus:ring-4 focus:ring-pink-50 transition-all duration-300
                           shadow-sm"
              />
            </div>

            {loading ? (
              <div className="space-y-3">
                {[1,2,3].map(i => (
                  <div key={i} className="h-20 bg-white rounded-2xl animate-pulse"/>
                ))}
              </div>
            ) : filteredHw.length === 0 ? (
              <div className="bg-white/80 backdrop-blur-xl rounded-[2rem]
                              border border-white shadow-lg py-16 text-center">
                <ClipboardList className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                <p className="text-slate-500 font-bold">
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
                      onClick={() => fetchSubmissions(hw.id)}
                      className="w-full flex items-center gap-4 p-5 text-left
                                 hover:bg-slate-50/50 transition-colors cursor-pointer"
                    >
                      <div className="w-10 h-10 bg-pink-50 rounded-xl
                                      flex items-center justify-center flex-shrink-0">
                        <ClipboardList className="w-5 h-5 text-pink-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">
                          {hw.title}
                        </p>
                        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                          <span className="text-xs text-slate-400 flex items-center gap-1">
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
                        className="flex items-center gap-1 text-xs font-bold text-slate-400 hover:text-pink-500 px-2.5 py-1.5 rounded-lg hover:bg-pink-50 transition-colors flex-shrink-0"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Editar</span>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(hw); }}
                        className="flex items-center gap-1 text-xs font-bold text-slate-400 hover:text-red-500 px-2.5 py-1.5 rounded-lg hover:bg-red-50 transition-colors flex-shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Eliminar</span>
                      </button>
                      <ChevronDown className={`w-4 h-4 text-slate-400 flex-shrink-0
                        transition-transform duration-200
                        ${activeHw === hw.id ? "rotate-180" : ""}`} />
                    </div>

                    {activeHw === hw.id && (
                      <div className="border-t border-slate-100 px-5 pb-5 pt-4 space-y-4">

                        {/* Vista previa: instrucciones completas + fecha límite */}
                        <div className="bg-slate-50 rounded-2xl p-4 space-y-2">
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
                          <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                            {hw.description}
                          </p>
                        </div>

                        {loadingSubs ? (
                          <div className="flex justify-center py-4">
                            <div className="w-5 h-5 border-2 border-pink-200 border-t-pink-500 rounded-full animate-spin" />
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
                                <div key={sub.id} className="flex items-center gap-3 py-2.5 px-4 bg-slate-50 rounded-xl">
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
                                  <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full flex items-center gap-1 ${st.cls}`}>
                                    {getStatusIcon(sub.status)}
                                    {st.text}
                                  </span>
                                  <button
                                    onClick={() => setGradeTarget(sub)}
                                    disabled={!hasSubmission}
                                    className={`text-xs font-bold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 ${
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
                p-6 sm:p-8 space-y-5 relative h-fit">

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
                          || !hwStudents.length || creating}
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
                            p-6 sm:p-8 space-y-4">

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
                  Sin resultados para "{studentSearch}"
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
      <ChipiWidget screenName="homework" />
      {gradeTarget && (
        <GradeModal
          submission={gradeTarget}
          onClose={() => setGradeTarget(null)}
          onSaved={() => activeHw && fetchSubmissions(activeHw)}
        />
      )}
      {editTarget && (
        <EditHomeworkModal
          hw={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={fetchAll}
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
  );
}