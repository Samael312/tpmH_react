"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Clock, Check, ChevronRight, ChevronLeft,
  Globe, Target, CreditCard, CalendarDays,
  Sparkles, ChevronDown, X, Trash2,
  BookOpen, Rocket
} from "lucide-react";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

// ─── Constantes ───────────────────────────────────────────────────────────────
const TIMEZONES = [
  "America/Caracas", "America/Bogota", "America/Lima",
  "America/Mexico_City", "America/New_York", "America/Los_Angeles",
  "America/Santiago", "America/Buenos_Aires",
  "America/Sao_Paulo", "America/Chicago",
  "Europe/Madrid", "Europe/London", "Europe/Paris",
  "Asia/Tokyo", "Asia/Dubai", "UTC",
];

const GOALS = [
  { text: "Conversaciones cotidianas", desc: "Hablar de temas del día a día", icon: "🗣️" },
  { text: "Mejorar pronunciación", desc: "Fluidez y acento natural", icon: "🎙️" },
  { text: "Ampliar vocabulario", desc: "Palabras para situaciones reales", icon: "📚" },
  { text: "Comprender audios/videos", desc: "Entender a hablantes nativos", icon: "🎧" },
  { text: "Preparar exámenes", desc: "TOEFL, IELTS, Cambridge, etc.", icon: "📝" },
  { text: "Viajar al extranjero", desc: "Sobrevivir en otro país en inglés", icon: "✈️" },
];

const PAYMENT_METHODS = [
  { value: "Paypal", label: "PayPal", icon: "💳", color: "text-blue-600" },
  { value: "Binance", label: "Binance (USDT)", icon: "🔶", color: "text-yellow-500" },
  { value: "Zelle", label: "Zelle", icon: "💜", color: "text-purple-600" },
];

const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

interface ScheduleBlock {
  day_of_week: number;
  start_time_local: string;
  end_time_local: string;
}

