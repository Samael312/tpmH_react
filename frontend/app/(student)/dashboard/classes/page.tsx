"use client";

import { useState } from "react";
import {
  Clock, Video, Calendar, ChevronLeft,
  ChevronRight, AlertCircle, X, Check,
  RotateCcw, BookOpen
} from "lucide-react";
import { useStudentClasses, useAvailableSlots } from "@/hooks/useStudentData";
import api from "@/lib/api";
import ChipiWidget from "@/components/chipi/ChipiWidget";
import ClassCard from "@/components/classes/ClassCard";
import { getMyDisplayTimezone, formatTimeTz, formatDateHumanTz } from "@/lib/tzFormat";

const STATUS_CONFIG: Record<string, {
  label: string;
  badge: string;
  border: string;
  dot: string;
}> = {
  pending_trial:    { label: "Prueba pendiente",  badge: "bg-purple-100 text-purple-700", border: "border-l-purple-400", dot: "bg-purple-400" },
  pending:         { label: "Pendiente de pago",  badge: "bg-amber-100 text-amber-700",    border: "border-l-amber-400",   dot: "bg-amber-400" },
  pending_payment: { label: "Pago en revisión",   badge: "bg-blue-100 text-blue-700",      border: "border-l-blue-400",    dot: "bg-blue-400" },
  confirmed:       { label: "Confirmada",         badge: "bg-emerald-100 text-emerald-700", border: "border-l-emerald-400", dot: "bg-emerald-400" },
  completed:       { label: "Completada",         badge: "bg-slate-100 text-slate-500",    border: "border-l-slate-300",   dot: "bg-slate-300" },
  cancelled:       { label: "Cancelada",          badge: "bg-red-100 text-red-600",        border: "border-l-red-400",     dot: "bg-red-400" },
  no_show:         { label: "No asististe",       badge: "bg-red-100 text-red-600",        border: "border-l-red-600",     dot: "bg-red-600" },
  rescheduled:     { label: "Reagendada",         badge: "bg-orange-100 text-orange-700",  border: "border-l-orange-400",  dot: "bg-orange-400" },
  finalized:       { label: "Finalizada",         badge: "bg-slate-100 text-slate-500",    border: "border-l-slate-300",   dot: "bg-slate-300" },
};

