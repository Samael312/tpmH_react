"use client";

import { useEffect, useState } from "react";
import { Sparkles, Zap, Clock, MessageCircle, Bot } from "lucide-react";
import ChipiMascot from "@/components/landing/ChipiMascot";

// ─── Conversación de ejemplo, en loop ──────────────────────────────────────
const DEMO_EXCHANGES: { question: string; answer: string }[] = [
  {
    question: "¿Cómo agendo mi próxima clase?",
    answer: "Elige un horario disponible en tu calendario y confirma en un toque ✨",
  },
  {
    question: "¿Qué métodos de pago aceptan?",
    answer: "Tarjeta, transferencia y pago móvil. ¡Te explico paso a paso!",
  },
  {
    question: "Perdí una clase, ¿qué hago?",
    answer: "Sin problema, puedo ayudarte a reprogramarla en segundos.",
  },
];

// Fases de la animación del mockup: 0 vacío, 1 pregunta, 2 escribiendo, 3 respuesta
const PHASE_QUESTION = 1;
const PHASE_TYPING = 2;
const PHASE_ANSWER = 3;

function TypingDots() {
  return (
    <div className="flex gap-1 items-center">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-pink-400 animate-bounce"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  );
}

const FEATURES = [
  { icon: <Clock className="w-4 h-4" />, label: "Disponible 24/7" },
  { icon: <Zap className="w-4 h-4" />, label: "Respuestas al instante" },
  { icon: <Sparkles className="w-4 h-4" />, label: "Aprende de cada charla" },
];

export default function ChipiSection() {
  const [phase, setPhase] = useState(0);
  const [exchangeIdx, setExchangeIdx] = useState(0);

  // Ciclo simple de la conversación de ejemplo, sin dependencias externas
  // de animación: solo setTimeout/interval encadenados por fase.
  useEffect(() => {
    let cancelled = false;
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    const runCycle = () => {
      if (cancelled) return;
      setPhase(PHASE_QUESTION);
      timeouts.push(setTimeout(() => !cancelled && setPhase(PHASE_TYPING), 1200));
      timeouts.push(setTimeout(() => !cancelled && setPhase(PHASE_ANSWER), 2600));
      timeouts.push(
        setTimeout(() => {
          if (cancelled) return;
          setPhase(0);
          setExchangeIdx(i => (i + 1) % DEMO_EXCHANGES.length);
        }, 5400)
      );
    };

    runCycle();
    const interval = setInterval(runCycle, 5800);

    return () => {
      cancelled = true;
      clearInterval(interval);
      timeouts.forEach(clearTimeout);
    };
  }, []);

  const exchange = DEMO_EXCHANGES[exchangeIdx];

  return (
    <section id="chipi" className="py-24 relative overflow-hidden bg-gradient-to-br from-slate-900 via-[#1a1030] to-slate-900">
      {/* ── Fondo decorado: grilla punteada + blobs animados ── */}
      <div
        className="absolute inset-0 opacity-[0.07] pointer-events-none"
        style={{ backgroundImage: "radial-gradient(circle, white 1px, transparent 1px)", backgroundSize: "28px 28px" }}
      />
      <div className="absolute -top-24 -left-24 w-[420px] h-[420px] bg-pink-600/30 rounded-full blur-[110px] animate-blob pointer-events-none" />
      <div className="absolute -bottom-24 -right-24 w-[420px] h-[420px] bg-purple-600/30 rounded-full blur-[110px] animate-blob pointer-events-none" style={{ animationDelay: "2.5s" }} />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-rose-500/10 rounded-full blur-[130px] pointer-events-none" />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 z-10 grid grid-cols-1 lg:grid-cols-[0.85fr_1.15fr] gap-14 lg:gap-10 items-center">
        {/* Mascota, sola en su columna */}
        <div className="flex justify-center lg:justify-start">
          <ChipiMascot />
        </div>

        {/* Texto + mockup de chat, juntos en la otra columna */}
        <div className="flex flex-col items-center lg:items-start gap-10">
          <div className="text-center lg:text-left">
            <p className="inline-flex items-center gap-1.5 text-[10px] font-bold text-pink-300 uppercase tracking-widest mb-4 bg-white/5 border border-white/10 px-3 py-1.5 rounded-full">
              <Bot className="w-3.5 h-3.5" /> Asistente con IA
            </p>
            <h2 className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight mb-5 leading-tight">
              Conoce a{" "}
              <span className="bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">Chipi</span>
            </h2>
            <p className="text-slate-300 text-lg leading-relaxed max-w-lg mx-auto lg:mx-0 mb-8">
              Tu copiloto dentro de la plataforma. Resuelve dudas sobre horarios, pagos y clases al instante,
              las 24 horas del día — para que nunca te quedes esperando una respuesta.
            </p>

            <div className="flex flex-wrap justify-center lg:justify-start gap-3">
              {FEATURES.map(f => (
                <div key={f.label} className="flex items-center gap-2 bg-white/5 border border-white/10 backdrop-blur-sm rounded-full px-4 py-2 text-xs font-bold text-white/90">
                  <span className="text-pink-400">{f.icon}</span>
                  {f.label}
                </div>
              ))}
            </div>
          </div>

          {/* Mockup de chat animado */}
          <div className="flex justify-center lg:justify-start w-full">
            <div className="relative w-full max-w-sm">
              <div className="absolute inset-0 bg-gradient-to-br from-pink-500/40 to-purple-500/40 rounded-[2.5rem] blur-2xl scale-95 animate-pulse pointer-events-none" />

              <div className="relative bg-white/95 backdrop-blur-xl rounded-[2rem] border border-white/20 shadow-2xl overflow-hidden">
                {/* Header falso */}
                <div className="flex items-center gap-2.5 px-5 py-3.5 bg-gradient-to-r from-pink-500 via-rose-500 to-pink-600">
                  <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
                    <MessageCircle className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <p className="text-white font-black text-xs">Chipi AI</p>
                    <p className="text-white/70 text-[10px] flex items-center gap-1">
                      <span className="w-1.5 h-1.5 bg-emerald-300 rounded-full animate-pulse" /> En línea
                    </p>
                  </div>
                </div>

                {/* Cuerpo del chat */}
                <div className="p-5 space-y-3 min-h-[220px] flex flex-col justify-end">
                  {phase === 0 && (
                    <p className="text-center text-[11px] text-slate-400 font-semibold px-4">
                      Escribe cualquier pregunta y Chipi te responde al instante
                    </p>
                  )}

                  {phase >= PHASE_QUESTION && (
                    <div className="flex justify-end animate-pop-in">
                      <div className="max-w-[80%] bg-gradient-to-r from-pink-500 to-rose-500 text-white text-xs font-medium px-4 py-2.5 rounded-2xl rounded-br-sm shadow-md">
                        {exchange.question}
                      </div>
                    </div>
                  )}

                  {phase === PHASE_TYPING && (
                    <div className="flex justify-start animate-pop-in">
                      <div className="bg-slate-100 rounded-2xl rounded-bl-sm px-4 py-3">
                        <TypingDots />
                      </div>
                    </div>
                  )}

                  {phase === PHASE_ANSWER && (
                    <div className="flex justify-start animate-pop-in">
                      <div className="max-w-[85%] bg-slate-100 text-slate-700 text-xs font-medium px-4 py-2.5 rounded-2xl rounded-bl-sm shadow-sm">
                        {exchange.answer}
                      </div>
                    </div>
                  )}
                </div>

                {/* Input falso */}
                <div className="px-4 pb-4">
                  <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-2xl px-3 py-2.5">
                    <span className="flex-1 text-[11px] text-slate-400 font-medium">Pregúntale algo a Chipi...</span>
                    <div className="w-7 h-7 rounded-xl bg-gradient-to-r from-pink-500 to-rose-500 flex items-center justify-center flex-shrink-0">
                      <Sparkles className="w-3.5 h-3.5 text-white" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
