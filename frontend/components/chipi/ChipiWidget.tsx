"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import { X, Send, Minimize2, Sparkles, RotateCcw, Bot, LifeBuoy } from "lucide-react";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { usePathname } from "next/navigation";
import SupportTicketModal from "@/components/support/SupportTicketModal";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  loading?: boolean;
}

// ─── Sugerencias Rápidas por defecto ─────────────────────────────────────────
const QUICK_SUGGESTIONS = [
  "¿Cómo puedo agendar una clase?",
  "Ver métodos de pago disponibles",
  "Tengo un problema técnico"
];

// ─── Mapeo de ruta → screen_name (contexto para Chipi) ────────────────────────
// IMPORTANTE: estas claves deben coincidir EXACTAMENTE con las que espera
// `SCREEN_CONTEXTS` en el backend (backend/app/core/chipi/prompts.py). Si
// agregas una pantalla nueva, agrégala en ambos lados con la misma clave.
//
// Nota: cuando una pantalla ya renderiza <ChipiWidget screenName="..." />
// con un valor explícito, ese prop tiene prioridad y este mapeo automático
// solo se usa como respaldo (por si algún día se agrega el widget a una
// pantalla nueva sin pasar el prop a mano).
//
// Las rutas se ordenan por especificidad (más larga primero) para que un
// prefijo genérico como "/admin" nunca "tape" a una ruta más específica
// como "/admin/students/banned" — a diferencia del bug anterior, que
// dependía del orden de inserción del objeto.
const SCREEN_ROUTES: Array<[string, string]> = ([
  // Públicas
  ["/", "main"],
  ["/login", "login"],
  ["/register/google-complete", "register_google_complete"],
  ["/register", "register"],
  ["/forgot-password", "forgot-password"],
  ["/reset-password", "reset-password"],

  // Estudiante
  // Nota: "/dashboard/teachers" (lista) vs "/dashboard/teachers/[username]"
  // (perfil individual) se resuelven con un caso especial en
  // useScreenName(), porque comparten el mismo prefijo y necesitan
  // distinguirse por igualdad exacta vs. sub-ruta dinámica.
  ["/dashboard/onboarding", "onboarding_student"],
  ["/dashboard/schedule", "schedule_student"],
  ["/dashboard/classes", "my_classes_student"],
  ["/dashboard/materials", "materials_student"],
  ["/dashboard/homework", "homework_student"],
  ["/dashboard/profile", "student_profile"],
  ["/dashboard/availability", "student-preferences"],
  ["/dashboard/support", "support_student"],
  ["/dashboard", "student_home"],

  // Profesor
  ["/teacher/onboarding", "onboarding_teacher"],
  ["/teacher/dashboard", "teacher_home"],
  ["/teacher/materials", "materials_teacher"],
  ["/teacher/homework", "homework_teacher"],
  ["/teacher/profile/preview", "teacher-view"],
  ["/teacher/profile", "teacher_profile"],
  ["/teacher/wallet", "wallet_teacher"],
  ["/teacher/availability", "teacher-availability"],
  ["/teacher/packages", "teacher_packages"],
  ["/teacher/cohorts", "teacher_cohorts"],
  ["/teacher/students", "teacher_students"],
  ["/teacher/support", "support_teacher"],
  ["/teacher/payments", "teacher_payments"],
  ["/teacher/calendar/callback", "teacher_calendar_callback"],

  // Admin / staff
  ["/admin/dashboard", "admin_home"],
  ["/admin/flow-tester", "admin_flow_tester"],
  ["/admin/god-mode", "admin_god_mode"],
  ["/admin/logs", "admin_logs"],
  ["/admin/students/banned", "admin_students_banned"],
  ["/admin/students", "admin_students"],
  ["/admin/teachers", "admin_teachers"],
  ["/admin/payments", "admin_payments"],
  ["/admin/settings", "admin_settings"],
  ["/admin/support", "admin_support"],
  ["/admin/users", "admin_users"],

  // Fallbacks genéricos (solo se alcanzan si se agrega una pantalla nueva
  // bajo /teacher o /admin sin registrarla arriba)
  ["/teacher", "teacher_home"],
  ["/admin", "admin_home"],
].sort((a, b) => b[0].length - a[0].length) as Array<[string, string]>);

