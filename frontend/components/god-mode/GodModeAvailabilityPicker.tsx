"use client";

import { useState } from "react";
import { Clock, Calendar, AlertCircle, X, Check } from "lucide-react";
import { RescheduleCalendar } from "@/components/classes/RescheduleModal";
import { useAvailableSlots, AvailableSlot } from "@/hooks/useStudentData";
import { getMyDisplayTimezone, formatTimeTz } from "@/lib/tzFormat";

interface GodModeAvailabilityPickerProps {
  teacherUsername: string;
  duration: number;
  classType?: "trial" | "regular" | "group";
  onClose: () => void;
  onSelect: (slot: AvailableSlot) => void;
}

// Igual que RescheduleModal, pero pensado para el Modo Dios: en vez de
// reagendar una clase existente, entrega el slot elegido al formulario
// que la creó (crear clase manual). Reutiliza el mismo calendario y el
// mismo endpoint de disponibilidad real, en vez de un input de fecha/hora
// en crudo que el staff podía escribir mal o fuera de horario.
export default function GodModeAvailabilityPicker({
  teacherUsername, duration, classType = "regular", onClose, onSelect,
}: GodModeAvailabilityPickerProps) {
  const [date, setDate] = useState("");
  const [selected, setSelected] = useState<AvailableSlot | null>(null);

  const { slots, loading } = useAvailableSlots(date, duration, teacherUsername || null, classType);

  const myTz = getMyDisplayTimezone();
  const formatTimeLocal = (utc: string) => formatTimeTz(utc, myTz);
  const formatDateHuman = (dateStr: string) => {
    if (!dateStr) return "";
    return new Date(dateStr).toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" });
  };

  const confirm = () => {
    if (selected) onSelect(selected);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-md" onClick={onClose} />

      <div className="relative w-full max-w-2xl bg-white/95 backdrop-blur-2xl rounded-[2.5rem] shadow-2xl
                      shadow-slate-300/50 border border-white p-6 sm:p-7 max-h-[90vh] flex flex-col overflow-hidden
                      animate-in fade-in zoom-in-95 duration-300">

        <div className="flex items-center justify-between pb-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-pink-100 text-pink-600 flex items-center justify-center shadow-inner">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-800 tracking-tight">Elegir horario disponible</h2>
              <p className="text-xs text-slate-500 font-medium">
                {teacherUsername ? `Disponibilidad real de @${teacherUsername}` : "Elige un profesor primero"}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors text-slate-500">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-4 space-y-4 pr-1">
          {!teacherUsername ? (
            <div className="flex flex-col items-center justify-center h-[240px] text-center">
              <AlertCircle className="w-9 h-9 text-amber-400 mb-2" />
              <p className="text-xs text-slate-500 font-bold">Selecciona un profesor antes de elegir horario.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 items-start">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                  1. Elige la fecha
                </label>
                <RescheduleCalendar value={date} onChange={d => { setDate(d); setSelected(null); }} />
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                  2. Elige el horario
                </label>

                {!date ? (
                  <div className="flex flex-col items-center justify-center h-[240px] bg-slate-50/80 border border-slate-100 rounded-2xl p-6 text-center">
                    <Calendar className="w-9 h-9 text-slate-300 mb-2" />
                    <p className="text-xs text-slate-500 font-bold">Primero selecciona una fecha</p>
                  </div>
                ) : loading ? (
                  <div className="flex flex-col items-center justify-center h-[240px] bg-slate-50/80 rounded-2xl">
                    <div className="w-8 h-8 border-4 border-pink-200 border-t-pink-500 rounded-full animate-spin mb-2" />
                    <p className="text-xs font-semibold text-slate-400">Buscando horarios...</p>
                  </div>
                ) : slots.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-[240px] bg-slate-50/80 border border-slate-100 rounded-2xl p-6 text-center">
                    <AlertCircle className="w-9 h-9 text-amber-400 mb-2" />
                    <p className="text-xs text-slate-700 font-black mb-1">Sin disponibilidad</p>
                    <p className="text-[11px] text-slate-400">No hay huecos libres en este día. Prueba con otra fecha.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 h-[240px] overflow-y-auto pr-1">
                    {slots.map((slot, i) => {
                      const isSelected = selected?.start_time_utc === slot.start_time_utc;
                      const blocked = !slot.is_available || slot.is_past;
                      return (
                        <button
                          key={i}
                          onClick={() => !blocked && setSelected(slot)}
                          disabled={blocked}
                          className={`py-2.5 px-3 rounded-xl text-center border-2 flex flex-col items-center justify-center transition-all duration-200
                            ${blocked ? "border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed"
                              : isSelected ? "border-pink-500 bg-pink-50 shadow-md shadow-pink-100"
                              : slot.is_preferred ? "border-purple-200 bg-purple-50/60 hover:border-purple-300"
                              : "border-slate-100 bg-white hover:border-pink-200 shadow-sm"}`}
                        >
                          <span className={`text-sm font-black tracking-tight ${blocked ? "text-slate-400" : isSelected ? "text-pink-600" : "text-slate-700"}`}>
                            {formatTimeLocal(slot.start_time_utc)}
                          </span>
                          {blocked && (
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider mt-0.5">
                              {slot.is_past ? "Pasado" : "Ocupado"}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {selected && (
            <div className="bg-gradient-to-r from-pink-500/10 via-rose-500/5 to-purple-500/10 border border-pink-200/60 rounded-2xl p-3.5 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-pink-500 to-rose-400 text-white flex items-center justify-center flex-shrink-0 shadow-sm">
                <Check className="w-4 h-4" />
              </div>
              <p className="text-xs sm:text-sm font-black text-slate-800 capitalize">
                {formatDateHuman(date)} · {formatTimeLocal(selected.start_time_utc)} hrs ({duration} min)
              </p>
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-slate-100 flex gap-3 flex-shrink-0">
          <button onClick={onClose} className="flex-1 py-3 text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors">
            Cancelar
          </button>
          <button
            onClick={confirm}
            disabled={!selected}
            className="flex-1 py-3 text-sm font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400
                       hover:from-pink-600 hover:to-rose-500 shadow-lg shadow-pink-200 active:scale-[0.98]
                       transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Usar este horario
          </button>
        </div>
      </div>
    </div>
  );
}
