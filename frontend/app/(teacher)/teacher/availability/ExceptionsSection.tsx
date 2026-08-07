"use client";

import { useState, useEffect, useCallback } from "react";
import {
  CalendarOff, CalendarPlus, Trash2, Plus,
  AlertTriangle, Check, Loader2
} from "lucide-react";
import api from "@/lib/api";
import CalendarPicker from "@/components/layout/CalendarPicker";
import { getMyDisplayTimezone } from "@/lib/tzFormat";

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
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [isRange, setIsRange] = useState(false);
  const [date, setDate] = useState("");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");

  const [isFullDay, setIsFullDay] = useState(true);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("13:00");
  const [mode, setMode] = useState<"block" | "extra">("block");
  const [reason, setReason] = useState("");

  const fetchExceptions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/availability/me/exceptions");
      
      const now = new Date();
      
      // Filtramos las excepciones: validas (futuras/actuales) y pasadas
      const validExceptions = res.data.filter((exc: Exception) => new Date(exc.end_time_utc) >= now);
      const pastExceptions = res.data.filter((exc: Exception) => new Date(exc.end_time_utc) < now);
      
      // Solo guardamos en el estado las que son válidas para mostrarlas al usuario
      setExceptions(validExceptions);

      // Limpieza automática: eliminamos las pasadas de la base de datos en segundo plano
      pastExceptions.forEach((exc: Exception) => {
        api.delete(`/availability/me/exceptions/${exc.id}`).catch(() => {
          console.error(`Error limpiando excepción pasada ID: ${exc.id}`);
        });
      });

    } catch {
      // silencioso
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchExceptions(); }, [fetchExceptions]);

  const resetForm = () => {
    setDate("");
    setRangeStart("");
    setRangeEnd("");
    setIsFullDay(true);
    setStartTime("09:00");
    setEndTime("13:00");
    setMode("block");
    setReason("");
  };

  const submit = async () => {
    const effectiveDate = isRange ? rangeStart : date;
    const effectiveEndDate = isRange ? (rangeEnd || rangeStart) : undefined;

    if (!effectiveDate) {
      setError(isRange ? "Selecciona el rango de fechas" : "Selecciona una fecha");
      return;
    }
    if (isRange && !rangeEnd) {
      setError("Selecciona también la fecha final del rango");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const timezone = getMyDisplayTimezone();
      const res = await api.post("/availability/me/exceptions", {
        date: effectiveDate,
        end_date: effectiveEndDate,
        timezone,
        is_full_day: isFullDay,
        start_time_local: isFullDay ? null : startTime,
        end_time_local: isFullDay ? null : endTime,
        is_available: mode === "extra",
        reason: reason.trim() || null,
      });
      const count = Array.isArray(res.data) ? res.data.length : 1;
      setSuccess(`${count} excepción${count !== 1 ? "es" : ""} guardada${count !== 1 ? "s" : ""} correctamente`);
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
    // 1. Limpiamos alertas previas
    setError("");
    setSuccess("");
    setDeletingId(id);
    
    try {
      // 2. Ejecutamos el borrado en la API
      await api.delete(`/availability/me/exceptions/${id}`);
      
      // 3. Actualizamos la lista local
      setExceptions(prev => prev.filter(e => e.id !== id));
      
      // 4. Mostramos mensaje de éxito
      setSuccess("Excepción eliminada correctamente");
    } catch {
      setError("Error eliminando la excepción");
    } finally {
      // 5. Ocultamos el mensaje de éxito después de 3 segundos
      setTimeout(() => setSuccess(""), 3000);
    }
  };

  const myTz = getMyDisplayTimezone();

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString("es", {
      weekday: "short", day: "numeric", month: "short", year: "numeric",
      timeZone: myTz,
    });

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", timeZone: myTz });
  

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
          Bloquea días completos, rangos de días (ej. vacaciones) u horas puntuales,
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

      {/* Formulario Mejorado */}
      <div className="bg-slate-50/80 rounded-2xl p-6 border border-slate-100 space-y-6">
        
        {/* Controles de Switches */}
        <div className="flex flex-col sm:flex-row gap-6 pb-4 border-b border-slate-200/60">
          <label className="flex items-center gap-3 cursor-pointer group w-fit">
            <button
              type="button"
              role="switch"
              aria-checked={isRange}
              onClick={() => { setIsRange(p => !p); setDate(""); setRangeStart(""); setRangeEnd(""); }}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-pink-500 focus:ring-offset-2 ${isRange ? "bg-pink-500" : "bg-slate-300"}`}
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${isRange ? "translate-x-5" : "translate-x-0"}`}
              />
            </button>
            <span className="text-xs font-bold text-slate-600 group-hover:text-slate-800 transition-colors">
              Rango de fechas (ej. vacaciones)
            </span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer group w-fit">
            <button
              type="button"
              role="switch"
              aria-checked={isFullDay}
              onClick={() => setIsFullDay(p => !p)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 ${isFullDay ? "bg-purple-500" : "bg-slate-300"}`}
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${isFullDay ? "translate-x-5" : "translate-x-0"}`}
              />
            </button>
            <span className="text-xs font-bold text-slate-600 group-hover:text-slate-800 transition-colors">
              Todo el día
            </span>
          </label>
        </div>

        {/* Grid de Configuración */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Columna Izquierda: Fecha */}
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">
                {isRange ? "Selecciona la fecha de inicio y luego la de fin" : "Fecha"}
              </label>

              {isRange ? (
                <div className="space-y-3">
                  <CalendarPicker
                    mode="range"
                    rangeStart={rangeStart}
                    rangeEnd={rangeEnd}
                    onRangeChange={(s, e) => { setRangeStart(s); setRangeEnd(e); }}
                  />
                  {rangeStart && (
                    <p className="text-xs font-bold text-pink-600 bg-pink-50 py-2 px-3 rounded-lg inline-block">
                      {rangeStart}{rangeEnd ? ` → ${rangeEnd}` : " → (elige la fecha final)"}
                    </p>
                  )}
                </div>
              ) : (
                <CalendarPicker mode="single" value={date} onChange={setDate} />
              )}
            </div>
          </div>

          {/* Columna Derecha: Tipo, Horas y Motivo */}
          <div className="space-y-5">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">
                Tipo de excepción
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setMode("block")}
                  className={`flex items-center justify-center gap-1.5 py-3 rounded-xl text-xs font-bold border-2 transition-all ${mode === "block"
                      ? "border-rose-400 bg-rose-50 text-rose-600 shadow-sm"
                      : "border-slate-100 bg-white text-slate-500 hover:border-slate-200"}`}
                >
                  <CalendarOff className="w-4 h-4" /> Bloquear
                </button>
                <button
                  type="button"
                  onClick={() => setMode("extra")}
                  className={`flex items-center justify-center gap-1.5 py-3 rounded-xl text-xs font-bold border-2 transition-all ${mode === "extra"
                      ? "border-emerald-400 bg-emerald-50 text-emerald-600 shadow-sm"
                      : "border-slate-100 bg-white text-slate-500 hover:border-slate-200"}`}
                >
                  <CalendarPlus className="w-4 h-4" /> Añadir extra
                </button>
              </div>
            </div>

            {!isFullDay && (
              <div className="grid grid-cols-2 gap-4 animate-in fade-in duration-200">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">
                    Desde
                  </label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={e => setStartTime(e.target.value)}
                    className="w-full bg-white border-2 border-slate-100 rounded-xl text-sm font-bold
                               text-slate-800 px-3 py-2.5 focus:outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-50 transition-all"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">
                    Hasta
                  </label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={e => setEndTime(e.target.value)}
                    className="w-full bg-white border-2 border-slate-100 rounded-xl text-sm font-bold
                               text-slate-800 px-3 py-2.5 focus:outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-50 transition-all"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">
                Motivo (opcional)
              </label>
              <input
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Ej: Vacaciones, cita médica..."
                className="w-full bg-white border-2 border-slate-100 rounded-xl text-sm font-bold
                           text-slate-800 placeholder:text-slate-400 px-4 py-3
                           focus:outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-50 transition-all"
              />
            </div>

            <button
            onClick={submit}
            disabled={saving}
            className="w-full py-3.5 text-sm font-bold text-white rounded-xl
                       bg-gradient-to-r from-purple-600 to-pink-500
                       hover:from-purple-700 hover:to-pink-600
                       shadow-lg shadow-purple-200 active:scale-[0.98]
                       transition-all duration-300 disabled:opacity-50
                       flex items-center justify-center gap-2"
          >
            {saving ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <><Plus className="w-5 h-5" /> Agregar excepción</>
            )}
          </button>
          </div>
        </div>
      </div>

      {/* Lista */}
      <div className="pt-2">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
          Excepciones configuradas ({exceptions.length})
        </p>
        
        {loading ? (
          /* Aquí está el nuevo spinner de carga */
          <div className="flex flex-col items-center justify-center py-10 space-y-3 bg-slate-50/50 rounded-2xl border border-slate-100">
            <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
            <p className="text-xs font-bold text-slate-400">Cargando excepciones...</p>
          </div>
        ) : sorted.length === 0 ? (
          <div className="bg-slate-50/50 rounded-2xl border border-slate-100 py-8 text-center">
            <p className="text-sm text-slate-400 font-bold">
              Sin excepciones configuradas
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto pr-2 custom-scrollbar">
            {sorted.map(exc => (
              <div key={exc.id}
                className="flex items-center justify-between gap-3 bg-white border
                           border-slate-100 hover:border-slate-200 rounded-xl px-4 py-3 shadow-sm transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-lg flex-shrink-0
                    ${exc.is_available ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
                    {exc.is_available ? "Extra" : "Bloqueado"}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-700 capitalize truncate">
                      {fmtDate(exc.start_time_utc)}
                    </p>
                    <p className="text-[11px] text-slate-400 font-bold mt-0.5">
                      {exc.is_full_day ? "Todo el día" : `${fmtTime(exc.start_time_utc)} – ${fmtTime(exc.end_time_utc)}`}
                      {exc.reason && <span className="text-slate-500"> · {exc.reason}</span>}
                    </p>
                  </div>
                </div>
                <button
                    onClick={() => remove(exc.id)}
                    disabled={deletingId === exc.id}
                    className="text-slate-300 hover:text-rose-500 hover:bg-rose-50
                              p-2 rounded-lg transition-colors flex-shrink-0
                              disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    title="Eliminar excepción"
                  >
                    {deletingId === exc.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}