function useScreenName(): string {
  const pathname = usePathname() || "/";

  if (pathname === "/") return "main";

  // Caso especial: lista de profesores vs. perfil individual de un
  // profesor. Comparten el mismo prefijo ("/dashboard/teachers"), así que
  // no pueden distinguirse con el algoritmo genérico de más abajo.
  if (pathname === "/dashboard/teachers") return "choose_teacher";
  if (pathname.startsWith("/dashboard/teachers/")) return "teacher_browse";

  for (const [key, val] of SCREEN_ROUTES) {
    if (key === "/") continue;
    if (pathname === key || pathname.startsWith(key + "/")) {
      return val;
    }
  }
  return "main";
}

// ─── Burbuja de mensaje ───────────────────────────────────────────────────────
function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";

  return (
    <div className={`flex gap-2.5 items-end transition-all duration-200 animate-in fade-in slide-in-from-bottom-2 ${
      isUser ? "flex-row-reverse" : "flex-row"
    }`}>
      {/* Avatar Chipi */}
      {!isUser && (
        <div className="w-7 h-7 rounded-xl overflow-hidden flex-shrink-0 border border-pink-100 shadow-sm bg-gradient-to-br from-pink-100 to-rose-50 flex items-center justify-center p-0.5">
          <Image
            src="/assets/logo.png"
            alt="Chipi"
            width={26}
            height={26}
            className="object-contain w-full h-full"
          />
        </div>
      )}

      <div
        className={`max-w-[82%] px-4 py-2.5 rounded-2xl text-xs sm:text-sm leading-relaxed ${
          isUser
            ? "bg-gradient-to-r from-pink-500 to-rose-500 text-white rounded-br-xs shadow-md shadow-pink-500/10 font-medium"
            : "bg-white border border-slate-100 text-slate-700 rounded-bl-xs shadow-sm font-medium"
        }`}
      >
        {msg.loading ? (
          /* Indicador de escritura refinado */
          <div className="flex gap-1.5 items-center py-1 px-1">
            <span className="text-[11px] font-semibold text-slate-400 mr-1">Chipi está escribiendo</span>
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="w-1.5 h-1.5 bg-pink-400 rounded-full animate-bounce"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </div>
        ) : (
          <p className="whitespace-pre-wrap">{msg.content}</p>
        )}
      </div>
    </div>
  );
}

