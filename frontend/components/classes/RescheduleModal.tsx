"use client";

import { useState } from "react";
import {
  Clock, Calendar, ChevronLeft, ChevronRight,
  AlertCircle, X, Check, RotateCcw, BookOpen
} from "lucide-react";
import api from "@/lib/api";
import { useAvailableSlots } from "@/hooks/useStudentData";
import { getMyDisplayTimezone, formatTimeTz } from "@/lib/tzFormat";

// ─── Mini calendario inline para reagendar ────────────────────────────────────
// Compartido entre el flujo de estudiante y el de profesor: ambos deben
// ofrecer la misma experiencia (calendario + huecos reales de disponibilidad),
// en vez de un simple par de inputs de fecha/hora sin validar disponibilidad.
export function RescheduleCalendar({
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

export interface RescheduleModalClassItem {
  id: number;
  subject?: string | null;
  start_time_utc: string;
  duration_minutes?: number | null;
  /** Nombre de la otra persona involucrada, para mostrar contexto (profesor visto por el estudiante, o estudiante visto por el profesor). */
  counterpart_name?: string | null;
  /** Si es una sesión grupal, reagendar mueve la hora para TODOS los inscritos — se muestra una advertencia y se pide confirmación extra. */
  isGroup?: boolean;
}

interface RescheduleModalProps {
  classItem: RescheduleModalClassItem;
  /** Username del profesor cuya disponibilidad se consulta (el propio, si quien reagenda es el profesor). */
  teacherUsername: string;
  /** Endpoint PATCH a invocar: distinto según el rol (`/classes/{id}/reschedule` vs `/classes/teacher/{id}/reschedule`). */
  endpoint: string;
  onClose: () => void;
  onSaved: () => void;
}

// ─── Modal Reagendar (compartido student/teacher) ────────────────────────────
export function RescheduleModal({
  classItem,
  teacherUsername,
  endpoint,
  onClose,
  onSaved,
}: RescheduleModalProps) {
  const [date, setDate]       = useState("");
  const [saving, setSaving]   = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError]     = useState("");
  const [selected, setSelected] = useState<any>(null);

  const currentDuration = classItem?.duration_minutes || 60;
  const { slots, loading } = useAvailableSlots(date, currentDuration, teacherUsername ?? null);

  // Formateador coherente en la hora local DE QUIEN REAGENDA (no del dispositivo)
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
    if (classItem.isGroup) {
      const ok = window.confirm(
        "Esta es una sesión GRUPAL: reagendarla mueve la hora para TODOS los alumnos inscritos, no solo para uno. ¿Confirmas el cambio de horario para todo el grupo?"
      );
      if (!ok) return;
    }
    setSaving(true);
    setError("");
    try {
      await api.patch(endpoint, {
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
                Selecciona una nueva fecha y hora para la sesión
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
              <p className="text-xs text-slate-500">Actualizando los datos...</p>
            </div>
          ) : (
            <div className="space-y-4">

              {classItem.isGroup && (
                <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 flex gap-3 items-start">
                  <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs font-bold text-amber-700 leading-relaxed">
                    Esta es una sesión grupal. Al reagendar, la hora cambia para <span className="underline">todos</span> los alumnos inscritos, no solo para uno.
                  </p>
                </div>
              )}

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
                    {classItem.counterpart_name && <span className="block sm:inline sm:ml-2">· 👤 {classItem.counterpart_name}</span>}
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
