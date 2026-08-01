"use client";

import { useState, useEffect } from "react";
import { 
  Calendar, Clock, Trash2, CalendarDays, 
  Sparkles, AlertCircle, Check, X 
} from "lucide-react";
import api from "@/lib/api";
import ChipiWidget from "@/components/chipi/ChipiWidget";
import { utcTimeToLocal } from "@/lib/scheduleUtc";

const DAYS = [
  { value: 0, label: "Lunes", short: "Lun" },
  { value: 1, label: "Martes", short: "Mar" },
  { value: 2, label: "Miércoles", short: "Mié" },
  { value: 3, label: "Jueves", short: "Jue" },
  { value: 4, label: "Viernes", short: "Vie" },
  { value: 5, label: "Sábado", short: "Sáb" },
  { value: 6, label: "Domingo", short: "Dom" },
];

const AVAILABLE_HOURS = Array.from({ length: 18 }, (_, i) => `${(i + 6).toString().padStart(2, "0")}:00`);

interface PreferenceDraft {
  day_of_week: number;
  start_time_local: string;
  end_time_local: string;
}

export default function StudentPreferencesPage() {
  const [preferences, setPreferences] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const [selectedDay, setSelectedDay] = useState(0);
  const [blocks, setBlocks] = useState<PreferenceDraft[]>([]);
  const [selectedSlots, setSelectedSlots] = useState<Record<number, string[]>>({
    0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [],
  });

  const fetchPreferences = async () => {
  setLoading(true);
  try {
    const res = await api.get("/users/me/preferences");
    setPreferences(res.data);
    
    const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const initialSlots: Record<number, string[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    
    res.data.forEach((pref: any) => {
      // Declaramos 'day' ANTES del try para que el catch pueda acceder a él
      const day = pref.day_of_week; 
      
      try {
        const localStart = utcTimeToLocal(pref.start_time_utc, day, userTimezone);
        const localEnd = utcTimeToLocal(pref.end_time_utc, day, userTimezone);

        const startHour = parseInt(localStart.split(":")[0]);
        let endHour = parseInt(localEnd.split(":")[0]);
        
        if (localEnd.startsWith("00:0") && startHour > 0) {
          endHour = 24;
        }

        for (let h = startHour; h < endHour; h++) {
          const hourStr = `${h.toString().padStart(2, "0")}:00`;
          if (!initialSlots[day].includes(hourStr)) {
            initialSlots[day].push(hourStr);
          }
        } 
      } catch (err) {
        // Ahora esto funcionará perfectamente
        console.error(`Error processing preference for day ${day}:`, err);
      }
    });
    
    setSelectedSlots(initialSlots);
  } catch (e) {
    console.error("Error fetching preferences", e);
  } finally {
    setLoading(false);
  }
};

  useEffect(() => {
    fetchPreferences();
  }, []);

  // Convert individual hours into contiguous blocks automatically
  useEffect(() => {
    const newBlocks: PreferenceDraft[] = [];

    Object.entries(selectedSlots).forEach(([dayStr, hours]) => {
      if (hours.length === 0) return;

      const day = parseInt(dayStr);
      const sortedHours = [...hours].sort();

      let blockStart = sortedHours[0];
      let prevHourNum = parseInt(blockStart.split(":")[0]);

      for (let i = 1; i < sortedHours.length; i++) {
        const currHourNum = parseInt(sortedHours[i].split(":")[0]);

        if (currHourNum !== prevHourNum + 1) {
          const endNum = prevHourNum + 1;
          newBlocks.push({
            day_of_week: day,
            start_time_local: blockStart,
            end_time_local: endNum === 24 ? "23:59" : `${endNum.toString().padStart(2, "0")}:00`,
          });
          blockStart = sortedHours[i];
        }
        prevHourNum = currHourNum;
      }

      const finalEndNum = prevHourNum + 1;
      newBlocks.push({
        day_of_week: day,
        start_time_local: blockStart,
        end_time_local: finalEndNum === 24 ? "23:59" : `${finalEndNum.toString().padStart(2, "0")}:00`,
      });
    });

    setBlocks(newBlocks);
  }, [selectedSlots]);

  const toggleHour = (hour: string) => {
    setSelectedSlots((prev) => {
      const daySlots = prev[selectedDay];
      const isSelected = daySlots.includes(hour);
      return {
        ...prev,
        [selectedDay]: isSelected
          ? daySlots.filter((h) => h !== hour)
          : [...daySlots, hour],
      };
    });
  };

  const removeBlock = (day: number, startLocal: string, endLocal: string) => {
    const startNum = parseInt(startLocal.split(":")[0]);
    const endNum = endLocal.startsWith("23:5") ? 24 : parseInt(endLocal.split(":")[0]);
    const hoursToRemove: string[] = [];

    for (let i = startNum; i < endNum; i++) {
      hoursToRemove.push(`${i.toString().padStart(2, "0")}:00`);
    }

    setSelectedSlots((prev) => ({
      ...prev,
      [day]: prev[day].filter((h) => !hoursToRemove.includes(h)),
    }));
  };

  const savePreferences = async () => {
    setSaving(true);
    setError("");
    setSuccessMsg("");
    try {
      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      await api.put("/users/me/preferences", {
        timezone: userTimezone,
        slots: blocks,
      });
      setSuccessMsg("¡Preferencias actualizadas con éxito!");
      fetchPreferences();
    } catch (e: any) {
      const detail = e.response?.data?.detail;
      let errorMessage = "Error guardando las preferencias";
      if (typeof detail === "string") {
        errorMessage = detail;
      } else if (Array.isArray(detail)) {
        errorMessage = detail.map((err: any) => err.msg || JSON.stringify(err)).join(", ");
      } else if (typeof detail === "object" && detail !== null) {
        errorMessage = detail.msg || JSON.stringify(detail);
      }
      setError(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 relative overflow-hidden pb-12">
        {/* Blobs de fondo */}
        <div className="fixed top-[-80px] right-[-80px] w-[500px] h-[500px] bg-purple-300/20 rounded-full blur-[100px] pointer-events-none" />
        <div className="fixed bottom-[-80px] left-[-80px] w-[400px] h-[400px] bg-pink-300/15 rounded-full blur-[100px] pointer-events-none" />

        <div className="max-w-5xl mx-auto space-y-8 relative px-4 pt-6 animate-pulse">
          {/* Header Skeleton */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-2">
              <div className="h-8 w-64 bg-slate-200 rounded-xl" />
              <div className="h-4 w-96 bg-slate-200 rounded-lg" />
            </div>
            <div className="w-40 h-16 bg-slate-200 rounded-2xl" />
          </div>

          {/* Creador Interactivo Skeleton */}
          <div className="bg-white/80 backdrop-blur-xl rounded-[2.5rem] border border-white shadow-2xl p-6 md:p-8 space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <div className="h-3 w-48 bg-slate-200 rounded" />
                <div className="h-4 w-64 bg-slate-200 rounded" />
              </div>
              <div className="h-8 w-48 bg-slate-200 rounded-full" />
            </div>

            {/* Días skeleton */}
            <div className="flex gap-2 overflow-x-auto pb-2">
              {[...Array(7)].map((_, i) => (
                <div key={i} className="h-16 w-[90px] bg-slate-200 rounded-2xl flex-shrink-0" />
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 pt-2">
              <div className="lg:col-span-2 space-y-4">
                <div className="flex justify-between">
                  <div className="h-4 w-36 bg-slate-200 rounded" />
                  <div className="h-4 w-20 bg-slate-200 rounded" />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[...Array(12)].map((_, i) => (
                    <div key={i} className="h-12 bg-slate-200 rounded-2xl" />
                  ))}
                </div>
              </div>

              <div className="bg-slate-50/80 rounded-3xl p-5 border border-slate-100 flex flex-col justify-between space-y-4">
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <div className="h-3 w-28 bg-slate-200 rounded" />
                    <div className="h-5 w-6 bg-slate-200 rounded-full" />
                  </div>
                  <div className="space-y-2">
                    <div className="h-10 bg-slate-200 rounded-xl" />
                    <div className="h-10 bg-slate-200 rounded-xl" />
                  </div>
                </div>
                <div className="h-14 bg-slate-200 rounded-2xl" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden pb-12">
      {/* Blobs de fondo */}
      <div className="fixed top-[-80px] right-[-80px] w-[500px] h-[500px] bg-purple-300/20 rounded-full blur-[100px] pointer-events-none" />
      <div className="fixed bottom-[-80px] left-[-80px] w-[400px] h-[400px] bg-pink-300/15 rounded-full blur-[100px] pointer-events-none" />

      <div className="max-w-5xl mx-auto space-y-8 relative px-4 pt-6">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-slate-800 tracking-tight">
              Tus Horarios Preferidos
            </h1>
            <p className="text-slate-500 mt-1 font-medium">
              Configura tus franjas horarias favoritas para que el sistema destaque automáticamente tus mejores opciones al agendar.
            </p>
          </div>
          <div className="bg-white/80 backdrop-blur-xl border border-white shadow-xl shadow-slate-200/50 px-5 py-3 rounded-2xl flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-50 rounded-xl flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-purple-500" />
            </div>
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Activas</p>
              <p className="text-lg font-black text-slate-800">{preferences.length} bloques</p>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-rose-50 border border-rose-100 text-rose-600 px-4 py-3 rounded-2xl text-xs font-bold flex items-center gap-2">
            <X className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {successMsg && (
          <div className="bg-emerald-50 border border-emerald-100 text-emerald-600 px-4 py-3 rounded-2xl text-xs font-bold flex items-center gap-2">
            <Check className="w-4 h-4 flex-shrink-0" />
            {successMsg}
          </div>
        )}

        {/* Creador Interactivo de Preferencias */}
        <div className="bg-white/80 backdrop-blur-xl rounded-[2.5rem] border border-white shadow-2xl shadow-slate-200/50 p-6 md:p-8 space-y-6">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">
                Editor Interactivo de Disponibilidad
              </h2>
              <p className="text-sm font-bold text-slate-700 mt-1">
                Selecciona los bloques de tiempo que prefieres para tus clases.
              </p>
            </div>
            <div className="bg-purple-50 border border-purple-100 px-3 py-1.5 rounded-full text-xs font-bold text-purple-700">
              Haz clic en las horas para activar/desactivar
            </div>
          </div>

          {/* Selector de Días */}
          <div className="flex overflow-x-auto pb-2 gap-2">
            {DAYS.map((day, i) => (
              <button
                key={i}
                onClick={() => setSelectedDay(i)}
                className={`px-5 py-3.5 rounded-2xl text-sm font-black transition-all duration-200 min-w-[90px] flex flex-col items-center gap-1.5
                  ${selectedDay === i
                    ? "bg-gradient-to-br from-purple-600 to-pink-500 text-white shadow-lg shadow-purple-200"
                    : "bg-slate-50 text-slate-500 hover:bg-slate-100 border border-slate-100"
                  }`}
              >
                <span>{day.short}</span>
                {selectedSlots[i].length > 0 && (
                  <div className={`w-2 h-2 rounded-full ${selectedDay === i ? "bg-white" : "bg-purple-500"}`} />
                )}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 pt-2">
            
            {/* Columna Izquierda / Horas */}
            <div className="lg:col-span-2 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-black text-slate-700">
                  Horarios para el <span className="text-purple-600">{DAYS[selectedDay].label}</span>
                </p>
                <button
                  onClick={() => setSelectedSlots((prev) => ({ ...prev, [selectedDay]: [] }))}
                  className="text-xs font-bold text-slate-400 hover:text-rose-500 transition-colors"
                >
                  Limpiar día
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-h-[320px] overflow-y-auto pr-1">
                {AVAILABLE_HOURS.map((hour) => {
                  const isSelected = selectedSlots[selectedDay].includes(hour);
                  return (
                    <button
                      key={hour}
                      onClick={() => toggleHour(hour)}
                      className={`py-3.5 px-3 rounded-2xl text-sm font-bold transition-all duration-200 border-2 flex items-center justify-center gap-2
                        ${isSelected
                          ? "border-purple-400 bg-purple-50 text-purple-700 shadow-sm shadow-purple-100"
                          : "border-slate-100 bg-white text-slate-600 hover:border-purple-200 hover:bg-purple-50/30"
                        }`}
                    >
                      <Clock className={`w-3.5 h-3.5 ${isSelected ? "text-purple-500" : "text-slate-400"}`} />
                      {hour}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Columna Derecha: Resumen de bloques seleccionados */}
            <div className="bg-slate-50/80 rounded-3xl p-5 border border-slate-100 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    Resumen de Bloques
                  </p>
                  <span className="bg-purple-100 text-purple-700 text-xs font-bold px-2.5 py-0.5 rounded-full">
                    {blocks.length}
                  </span>
                </div>

                {blocks.length > 0 ? (
                  <div className="space-y-2.5 max-h-[220px] overflow-y-auto pr-1">
                    {blocks.map((block, idx) => (
                      <div key={idx} className="flex items-center justify-between bg-white border border-slate-100 rounded-xl px-3 py-2.5 shadow-sm">
                        <div className="flex items-center gap-2.5">
                          <span className="text-[10px] font-black text-white bg-purple-600 px-2 py-1 rounded-md">
                            {DAYS[block.day_of_week].short}
                          </span>
                          <span className="text-xs font-bold text-slate-700">
                            {block.start_time_local} – {block.end_time_local}
                          </span>
                        </div>
                        <button
                          onClick={() => removeBlock(block.day_of_week, block.start_time_local, block.end_time_local)}
                          className="text-slate-300 hover:text-rose-500 hover:bg-rose-50 p-1 rounded-lg transition-colors"
                          title="Eliminar bloque"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-12 text-center">
                    <CalendarDays className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                    <p className="text-xs text-slate-400 font-bold">Sin bloques seleccionados</p>
                  </div>
                )}
              </div>

              <div className="pt-4 mt-4 border-t border-slate-200/60">
                <button
                  onClick={savePreferences}
                  disabled={saving}
                  className="w-full py-4 text-sm font-bold text-white rounded-2xl
                             bg-gradient-to-r from-purple-600 to-pink-500
                             hover:from-purple-700 hover:to-pink-600
                             shadow-lg shadow-purple-200 active:scale-[0.98]
                             transition-all duration-300 disabled:opacity-50
                             flex items-center justify-center gap-2"
                >
                  {saving ? (
                    <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  ) : (
                    <><Check className="w-4 h-4" /> Guardar Preferencias</>
                  )}
                </button>
              </div>
            </div>

          </div>
        </div>

      </div>
      <ChipiWidget screenName="student-preferences" />
    </div>
  );
}