// ─── Panel Lateral de Progreso ────────────────────────────────────────────────
function SidebarProgress({ step, name }: { step: number; name: string }) {
  const steps = [
    { num: 1, title: "Bienvenida", desc: "Conociéndonos" },
    { num: 2, title: "Preferencias", desc: "Tus objetivos" },
    { num: 3, title: "Disponibilidad", desc: "Tus horarios" },
    { num: 4, title: "Pagos", desc: "Métodos preferidos" },
  ];

  return (
    <div className="hidden lg:flex w-1/3 max-w-sm bg-slate-900 p-10 flex-col justify-between relative overflow-hidden">
      {/* Elementos decorativos */}
      <div className="absolute top-[-10%] left-[-10%] w-64 h-64 bg-pink-500/20 blur-[80px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-64 h-64 bg-rose-500/20 blur-[80px] rounded-full pointer-events-none" />

      <div className="relative z-10">
        <div className="w-16 h-16 rounded-2xl overflow-hidden shadow-2xl border-2 border-slate-700/50 mb-10 bg-white p-1">
          <Image src="/assets/logo.png" alt="Logo" width={64} height={64} className="object-contain w-full h-full" />
        </div>
        <h2 className="text-3xl font-black text-white mb-2">Puesta a punto</h2>
        <p className="text-slate-400 mb-12">Estamos preparando todo para ti, {name}.</p>

        <div className="space-y-8">
          {steps.map((s, i) => {
            const isCompleted = step > s.num;
            const isActive = step === s.num;
            return (
              <div key={i} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-300 ${
                    isCompleted ? "bg-emerald-500 text-white" : isActive ? "bg-pink-500 text-white ring-4 ring-pink-500/20" : "bg-slate-800 text-slate-500"
                  }`}>
                    {isCompleted ? <Check className="w-5 h-5" /> : s.num}
                  </div>
                  {i !== steps.length - 1 && (
                    <div className={`w-0.5 h-12 mt-2 rounded-full ${isCompleted ? "bg-emerald-500/50" : "bg-slate-800"}`} />
                  )}
                </div>
                <div className="pt-2">
                  <p className={`font-bold ${isActive || isCompleted ? "text-white" : "text-slate-500"}`}>{s.title}</p>
                  <p className="text-xs text-slate-400 mt-1">{s.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Paso 1: Bienvenida ───────────────────────────────────────────────────────
function StepWelcome({ name, onNext }: { name: string; onNext: () => void }) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-2xl mx-auto w-full">
      <div className="inline-flex items-center gap-2 bg-pink-50 border border-pink-100 rounded-full px-4 py-1.5 mb-6">
        <Sparkles className="w-4 h-4 text-pink-500" />
        <span className="text-xs font-black text-pink-600 uppercase tracking-widest">¡Comencemos!</span>
      </div>

      <h1 className="text-5xl font-black text-slate-800 tracking-tight mb-4">
        Hola, {name} 👋
      </h1>
      <p className="text-slate-500 text-lg leading-relaxed mb-10 max-w-xl">
        Antes de empezar a agendar clases, necesitamos configurar tu perfil para ofrecerte la mejor experiencia posible. Solo te tomará <span className="font-black text-pink-600">2 minutos</span>.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
        {[
          { icon: <Globe className="w-5 h-5 text-blue-500" />, title: "Zona horaria", text: "Para sincronizar clases" },
          { icon: <Target className="w-5 h-5 text-purple-500" />, title: "Objetivo", text: "Para adaptar el contenido" },
          { icon: <Clock className="w-5 h-5 text-pink-500" />, title: "Disponibilidad", text: "Para mostrarte huecos" },
          { icon: <CreditCard className="w-5 h-5 text-emerald-500" />, title: "Pagos", text: "Para agilizar reservas" },
        ].map((item, i) => (
          <div key={i} className="flex items-start gap-4 p-5 bg-white border border-slate-100 rounded-2xl shadow-sm hover:shadow-md transition-shadow">
            <div className="w-12 h-12 bg-slate-50 rounded-xl flex items-center justify-center flex-shrink-0">
              {item.icon}
            </div>
            <div>
              <p className="font-bold text-slate-800">{item.title}</p>
              <p className="text-sm text-slate-500 mt-1">{item.text}</p>
            </div>
          </div>
        ))}
      </div>

      <button onClick={onNext} className="py-4 px-8 text-base font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 shadow-xl shadow-pink-200 hover:shadow-pink-300 active:scale-[0.98] transition-all duration-300 flex items-center justify-center gap-2 w-full md:w-auto">
        Empezar configuración <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  );
}

// ─── Paso 2: Zona horaria y objetivo ──────────────────────────────────────────
function StepPreferences({ timezone, setTimezone, goal, setGoal, onNext, onBack }: any) {
  const valid = timezone && goal;

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300 w-full max-w-3xl mx-auto space-y-8">
      <div>
        <h2 className="text-4xl font-black text-slate-800 tracking-tight">Tus preferencias</h2>
        <p className="text-slate-500 text-lg mt-2">Cuéntanos sobre ti para personalizar tu experiencia.</p>
      </div>

      <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 space-y-4">
        <label className="text-xs font-black text-slate-400 uppercase tracking-widest block">Tu zona horaria</label>
        <div className="relative max-w-md">
          <Globe className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
          <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full appearance-none bg-slate-50 border-2 border-slate-100 rounded-xl text-base font-bold text-slate-800 pl-12 pr-10 py-4 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all duration-300 cursor-pointer">
            <option value="">Seleccionar zona horaria...</option>
            {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </select>
          <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
        </div>
      </div>

      <div>
        <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-4">¿Cuál es tu objetivo principal?</label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {GOALS.map((g) => (
            <button key={g.text} onClick={() => setGoal(g.text)} className={`flex items-start gap-4 p-4 rounded-2xl border-2 text-left transition-all duration-200 ${goal === g.text ? "border-pink-500 bg-pink-50 shadow-md shadow-pink-100" : "border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50"}`}>
              <div className="text-3xl flex-shrink-0">{g.icon}</div>
              <div className="flex-1">
                <span className={`block font-bold text-base leading-snug ${goal === g.text ? "text-pink-700" : "text-slate-700"}`}>{g.text}</span>
                <span className="block text-sm text-slate-500 mt-1">{g.desc}</span>
              </div>
              <div className={`w-5 h-5 mt-1 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all ${goal === g.text ? "border-pink-500 bg-pink-500" : "border-slate-300"}`}>
                {goal === g.text && <div className="w-2 h-2 bg-white rounded-full" />}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-4 pt-6 border-t border-slate-100">
        <button onClick={onBack} className="px-8 py-4 text-base font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors flex items-center justify-center gap-2">
          <ChevronLeft className="w-5 h-5" /> Volver
        </button>
        <button onClick={onNext} disabled={!valid} className="flex-1 py-4 text-base font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 shadow-lg shadow-pink-200 active:scale-[0.98] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
          Continuar <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

// ─── Paso 3: Horario preferencial (Selección visual por bloques) ────────────
function StepSchedule({ blocks, setBlocks, onNext, onBack }: any) {
  const [selectedDay, setSelectedDay] = useState(0);

  // Generamos las horas disponibles (ej. de 07:00 a 22:00)
  const AVAILABLE_HOURS = Array.from({ length: 16 }, (_, i) => `${(i + 7).toString().padStart(2, "0")}:00`);

  // Estado local para manejar las horas sueltas seleccionadas por día
  const [selectedSlots, setSelectedSlots] = useState<Record<number, string[]>>(() => {
    const initial: Record<number, string[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    blocks.forEach((b: any) => {
      const start = parseInt(b.start_time_local.split(":")[0]);
      const end = parseInt(b.end_time_local.split(":")[0]);
      for (let h = start; h < end; h++) {
        initial[b.day_of_week].push(`${h.toString().padStart(2, "0")}:00`);
      }
    });
    return initial;
  });

  // Cada vez que el usuario marca/desmarca horas, calculamos los rangos contiguos
  useEffect(() => {
    const newBlocks: any[] = [];

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
            end_time_local: `${(prevHourNum + 1).toString().padStart(2, "0")}:00`
          });
          blockStart = sortedHours[i];
        }
        prevHourNum = currHourNum;
      }
      
      newBlocks.push({
        day_of_week: day,
        start_time_local: blockStart,
        end_time_local: `${(prevHourNum + 1).toString().padStart(2, "0")}:00`
      });
    });

    setBlocks(newBlocks);
  }, [selectedSlots, setBlocks]);

  const toggleHour = (hour: string) => {
    setSelectedSlots(prev => {
      const daySlots = prev[selectedDay];
      const isSelected = daySlots.includes(hour);
      return {
        ...prev,
        [selectedDay]: isSelected 
          ? daySlots.filter(h => h !== hour) 
          : [...daySlots, hour] 
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

    setSelectedSlots(prev => ({
      ...prev,
      [day]: prev[day].filter(h => !hoursToRemove.includes(h))
    }));
  };

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300 w-full max-w-4xl mx-auto space-y-8">
      <div>
        <h2 className="text-4xl font-black text-slate-800 tracking-tight">Tu disponibilidad</h2>
        <p className="text-slate-500 text-lg mt-2">Selecciona las horas en las que prefieres tomar clases.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        
        {/* Columna Izquierda: Selector Interactivo */}
        <div className="lg:col-span-3 bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex flex-col">
          <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Días de la semana</p>
          
          <div className="flex overflow-x-auto pb-2 mb-6 gap-2 hide-scrollbar">
            {DAYS.map((day, i) => (
              <button 
                key={i} 
                onClick={() => setSelectedDay(i)} 
                className={`px-5 py-3 rounded-2xl text-sm font-black transition-all duration-200 min-w-[80px] flex flex-col items-center gap-1
                  ${selectedDay === i 
                    ? "bg-slate-800 text-white shadow-lg shadow-slate-200" 
                    : "bg-slate-50 text-slate-500 hover:bg-slate-100 border border-slate-100"}`}
              >
                <span>{day}</span>
                {selectedSlots[i].length > 0 && (
                  <div className={`w-1.5 h-1.5 rounded-full ${selectedDay === i ? "bg-pink-500" : "bg-pink-400"}`} />
                )}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-bold text-slate-600">
              Horarios para el <span className="text-pink-600">{DAYS[selectedDay]}</span>
            </p>
            <button 
               onClick={() => setSelectedSlots(prev => ({ ...prev, [selectedDay]: [] }))}
               className="text-xs font-bold text-slate-400 hover:text-red-500 transition-colors"
            >
               Limpiar día
            </button>
          </div>

          {/* Grid de píldoras de horas */}
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 flex-1 overflow-y-auto pr-2 max-h-[250px]">
            {AVAILABLE_HOURS.map((hour) => {
              const isSelected = selectedSlots[selectedDay].includes(hour);
              return (
                <button
                  key={hour}
                  onClick={() => toggleHour(hour)}
                  className={`py-3 rounded-xl text-sm font-bold transition-all duration-200 border-2 flex items-center justify-center gap-2
                    ${isSelected 
                      ? "border-pink-500 bg-pink-50 text-pink-700 shadow-sm" 
                      : "border-slate-100 bg-white text-slate-600 hover:border-pink-200 hover:bg-pink-50/50"}`}
                >
                  {hour}
                </button>
              );
            })}
          </div>
        </div>

        {/* Columna Derecha: Vista Previa */}
        <div className="lg:col-span-2 bg-slate-50 rounded-3xl p-6 border border-slate-100 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-black text-slate-400 uppercase tracking-widest">
              Vista Previa
            </p>
            <span className="bg-pink-100 text-pink-600 text-xs font-bold px-2.5 py-1 rounded-full">
              {blocks.length} {blocks.length === 1 ? 'rango' : 'rangos'}
            </span>
          </div>
          
          {blocks.length > 0 ? (
            <div className="space-y-3 overflow-y-auto pr-2 flex-1 max-h-[320px]">
              {blocks.map((block: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between bg-white border border-slate-100 rounded-xl px-4 py-3.5 shadow-sm animate-in zoom-in-95 duration-200">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-black text-white bg-slate-800 px-2.5 py-1 rounded-lg w-10 text-center">
                      {DAYS[block.day_of_week]}
                    </span>
                    <span className="text-sm font-bold text-slate-700">
                      {block.start_time_local} – {block.end_time_local}
                    </span>
                  </div>
                  <button 
                    onClick={() => removeBlock(block.day_of_week, block.start_time_local, block.end_time_local)} 
                    className="text-slate-300 hover:text-red-500 hover:bg-red-50 p-1.5 rounded-lg transition-colors"
                    title="Eliminar rango"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-10 opacity-60">
              <CalendarDays className="w-12 h-12 text-slate-300 mb-3" />
              <p className="text-sm text-slate-500 font-bold">Aún no has seleccionado horas</p>
              <p className="text-xs text-slate-400 mt-1">Tus selecciones aparecerán aquí agrupadas.</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-4 pt-6 border-t border-slate-100">
        <button onClick={onBack} className="px-8 py-4 text-base font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors flex items-center justify-center gap-2">
          <ChevronLeft className="w-5 h-5" /> Volver
        </button>
        <button onClick={onNext} className="flex-1 py-4 text-base font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 shadow-lg shadow-pink-200 active:scale-[0.98] transition-all duration-300 flex items-center justify-center gap-2">
          {blocks.length === 0 ? "Saltar por ahora" : "Continuar"} <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

// ─── Paso 4: Métodos de pago ──────────────────────────────────────────────────
function StepPaymentMethods({ selected, setSelected, onNext, onBack, saving }: any) {
  const toggle = (v: string) => setSelected(selected.includes(v) ? selected.filter((x: string) => x !== v) : [...selected, v]);

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300 w-full max-w-3xl mx-auto space-y-8">
      <div>
        <h2 className="text-4xl font-black text-slate-800 tracking-tight">Métodos de pago</h2>
        <p className="text-slate-500 text-lg mt-2">Selecciona cómo prefieres pagar a tus profesores (opcional).</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {PAYMENT_METHODS.map((pm) => (
          <button key={pm.value} onClick={() => toggle(pm.value)} className={`flex flex-col items-center gap-3 p-6 rounded-3xl border-2 transition-all duration-200 text-center ${selected.includes(pm.value) ? "border-pink-500 bg-pink-50 shadow-md" : "border-slate-100 bg-white hover:border-slate-200"}`}>
            <span className="text-4xl">{pm.icon}</span>
            <span className={`text-base font-bold ${selected.includes(pm.value) ? "text-pink-700" : "text-slate-700"}`}>{pm.label}</span>
            <div className={`w-6 h-6 mt-2 rounded-full border-2 flex items-center justify-center transition-all ${selected.includes(pm.value) ? "border-pink-500 bg-pink-500" : "border-slate-300"}`}>
              {selected.includes(pm.value) && <Check className="w-4 h-4 text-white" />}
            </div>
          </button>
        ))}
      </div>

      <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5 flex gap-4 items-start">
        <span className="text-xl">💡</span>
        <p className="text-sm font-bold text-amber-800 leading-relaxed">
          El pago de las clases se coordina directamente con el profesor fuera de la plataforma. Esta selección nos ayuda a mostrarte profesores que acepten tus métodos preferidos.
        </p>
      </div>

      <div className="flex gap-4 pt-6 border-t border-slate-100">
        <button onClick={onBack} disabled={saving} className="px-8 py-4 text-base font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
          <ChevronLeft className="w-5 h-5" /> Volver
        </button>
        <button onClick={onNext} disabled={saving} className="flex-1 py-4 text-base font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 shadow-lg shadow-pink-200 active:scale-[0.98] transition-all duration-300 disabled:opacity-70 flex items-center justify-center gap-2">
          {saving ? (
            <div className="w-6 h-6 border-4 border-white/40 border-t-white rounded-full animate-spin" />
          ) : (
            <>{selected.length === 0 ? "Saltar y finalizar" : "Finalizar"}<Rocket className="w-5 h-5" /></>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Paso 5: Éxito ────────────────────────────────────────────────────────────
function StepSuccess({ name }: { name: string }) {
  return (
    <div className="flex flex-col items-center text-center py-10 animate-in fade-in zoom-in-95 duration-500 max-w-2xl mx-auto">
      <div className="w-24 h-24 bg-emerald-100 rounded-full flex items-center justify-center mb-8 shadow-2xl shadow-emerald-200">
        <Check className="w-12 h-12 text-emerald-600" />
      </div>
      <h2 className="text-5xl font-black text-slate-800 tracking-tight mb-4">¡Todo listo, {name}!</h2>
      <p className="text-slate-500 text-lg leading-relaxed mb-12">
        Tu perfil ha sido configurado exitosamente. Ya tienes acceso completo a la plataforma.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full mb-10 text-left">
        {[
          { icon: <CalendarDays className="w-6 h-6 text-pink-500" />, label: "Clase de prueba", sub: "Agenda sin compromiso" },
          { icon: <BookOpen className="w-6 h-6 text-purple-500" />, label: "Materiales", sub: "Recursos a tu nivel" },
        ].map((item, i) => (
          <div key={i} className="flex items-center gap-5 bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
            <div className="w-14 h-14 bg-slate-50 rounded-xl flex items-center justify-center flex-shrink-0">{item.icon}</div>
            <div>
              <p className="text-base font-bold text-slate-800">{item.label}</p>
              <p className="text-sm text-slate-500 mt-1">{item.sub}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function OnboardingPage() {
  const router = useRouter();
  const { user, setUser } = useAuthStore();

  const [step, setStep] = useState(1);
  const TOTAL_STEPS = 5;

  const [timezone, setTimezone] = useState(
    typeof window !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC"
  );
  const [goal, setGoal] = useState("");
  const [blocks, setBlocks] = useState<ScheduleBlock[]>([]);
  const [payMethods, setPayMethods] = useState<string[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const name = user?.name ?? "Estudiante";

  const next = () => setStep((p) => Math.min(p + 1, TOTAL_STEPS));
  const back = () => setStep((p) => Math.max(p - 1, 1));

  const finish = async () => {
    setSaving(true);
    setError("");
    try {
      // 1. Guardar perfil del estudiante
      await api.patch("/users/me/student-profile", {
        timezone,
        goal,
        preferred_payment_methods: payMethods,
      });

      // 2. Guardar bloques de horario si existen
      if (blocks.length > 0) {
        await api.post("/users/me/preferences", {
          timezone,
          slots: blocks,
        });
      }

      // 3. Marcar onboarding completado
      await api.patch("/users/me", { onboarding_completed: true });

      // 4. Actualizar el store local
      if (user) {
        setUser({
          ...user,
          timezone,
          goal,
          preferred_payment_methods: payMethods,
          onboarding_completed: true, 
        });
      }

      // 5. Ir al paso de éxito
      next();

      // 6. Redirigir al dashboard tras 3s
      setTimeout(() => router.push("/dashboard"), 3000);

    } catch (e: any) {
      setError(e.response?.data?.detail || "Error guardando la configuración. Inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-50 font-sans">
      {/* Panel lateral visible en pantallas grandes */}
      <SidebarProgress step={step} name={name} />

      {/* Contenido principal aprovechando el resto de la pantalla */}
      <div className="flex-1 flex flex-col justify-center px-6 py-12 md:px-12 overflow-y-auto relative">
        
        {/* Error global */}
        {error && (
          <div className="absolute top-6 right-6 left-6 md:left-auto max-w-sm bg-rose-50 border border-rose-200 text-rose-700 px-5 py-4 rounded-2xl text-sm font-bold flex items-start gap-3 shadow-lg z-50 animate-in slide-in-from-top-5">
            <X className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <p className="flex-1">{error}</p>
            <button onClick={() => setError("")} className="text-rose-400 hover:text-rose-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="w-full flex justify-center">
          {step === 1 && <StepWelcome name={name} onNext={next} />}
          {step === 2 && <StepPreferences timezone={timezone} setTimezone={setTimezone} goal={goal} setGoal={setGoal} onNext={next} onBack={back} />}
          {step === 3 && <StepSchedule blocks={blocks} setBlocks={setBlocks} onNext={next} onBack={back} />}
          {step === 4 && <StepPaymentMethods selected={payMethods} setSelected={setPayMethods} onNext={finish} onBack={back} saving={saving} />}
          
          {step === 5 && (
            <div className="w-full">
              <StepSuccess name={name} />
              <div className="max-w-md mx-auto mt-8">
                <button
                  onClick={() => router.push("/dashboard")}
                  className="w-full py-4 text-base font-bold text-white rounded-xl bg-slate-800 hover:bg-slate-900 shadow-xl transition-all duration-300 flex items-center justify-center gap-2"
                >
                  Ir a mi dashboard ahora
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Indicador de pasos para móvil */}
        {step < 5 && (
          <div className="lg:hidden mt-12 text-center">
            <p className="text-xs font-black text-slate-400 uppercase tracking-widest">
              {step === 1 ? "Paso 1 de 4" : `Paso ${step} de 4`}
            </p>
            <div className="flex justify-center gap-2 mt-3">
              {[1, 2, 3, 4].map((s) => (
                <div key={s} className={`h-1.5 rounded-full transition-all duration-300 ${step >= s ? "w-8 bg-pink-500" : "w-4 bg-slate-200"}`} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}