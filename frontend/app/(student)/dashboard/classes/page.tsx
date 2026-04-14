"use client";

import { useState } from "react";
import {
  Clock, Video, Calendar, ChevronLeft,
  ChevronRight, AlertCircle, X, Check,
  RotateCcw, BookOpen
} from "lucide-react";
import { useStudentClasses, useAvailableSlots } from "@/hooks/useStudentData";
import api from "@/lib/api";

const STATUS_CONFIG: Record<string, {
  label: string;
  badge: string;
  border: string;
  dot: string;
}> = {
  pending:         { label: "Pendiente de pago",  badge: "bg-amber-100 text-amber-700",    border: "border-l-amber-400",   dot: "bg-amber-400" },
  pending_payment: { label: "Pago en revisión",   badge: "bg-blue-100 text-blue-700",      border: "border-l-blue-400",    dot: "bg-blue-400" },
  confirmed:       { label: "Confirmada",         badge: "bg-emerald-100 text-emerald-700", border: "border-l-emerald-400", dot: "bg-emerald-400" },
  completed:       { label: "Completada",         badge: "bg-slate-100 text-slate-500",    border: "border-l-slate-300",   dot: "bg-slate-300" },
  cancelled:       { label: "Cancelada",          badge: "bg-red-100 text-red-600",        border: "border-l-red-400",     dot: "bg-red-400" },
  no_show:         { label: "No asististe",       badge: "bg-red-100 text-red-600",        border: "border-l-red-600",     dot: "bg-red-600" },
  rescheduled:     { label: "Reagendada",         badge: "bg-purple-100 text-purple-700",  border: "border-l-purple-400",  dot: "bg-purple-400" },
};

const HISTORY_STATUSES = ["completed", "cancelled", "no_show"];

