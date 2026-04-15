"use client";

import { useState } from "react";
import {
  ClipboardList, Clock, CheckCircle, Star,
  Send, X, ChevronDown, AlertCircle,
  BookOpen, Award
} from "lucide-react";
import { useStudentHomework } from "@/hooks/useStudentData";
import api from "@/lib/api";
import ChipiWidget from "@/components/chipi/ChipiWidget";

const STATUS_CONFIG: Record<string, {
  label: string;
  badge: string;
  border: string;
  icon: React.ReactNode;
}> = {
  Pending: {
    label: "Pendiente",
    badge: "bg-amber-100 text-amber-700",
    border: "border-l-amber-400",
    icon: <Clock className="w-3.5 h-3.5" />,
  },
  Submitted: {
    label: "Entregada",
    badge: "bg-blue-100 text-blue-700",
    border: "border-l-blue-400",
    icon: <Send className="w-3.5 h-3.5" />,
  },
  Graded: {
    label: "Calificada",
    badge: "bg-emerald-100 text-emerald-700",
    border: "border-l-emerald-400",
    icon: <Star className="w-3.5 h-3.5" />,
  },
};

// ─── Modal entregar tarea ─────────────────────────────────────────────────────
function SubmitModal({
  hw,
  onClose,
  onSaved,
}: {
  hw: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText]       = useState(hw.submission ?? "");
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError]     = useState("");

  const submit = async () => {
    if (!text.trim()) return;
    setSending(true);
    setError("");
    try {
      await api.post(`/homework/student/${hw.homework_id}/submit`, {
        submission: text,
      });
      setSuccess(true);
      setTimeout(() => { onSaved(); onClose(); }, 1200);
    } catch (e: any) {
      setError(e.response?.data?.detail || "Error enviando la tarea");
    } finally {
      setSending(false);
    }
  };

  const dueDate = new Date(hw.date_due + "T00:00:00");
  const isOverdue = dueDate < new Date();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-xl bg-white/95 backdrop-blur-2xl
                      rounded-[2.5rem] shadow-2xl shadow-slate-200/60
                      border border-white p-8 animate-in fade-in zoom-in-95
                      duration-200 max-h-[90vh] overflow-y-auto"
      >
        {/* Blob */}
        <div
          className="absolute top-0 right-0 w-48 h-48 bg-pink-300/20
                        rounded-full blur-[80px] pointer-events-none"
        />

        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-xl font-black text-slate-800 tracking-tight">
              {hw.status === "Submitted" ? "Editar entrega" : "Entregar tarea"}
            </h2>
            <p className="text-sm text-slate-500 mt-0.5 line-clamp-1">
              {hw.title}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200
                         flex items-center justify-center transition-colors
                         flex-shrink-0"
          >
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        {/* Alerta vencida */}
        {isOverdue && (
          <div
            className="mb-5 bg-amber-50 border border-amber-100 rounded-xl
                          px-4 py-3 flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
            <p className="text-xs font-bold text-amber-600">
              Esta tarea venció el{" "}
              {dueDate.toLocaleDateString("es", {
                day: "numeric",
                month: "long",
              })}
              . Aún puedes entregarla.
            </p>
          </div>
        )}

        {/* Instrucciones */}
        <div className="bg-slate-50 rounded-2xl p-4 mb-5">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
            Instrucciones
          </p>
          <p className="text-sm text-slate-700 leading-relaxed">
            {hw.content}
          </p>
        </div>

        {success ? (
          <div className="flex flex-col items-center py-8 gap-3">
            <div
              className="w-14 h-14 rounded-full bg-emerald-100
                            flex items-center justify-center"
            >
              <CheckCircle className="w-7 h-7 text-emerald-600" />
            </div>
            <p className="font-bold text-slate-700">¡Tarea entregada!</p>
          </div>
        ) : (
          <>
            {/* Textarea */}
            <div className="mb-5">
              <label
                className="text-[10px] font-black text-slate-400
                              uppercase tracking-widest block mb-1.5"
              >
                Tu respuesta
              </label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={6}
                placeholder="Escribe tu respuesta aquí..."
                className="w-full bg-slate-50 border-2 border-transparent
                             rounded-xl text-sm font-medium text-slate-800
                             placeholder:text-slate-400 px-4 py-3.5
                             focus:outline-none focus:bg-white
                             focus:border-pink-500 focus:ring-4 focus:ring-pink-50
                             transition-all duration-300 resize-none"
              />
              <p className="text-xs text-slate-400 text-right mt-1">
                {text.length} caracteres
              </p>
            </div>

            {/* Error */}
            {error && (
              <div
                className="mb-4 bg-rose-50 border border-rose-100 text-rose-600
                              px-4 py-3 rounded-xl text-xs font-bold
                              flex items-center gap-2"
              >
                <X className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <button
              onClick={submit}
              disabled={!text.trim() || sending}
              className="w-full py-3.5 text-sm font-bold text-white rounded-xl
                           bg-gradient-to-r from-pink-500 to-rose-400
                           hover:from-pink-600 hover:to-rose-500
                           shadow-lg shadow-pink-200 hover:shadow-pink-300
                           active:scale-[0.98] transition-all duration-300
                           disabled:opacity-50 disabled:cursor-not-allowed
                           flex items-center justify-center gap-2"
            >
              {sending ? (
                <div
                  className="w-4 h-4 border-2 border-white/40
                                border-t-white rounded-full animate-spin"
                />
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  {hw.status === "Submitted"
                    ? "Actualizar entrega"
                    : "Enviar tarea"}
                </>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Card de tarea calificada (expandible) ────────────────────────────────────
function GradedCard({ hw }: { hw: any }) {
  const [expanded, setExpanded] = useState(false);
  const score = hw.grade?.score;
  const feedback = hw.grade?.feedback;

  const scoreColor =
    score >= 8
      ? "text-emerald-600"
      : score >= 6
      ? "text-amber-600"
      : "text-red-500";

  const scoreBg =
    score >= 8
      ? "bg-emerald-50 border-emerald-200"
      : score >= 6
      ? "bg-amber-50 border-amber-200"
      : "bg-red-50 border-red-200";

  return (
    <div
      className="bg-white/80 backdrop-blur-xl rounded-2xl border border-white
                    shadow-lg border-l-4 border-l-emerald-400
                    hover:shadow-xl transition-all duration-300"
    >
      {/* Cabecera */}
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-start gap-4 p-5 text-left"
      >
        {/* Score */}
        <div
          className={`flex-shrink-0 w-14 h-14 rounded-2xl border-2
                          flex flex-col items-center justify-center ${scoreBg}`}
        >
          <span className={`text-xl font-black leading-none ${scoreColor}`}>
            {score ?? "–"}
          </span>
          <span className="text-[9px] text-slate-400 font-black">/10</span>
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-800 mb-1 line-clamp-1">
            {hw.title}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-[10px] font-black uppercase tracking-widest
                              px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700
                              flex items-center gap-1"
            >
              <Star className="w-3 h-3" />
              Calificada
            </span>
            {hw.grade?.graded_at && (
              <span className="text-[10px] text-slate-400 font-bold">
                {new Date(hw.grade.graded_at).toLocaleDateString("es", {
                  day: "numeric",
                  month: "short",
                })}
              </span>
            )}
          </div>
        </div>

        <ChevronDown
          className={`w-4 h-4 text-slate-400 flex-shrink-0 mt-1
                          transition-transform duration-200
                          ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {/* Detalle expandido */}
      {expanded && (
        <div
          className="border-t border-slate-100 px-5 pb-5 pt-4
                        animate-in fade-in slide-in-from-top-2 duration-200"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            {/* Tu respuesta */}
            <div>
              <p
                className="text-[10px] font-black text-slate-400 uppercase
                              tracking-widest mb-2"
              >
                Tu respuesta
              </p>
              <div className="bg-slate-50 rounded-xl p-3 max-h-32 overflow-y-auto">
                <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">
                  {hw.submission ?? "Sin respuesta enviada"}
                </p>
              </div>
            </div>

            {/* Feedback */}
            <div>
              <p
                className="text-[10px] font-black text-slate-400 uppercase
                              tracking-widest mb-2"
              >
                Retroalimentación
              </p>
              <div className="bg-emerald-50 rounded-xl p-3 max-h-32 overflow-y-auto">
                <p className="text-xs text-emerald-800 leading-relaxed">
                  {feedback ?? "Sin comentarios adicionales"}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Card de tarea pendiente/entregada ────────────────────────────────────────
function HomeworkCard({
  hw,
  onSubmit,
}: {
  hw: any;
  onSubmit: () => void;
}) {
  const cfg =
    STATUS_CONFIG[hw.status as keyof typeof STATUS_CONFIG] ??
    STATUS_CONFIG.Pending;

  const dueDate = new Date(hw.date_due + "T00:00:00");
  const isOverdue = dueDate < new Date() && hw.status === "Pending";
  const daysLeft = Math.ceil(
    (dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );

  return (
    <div
      className={`bg-white/80 backdrop-blur-xl rounded-2xl border border-white
                    shadow-lg border-l-4 ${cfg.border}
                    hover:shadow-xl transition-all duration-300`}
    >
      <div className="flex items-start gap-4 p-5">
        {/* Icono */}
        <div
          className="w-11 h-11 bg-slate-50 rounded-xl flex items-center
                        justify-center flex-shrink-0"
        >
          <ClipboardList className="w-5 h-5 text-slate-400" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-2">
            <p className="text-sm font-bold text-slate-800 line-clamp-2 leading-snug">
              {hw.title}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap mb-3">
            <span
              className={`text-[10px] font-black uppercase tracking-widest
                              px-2.5 py-1 rounded-full flex items-center gap-1
                              ${cfg.badge}`}
            >
              {cfg.icon}
              {cfg.label}
            </span>

            {/* Fecha vencimiento */}
            <span
              className={`text-[10px] font-black flex items-center gap-1
                              ${
                                isOverdue
                                  ? "text-red-500"
                                  : daysLeft <= 3
                                  ? "text-amber-600"
                                  : "text-slate-400"
                              }`}
            >
              <Clock className="w-3 h-3" />
              {isOverdue
                ? "Vencida"
                : daysLeft === 0
                ? "Vence hoy"
                : daysLeft === 1
                ? "Vence mañana"
                : `${daysLeft} días`}
            </span>
          </div>

          {/* Preview instrucciones */}
          <p className="text-xs text-slate-500 line-clamp-2 mb-3 leading-relaxed">
            {hw.content}
          </p>

          {/* Acciones */}
          <div className="flex gap-2">
            {hw.status !== "Graded" && (
              <button
                onClick={onSubmit}
                className={`flex items-center gap-1.5 text-xs font-bold
                               px-3.5 py-2 rounded-xl transition-colors
                               ${
                                 hw.status === "Submitted"
                                   ? "bg-blue-50 text-blue-600 hover:bg-blue-100"
                                   : "bg-pink-50 text-pink-600 hover:bg-pink-100"
                               }`}
              >
                <Send className="w-3.5 h-3.5" />
                {hw.status === "Submitted" ? "Editar entrega" : "Entregar"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function StudentHomeworkPage() {
  const { homeworks, loading, refetch } = useStudentHomework();
  const [tab, setTab] = useState<"pending" | "graded">("pending");
  const [submitTarget, setSubmitTarget] = useState<any | null>(null);

  const pending = homeworks.filter((h) => h.status !== "Graded");
  const graded  = homeworks.filter((h) => h.status === "Graded");

  const pendingUnsent = pending.filter((h) => h.status === "Pending").length;
  const displayed     = tab === "pending" ? pending : graded;

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">
      {/* Blobs */}
      <div
        className="fixed top-[-80px] right-[-80px] w-[500px] h-[500px]
                      bg-pink-300/20 rounded-full blur-[100px] pointer-events-none"
      />
      <div
        className="fixed bottom-[-80px] left-[-80px] w-[400px] h-[400px]
                      bg-blue-300/15 rounded-full blur-[100px] pointer-events-none"
      />

      <div className="relative space-y-6">
        {/* Header */}
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">
            Mis Tareas
          </h1>
          <p className="text-slate-500 mt-1">
            Entrega tus actividades y revisa tus calificaciones
          </p>
        </div>

        {/* Stats rápidos */}
        <div
          className="grid grid-cols-3 gap-4 animate-in fade-in
                        slide-in-from-bottom-4 duration-500 delay-100"
        >
          {[
            {
              label: "Por entregar",
              value: pendingUnsent,
              color: "text-amber-600",
              bg: "bg-amber-50 border-amber-100",
            },
            {
              label: "Entregadas",
              value: pending.filter((h) => h.status === "Submitted").length,
              color: "text-blue-600",
              bg: "bg-blue-50 border-blue-100",
            },
            {
              label: "Calificadas",
              value: graded.length,
              color: "text-emerald-600",
              bg: "bg-emerald-50 border-emerald-100",
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className={`${stat.bg} border rounded-2xl p-4 text-center`}
            >
              <p className={`text-2xl font-black ${stat.color}`}>
                {stat.value}
              </p>
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-0.5">
                {stat.label}
              </p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div
          className="flex gap-1 bg-white/80 backdrop-blur-xl border
                        border-white rounded-2xl p-1 w-fit shadow-lg
                        shadow-slate-100 animate-in fade-in duration-500 delay-150"
        >
          {[
            { key: "pending", label: `Pendientes (${pending.length})` },
            { key: "graded", label: `Calificadas (${graded.length})` },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key as any)}
              className={`
                px-5 py-2.5 rounded-xl text-sm font-bold
                transition-all duration-200
                ${
                  tab === t.key
                    ? "bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-md"
                    : "text-slate-500 hover:text-slate-700"
                }
              `}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Lista */}
        <div
          className="animate-in fade-in slide-in-from-bottom-4 duration-500
                        delay-200 space-y-3"
        >
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-28 bg-white rounded-2xl animate-pulse"
              />
            ))
          ) : displayed.length === 0 ? (
            <div
              className="bg-white/80 backdrop-blur-xl rounded-[2rem]
                            border border-white shadow-lg py-16 text-center"
            >
              {tab === "pending" ? (
                <>
                  <CheckCircle className="w-12 h-12 text-emerald-200 mx-auto mb-3" />
                  <p className="text-slate-500 font-bold">
                    ¡Todo al día! Sin tareas pendientes
                  </p>
                </>
              ) : (
                <>
                  <Award className="w-12 h-12 text-slate-200 mx-auto mb-3" />
                  <p className="text-slate-500 font-bold">
                    Aún no tienes tareas calificadas
                  </p>
                </>
              )}
            </div>
          ) : (
            displayed.map((hw) =>
              tab === "graded" ? (
                <GradedCard key={hw.id} hw={hw} />
              ) : (
                <HomeworkCard
                  key={hw.id}
                  hw={hw}
                  onSubmit={() => setSubmitTarget(hw)}
                />
              )
            )
          )}
        </div>
        <ChipiWidget screenName="homework" />
      </div>

      {/* Modal entregar */}
      {submitTarget && (
        <SubmitModal
          hw={submitTarget}
          onClose={() => setSubmitTarget(null)}
          onSaved={refetch}
        />
      )}
    </div>
  );
}