const HISTORY_STATUSES = ["completed", "cancelled", "no_show", "finalized"];

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
    <div className="bg-slate-50/85 border border-slate-100 rounded-2xl p-3.5 shadow-inner">
      <div className="flex items-center justify-between mb-2.5">
        <button
          onClick={() => {
            if (month === 0) { setMonth(11); setYear(y => y - 1); }
            else setMonth(m => m - 1);
          }}
          className="w-7 h-7 rounded-xl bg-white border border-slate-200
                     flex items-center justify-center hover:border-pink-300
                     hover:bg-pink-50/50 transition-all text-slate-600 shadow-sm"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span className="text-xs font-black uppercase tracking-wider text-slate-700">
          {MONTHS[month]} {year}
        </span>
        <button
          onClick={() => {
            if (month === 11) { setMonth(0); setYear(y => y + 1); }
            else setMonth(month + 1);
          }}
          className="w-7 h-7 rounded-xl bg-white border border-slate-200
                     flex items-center justify-center hover:border-pink-300
                     hover:bg-pink-50/50 transition-all text-slate-600 shadow-sm"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {DAYS_HEAD.map(d => (
          <div key={d}
            className="text-center text-[10px] font-black text-slate-400
                       uppercase tracking-widest py-0.5">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
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
                w-full aspect-square rounded-xl text-xs font-black
                transition-all duration-200 flex items-center justify-center
                ${isSelected
                  ? "bg-gradient-to-br from-pink-500 to-rose-400 text-white shadow-md shadow-pink-200 scale-105"
                  : isPast
                    ? "text-slate-300 cursor-not-allowed bg-transparent"
                    : isToday
                      ? "bg-pink-100 text-pink-600 border border-pink-200"
                      : "text-slate-600 bg-white border border-slate-100 hover:border-pink-300 hover:text-pink-600 shadow-sm"
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

// ─── Modal Reagendar Ajustado ────────────────────────────────────────────────
function RescheduleModal({
  classItem,
  onClose,
  onSaved,
}: {
  classItem: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate]       = useState("");
  const [saving, setSaving]   = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError]     = useState("");
  const [selected, setSelected] = useState<any>(null);

  const currentDuration = classItem?.duration_minutes || 60;
  const { slots, loading } = useAvailableSlots(date, currentDuration, classItem?.teacher_username ?? null);
  
  // Formateador coherente en la hora local DEL ESTUDIANTE (no del dispositivo)
  const myTz = getMyDisplayTimezone();
  const formatTimeLocal = (utc: string) => formatTimeTz(utc, myTz);

  const formatDateHuman = (dateStr: string) => {
    if (!dateStr) return "";
    const dateObj = new Date(dateStr);
    return dateObj.toLocaleDateString("es", {
      weekday: "long", day: "numeric", month: "long"
    });
  };

  const reschedule = async () => {
    if (!selected || !classItem) return;
    setSaving(true);
    setError("");
    try {
      await api.patch(`/classes/${classItem.id}/reschedule`, {
        start_time_utc: selected.start_time_utc,
        end_time_utc:   selected.end_time_utc,
      });
      setSuccess(true);
      setTimeout(() => { onSaved(); onClose(); }, 1200);
    } catch (e: any) {
      setError(e.response?.data?.detail || "Error reagendando la clase");
    } finally {
      setSaving(false);
    }
  };

  if (!classItem) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-md transition-opacity"
           onClick={onClose} />

      <div className="relative w-full max-w-2xl bg-white/95 backdrop-blur-2xl
                      rounded-[2.5rem] shadow-2xl shadow-slate-300/50
                      border border-white p-6 sm:p-7
                      animate-in fade-in zoom-in-95 duration-300
                      max-h-[90vh] flex flex-col overflow-hidden">

        <div className="absolute top-0 right-0 w-56 h-56 bg-pink-300/20
                        rounded-full blur-[90px] pointer-events-none" />

        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-pink-100 text-pink-600 flex items-center justify-center shadow-inner">
              <RotateCcw className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-800 tracking-tight">
                Reagendar clase
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                Selecciona una nueva fecha y hora para tu sesión
              </p>
            </div>
          </div>
          <button onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200
                       flex items-center justify-center transition-colors text-slate-500">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Cuerpo Scrolleable */}
        <div className="flex-1 overflow-y-auto py-4 space-y-4 pr-1">
          {success ? (
            <div className="flex flex-col items-center py-12 gap-3">
              <div className="w-16 h-16 rounded-full bg-emerald-100
                              flex items-center justify-center shadow-lg shadow-emerald-100 animate-bounce">
                <Check className="w-8 h-8 text-emerald-600" />
              </div>
              <p className="text-lg font-black text-slate-800">¡Clase reagendada con éxito!</p>
              <p className="text-xs text-slate-500">Actualizando tus datos...</p>
            </div>
          ) : (
            <div className="space-y-4">
              
              {/* Información de la clase actual */}
              <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 flex items-center gap-3.5 shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-pink-100 text-pink-600 flex items-center justify-center flex-shrink-0">
                  <BookOpen className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">
                    Clase actual a modificar
                  </span>
                  <h4 className="text-sm font-black text-slate-800 truncate">
                    {classItem.subject || "Clase de Inglés General"}
                  </h4>
                  <p className="text-xs text-slate-500 font-medium capitalize mt-0.5">
                    📅 {formatDateHuman(classItem.start_time_utc)} · ⏰ {formatTimeLocal(classItem.start_time_utc)} Hrs ({currentDuration} Min)
                    {classItem.teacher_name && <span className="block sm:inline sm:ml-2">· 👨‍🏫 {classItem.teacher_name}</span>}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 items-start">
                <div>
                  <label className="block text-[10px] font-black text-slate-400
                                uppercase tracking-widest mb-2">
                    1. Elige la nueva fecha
                  </label>
                  <RescheduleCalendar value={date} onChange={(d) => { setDate(d); setSelected(null); }} />
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-400
                                uppercase tracking-widest mb-2">
                    2. Elige el horario disponible
                  </label>

                  {!date ? (
                    <div className="flex flex-col items-center justify-center
                                    h-[240px] bg-slate-50/80 border border-slate-100 rounded-2xl p-6 text-center">
                      <Calendar className="w-9 h-9 text-slate-300 mb-2" />
                      <p className="text-xs text-slate-500 font-bold">
                        Primero selecciona una fecha en el calendario
                      </p>
                    </div>
                  ) : loading ? (
                    <div className="flex flex-col items-center justify-center h-[240px] bg-slate-50/80 rounded-2xl">
                      <div className="w-8 h-8 border-4 border-pink-200
                                      border-t-pink-500 rounded-full animate-spin mb-2" />
                      <p className="text-xs font-semibold text-slate-400">Buscando horarios...</p>
                    </div>
                  ) : slots.length === 0 ? (
                    <div className="flex flex-col items-center justify-center
                                    h-[240px] bg-slate-50/80 border border-slate-100 rounded-2xl p-6 text-center">
                      <AlertCircle className="w-9 h-9 text-amber-400 mb-2" />
                      <p className="text-xs text-slate-700 font-black mb-1">
                        Sin disponibilidad
                      </p>
                      <p className="text-[11px] text-slate-400">
                        No hay huecos libres en este día. Prueba con otra fecha.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 h-[240px]
                                    overflow-y-auto pr-1">
                      {slots.map((slot, i) => {
                        const isSelected = selected?.start_time_utc === slot.start_time_utc;
                        const blocked = !slot.is_available || slot.is_past;
                        return (
                          <button
                            key={i}
                            onClick={() => !blocked && setSelected(slot)}
                            disabled={blocked}
                            className={`
                              py-2.5 px-3 rounded-xl text-center border-2 flex flex-col items-center justify-center
                              transition-all duration-200 relative group
                              ${blocked
                                ? "border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed"
                                : isSelected
                                  ? "border-pink-500 bg-pink-50 shadow-md shadow-pink-100"
                                  : slot.is_preferred
                                    ? "border-purple-200 bg-purple-50/60 hover:border-purple-300"
                                    : "border-slate-100 bg-white hover:border-pink-200 shadow-sm"
                              }
                            `}
                          >
                            <span className={`text-sm font-black tracking-tight
                              ${blocked ? "text-slate-400" : isSelected ? "text-pink-600" : "text-slate-700"}`}>
                              {formatTimeLocal(slot.start_time_utc)}
                            </span>
                            {blocked ? (
                              <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider mt-0.5">
                                {slot.is_past ? "Pasado" : "Ocupado"}
                              </span>
                            ) : slot.is_preferred && (
                              <span className="text-[9px] font-black text-purple-600 uppercase tracking-wider mt-0.5">
                                ★ Tu Preferido
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {selected && (
                <div className="bg-gradient-to-r from-pink-500/10 via-rose-500/5 to-purple-500/10 border border-pink-200/60 rounded-2xl p-3.5 flex items-center justify-between gap-4 animate-in fade-in duration-300">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-pink-500 to-rose-400 text-white flex items-center justify-center flex-shrink-0 shadow-sm">
                      <Check className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-pink-600 uppercase tracking-wider">Nuevo horario seleccionado</p>
                      <p className="text-xs sm:text-sm font-black text-slate-800 capitalize">
                        {formatDateHuman(date)} · {formatTimeLocal(selected.start_time_utc)} hrs ({currentDuration} min)
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="bg-rose-50 border border-rose-100 text-rose-600
                            px-4 py-3 rounded-xl text-xs font-bold
                            flex items-center gap-2">
              <X className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        {!success && (
          <div className="pt-4 border-t border-slate-100 flex gap-3 flex-shrink-0">
            <button
              onClick={onClose}
              className="flex-1 py-3 text-sm font-bold text-slate-600
                         bg-slate-100 hover:bg-slate-200 rounded-xl
                         transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={reschedule}
              disabled={!selected || saving}
              className="flex-1 py-3 text-sm font-bold text-white
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
          </div>
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

  const dateFormatted = formatDateHumanTz(classDate, getMyDisplayTimezone());

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

function toUtcDateStr(date: Date) {
  return date.toISOString().split("T")[0];
}

function getWeekDates() {
  const today = new Date();
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - today.getUTCDay() + 1);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    return d;
  });
}

const WEEK_DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function DatePickerCalendar({
  value,
  onSelect,
  onClose,
}: {
  value: string;
  onSelect: (d: string) => void;
  onClose: () => void;
}) {
  const initial = value ? new Date(value + "T00:00:00Z") : new Date();
  const [year, setYear] = useState(initial.getUTCFullYear());
  const [month, setMonth] = useState(initial.getUTCMonth());

  const firstDay = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const offset = (firstDay + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = Array.from({ length: offset + daysInMonth }, (_, i) => (i < offset ? null : i - offset + 1));

  const todayStr = toUtcDateStr(new Date());

  const select = (day: number) => {
    const d = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    onSelect(d);
    onClose();
  };

  return (
    <div className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-2xl shadow-slate-300/50 border border-slate-100 p-4 animate-in fade-in zoom-in-95 duration-150">
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); }}
          className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
        >
          <ChevronLeft className="w-4 h-4 text-slate-600" />
        </button>
        <span className="text-sm font-black text-slate-800">{MONTHS[month]} {year}</span>
        <button
          onClick={() => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); }}
          className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
        >
          <ChevronRight className="w-4 h-4 text-slate-600" />
        </button>
      </div>
      <div className="grid grid-cols-7 mb-1">
        {["L","M","X","J","V","S","D"].map(d => (
          <div key={d} className="text-center text-[10px] font-black text-slate-400 uppercase tracking-widest py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const isSelected = dateStr === value;
          const isToday = dateStr === todayStr;
          return (
            <button
              key={i}
              onClick={() => select(day)}
              className={`
                w-full aspect-square rounded-lg text-xs font-bold transition-all duration-150
                ${isSelected
                  ? "bg-gradient-to-br from-pink-500 to-rose-400 text-white shadow-md"
                  : isToday
                    ? "bg-pink-50 text-pink-600 border border-pink-200"
                    : "text-slate-700 hover:bg-pink-50 hover:text-pink-600"}
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

// ─── Página principal ─────────────────────────────────────────────────────────
export default function MyClassesPage() {
  const [tab, setTab] = useState<"upcoming" | "history">("upcoming");
  const [rescheduleTarget, setRescheduleTarget] = useState<any | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{
    id: number; date: string;
  } | null>(null);

  const weekDates = getWeekDates();
  const todayStr = toUtcDateStr(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);

  // Se pide siempre el historial completo (una sola query key) para que
  // "Próximas" e "Historial" lean del mismo dataset. Antes, cada tab usaba
  // una query distinta (includeHistory=false / true); al cambiar de tab se
  // mostraban datos de una caché diferente -y potencialmente desactualizada-
  // porque refetch() sólo refresca la query activa, causando que el conteo
  // de "Próximas" fluctuara al alternar entre tabs.
  const { classes, loading, refetch } = useStudentClasses(true);

  const safeClasses = Array.isArray(classes) ? classes : [];

  // Mismo criterio que usa el backend para "próximas": estado no finalizado
  // Y que todavía no haya empezado. Sin el chequeo de fecha, una clase que
  // ya arrancó pero aún no fue finalizada por el backend se contaría como
  // "próxima" en este tab aunque el backend ya no la considere así.
  const now = Date.now();
  const upcomingAll = safeClasses.filter(
    c => !HISTORY_STATUSES.includes(c.status) &&
      new Date(c.start_time_utc).getTime() >= now
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

  const upcomingFiltered = selectedDate
    ? upcomingAll.filter(c => c.start_time_utc.slice(0, 10) === selectedDate)
    : upcomingAll;

  const displayed = tab === "upcoming" ? upcomingFiltered : history;

  return (
    <>
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">

      <div className="fixed top-[-80px] right-[-80px] w-[500px] h-[500px]
                      bg-pink-300/20 rounded-full blur-[100px]
                      pointer-events-none" />
      <div className="fixed bottom-[-80px] left-[-80px] w-[400px] h-[400px]
                      bg-purple-300/15 rounded-full blur-[100px]
                      pointer-events-none" />

      <div className="relative space-y-6">

        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">
            Mis Clases
          </h1>
          <p className="text-slate-500 mt-1">
            Gestiona tus sesiones activas e historial
          </p>
        </div>

        {/* Selector de semana + calendario específico */}
        <div className="bg-slate-50/50 p-4 rounded-2xl border border-pink-50 relative z-20
                        animate-in fade-in slide-in-from-bottom-4 duration-500 delay-75">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-pink-400 uppercase tracking-widest font-bold">
              Semana actual
            </p>
            <div className="relative">
              <button
                onClick={() => setShowCalendar(p => !p)}
                className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-pink-600
                          bg-white border border-slate-200 hover:border-pink-300 px-3 py-1.5 rounded-xl
                          transition-colors"
              >
                <Calendar className="w-3.5 h-3.5" />
                Elegir fecha
              </button>
              {showCalendar && (
                <DatePickerCalendar
                  value={selectedDate ?? todayStr}
                  onSelect={(d) => { setSelectedDate(d); setTab("upcoming"); }}
                  onClose={() => setShowCalendar(false)}
                />
              )}
            </div>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-2">
            {weekDates.map((date) => {
              const dateStr = toUtcDateStr(date);
              const isToday = dateStr === todayStr;
              const isSelected = dateStr === selectedDate;
              const dayIdx = (date.getUTCDay() + 6) % 7;

              return (
                <button
                  key={dateStr}
                  onClick={() => { setSelectedDate(dateStr); setTab("upcoming"); }}
                  className={`
                    flex-shrink-0 flex flex-col items-center px-4 py-3
                    rounded-2xl text-xs transition-all duration-300 shadow-sm
                    ${isSelected
                      ? "bg-gradient-to-br from-pink-500 to-rose-400 text-white shadow-pink-200 shadow-md scale-105 transform"
                      : isToday
                        ? "bg-pink-50 text-pink-600 border border-pink-200 hover:bg-pink-100"
                        : "bg-white text-slate-500 hover:text-pink-500 hover:bg-pink-50/50 border border-slate-100"
                    }
                  `}
                >
                  <span className="font-medium">{WEEK_DAYS[dayIdx]}</span>
                  <span className={`text-lg font-bold mt-1 ${isSelected ? "text-white" : "text-slate-700"} ${isToday && !isSelected ? "text-pink-600" : ""}`}>
                    {date.getUTCDate()}
                  </span>
                </button>
              );
            })}
          </div>

          {selectedDate && (
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <span className="text-xs font-bold text-slate-500 bg-white px-3 py-1.5 rounded-full border border-slate-100 capitalize">
                Mostrando: {new Date(selectedDate + "T00:00:00Z").toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}
              </span>
              <button
                onClick={() => setSelectedDate(null)}
                className="flex items-center gap-1 text-xs font-bold text-pink-500 hover:text-pink-600 transition-colors"
              >
                <X className="w-3.5 h-3.5" /> Ver todas las próximas
              </button>
            </div>
          )}
        </div>
        <div className="flex gap-1 bg-white/80 backdrop-blur-xl border
                        border-white rounded-2xl p-1 w-fit shadow-lg
                        shadow-slate-100 animate-in fade-in duration-500
                        delay-100">
          {[
            { key: "upcoming", label: `Próximas (${upcomingAll.length})` },
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

        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500
                        delay-150 space-y-3">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i}
                className="h-28 bg-white rounded-2xl animate-pulse" />
            ))
          ) : displayed.length === 0 ? (
          <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-lg py-16 text-center">
            <Calendar className="w-12 h-12 text-slate-200 mx-auto mb-3" />
            <p className="text-slate-500 font-bold">
              {tab === "upcoming"
                ? selectedDate
                  ? "No tienes clases ese día"
                  : "No tienes clases próximas"
                : "Sin historial todavía"}
            </p>
          </div>
          ) : (
            displayed.map(cls => (
              <ClassCard
                key={cls.id}
                class_={cls}
                role="student"
                onReschedule={() => setRescheduleTarget(cls)}
                onCancel={() =>
                  setCancelTarget({ id: cls.id, date: cls.start_time_utc })
                }
              />
            ))
          )}
        </div>
        
      </div>

      {rescheduleTarget && (
        <RescheduleModal
          classItem={rescheduleTarget}
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
    <ChipiWidget screenName="my_classes_student" />
    </>
  );
}