// ─── Mini calendario inline para reagendar ────────────────────────────────────
function RescheduleCalendar({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const today = new Date();
  const [year, setYear]   = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const MONTHS    = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
                     "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const DAYS_HEAD = ["L","M","X","J","V","S","D"];

  const firstDay    = new Date(year, month, 1).getDay();
  const offset      = (firstDay + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells       = Array.from(
    { length: offset + daysInMonth },
    (_, i) => (i < offset ? null : i - offset + 1)
  );

  return (
    <div className="bg-slate-50 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => {
            if (month === 0) { setMonth(11); setYear(y => y - 1); }
            else setMonth(m => m - 1);
          }}
          className="w-8 h-8 rounded-lg bg-white border border-slate-200
                     flex items-center justify-center hover:border-pink-300
                     transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5 text-slate-600" />
        </button>
        <span className="text-sm font-black text-slate-700">
          {MONTHS[month]} {year}
        </span>
        <button
          onClick={() => {
            if (month === 11) { setMonth(0); setYear(y => y + 1); }
            else setMonth(m => m + 1);
          }}
          className="w-8 h-8 rounded-lg bg-white border border-slate-200
                     flex items-center justify-center hover:border-pink-300
                     transition-colors"
        >
          <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
        </button>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {DAYS_HEAD.map(d => (
          <div key={d}
            className="text-center text-[9px] font-black text-slate-400
                       uppercase tracking-widest py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const dateStr = `${year}-${String(month + 1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
          const isSelected = dateStr === value;
          const isPast     = new Date(dateStr) < new Date(today.toDateString());
          const isToday    = dateStr === today.toISOString().split("T")[0];

          return (
            <button
              key={i}
              disabled={isPast}
              onClick={() => onChange(dateStr)}
              className={`
                w-full aspect-square rounded-lg text-xs font-bold
                transition-all duration-150
                ${isSelected
                  ? "bg-gradient-to-br from-pink-500 to-rose-400 text-white shadow-sm"
                  : isPast
                    ? "text-slate-300 cursor-not-allowed"
                    : isToday
                      ? "bg-pink-50 text-pink-600 border border-pink-200"
                      : "text-slate-600 hover:bg-pink-50 hover:text-pink-600"
                }
              `}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Modal Reagendar ──────────────────────────────────────────────────────────
function RescheduleModal({
  classId,
  currentDuration,
  onClose,
  onSaved,
}: {
  classId: number;
  currentDuration: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate]       = useState("");
  const [saving, setSaving]   = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError]     = useState("");
  const [selected, setSelected] = useState<any>(null);

  const { slots, loading } = useAvailableSlots(date, currentDuration);

  const formatTime = (utc: string) =>
    new Date(utc).toLocaleTimeString("es", {
      hour: "2-digit", minute: "2-digit",
    });

  const reschedule = async () => {
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      await api.patch(`/classes/${classId}/reschedule`, {
        start_time_utc: selected.start_time_utc,
        end_time_utc:   selected.end_time_utc,
      });
      setSuccess(true);
      setTimeout(() => { onSaved(); onClose(); }, 1200);
    } catch (e: any) {
      setError(e.response?.data?.detail || "Error reagendando");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
           onClick={onClose} />

      <div className="relative w-full max-w-2xl bg-white/95 backdrop-blur-2xl
                      rounded-[2.5rem] shadow-2xl shadow-slate-200/60
                      border border-white p-6 sm:p-8
                      animate-in fade-in zoom-in-95 duration-200
                      max-h-[90vh] overflow-y-auto">

        {/* Blob */}
        <div className="absolute top-0 right-0 w-48 h-48 bg-purple-300/20
                        rounded-full blur-[80px] pointer-events-none" />

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-black text-slate-800 tracking-tight">
              Reagendar clase
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Elige una nueva fecha y horario
            </p>
          </div>
          <button onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200
                       flex items-center justify-center transition-colors">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        {success ? (
          <div className="flex flex-col items-center py-10 gap-3">
            <div className="w-14 h-14 rounded-full bg-emerald-100
                            flex items-center justify-center">
              <Check className="w-7 h-7 text-emerald-600" />
            </div>
            <p className="font-bold text-slate-700">¡Clase reagendada!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">

            {/* Calendario */}
            <div>
              <p className="text-[10px] font-black text-slate-400
                            uppercase tracking-widest mb-3">
                Nueva fecha
              </p>
              <RescheduleCalendar value={date} onChange={setDate} />
            </div>

            {/* Slots */}
            <div>
              <p className="text-[10px] font-black text-slate-400
                            uppercase tracking-widest mb-3">
                Horarios disponibles
              </p>

              {!date ? (
                <div className="flex flex-col items-center justify-center
                                h-full py-10 bg-slate-50 rounded-2xl">
                  <Calendar className="w-8 h-8 text-slate-200 mb-2" />
                  <p className="text-xs text-slate-400 font-bold">
                    Selecciona una fecha
                  </p>
                </div>
              ) : loading ? (
                <div className="flex justify-center py-10">
                  <div className="w-7 h-7 border-4 border-pink-200
                                  border-t-pink-500 rounded-full animate-spin" />
                </div>
              ) : slots.length === 0 ? (
                <div className="flex flex-col items-center justify-center
                                py-10 bg-slate-50 rounded-2xl">
                  <AlertCircle className="w-8 h-8 text-slate-200 mb-2" />
                  <p className="text-xs text-slate-400 font-bold text-center">
                    Sin disponibilidad
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 max-h-64
                                overflow-y-auto pr-1">
                  {slots.map((slot, i) => (
                    <button
                      key={i}
                      onClick={() => setSelected(slot)}
                      className={`
                        py-3 px-2 rounded-xl text-center border-2
                        transition-all duration-150
                        ${selected?.start_time_utc === slot.start_time_utc
                          ? "border-pink-400 bg-pink-50"
                          : slot.is_preferred
                            ? "border-purple-200 bg-purple-50 hover:border-purple-300"
                            : "border-slate-100 bg-white hover:border-pink-200"
                        }
                      `}
                    >
                      <p className={`text-sm font-black
                        ${selected?.start_time_utc === slot.start_time_utc
                          ? "text-pink-600"
                          : "text-slate-700"
                        }`}>
                        {formatTime(slot.start_time_utc)}
                      </p>
                      {slot.is_preferred && (
                        <span className="text-[9px] font-black text-purple-500
                                         uppercase tracking-widest">
                          Preferido
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mt-4 bg-rose-50 border border-rose-100 text-rose-600
                          px-4 py-3 rounded-xl text-xs font-bold
                          flex items-center gap-2">
            <X className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {!success && (
          <button
            onClick={reschedule}
            disabled={!selected || saving}
            className="w-full mt-5 py-3.5 text-sm font-bold text-white
                       rounded-xl bg-gradient-to-r from-pink-500 to-rose-400
                       hover:from-pink-600 hover:to-rose-500
                       shadow-lg shadow-pink-200 active:scale-[0.98]
                       transition-all duration-300 disabled:opacity-50
                       disabled:cursor-not-allowed flex items-center
                       justify-center gap-2"
          >
            {saving ? (
              <div className="w-4 h-4 border-2 border-white/40
                              border-t-white rounded-full animate-spin" />
            ) : (
              <><RotateCcw className="w-4 h-4" /> Confirmar reagendamiento</>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Modal Cancelar ───────────────────────────────────────────────────────────
function CancelModal({
  classId,
  classDate,
  onClose,
  onSaved,
}: {
  classId: number;
  classDate: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [cancelling, setCancelling] = useState(false);
  const [error, setError]           = useState("");

  const cancel = async () => {
    setCancelling(true);
    setError("");
    try {
      await api.delete(`/classes/${classId}`);
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.response?.data?.detail || "Error cancelando la clase");
    } finally {
      setCancelling(false);
    }
  };

  const dateFormatted = new Date(classDate).toLocaleDateString("es", {
    weekday: "long", day: "numeric", month: "long",
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
           onClick={onClose} />
      <div className="relative w-full max-w-sm bg-white/95 backdrop-blur-2xl
                      rounded-[2.5rem] shadow-2xl shadow-slate-200/60
                      border border-white p-8
                      animate-in fade-in zoom-in-95 duration-200">

        <div className="absolute top-0 right-0 w-40 h-40 bg-red-300/20
                        rounded-full blur-[60px] pointer-events-none" />

        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-14 h-14 bg-red-100 rounded-full flex items-center
                          justify-center mb-4">
            <AlertCircle className="w-7 h-7 text-red-500" />
          </div>
          <h2 className="text-xl font-black text-slate-800 tracking-tight mb-2">
            ¿Cancelar clase?
          </h2>
          <p className="text-sm text-slate-500">
            La clase del{" "}
            <span className="font-bold text-slate-700 capitalize">
              {dateFormatted}
            </span>{" "}
            será cancelada. Esta acción no se puede deshacer.
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
            className="flex-1 py-3 text-sm font-bold text-slate-600
                       bg-slate-100 hover:bg-slate-200 rounded-xl
                       transition-colors"
          >
            Volver
          </button>
          <button
            onClick={cancel}
            disabled={cancelling}
            className="flex-1 py-3 text-sm font-bold text-white bg-red-500
                       hover:bg-red-600 rounded-xl shadow-md shadow-red-100
                       active:scale-[0.98] transition-all duration-200
                       disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {cancelling ? (
              <div className="w-4 h-4 border-2 border-white/40
                              border-t-white rounded-full animate-spin" />
            ) : (
              <><X className="w-4 h-4" /> Cancelar clase</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Tarjeta de clase ─────────────────────────────────────────────────────────
function ClassCard({
  cls,
  onReschedule,
  onCancel,
}: {
  cls: any;
  onReschedule: () => void;
  onCancel: () => void;
}) {
  const cfg   = STATUS_CONFIG[cls.status] ?? STATUS_CONFIG.pending;
  const start = new Date(cls.start_time_utc);
  const end   = new Date(cls.end_time_utc);
  const isHistory = HISTORY_STATUSES.includes(cls.status);
  const canAct    = ["pending", "pending_payment", "confirmed"].includes(cls.status);

  return (
    <div className={`
      bg-white/80 backdrop-blur-xl rounded-2xl border border-white
      shadow-lg border-l-4 ${cfg.border}
      hover:shadow-xl transition-all duration-300
      ${isHistory ? "opacity-70 hover:opacity-100" : ""}
    `}>
      <div className="p-5">
        <div className="flex items-start gap-4">

          {/* Fecha */}
          <div className="flex-shrink-0 text-center w-14">
            <p className="text-3xl font-black text-slate-800 leading-none">
              {start.getUTCDate()}
            </p>
            <p className="text-[10px] text-slate-400 font-black uppercase
                           tracking-wide mt-0.5">
              {start.toLocaleString("es", { month:"short", timeZone:"UTC" })}
            </p>
            <div className={`w-1.5 h-1.5 rounded-full mx-auto mt-2 ${cfg.dot}`} />
          </div>

          {/* Divider */}
          <div className="w-px bg-slate-100 self-stretch flex-shrink-0" />

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className={`text-[10px] font-black uppercase tracking-widest
                                px-2.5 py-1 rounded-full ${cfg.badge}`}>
                {cfg.label}
              </span>
              {cls.class_type === "trial" && (
                <span className="text-[10px] font-black uppercase tracking-widest
                                 px-2.5 py-1 rounded-full bg-purple-100 text-purple-700">
                  Prueba
                </span>
              )}
              {cls.class_count && (
                <span className="text-[10px] text-slate-400 font-black ml-auto">
                  {cls.class_count}
                </span>
              )}
            </div>

            {/* Hora */}
            <div className="flex items-center gap-2 text-slate-600 mb-2">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-sm font-bold">
                {start.toLocaleTimeString("es", {
                  hour: "2-digit", minute: "2-digit",
                })}{" "}
                –{" "}
                {end.toLocaleTimeString("es", {
                  hour: "2-digit", minute: "2-digit",
                })}
              </span>
              <span className="text-xs text-slate-400">
                · {cls.duration_minutes} min
              </span>
            </div>

            {/* Subject */}
            {cls.subject && (
              <div className="flex items-center gap-1.5 text-xs
                              text-slate-500 mb-3">
                <BookOpen className="w-3.5 h-3.5" />
                {cls.subject}
              </div>
            )}

            {/* Meet link */}
            {cls.meet_link && cls.status === "confirmed" && (
            <a
                href={cls.meet_link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-bold
                           text-white bg-emerald-500 hover:bg-emerald-600
                           px-3.5 py-2 rounded-xl shadow-sm shadow-emerald-100
                           transition-all duration-200 mb-3"
              >
                <Video className="w-3.5 h-3.5" />
                Entrar a Google Meet
              </a>
            )}

            {/* Acciones */}
            {canAct && (
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={onReschedule}
                  className="flex items-center gap-1.5 text-xs font-bold
                             text-purple-600 bg-purple-50 hover:bg-purple-100
                             px-3.5 py-2 rounded-xl transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reagendar
                </button>
                <button
                  onClick={onCancel}
                  className="flex items-center gap-1.5 text-xs font-bold
                             text-red-500 bg-red-50 hover:bg-red-100
                             px-3.5 py-2 rounded-xl transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                  Cancelar
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function MyClassesPage() {
  const [tab, setTab] = useState<"upcoming" | "history">("upcoming");
  const [rescheduleTarget, setRescheduleTarget] = useState<{
    id: number; duration: number;
  } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{
    id: number; date: string;
  } | null>(null);

  const { classes, loading, refetch } = useStudentClasses(
    tab === "history"
  );

  const safeClasses = Array.isArray(classes) ? classes : [];

  const upcoming = safeClasses.filter(
    c => !HISTORY_STATUSES.includes(c.status)
  ).sort((a, b) =>
    new Date(a.start_time_utc).getTime() -
    new Date(b.start_time_utc).getTime()
  );

  const history = safeClasses.filter(
    c => HISTORY_STATUSES.includes(c.status)
  ).sort((a, b) =>
    new Date(b.start_time_utc).getTime() -
    new Date(a.start_time_utc).getTime()
  );

  const displayed = tab === "upcoming" ? upcoming : history;

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">

      {/* Blobs */}
      <div className="fixed top-[-80px] right-[-80px] w-[500px] h-[500px]
                      bg-pink-300/20 rounded-full blur-[100px]
                      pointer-events-none" />
      <div className="fixed bottom-[-80px] left-[-80px] w-[400px] h-[400px]
                      bg-purple-300/15 rounded-full blur-[100px]
                      pointer-events-none" />

      <div className="relative space-y-6">

        {/* Header */}
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">
            Mis Clases
          </h1>
          <p className="text-slate-500 mt-1">
            Gestiona tus sesiones activas e historial
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-white/80 backdrop-blur-xl border
                        border-white rounded-2xl p-1 w-fit shadow-lg
                        shadow-slate-100 animate-in fade-in duration-500
                        delay-100">
          {[
            { key: "upcoming", label: `Próximas (${upcoming.length})` },
            { key: "history",  label: "Historial" },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key as any)}
              className={`
                px-5 py-2.5 rounded-xl text-sm font-bold
                transition-all duration-200
                ${tab === t.key
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
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500
                        delay-150 space-y-3">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i}
                className="h-28 bg-white rounded-2xl animate-pulse" />
            ))
          ) : displayed.length === 0 ? (
            <div className="bg-white/80 backdrop-blur-xl rounded-[2rem]
                            border border-white shadow-lg py-16 text-center">
              <Calendar className="w-12 h-12 text-slate-200 mx-auto mb-3" />
              <p className="text-slate-500 font-bold">
                {tab === "upcoming"
                  ? "No tienes clases próximas"
                  : "Sin historial todavía"
                }
              </p>
            </div>
          ) : (
            displayed.map(cls => (
              <ClassCard
                key={cls.id}
                cls={cls}
                onReschedule={() =>
                  setRescheduleTarget({
                    id: cls.id,
                    duration: cls.duration_minutes,
                  })
                }
                onCancel={() =>
                  setCancelTarget({
                    id: cls.id,
                    date: cls.start_time_utc,
                  })
                }
              />
            ))
          )}
        </div>
      </div>

      {/* Modals */}
      {rescheduleTarget && (
        <RescheduleModal
          classId={rescheduleTarget.id}
          currentDuration={rescheduleTarget.duration}
          onClose={() => setRescheduleTarget(null)}
          onSaved={refetch}
        />
      )}
      {cancelTarget && (
        <CancelModal
          classId={cancelTarget.id}
          classDate={cancelTarget.date}
          onClose={() => setCancelTarget(null)}
          onSaved={refetch}
        />
      )}
    </div>
  );
}