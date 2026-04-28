"use client";

import { useState, useEffect } from "react";
import { useWeeklyAvailability, useTeacherProfile } from "@/hooks/useTeacherData";
import { Card, Button, Badge, StatCard } from "@/components/ui"; // Importación limpia desde el index
import api from "@/lib/api";
import ChipiWidget from "@/components/chipi/ChipiWidget";
import { Trash2, CalendarDays } from "lucide-react";

const DAYS = [
  { value: 0, label: "Lunes", short: "Lun" },
  { value: 1, label: "Martes", short: "Mar" },
  { value: 2, label: "Miércoles", short: "Mié" },
  { value: 3, label: "Jueves", short: "Jue" },
  { value: 4, label: "Viernes", short: "Vie" },
  { value: 5, label: "Sábado", short: "Sáb" },
  { value: 6, label: "Domingo", short: "Dom" },
];

// Generamos las horas disponibles desde las 06:00 hasta las 23:00 para dar amplio margen al profesor
const AVAILABLE_HOURS = Array.from({ length: 18 }, (_, i) => `${(i + 6).toString().padStart(2, "0")}:00`);

interface SlotDraft {
  day_of_week: number;
  start_time_local: string;
  end_time_local: string;
  is_available: boolean;
}

export default function AvailabilityPage() {
  const { slots, loading, refetch } = useWeeklyAvailability();
  const { profile } = useTeacherProfile();
  const [saving, setSaving] = useState(false);

  // ─── ESTADOS DEL CREADOR INTERACTIVO ───
  const [selectedDay, setSelectedDay] = useState(0);
  const [blocks, setBlocks] = useState<SlotDraft[]>([]);
  const [selectedSlots, setSelectedSlots] = useState<Record<number, string[]>>({
    0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [],
  });

  // 🧠 LÓGICA: Convertir horas sueltas en bloques contiguos automáticamente
  useEffect(() => {
    const newBlocks: SlotDraft[] = [];

    Object.entries(selectedSlots).forEach(([dayStr, hours]) => {
      if (hours.length === 0) return;

      const day = parseInt(dayStr);
      const sortedHours = [...hours].sort();

      let blockStart = sortedHours[0];
      let prevHourNum = parseInt(blockStart.split(":")[0]);

      for (let i = 1; i < sortedHours.length; i++) {
        const currHourNum = parseInt(sortedHours[i].split(":")[0]);

        if (currHourNum !== prevHourNum + 1) {
          newBlocks.push({
            day_of_week: day,
            start_time_local: blockStart,
            end_time_local: `${(prevHourNum + 1).toString().padStart(2, "0")}:00`,
            is_available: true,
          });
          blockStart = sortedHours[i];
        }
        prevHourNum = currHourNum;
      }

      newBlocks.push({
        day_of_week: day,
        start_time_local: blockStart,
        end_time_local: `${(prevHourNum + 1).toString().padStart(2, "0")}:00`,
        is_available: true,
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
    const endNum = parseInt(endLocal.split(":")[0]);
    const hoursToRemove: string[] = [];

    for (let i = startNum; i < endNum; i++) {
      hoursToRemove.push(`${i.toString().padStart(2, "0")}:00`);
    }

    setSelectedSlots((prev) => ({
      ...prev,
      [day]: prev[day].filter((h) => !hoursToRemove.includes(h)),
    }));
  };

  // ─── GUARDAR EN BACKEND ───
  const saveAvailability = async () => {
    if (!profile?.timezone) {
      alert("Configura tu zona horaria en tu perfil primero");
      return;
    }
    if (blocks.length === 0) {
      alert("Añade al menos un bloque de disponibilidad");
      return;
    }
    setSaving(true);
    try {
      await api.post("/availability/me/weekly", {
        timezone: profile.timezone,
        slots: blocks,
      });
      // Limpiamos el formulario tras guardar con éxito
      setSelectedSlots({ 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] });
      refetch();
    } catch (e: any) {
      alert(e.response?.data?.detail || "Error guardando disponibilidad");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8 animate-fade-up max-w-5xl mx-auto pb-12">
      {/* ─── Resumen Superior ─── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2">
          <h1 className="font-display text-4xl font-black text-slate-800 mb-2 tracking-tight">
            Gestión de Horarios
          </h1>
          <p className="text-slate-500 font-medium">
            Define los bloques de tiempo en los que tus alumnos pueden agendar clases.
          </p>
        </div>
        <StatCard
          label="Bloques Activos"
          value={slots.length}
          icon={<ClockIcon />}
        />
      </div>

      {profile?.timezone && (
        <Badge variant="pink" className="py-2 px-4 shadow-sm">
          <span className="flex h-2 w-2 rounded-full bg-pink-500 animate-pulse mr-2" />
          Zona horaria local: {profile.timezone}
        </Badge>
      )}

      {/* ─── Listado de Disponibilidad Actual ─── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between ml-2">
          <h2 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">
            Tu Agenda Semanal Actual
          </h2>
        </div>

        {loading ? (
          <div className="grid gap-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-20 bg-white rounded-[2rem] animate-pulse border border-slate-100" />
            ))}
          </div>
        ) : slots.length === 0 ? (
          <Card className="py-16 text-center border-2 border-dashed border-slate-200 shadow-none">
            <p className="text-slate-400 font-bold uppercase text-xs tracking-widest">
              No hay horarios configurados
            </p>
          </Card>
        ) : (
          <div className="grid gap-3">
            {DAYS.map((day) => {
              const daySlots = slots.filter((s) => s.day_of_week === day.value);
              if (daySlots.length === 0) return null;
              return (
                <Card key={day.value} className="p-5 flex flex-col md:flex-row md:items-center gap-4 hover:border-pink-200" hover>
                  <div className="w-32">
                    <Badge variant="neutral" className="w-full justify-center py-1.5 font-black">
                      {day.label}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {daySlots.map((slot) => (
                      <Badge
                        key={slot.id}
                        variant={slot.is_available ? "success" : "neutral"}
                        className="font-semibold shadow-sm"
                      >
                        {slot.start_time_utc} – {slot.end_time_utc} UTC
                      </Badge>
                    ))}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* ─── Creador de Disponibilidad Interactivo ─── */}
      <section className="space-y-4 pt-6">
        <h2 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] ml-2">
          Actualizar Calendario
        </h2>
        
        <div className="bg-rose-50/50 p-5 rounded-3xl border border-rose-100 flex gap-4 items-start mb-6">
          <span className="text-xl">✨</span>
          <p className="text-sm text-rose-700 font-semibold leading-relaxed">
            Al guardar, se sobrescribirá toda tu agenda previa. Selecciona en el calendario interactivo todas las horas que deseas mantener activas.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* Columna Izquierda: Selector Interactivo */}
          <div className="lg:col-span-3 bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex flex-col">
            <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">
              Selecciona el Día
            </p>

            {/* Días */}
            <div className="flex overflow-x-auto pb-2 mb-6 gap-2 custom-scrollbar">
              {DAYS.map((day, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedDay(i)}
                  className={`px-5 py-3 rounded-2xl text-sm font-black transition-all duration-200 min-w-[80px] flex flex-col items-center gap-1
                    ${selectedDay === i
                      ? "bg-slate-800 text-white shadow-lg shadow-slate-200"
                      : "bg-slate-50 text-slate-500 hover:bg-slate-100 border border-slate-100"
                    }`}
                >
                  <span>{day.short}</span>
                  {selectedSlots[i].length > 0 && (
                    <div className={`w-1.5 h-1.5 rounded-full ${selectedDay === i ? "bg-pink-500" : "bg-pink-400"}`} />
                  )}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-bold text-slate-600">
                Horarios para el <span className="text-pink-600">{DAYS[selectedDay].label}</span>
              </p>
              <button
                onClick={() => setSelectedSlots((prev) => ({ ...prev, [selectedDay]: [] }))}
                className="text-xs font-bold text-slate-400 hover:text-red-500 transition-colors"
              >
                Limpiar día
              </button>
            </div>

            {/* Grid de píldoras de horas */}
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 flex-1 overflow-y-auto pr-2 max-h-[300px] custom-scrollbar">
              {AVAILABLE_HOURS.map((hour) => {
                const isSelected = selectedSlots[selectedDay].includes(hour);
                return (
                  <button
                    key={hour}
                    onClick={() => toggleHour(hour)}
                    className={`py-3 rounded-xl text-sm font-bold transition-all duration-200 border-2 flex items-center justify-center gap-2
                      ${isSelected
                        ? "border-pink-500 bg-pink-50 text-pink-700 shadow-sm"
                        : "border-slate-100 bg-white text-slate-600 hover:border-pink-200 hover:bg-pink-50/50"
                      }`}
                  >
                    {hour}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Columna Derecha: Vista Previa y Botón Guardar */}
          <div className="lg:col-span-2 flex flex-col gap-4">
            <div className="bg-slate-50 rounded-3xl p-6 border border-slate-100 flex flex-col flex-1">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest">
                  Resumen (Local)
                </p>
                <span className="bg-pink-100 text-pink-600 text-xs font-bold px-2.5 py-1 rounded-full">
                  {blocks.length} {blocks.length === 1 ? "bloque" : "bloques"}
                </span>
              </div>

              {blocks.length > 0 ? (
                <div className="space-y-3 overflow-y-auto pr-2 flex-1 max-h-[250px] custom-scrollbar">
                  {blocks.map((block, idx) => (
                    <div key={idx} className="flex items-center justify-between bg-white border border-slate-100 rounded-xl px-4 py-3.5 shadow-sm animate-in zoom-in-95 duration-200">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-black text-white bg-slate-800 px-2.5 py-1 rounded-lg w-10 text-center">
                          {DAYS[block.day_of_week].short}
                        </span>
                        <span className="text-sm font-bold text-slate-700">
                          {block.start_time_local} – {block.end_time_local}
                        </span>
                      </div>
                      <button
                        onClick={() => removeBlock(block.day_of_week, block.start_time_local, block.end_time_local)}
                        className="text-slate-300 hover:text-red-500 hover:bg-red-50 p-1.5 rounded-lg transition-colors"
                        title="Eliminar bloque"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center py-10 opacity-60">
                  <CalendarDays className="w-12 h-12 text-slate-300 mb-3" />
                  <p className="text-sm text-slate-500 font-bold">Aún no hay horarios</p>
                  <p className="text-xs text-slate-400 mt-1">
                    Selecciona horas en el panel izquierdo.
                  </p>
                </div>
              )}
            </div>

            {/* Botón de Guardar */}
            <Button
              variant="primary"
              size="lg"
              loading={saving}
              disabled={blocks.length === 0}
              onClick={saveAvailability}
              className="w-full h-[60px] !rounded-[1.5rem] shadow-xl shadow-pink-200"
            >
              Confirmar y Guardar Agenda
            </Button>
          </div>
        </div>
      </section>

      <ChipiWidget screenName="availability" />
    </div>
  );
}

// ─── ICONOS ───
const ClockIcon = () => (
  <svg className="w-6 h-6 text-pink-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);