// ─── Props del widget ─────────────────────────────────────────────────────────
interface ChipiWidgetProps {
  screenName?: string;
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function ChipiWidget({ screenName }: ChipiWidgetProps) {
  const autoScreen  = useScreenName();
  const screen      = screenName ?? autoScreen;
  const { user }    = useAuthStore();
  const canReportToSupport = user?.role === "student" || user?.role === "teacher";

  const [open, setOpen]                 = useState(false);
  const [supportOpen, setSupportOpen]   = useState(false);
  const [input, setInput]               = useState("");
  const [messages, setMessages]         = useState<Message[]>([
    {
      id:      "welcome",
      role:    "assistant",
      content: "¡Hola! 👋 Soy Chipi, tu asistente IA. ¿En qué te puedo ayudar hoy?",
    },
  ]);
  const [sending, setSending]           = useState(false);
  const [idleVisible, setIdleVisible]   = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLInputElement>(null);
  const idleTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-scroll al último mensaje
  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, open]);

  // Focus en input al abrir
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open]);

  // Burbuja de inactividad (aparece a los 12s sin interacción)
  const resetIdleTimer = useCallback(() => {
    setIdleVisible(false);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (!open) {
      idleTimerRef.current = setTimeout(() => {
        setIdleVisible(true);
      }, 12000);
    }
  }, [open]);

  useEffect(() => {
    resetIdleTimer();
    window.addEventListener("click", resetIdleTimer);
    window.addEventListener("keydown", resetIdleTimer);
    return () => {
      window.removeEventListener("click", resetIdleTimer);
      window.removeEventListener("keydown", resetIdleTimer);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [resetIdleTimer]);

  const handleToggle = () => {
    setIdleVisible(false);
    setOpen(p => !p);
  };

  // Resetear conversación
  const handleResetChat = () => {
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        content: "¡Chat reiniciado! 🔄 ¿En qué más puedo ayudarte?",
      },
    ]);
  };

  // Enviar mensaje
  const sendMessage = async (customText?: string) => {
    const text = (customText || input).trim();
    if (!text || sending) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: text,
    };
    const loadingMsg: Message = {
      id: "loading",
      role: "assistant",
      content: "",
      loading: true,
    };

    setMessages(p => [...p, userMsg, loadingMsg]);
    setInput("");
    setSending(true);

    try {
      const res = await api.post("/chipi/chat", {
        message: text,
        screen: screen,
        stream: false,
      });

      setMessages(p =>
        p
          .filter(m => m.id !== "loading")
          .concat({
            id: Date.now().toString() + "_r",
            role: "assistant",
            content: res.data.response,
          })
      );
    } catch {
      setMessages(p =>
        p
          .filter(m => m.id !== "loading")
          .concat({
            id: Date.now().toString() + "_err",
            role: "assistant",
            content: "Tuve un pequeño inconveniente de conexión. 🔌 ¿Podrías intentarlo nuevamente?",
          })
      );
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <>
      {/* ─── Burbuja de Inactividad (Tooltip Flotante) ─── */}
      <div
        onClick={handleToggle}
        className={`fixed bottom-[calc(6.5rem+env(safe-area-inset-bottom))] right-4 md:bottom-24 md:right-6 z-40 max-w-[240px] cursor-pointer
          bg-white/95 backdrop-blur-md border border-pink-100
          shadow-xl shadow-pink-500/10 rounded-2xl rounded-br-none
          p-3.5 transition-all duration-300 hover:scale-105 active:scale-95
          ${idleVisible && !open
            ? "opacity-100 translate-y-0 pointer-events-auto"
            : "opacity-0 translate-y-3 pointer-events-none"
          }
        `}
      >
        <div className="flex items-center justify-between mb-1">
          <span className="inline-flex items-center gap-1 text-[10px] font-black text-pink-600 bg-pink-50 px-2 py-0.5 rounded-full uppercase tracking-wider">
            <Sparkles className="w-3 h-3" /> Chipi AI
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIdleVisible(false);
            }}
            className="text-slate-400 hover:text-slate-600 p-0.5"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
        <p className="text-xs font-bold text-slate-700 leading-snug">
          ¿Tienes alguna duda sobre esta sección?
        </p>
        <p className="text-[11px] text-slate-400 mt-0.5">Haz clic para conversar 💬</p>
      </div>

      {/* ─── Ventana Principal de Chat ─── */}
      <div
        className={`fixed bottom-[calc(6.5rem+env(safe-area-inset-bottom))] right-4 sm:right-6 md:bottom-24 z-50 
          w-[calc(100vw-2rem)] sm:w-[370px]
          bg-white/95 backdrop-blur-2xl rounded-[2rem]
          border border-slate-100 shadow-2xl shadow-slate-900/15
          flex flex-col overflow-hidden
          transition-all duration-300 origin-bottom-right
          ${open
            ? "opacity-100 scale-100 pointer-events-auto translate-y-0"
            : "opacity-0 scale-90 pointer-events-none translate-y-4"
          }
        `}
        style={{ height: "min(500px, calc(100dvh - 10rem))" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-pink-500 via-rose-500 to-pink-600 flex-shrink-0 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="relative w-9 h-9 rounded-2xl overflow-hidden border-2 border-white/40 flex-shrink-0 shadow-inner bg-white/10 p-0.5">
              <Image
                src="/assets/logo.png"
                alt="Chipi AI"
                width={36}
                height={36}
                className="object-contain w-full h-full"
              />
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="text-white font-black text-sm tracking-tight leading-none">Chipi AI</h3>
                <span className="bg-white/20 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase">
                  Beta
                </span>
              </div>
              <p className="text-white/80 text-[11px] font-medium mt-0.5 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
                Asistente Virtual
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={handleResetChat}
              title="Reiniciar chat"
              className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white/90 hover:text-white transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white/90 hover:text-white transition-colors"
            >
              <Minimize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Mensajes */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-slate-50/60 custom-scrollbar">
          {messages.map(msg => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Sugerencias Rápidas (Chips) si solo hay el mensaje de bienvenida */}
        {messages.length <= 1 && (
          <div className="px-4 py-2 bg-slate-50/80 border-t border-slate-100 flex gap-1.5 overflow-x-auto custom-scrollbar no-scrollbar">
            {QUICK_SUGGESTIONS.map((sug, idx) => (
              <button
                key={idx}
                onClick={() => sendMessage(sug)}
                className="whitespace-nowrap text-[11px] font-semibold text-pink-600 bg-pink-50/80 hover:bg-pink-100/80 border border-pink-100 rounded-xl px-2.5 py-1 transition-all flex-shrink-0"
              >
                {sug}
              </button>
            ))}
          </div>
        )}

        {/* Enlace a soporte humano — solo para student/teacher autenticados */}
        {canReportToSupport && (
          <div className="px-4 py-2 bg-white border-t border-slate-100 flex-shrink-0">
            <button
              onClick={() => setSupportOpen(true)}
              className="w-full flex items-center justify-center gap-1.5 text-[11px] font-bold
                         text-slate-400 hover:text-pink-600 transition-colors py-1"
            >
              <LifeBuoy className="w-3.5 h-3.5" />
              ¿Chipi no resolvió tu duda? Habla con soporte
            </button>
          </div>
        )}

        {/* Área de Input */}
        <div className="p-3 bg-white border-t border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2 bg-slate-50 rounded-2xl border border-slate-200/80 p-1.5 focus-within:border-pink-400 focus-within:ring-4 focus-within:ring-pink-50/50 transition-all">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Pregúntale algo a Chipi..."
              disabled={sending}
              className="flex-1 bg-transparent border-none text-xs sm:text-sm font-medium text-slate-800 placeholder:text-slate-400 px-2 py-1 focus:outline-none disabled:opacity-60"
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || sending}
              className="w-8 h-8 rounded-xl bg-gradient-to-r from-pink-500 to-rose-500 flex items-center justify-center text-white shadow-sm shadow-pink-500/20 hover:shadow-pink-500/30 hover:scale-105 active:scale-95 transition-all disabled:opacity-40 disabled:hover:scale-100 disabled:cursor-not-allowed flex-shrink-0"
            >
              {sending ? (
                <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
          <div className="flex items-center justify-between px-2 mt-1.5">
            <span className="text-[10px] text-slate-400 font-medium">
              Contexto: <strong className="text-slate-500 font-bold">{screen}</strong>
            </span>
            <span className="text-[10px] text-slate-400 font-medium">Powered by Chipi AI</span>
          </div>
        </div>
      </div>

      {/* ─── Botón Flotante Principal ─── */}
      <button
        onClick={handleToggle}
        className={`fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 md:bottom-6 md:right-6 z-50
          w-14 h-14 rounded-2xl overflow-hidden
          shadow-xl shadow-pink-500/25 hover:shadow-pink-500/40
          border-2 border-white
          flex items-center justify-center
          transition-all duration-300 transform
          hover:scale-110 active:scale-95
          ${open 
            ? "bg-slate-900 text-white rotate-90" 
            : "bg-gradient-to-br from-pink-500 to-rose-500 text-white rotate-0"
          }
        `}
        aria-label="Abrir asistente Chipi"
      >
        {open ? (
          <X className="w-6 h-6 text-white transition-transform duration-300 -rotate-90" />
        ) : (
          <div className="relative w-full h-full flex items-center justify-center p-2.5">
            <Image
              src="/assets/logo.png"
              alt="Chipi AI"
              width={40}
              height={40}
              className="object-contain w-full h-full"
            />
            {/* Anillo de pulso exterior en estado cerrado */}
            <span className="absolute inset-0 rounded-2xl bg-pink-400/20 animate-ping -z-10" />
            <span className="absolute bottom-1 right-1 w-3 h-3 bg-emerald-400 rounded-full border-2 border-white" />
          </div>
        )}
      </button>

      {canReportToSupport && (
        <SupportTicketModal
          open={supportOpen}
          onClose={() => setSupportOpen(false)}
          screenContext={screen}
          initialMessage={
            [...messages].reverse().find(m => m.role === "user" && !m.loading)?.content ?? ""
          }
        />
      )}
    </>
  );
}