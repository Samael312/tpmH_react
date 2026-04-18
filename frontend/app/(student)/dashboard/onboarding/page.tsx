"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Clock, Check, ChevronRight, ChevronLeft,
  Globe, Target, CreditCard, CalendarDays,
  Sparkles, ChevronDown, X,
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
  "Mantener conversaciones básicas sobre temas cotidianos",
  "Mejorar la pronunciación y la fluidez al hablar",
  "Ampliar el vocabulario para situaciones reales",
  "Comprender mejor audios y vídeos en inglés",
  "Prepararse para exámenes oficiales (A1, A2, B1…)",
  "Ganar confianza al participar en conversaciones",
  "Poder viajar al extranjero usando solo inglés",
];

const PAYMENT_METHODS = [
  { value: "Paypal",  label: "PayPal",        icon: "💳" },
  { value: "Binance", label: "Binance (USDT)", icon: "🔶" },
  { value: "Zelle",   label: "Zelle",          icon: "💜" },
];

const DAYS  = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const HOURS = Array.from({ length: 24 }, (_, i) =>
  `${String(i).padStart(2, "0")}:00`
);

interface ScheduleBlock {
  day_of_week: number;
  start_time_local: string;
  end_time_local: string;
}

// ─── Barra de pasos ───────────────────────────────────────────────────────────
function StepBar({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {Array.from({ length: total }, (_, i) => {
        const step   = i + 1;
        const done   = step < current;
        const active = step === current;
        return (
          <div key={i} className="flex items-center gap-2 flex-1 last:flex-none">
            <div className={`
              w-8 h-8 rounded-full flex items-center justify-center
              text-xs font-black flex-shrink-0 transition-all duration-300
              ${done
                ? "bg-emerald-500 text-white shadow-md shadow-emerald-100"
                : active
                  ? "bg-gradient-to-br from-pink-500 to-rose-400 text-white shadow-md shadow-pink-100"
                  : "bg-slate-100 text-slate-400"
              }
            `}>
              {done ? <Check className="w-3.5 h-3.5" /> : step}
            </div>
            {i < total - 1 && (
              <div className={`
                flex-1 h-0.5 rounded-full transition-colors duration-300
                ${done ? "bg-emerald-300" : "bg-slate-200"}
              `} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Paso 1: Bienvenida ───────────────────────────────────────────────────────
function StepWelcome({ name, onNext }: { name: string; onNext: () => void }) {
  return (
    <div className="flex flex-col items-center text-center
                    animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="w-24 h-24 rounded-[2rem] overflow-hidden shadow-2xl
                        shadow-pink-200 border-4 border-white mb-6 bg-pink-50
                        flex items-center justify-center">
        <span className="text-5xl font-black text-pink-400">T</span>
      </div>

      <div className="inline-flex items-center gap-2 bg-pink-50 border
                        border-pink-100 rounded-full px-4 py-1.5 mb-4">
        <Sparkles className="w-3.5 h-3.5 text-pink-500" />
        <span className="text-xs font-black text-pink-600 uppercase tracking-widest">
          ¡Bienvenido a la plataforma!
        </span>
      </div>

      <h1 className="text-4xl font-black text-slate-800 tracking-tight mb-3">
        Hola, {name} 👋
      </h1>
      <p className="text-slate-500 leading-relaxed max-w-sm mb-8">
        Antes de empezar configuremos tu perfil. Solo toma{" "}
        <span className="font-black text-pink-600">2 minutos</span>.
      </p>

      <div className="w-full bg-slate-50 rounded-2xl p-5 mb-8 text-left space-y-3">
        {[
          { icon: <Globe className="w-4 h-4 text-blue-500" />,    text: "Confirmar tu zona horaria" },
          { icon: <Target className="w-4 h-4 text-purple-500" />, text: "Definir tu objetivo de aprendizaje" },
          { icon: <Clock className="w-4 h-4 text-pink-500" />,    text: "Elegir tus horarios preferidos" },
          { icon: <CreditCard className="w-4 h-4 text-emerald-500" />, text: "Seleccionar método de pago" },
        ].map((item, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="w-8 h-8 bg-white rounded-xl border border-slate-100
                              flex items-center justify-center flex-shrink-0 shadow-sm">
              {item.icon}
            </div>
            <p className="text-sm font-bold text-slate-700">{item.text}</p>
          </div>
        ))}
      </div>

      <button
        onClick={onNext}
        className="w-full py-4 text-sm font-bold text-white rounded-xl
                     bg-gradient-to-r from-pink-500 to-rose-400
                     shadow-xl shadow-pink-200 hover:shadow-pink-300
                     active:scale-[0.98] transition-all duration-300
                     flex items-center justify-center gap-2"
      >
        Empezar configuración
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

// ─── Paso 2: Zona horaria y objetivo ─────────────────────────────────────────
function StepPreferences({
  timezone, setTimezone,
  goal, setGoal,
  onNext, onBack,
}: {
  timezone: string; setTimezone: (v: string) => void;
  goal: string;     setGoal: (v: string) => void;
  onNext: () => void; onBack: () => void;
}) {
  const valid = timezone && goal;

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300 space-y-6">
      <div className="mb-2">
        <h2 className="text-2xl font-black text-slate-800 tracking-tight">
          Tus preferencias
        </h2>
        <p className="text-slate-500 text-sm mt-1">
          Necesitamos esto para mostrarte los horarios correctos
        </p>
      </div>

      {/* Zona horaria */}
      <div>
        <label className="text-[10px] font-black text-slate-400 uppercase
                            tracking-widest block mb-1.5">
          Tu zona horaria
        </label>
        <div className="relative">
          <Globe className="absolute left-3.5 top-1/2 -translate-y-1/2
                              w-5 h-5 text-slate-400 pointer-events-none" />
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full appearance-none bg-slate-50 border-2
                         border-transparent rounded-xl text-sm font-bold
                         text-slate-800 pl-11 pr-10 py-3.5
                         focus:outline-none focus:bg-white focus:border-pink-500
                         focus:ring-4 focus:ring-pink-50
                         transition-all duration-300 cursor-pointer"
          >
            <option value="">Seleccionar zona horaria...</option>
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2
                                     w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
        <p className="text-xs text-slate-400 mt-1.5 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          Los horarios de las clases se mostrarán en tu hora local
        </p>
      </div>

      {/* Objetivo */}
      <div>
        <label className="text-[10px] font-black text-slate-400 uppercase
                            tracking-widest block mb-3">
          ¿Cuál es tu objetivo principal?
        </label>
        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {GOALS.map((g) => (
            <button
              key={g}
              onClick={() => setGoal(g)}
              className={`
                w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl
                border-2 text-left transition-all duration-200
                ${goal === g
                  ? "border-pink-400 bg-pink-50"
                  : "border-slate-100 bg-white hover:border-slate-200"
                }
              `}
            >
              <div className={`
                w-5 h-5 rounded-full border-2 flex-shrink-0
                flex items-center justify-center transition-all
                ${goal === g ? "border-pink-500 bg-pink-500" : "border-slate-300"}
              `}>
                {goal === g && <div className="w-2 h-2 bg-white rounded-full" />}
              </div>
              <span className="text-sm font-bold text-slate-700 leading-snug">
                {g}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <button
          onClick={onBack}
          className="flex-1 py-3.5 text-sm font-bold text-slate-600
                       bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors
                       flex items-center justify-center gap-2"
        >
          <ChevronLeft className="w-4 h-4" /> Volver
        </button>
        <button
          onClick={onNext}
          disabled={!valid}
          className="flex-1 py-3.5 text-sm font-bold text-white rounded-xl
                       bg-gradient-to-r from-pink-500 to-rose-400
                       shadow-lg shadow-pink-200 active:scale-[0.98]
                       transition-all duration-300 disabled:opacity-50
                       disabled:cursor-not-allowed
                       flex items-center justify-center gap-2"
        >
          Continuar <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Paso 3: Horario preferencial ────────────────────────────────────────────
function StepSchedule({
  blocks, setBlocks, onNext, onBack,
}: {
  blocks: ScheduleBlock[];
  setBlocks: (v: ScheduleBlock[]) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [selectedDay, setSelectedDay] = useState(0);
  const [startTime, setStartTime]     = useState("09:00");
  const [endTime, setEndTime]         = useState("17:00");

  const addBlock = () => {
    if (startTime >= endTime) return;
    const newBlock: ScheduleBlock = {
      day_of_week:      selectedDay,
      start_time_local: startTime,
      end_time_local:   endTime,
    };
    const exists = blocks.some(
      (b) =>
        b.day_of_week === selectedDay &&
        b.start_time_local === startTime &&
        b.end_time_local === endTime
    );
    if (!exists) setBlocks([...blocks, newBlock]);
  };

  const removeBlock = (idx: number) =>
    setBlocks(blocks.filter((_, i) => i !== idx));

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300 space-y-5">
      <div>
        <h2 className="text-2xl font-black text-slate-800 tracking-tight">
          Horario preferido
        </h2>
        <p className="text-slate-500 text-sm mt-1">
          Opcional. Esto resalta los mejores slots al agendar.
        </p>
      </div>

      {/* Constructor */}
      <div className="bg-slate-50 rounded-2xl p-4 space-y-4">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
          Añadir bloque
        </p>

        {/* Días */}
        <div>
          <p className="text-xs font-bold text-slate-500 mb-2">Día</p>
          <div className="flex gap-2 flex-wrap">
            {DAYS.map((day, i) => (
              <button
                key={i}
                onClick={() => setSelectedDay(i)}
                className={`
                  px-3 py-2 rounded-xl text-sm font-bold border-2
                  transition-all duration-150
                  ${selectedDay === i
                    ? "border-pink-400 bg-pink-50 text-pink-600"
                    : "border-transparent bg-white text-slate-500 hover:border-slate-200"
                  }
                `}
              >
                {day}
              </button>
            ))}
          </div>
        </div>

        {/* Horas */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs font-bold text-slate-500 mb-2">Desde</p>
            <div className="relative">
              <select
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full appearance-none bg-white border-2 border-slate-100
                             rounded-xl text-sm font-bold text-slate-800 px-3 py-2.5
                             focus:outline-none focus:border-pink-400 cursor-pointer"
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2
                                         w-4 h-4 text-slate-400 pointer-events-none" />
            </div>
          </div>
          <div>
            <p className="text-xs font-bold text-slate-500 mb-2">Hasta</p>
            <div className="relative">
              <select
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full appearance-none bg-white border-2 border-slate-100
                             rounded-xl text-sm font-bold text-slate-800 px-3 py-2.5
                             focus:outline-none focus:border-pink-400 cursor-pointer"
              >
                {HOURS.filter((h) => h > startTime).map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2
                                         w-4 h-4 text-slate-400 pointer-events-none" />
            </div>
          </div>
        </div>

        <button
          onClick={addBlock}
          disabled={startTime >= endTime}
          className="w-full py-3 text-sm font-bold text-pink-600 bg-white
                       border-2 border-pink-200 hover:border-pink-400 rounded-xl
                       transition-all duration-200 disabled:opacity-40
                       disabled:cursor-not-allowed"
        >
          + Añadir bloque
        </button>
      </div>

      {/* Lista de bloques */}
      <div>
        <p className="text-[10px] font-black text-slate-400 uppercase
                        tracking-widest mb-3">
          Bloques añadidos
          {blocks.length > 0 && (
            <span className="ml-2 text-pink-500">({blocks.length})</span>
          )}
        </p>

        {blocks.length === 0 ? (
          <div className="bg-slate-50 rounded-2xl py-8 text-center">
            <CalendarDays className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-xs text-slate-400 font-bold">Sin bloques todavía</p>
            <p className="text-xs text-slate-400 mt-0.5">
              Puedes saltarte este paso
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
            {blocks.map((block, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between bg-white
                             border border-slate-100 rounded-xl px-4 py-2.5 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs font-black text-pink-600
                                     bg-pink-50 px-2.5 py-1 rounded-lg">
                    {DAYS[block.day_of_week]}
                  </span>
                  <span className="text-sm font-bold text-slate-700">
                    {block.start_time_local} – {block.end_time_local}
                  </span>
                </div>
                <button
                  onClick={() => removeBlock(idx)}
                  className="text-slate-300 hover:text-red-400 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-3 pt-2">
        <button
          onClick={onBack}
          className="flex-1 py-3.5 text-sm font-bold text-slate-600
                       bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors
                       flex items-center justify-center gap-2"
        >
          <ChevronLeft className="w-4 h-4" /> Volver
        </button>
        <button
          onClick={onNext}
          className="flex-1 py-3.5 text-sm font-bold text-white rounded-xl
                       bg-gradient-to-r from-pink-500 to-rose-400
                       shadow-lg shadow-pink-200 active:scale-[0.98]
                       transition-all duration-300
                       flex items-center justify-center gap-2"
        >
          {blocks.length === 0 ? "Saltar" : "Continuar"}
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Paso 4: Métodos de pago ──────────────────────────────────────────────────
function StepPaymentMethods({
  selected, setSelected, onNext, onBack, saving,
}: {
  selected: string[];
  setSelected: (v: string[]) => void;
  onNext: () => void;
  onBack: () => void;
  saving: boolean;
}) {
  const toggle = (v: string) =>
    setSelected(
      selected.includes(v)
        ? selected.filter((x) => x !== v)
        : [...selected, v]
    );

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300 space-y-6">
      <div>
        <h2 className="text-2xl font-black text-slate-800 tracking-tight">
          Métodos de pago
        </h2>
        <p className="text-slate-500 text-sm mt-1">
          ¿Con qué método prefieres pagar? Puedes elegir varios.
        </p>
      </div>

      <div className="space-y-3">
        {PAYMENT_METHODS.map((pm) => (
          <button
            key={pm.value}
            onClick={() => toggle(pm.value)}
            className={`
              w-full flex items-center gap-4 px-5 py-4 rounded-2xl
              border-2 transition-all duration-200 text-left
              ${selected.includes(pm.value)
                ? "border-pink-400 bg-pink-50"
                : "border-slate-100 bg-white hover:border-slate-200"
              }
            `}
          >
            <span className="text-2xl">{pm.icon}</span>
            <span className="flex-1 text-base font-bold text-slate-700">
              {pm.label}
            </span>
            <div className={`
              w-6 h-6 rounded-full border-2 flex items-center justify-center
              transition-all flex-shrink-0
              ${selected.includes(pm.value)
                ? "border-pink-500 bg-pink-500"
                : "border-slate-300"
              }
            `}>
              {selected.includes(pm.value) && (
                <Check className="w-3.5 h-3.5 text-white" />
              )}
            </div>
          </button>
        ))}
      </div>

      <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
        <p className="text-xs font-bold text-amber-700">
          💡 El pago se coordina directamente con la profesora.
          Esta selección es solo para agilizar el proceso.
        </p>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          disabled={saving}
          className="flex-1 py-3.5 text-sm font-bold text-slate-600
                       bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors
                       flex items-center justify-center gap-2
                       disabled:opacity-50"
        >
          <ChevronLeft className="w-4 h-4" /> Volver
        </button>
        <button
          onClick={onNext}
          disabled={saving}
          className="flex-1 py-3.5 text-sm font-bold text-white rounded-xl
                       bg-gradient-to-r from-pink-500 to-rose-400
                       shadow-lg shadow-pink-200 active:scale-[0.98]
                       transition-all duration-300 disabled:opacity-60
                       flex items-center justify-center gap-2"
        >
          {saving ? (
            <div className="w-4 h-4 border-2 border-white/40
                              border-t-white rounded-full animate-spin" />
          ) : (
            <>{selected.length === 0 ? "Saltar" : "Finalizar"}
              <ChevronRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Paso 5: Éxito ────────────────────────────────────────────────────────────
function StepSuccess({ name }: { name: string }) {
  return (
    <div className="flex flex-col items-center text-center py-4
                    animate-in fade-in zoom-in-95 duration-500">
      <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center
                        justify-center mb-6 shadow-xl shadow-emerald-100">
        <Check className="w-10 h-10 text-emerald-600" />
      </div>

      <h2 className="text-3xl font-black text-slate-800 tracking-tight mb-3">
        ¡Todo listo, {name}!
      </h2>
      <p className="text-slate-500 leading-relaxed mb-8 max-w-sm">
        Tu perfil está configurado. Ya puedes agendar tu primera clase.
      </p>

      <div className="w-full space-y-3 mb-8 text-left">
        {[
          {
            icon: <CalendarDays className="w-4 h-4 text-pink-500" />,
            label: "Agenda tu clase de prueba gratuita",
            sub:   "Conoce a la profesora sin compromiso",
          },
          {
            icon: <Target className="w-4 h-4 text-purple-500" />,
            label: "Revisa los materiales disponibles",
            sub:   "Recursos adaptados a tu nivel",
          },
        ].map((item, i) => (
          <div key={i}
            className="flex items-center gap-4 bg-slate-50 rounded-2xl p-4">
            <div className="w-10 h-10 bg-white rounded-xl border border-slate-100
                              flex items-center justify-center flex-shrink-0 shadow-sm">
              {item.icon}
            </div>
            <div>
              <p className="text-sm font-bold text-slate-800">{item.label}</p>
              <p className="text-xs text-slate-500 mt-0.5">{item.sub}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function OnboardingPage() {
  const router       = useRouter();
  const { user, setUser } = useAuthStore();

  const [step, setStep] = useState(1);
  const TOTAL_STEPS     = 5;

  const [timezone,   setTimezone]   = useState(
    typeof window !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : "UTC"
  );
  const [goal,       setGoal]       = useState("");
  const [blocks,     setBlocks]     = useState<ScheduleBlock[]>([]);
  const [payMethods, setPayMethods] = useState<string[]>([]);

  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  const name = user?.name ?? "Estudiante";

  const next = () => setStep((p) => Math.min(p + 1, TOTAL_STEPS));
  const back = () => setStep((p) => Math.max(p - 1, 1));

  // ── Guardar y marcar onboarding completo ──
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

      // 4. Actualizar el store local para que el guard no vuelva a redirigir
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

      // 6. Redirigir al dashboard tras 2.5s
      setTimeout(() => router.push("/dashboard"), 2500);

    } catch (e: any) {
      setError(
        e.response?.data?.detail ||
        "Error guardando la configuración. Inténtalo de nuevo."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden
                    flex items-center justify-center p-4">
      {/* Blobs de fondo */}
      <div className="fixed top-[-100px] right-[-100px] w-[500px] h-[500px]
                        bg-pink-300/25 rounded-full blur-[120px] pointer-events-none" />
      <div className="fixed bottom-[-80px] left-[-80px] w-[400px] h-[400px]
                        bg-rose-300/20 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative w-full max-w-md
                        animate-in fade-in slide-in-from-bottom-6 duration-500">

        {/* Card principal */}
        <div className="bg-white/80 backdrop-blur-xl rounded-[2.5rem]
                          border border-white shadow-2xl shadow-slate-200/50 p-8">

          {/* Barra de pasos (pasos 2–4) */}
          {step >= 2 && step <= 4 && (
            <StepBar current={step - 1} total={3} />
          )}

          {/* Error global */}
          {error && (
            <div className="mb-5 bg-rose-50 border border-rose-100 text-rose-600
                              px-4 py-3 rounded-xl text-xs font-bold
                              flex items-center gap-2">
              <X className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Pasos */}
          {step === 1 && <StepWelcome name={name} onNext={next} />}

          {step === 2 && (
            <StepPreferences
              timezone={timezone} setTimezone={setTimezone}
              goal={goal}         setGoal={setGoal}
              onNext={next}       onBack={back}
            />
          )}

          {step === 3 && (
            <StepSchedule
              blocks={blocks} setBlocks={setBlocks}
              onNext={next}   onBack={back}
            />
          )}

          {step === 4 && (
            <StepPaymentMethods
              selected={payMethods} setSelected={setPayMethods}
              onNext={finish}       onBack={back}
              saving={saving}
            />
          )}

          {step === 5 && (
            <>
              <StepSuccess name={name} />
              <button
                onClick={() => router.push("/dashboard")}
                className="w-full py-4 text-sm font-bold text-white rounded-xl
                             bg-gradient-to-r from-pink-500 to-rose-400
                             shadow-xl shadow-pink-200 hover:shadow-pink-300
                             active:scale-[0.98] transition-all duration-300
                             flex items-center justify-center gap-2"
              >
                Ir a mi dashboard
                <ChevronRight className="w-4 h-4" />
              </button>
            </>
          )}
        </div>

        {/* Indicador de paso */}
        {step < 5 && (
          <p className="text-center text-xs text-slate-400 font-bold mt-4">
            {step === 1 ? "Paso 1 de 4 — Bienvenida" : `Paso ${step} de 4`}
          </p>
        )}
      </div>
    </div>
  );
}