"use client";

import { useState, useEffect, useCallback } from "react";
import {
  CalendarOff, CalendarPlus, Trash2, Plus,
  AlertTriangle, Check, Loader2
} from "lucide-react";
import api from "@/lib/api";

interface Exception {
  id: number;
  start_time_utc: string;
  end_time_utc: string;
  is_available: boolean;
  reason: string | null;
  is_full_day: boolean;
}

export default function ExceptionsSection() {
  const [exceptions, setExceptions] = useState<Exception[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [date, setDate] = useState("");
  const [isFullDay, setIsFullDay] = useState(true);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("13:00");
  const [mode, setMode] = useState<"block" | "extra">("block");
  const [reason, setReason] = useState("");

  const fetchExceptions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/availability/me/exceptions");
      setExceptions(res.data);
    } catch {
      // silencioso
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchExceptions(); }, [fetchExceptions]);

  const resetForm = () => {
    setDate("");
    setIsFullDay(true);
    setStartTime("09:00");
    setEndTime("13:00");
    setMode("block");
    setReason("");
  };

  const submit = async () => {
    if (!date) {
      setError("Selecciona una fecha");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      await api.post("/availability/me/exceptions", {
        date,
        timezone,
        is_full_day: isFullDay,
        start_time_local: isFullDay ? null : startTime,
        end_time_local: isFullDay ? null : endTime,
        is_available: mode === "extra",
        reason: reason.trim() || null,
      });
      setSuccess("Excepción guardada correctamente");
      resetForm();
      fetchExceptions();
    } catch (e: any) {
      setError(e.response?.data?.detail || "Error guardando la excepción");
    } finally {
      setSaving(false);
      setTimeout(() => setSuccess(""), 3000);
    }
  };

  const remove = async (id: number) => {
    try {
      await api.delete(`/availability/me/exceptions/${id}`);
      setExceptions(prev => prev.filter(e => e.id !== id));
    } catch {
      setError("Error eliminando la excepción");
    }
  };

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString("es", {
      weekday: "short", day: "numeric", month: "short", year: "numeric",
    });

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });

  const sorted = [...exceptions].sort(
    (a, b) => new Date(a.start_time_utc).getTime() - new Date(b.start_time_utc).getTime()
  );

  return (
    <div className="bg-white/85 backdrop-blur-xl rounded-[2.5rem] border border-white
                    shadow-2xl shadow-slate-200/50 p-6 md:p-8 space-y-6">
      <div>
        <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">
          Días y horas no disponibles
        </h2>
        <p className="text-sm font-bold text-slate-700 mt-1">
          Bloquea días completos o rangos puntuales (vacaciones, citas, etc.)
          o agrega disponibilidad extra en un día que normalmente no trabajas.
        </p>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-100 text-rose-600 px-4 py-3
                        rounded-2xl text-xs font-bold flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}
      {success && (
        <div className="bg-emerald-50 border border-emerald-100 text-emerald-600 px-4 py-3
                        rounded-2xl text-xs font-bold flex items-center gap-2">
          <Check className="w-4 h-4 flex-shrink-0" /> {success}
        </div>
      )}

      {/* Formulario */}
      <div className="bg-slate-50/80 rounded-2xl p-5 border border-slate-100 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
              Fecha
            </label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              min={new Date().toISOString().split("T")[0]}
              className="w-full bg-white border-2 border-slate-200 rounded-xl text-sm font-bold
                         text-slate-800 px-4 py-3 focus:outline-none focus:border-purple-400
                         focus:ring-4 focus:ring-purple-50 transition-all"
            />
          </div>

          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
              Tipo de excepción
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode("block")}
                className={`flex items-center justify-center gap-1.5 py-3 rounded-xl text-xs font-bold
                  border-2 transition-all ${mode === "block"
                    ? "border-rose-400 bg-rose-50 text-rose-600"
                    : "border-transparent bg-white text-slate-500"}`}
              >
                <CalendarOff className="w-3.5 h-3.5" /> Bloquear
              </button>
              <button
                type="button"
                onClick={() => setMode("extra")}
                className={`flex items-center justify-center gap-1.5 py-3 rounded-xl text-xs font-bold
                  border-2 transition-all ${mode === "extra"
                    ? "border-emerald-400 bg-emerald-50 text-emerald-600"
                    : "border-transparent bg-white text-slate-500"}`}
              >
                <CalendarPlus className="w-3.5 h-3.5" /> Añadir extra
              </button>
            </div>
          </div>
        </div>

        {/* --- SWITCH ARREGLADO --- */}
        <label className="flex items-center gap-3 cursor-pointer w-fit select-none py-1">
          <button
            type="button"
            role="switch"
            aria-checked={isFullDay}
            onClick={() => setIsFullDay(p => !p)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none ${
              isFullDay ? "bg-purple-600" : "bg-slate-300"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                isFullDay ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
          <span className="text-xs font-bold text-slate-600">Todo el día</span>
        </label>
        {/* -------------------------- */}

        {!isFullDay && (
          <div className="grid grid-cols-2 gap-3 animate-in fade-in duration-200">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                Desde
              </label>
              <input
                type="time"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                className="w-full bg-white border-2 border-slate-200 rounded-xl text-sm font-bold
                           text-slate-800 px-3 py-2.5 focus:outline-none focus:border-purple-400"
              />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                Hasta
              </label>
              <input
                type="time"
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
                className="w-full bg-white border-2 border-slate-200 rounded-xl text-sm font-bold
                           text-slate-800 px-3 py-2.5 focus:outline-none focus:border-purple-400"
              />
            </div>
          </div>
        )}

        <div>
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
            Motivo (opcional)
          </label>
          <input
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Ej: Vacaciones, cita médica..."
            className="w-full bg-white border-2 border-slate-200 rounded-xl text-sm font-bold
                       text-slate-800 placeholder:text-slate-400 px-4 py-3
                       focus:outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-50"
          />
        </div>

        <button
          onClick={submit}
          disabled={saving || !date}
          className="w-full py-3.5 text-sm font-bold text-white rounded-xl
                     bg-gradient-to-r from-purple-600 to-pink-500
                     hover:from-purple-700 hover:to-pink-600
                     shadow-lg shadow-purple-200 active:scale-[0.98]
                     transition-all duration-300 disabled:opacity-50
                     flex items-center justify-center gap-2"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <><Plus className="w-4 h-4" /> Agregar excepción</>
          )}
        </button>
      </div>

      {/* Lista */}
      <div>
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
          Excepciones configuradas ({exceptions.length})
        </p>
        {loading ? (
          <div className="h-16 bg-slate-50 rounded-2xl animate-pulse" />
        ) : sorted.length === 0 ? (
          <p className="text-xs text-slate-400 font-bold py-6 text-center">
            Sin excepciones configuradas
          </p>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {sorted.map(exc => (
              <div key={exc.id}
                className="flex items-center justify-between gap-3 bg-white border
                           border-slate-100 rounded-xl px-4 py-3 shadow-sm">
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg flex-shrink-0
                    ${exc.is_available ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
                    {exc.is_available ? "Extra" : "Bloqueado"}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-700 capitalize truncate">
                      {fmtDate(exc.start_time_utc)}
                    </p>
                    <p className="text-[11px] text-slate-400 font-bold">
                      {exc.is_full_day ? "Todo el día" : `${fmtTime(exc.start_time_utc)} – ${fmtTime(exc.end_time_utc)}`}
                      {exc.reason && ` · ${exc.reason}`}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => remove(exc.id)}
                  className="text-slate-300 hover:text-rose-500 hover:bg-rose-50
                             p-1.5 rounded-lg transition-colors flex-shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}